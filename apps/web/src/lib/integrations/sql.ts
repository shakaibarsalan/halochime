import { validateArguments, type ArgValue } from "@/lib/actions/schema";
import { MAX_QUERY_SQL, type DbDialect, type DbQueryParameter } from "./types";

// Read-only query rules for the database connector (pure: no server imports).
// Owners write one SELECT or WITH statement with :name placeholders; the AI only ever fills in values,
// which are bound as real parameters. The connector also runs every query in a read-only transaction
// with a statement timeout (db-connector.ts), so these checks are the first of several walls.

export const MAX_ROWS = 20;
export const MAX_RESULT_CHARS = 4000;
const MAX_CELL_CHARS = 500;

/** Statements and clauses that write, lock or change settings. Compared lowercase, outside quotes and comments. */
const FORBIDDEN_WORDS = new Set([
  "insert", "update", "delete", "merge", "upsert", "drop", "alter", "create", "truncate", "grant", "revoke",
  "copy", "call", "execute", "exec", "prepare", "deallocate", "into", "lock", "unlock", "vacuum", "commit",
  "rollback", "savepoint", "release", "listen", "notify", "unlisten", "handler", "load", "outfile", "dumpfile",
  "attach", "detach", "refresh", "reindex", "cluster", "discard", "import",
]);

/** Functions with side effects or file / network access. */
const FORBIDDEN_FUNCTIONS = new Set([
  "pg_sleep", "pg_sleep_for", "pg_sleep_until", "sleep", "benchmark", "pg_read_file", "pg_read_binary_file",
  "pg_ls_dir", "pg_stat_file", "lo_import", "lo_export", "lo_from_bytea", "lo_put", "dblink", "dblink_exec",
  "dblink_connect", "load_file", "pg_terminate_backend", "pg_cancel_backend", "set_config", "pg_reload_conf",
  "pg_rotate_logfile", "nextval", "setval", "pg_advisory_lock", "pg_advisory_xact_lock", "get_lock",
  "release_lock", "sys_exec", "sys_eval", "query_to_xml", "pg_notify",
]);

type Placeholder = { name: string; start: number; end: number };
type Scan = { ok: true; words: string[]; placeholders: Placeholder[] } | { ok: false; reason: string };

const isWordStart = (c: string | undefined) => !!c && /[A-Za-z_]/.test(c);
const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);

/** Splits SQL into bare words and :name placeholders, skipping strings, quoted names and comments. */
export function scanSql(sql: string, dialect: DbDialect): Scan {
  const words: string[] = [];
  const placeholders: Placeholder[] = [];
  const n = sql.length;
  let i = 0;

  const skipQuoted = (quote: string, backslash: boolean): boolean => {
    i += 1;
    while (i < n) {
      const c = sql[i];
      if (backslash && c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) {
        if (sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        i += 1;
        return true;
      }
      i += 1;
    }
    return false;
  };

  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? n : end + 1;
    } else if (c === "#" && dialect === "mysql") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? n : end + 1;
    } else if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) return { ok: false, reason: "A /* comment is not closed." };
      i = end + 2;
    } else if (c === "'") {
      // Postgres: backslash escapes only in E'...' strings. MySQL: always.
      const prefixE = dialect === "postgres" && /[Ee]/.test(sql[i - 1] ?? "") && !isWordChar(sql[i - 2]);
      if (!skipQuoted("'", dialect === "mysql" || prefixE)) return { ok: false, reason: "A quoted text ('...') is not closed." };
    } else if (c === '"') {
      if (!skipQuoted('"', dialect === "mysql")) return { ok: false, reason: 'A quoted name ("...") is not closed.' };
    } else if (c === "`") {
      if (!skipQuoted("`", false)) return { ok: false, reason: "A quoted name (`...`) is not closed." };
    } else if (c === "$" && dialect === "postgres") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end < 0) return { ok: false, reason: `A ${tag[0]} quoted text is not closed.` };
        i = end + tag[0].length;
      } else if (/^\$\d/.test(sql.slice(i, i + 2))) {
        return { ok: false, reason: "Use :name placeholders (for example :email) instead of $1." };
      } else {
        i += 1;
      }
    } else if (c === "?" && dialect === "mysql") {
      return { ok: false, reason: "Use :name placeholders (for example :email) instead of ?." };
    } else if (c === ":") {
      if (next === ":") {
        i += 2; // Postgres cast, e.g. created_at::date
      } else if (isWordStart(next) && sql[i - 1] !== ":") {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(sql[j]!)) j += 1;
        placeholders.push({ name: sql.slice(i + 1, j), start: i, end: j });
        i = j;
      } else {
        i += 1;
      }
    } else if (isWordStart(c)) {
      let j = i + 1;
      while (j < n && isWordChar(sql[j])) j += 1;
      words.push(sql.slice(i, j).toLowerCase());
      i = j;
    } else {
      i += 1;
    }
  }
  return { ok: true, words, placeholders };
}

export type SqlCheck = { ok: true; placeholders: Placeholder[] } | { ok: false; reason: string };

/**
 * Accepts exactly one read-only SELECT / WITH statement whose :placeholders match the inputs.
 * Reasons are plain sentences for the dashboard.
 */
export function checkReadOnlySql(sql: string, dialect: DbDialect, parameterNames: string[]): SqlCheck {
  const text = sql.trim();
  if (!text) return { ok: false, reason: "Enter the SQL query." };
  if (text.length > MAX_QUERY_SQL) return { ok: false, reason: `The query is too long (at most ${MAX_QUERY_SQL.toLocaleString("en-US")} characters).` };
  if (text.includes(";")) return { ok: false, reason: "Remove the semicolon (;). Only one statement is allowed, without a ; at the end." };
  if (/\u0000/.test(text)) return { ok: false, reason: "The query contains a null character." };
  const scan = scanSql(text, dialect);
  if (!scan.ok) return scan;
  const first = scan.words[0];
  if (first !== "select" && first !== "with") return { ok: false, reason: "The query must start with SELECT or WITH. Only reading is allowed." };
  const bad = scan.words.find((w) => FORBIDDEN_WORDS.has(w));
  if (bad) return { ok: false, reason: `The query can only read data, so ${bad.toUpperCase()} is not allowed.` };
  const fn = scan.words.find((w) => FORBIDDEN_FUNCTIONS.has(w));
  if (fn) return { ok: false, reason: `${fn}() is not allowed in a query.` };
  const names = new Set(parameterNames);
  const unknown = scan.placeholders.find((p) => !names.has(p.name));
  if (unknown) return { ok: false, reason: `The SQL uses :${unknown.name}, but there is no input called ${unknown.name}. Add it under Inputs or fix the name.` };
  const used = new Set(scan.placeholders.map((p) => p.name));
  const unused = parameterNames.find((p) => !used.has(p));
  if (unused) return { ok: false, reason: `The input ${unused} is not used in the SQL. Add :${unused} to the query or remove the input.` };
  return { ok: true, placeholders: scan.placeholders };
}

export type CompiledSql = {
  /** The query wrapped so the database itself returns at most MAX_ROWS + 1 rows. */
  text: string;
  /** Input names in bind order ($1, $2... for Postgres; one per ? for MySQL). */
  order: string[];
};

/** Rewrites :name placeholders for the driver: $1.. (Postgres, a name used twice keeps its number) or ? (MySQL). */
export function compileSql(sql: string, dialect: DbDialect, placeholders: Placeholder[]): CompiledSql {
  const text = sql.trim();
  const unique: string[] = [];
  for (const p of placeholders) if (!unique.includes(p.name)) unique.push(p.name);
  let out = "";
  let last = 0;
  const order: string[] = [];
  for (const p of [...placeholders].sort((a, b) => a.start - b.start)) {
    out += text.slice(last, p.start);
    if (dialect === "postgres") {
      out += `$${unique.indexOf(p.name) + 1}`;
    } else {
      out += "?";
      order.push(p.name);
    }
    last = p.end;
  }
  out += text.slice(last);
  // New lines around the query: a trailing -- comment in it can't swallow the closing bracket.
  return {
    text: `SELECT * FROM (\n${out}\n) AS halochime_q LIMIT ${MAX_ROWS + 1}`,
    order: dialect === "postgres" ? unique : order,
  };
}

export type BindResult =
  | { ok: true; values: (ArgValue | null)[] }
  | { ok: false; reason: string; needsSignIn?: boolean };

/**
 * The values to bind, in `order`. Inputs marked verifiedUserId always come from the verified visitor
 * (whatever the AI sent); without a verified visitor the query refuses politely.
 */
export function bindQueryArgs(
  parameters: DbQueryParameter[],
  order: string[],
  raw: Record<string, unknown>,
  verifiedUserId: string | null,
): BindResult {
  const visible = parameters.filter((p) => !p.verifiedUserId);
  const checked = validateArguments(
    visible.map((p) => ({ name: p.name, type: p.type, description: p.description, required: p.required })),
    raw,
  );
  if (!checked.ok) return checked;
  const values = new Map<string, ArgValue | null>(Object.entries(checked.args));
  for (const p of parameters.filter((x) => x.verifiedUserId)) {
    if (!verifiedUserId) {
      return {
        ok: false,
        needsSignIn: true,
        reason: "This needs the visitor to be signed in on the website, so it can only show their own records. Ask them to sign in and open the chat again.",
      };
    }
    if (p.type === "string") values.set(p.name, verifiedUserId);
    else if (p.type === "boolean") return { ok: false, reason: "This query is set up wrongly (a signed-in user id can't be yes / no)." };
    else {
      const num = Number(verifiedUserId);
      if (!Number.isFinite(num) || (p.type === "integer" && !Number.isInteger(num))) {
        return { ok: false, reason: "The signed-in user's id is not a number, so this query could not run." };
      }
      values.set(p.name, num);
    }
  }
  return { ok: true, values: order.map((name) => (values.has(name) ? values.get(name)! : null)) };
}

function cell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Uint8Array) return "[binary data]";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}... [cut]` : text;
}

/** Rows -> compact JSON text for the AI: at most MAX_ROWS rows and MAX_RESULT_CHARS characters. */
export function formatRows(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "No matching rows.";
  const more = rows.length > MAX_ROWS;
  let list = rows.slice(0, MAX_ROWS).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
  const render = (cut: boolean) =>
    JSON.stringify({ rows: list, ...(more ? { note: `Only the first ${MAX_ROWS} rows.` } : {}), ...(cut ? { cut: "Some rows were left out to keep the answer short." } : {}) });
  let text = render(false);
  while (text.length > MAX_RESULT_CHARS && list.length > 1) {
    list = list.slice(0, -1);
    text = render(true);
  }
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS - 20)}... [cut, too long]` : text;
}
