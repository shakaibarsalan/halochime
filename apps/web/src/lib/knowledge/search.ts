import "server-only";
import { sql } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, type KnowledgeSearchResponse } from "@talkfront/shared";
import { db } from "@/db";

export type SearchScope = { organizationId: string; agentId: string };
export type SearchResult = KnowledgeSearchResponse["results"][number];

type Row = { chunk_id: string; source_id: string; title: string; url: string | null; content: string; score: number };

const toResult = (r: Row): SearchResult => ({
  chunkId: r.chunk_id,
  sourceId: r.source_id,
  title: r.title,
  url: r.url,
  content: r.content,
  score: Number(r.score),
});

// Only ready sources of this workspace that are shared (agent_id null) or owned by this agent.
const scopeFilter = (scope: SearchScope) => sql`
  c.organization_id = ${scope.organizationId}
  and s.organization_id = ${scope.organizationId}
  and s.status = 'ready'
  and (s.agent_id is null or s.agent_id = ${scope.agentId})`;

function words(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0, 20);
}

// ---------------------------------------------------------------------------------------------
// Lexical: IDF-weighted word matching
// ---------------------------------------------------------------------------------------------

/** A word found in more than this share of the chunks (e.g. the business name) is "common". */
const COMMON_SHARE = 0.5;
/** Below this many chunks, document frequency says little, so no word is treated as common. */
const MIN_CHUNKS_FOR_COMMON = 5;
const MAX_TERMS = 24;

/**
 * Each query word is stemmed with the English config (stop words dropped; Urdu, Arabic, Hindi and
 * other scripts pass through as written) and matched against the source title + chunk text.
 * A word that matches nothing exactly is tried as a prefix ("transcr" finds "transcripts").
 *
 * Score = share of the query's information found in the chunk: the sum of the matched words'
 * IDF (BM25 formula) over the sum for all query words, plus a small ts_rank_cd tie-break.
 * Words found in most chunks get almost no weight, and chunks that match only such common
 * words are dropped whenever another chunk matches a rarer word. So "Halochime latency" ranks
 * the chunk about latency first, not every chunk that says "Halochime".
 *
 * Computed per query over the workspace's chunks (fine for one workspace; a stored English
 * tsvector column is the next step when knowledge bases get large).
 */
async function lexical(scope: SearchScope, query: string, limit: number): Promise<Row[]> {
  const rows = await db.execute<Row>(sql`
    with docs as materialized (
      select c.id as chunk_id, c.source_id, s.title, s.url, c.content, c.position,
             to_tsvector('english', s.title || ' ' || c.content) as en
      from knowledge_chunks c
      join knowledge_sources s on s.id = c.source_id
      where ${scopeFilter(scope)}
    ),
    n as (select count(*)::float8 as n from docs),
    lexemes as (
      select distinct lex
      from unnest(tsvector_to_array(to_tsvector('english', ${query}))) as lex
      limit ${MAX_TERMS}
    ),
    exact as (
      select lex, plainto_tsquery('simple', lex) as q,
             (select count(*) from docs d where d.en @@ plainto_tsquery('simple', lex))::float8 as df
      from lexemes
    ),
    -- No exact match anywhere: try the word as a prefix (plain a-z/0-9 words of 4+ letters only).
    terms as (
      select coalesce(p.q, e.q) as q, coalesce(p.df, e.df) as df
      from exact e
      left join lateral (
        select pq.q, (select count(*) from docs d where d.en @@ pq.q)::float8 as df
        from (select to_tsquery('simple', e.lex || ':*') as q) pq
        where e.df = 0 and e.lex ~ '^[a-z0-9]{4,}$'
      ) p on true
    ),
    -- Every query word counts, so a chunk that covers only part of the question scores lower;
    -- a word missing from the whole workspace gets the highest IDF.
    weighted as (
      select t.q, t.df,
             ln(1 + (n.n - t.df + 0.5) / (t.df + 0.5)) as idf,
             (n.n >= ${MIN_CHUNKS_FOR_COMMON} and t.df > ${COMMON_SHARE} * n.n) as common
      from terms t cross join n
    ),
    total as (select sum(idf) as idf from weighted),
    any_q as (
      select string_agg('(' || querytree(q) || ')', ' | ')::tsquery as q
      from weighted where df > 0 and not common
    ),
    hits as (
      select d.chunk_id, sum(w.idf) as hit_idf, bool_and(w.common) as only_common
      from docs d
      join weighted w on w.df > 0 and d.en @@ w.q
      group by d.chunk_id
    )
    select d.chunk_id, d.source_id, d.title, d.url, d.content,
           0.9 * h.hit_idf / nullif(total.idf, 0)
             + 0.1 * coalesce(ts_rank_cd(d.en, any_q.q, 32), 0) as score
    from hits h
    join docs d on d.chunk_id = h.chunk_id
    cross join total
    cross join any_q
    where not h.only_common or not exists (select 1 from hits x where not x.only_common)
    order by score desc, d.position asc
    limit ${limit}`);
  return [...rows];
}

/**
 * Last resort for partial words and scripts the parser splits oddly. English stop words
 * ("what", "you") are left out so they don't match every chunk. Words only hold letters and
 * digits (see `words`), so they need no LIKE escaping.
 */
async function substring(scope: SearchScope, query: string, limit: number): Promise<Row[]> {
  const terms = words(query).filter((w) => w.length >= 3).slice(0, 8);
  if (terms.length === 0) return [];
  const list = sql.join(terms.map((w) => sql`${w}`), sql`, `);
  const rows = await db.execute<Row>(sql`
    with t as (
      select w from unnest(array[${list}]::text[]) as w
      where to_tsvector('english', w) <> ''::tsvector
    ),
    nt as (select count(*)::float8 as n from t)
    select * from (
      select c.id as chunk_id, c.source_id, s.title, s.url, c.content, c.position,
             (select count(*) from t where c.content ilike '%' || t.w || '%')::float8 / nullif(nt.n, 0) as score
      from knowledge_chunks c
      join knowledge_sources s on s.id = c.source_id
      cross join nt
      where ${scopeFilter(scope)}
    ) x
    where score > 0
    order by score desc, position asc
    limit ${limit}`);
  return [...rows];
}

async function lexicalWithFallback(scope: SearchScope, query: string, limit: number): Promise<Row[]> {
  const rows = await lexical(scope, query, limit);
  return rows.length > 0 ? rows : substring(scope, query, limit);
}

// ---------------------------------------------------------------------------------------------
// Semantic: pgvector kNN, fused with lexical
// ---------------------------------------------------------------------------------------------

/** e5 cosine similarities sit between about 0.7 (unrelated) and 0.9 (same topic). */
const MIN_SIMILARITY = 0.78;
/** Also drop matches far below the best one for this query. */
const SIMILARITY_WINDOW = 0.05;
const CANDIDATES = 20;
/**
 * Reciprocal rank fusion constant. The usual 60 flattens ranks so much that a word match on a
 * generic chunk beat the clearly best semantic match (production, 26 Oct); 10 keeps rank 1 strong.
 */
const RRF_K = 10;

/**
 * Nearest chunks by cosine distance (HNSW index). Iterative scan keeps the index useful when the
 * workspace filter removes most neighbours; the outer query restores exact order.
 * Chunks not embedded yet are skipped here and still come through lexical search.
 */
async function semantic(scope: SearchScope, embedding: number[], limit: number): Promise<Row[]> {
  const vector = `[${embedding.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    await tx.execute(sql`set local hnsw.ef_search = 100`);
    const rows = await tx.execute<Row>(sql`
      select * from (
        select c.id as chunk_id, c.source_id, s.title, s.url, c.content,
               1 - (c.embedding <=> ${vector}::vector(${sql.raw(String(EMBEDDING_DIMENSIONS))})) as score
        from knowledge_chunks c
        join knowledge_sources s on s.id = c.source_id
        where ${scopeFilter(scope)} and c.embedding is not null
        order by c.embedding <=> ${vector}::vector(${sql.raw(String(EMBEDDING_DIMENSIONS))})
        limit ${limit}
      ) t
      order by score desc`);
    return [...rows];
  });
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Weighted reciprocal rank fusion. Each list adds weight / (60 + rank):
 * - a semantic hit weighs 0.6 at similarity 0.78 up to 1.4 at 0.86 and above;
 * - a lexical hit weighs 0.3 when it covers little of the query up to 1 when it covers all of it.
 * So a stray word match does not outrank a clear semantic match, and an exact word match (a
 * product name, a partial word) is not pushed out by a vague semantic one.
 * Returned score: 1.0 = first in both lists at full weight.
 */
function fuse(vector: Row[], text: Row[], limit: number): SearchResult[] {
  const best = vector[0]?.score ?? 0;
  const floor = Math.max(MIN_SIMILARITY, best - SIMILARITY_WINDOW);
  const kept = vector.filter((r) => Number(r.score) >= floor);

  const fused = new Map<string, { row: Row; score: number; sim: number }>();
  const add = (row: Row, weight: number, rank: number, sim: number) => {
    const entry = fused.get(row.chunk_id) ?? { row, score: 0, sim: 0 };
    entry.score += weight / (RRF_K + rank);
    entry.sim = Math.max(entry.sim, sim);
    fused.set(row.chunk_id, entry);
  };
  kept.forEach((r, i) => {
    const sim = Number(r.score);
    add(r, clamp(0.6 + (sim - MIN_SIMILARITY) * 10, 0.6, 1.4), i + 1, sim);
  });
  text.forEach((r, i) => add(r, 0.3 + 0.7 * clamp(Number(r.score), 0, 1), i + 1, 0));

  const max = 2.4 / (RRF_K + 1);
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || b.sim - a.sim)
    .slice(0, limit)
    .map(({ row, score }) => toResult({ ...row, score: Math.round((score / max) * 1e4) / 1e4 }));
}

/**
 * Hybrid search. With a query embedding (same model as the chunks, from the embedder), semantic
 * and lexical results are fused; without one, lexical only.
 */
export async function searchKnowledge(
  scope: SearchScope,
  query: string,
  limit = 5,
  embedding?: number[],
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    return (await lexicalWithFallback(scope, q, limit)).map(toResult);
  }
  const [vector, text] = await Promise.all([
    semantic(scope, embedding, CANDIDATES).catch((err) => {
      console.error("semantic search failed, using text only", err instanceof Error ? err.message : err);
      return [] as Row[];
    }),
    lexicalWithFallback(scope, q, CANDIDATES),
  ]);
  return fuse(vector, text, limit);
}
