import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { AgentSnapshot } from "../../lib/versions/snapshot";
import { agents } from "./app";
import { organization, user } from "./auth";

// Platform features (all off by default): agency white label, agent versions with A/B tests, and
// test suites that run questions through the agent before publishing.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const orgId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const agentId = () =>
  text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" });

// ---------------------------------------------------------------------------
// A. White label

/** "halochime" = the usual "by Halochime" line, "hidden" = no line, "custom" = the agency's own name + link. */
export const poweredByMode = pgEnum("powered_by_mode", ["halochime", "hidden", "custom"]);

/**
 * White label settings per workspace (owners only). No row = Halochime as before.
 * The logo is small and stored like agent_images (base64, type checked from the file's bytes).
 */
export const workspaceBranding = pgTable("workspace_branding", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  poweredBy: poweredByMode("powered_by").notNull().default("halochime"),
  poweredByLabel: text("powered_by_label"),
  poweredByUrl: text("powered_by_url"),
  /** Shown in the dashboard sidebar for this workspace's members instead of the Halochime logo. null = Halochime. */
  brandName: text("brand_name"),
  logoContentType: text("logo_content_type"),
  logoData: text("logo_data"),
  /** Changes with every new logo, so its URL (and caches) change too. */
  logoVersion: text("logo_version"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ---------------------------------------------------------------------------
// B. Agent versions and A/B tests

/** A named copy of an agent's talking setup (greeting, persona, rules, language, voice, models). */
export const agentVersions = pgTable(
  "agent_versions",
  {
    id: id(),
    organizationId: orgId(),
    agentId: agentId(),
    name: text("name").notNull(),
    snapshot: jsonb("snapshot").$type<AgentSnapshot>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("agent_versions_agent_idx").on(t.agentId, t.createdAt.desc())],
);

export const abTestStatus = pgEnum("ab_test_status", ["running", "ended"]);

/**
 * Two versions of one agent sharing its new conversations. splitB = percent of visitors on version B.
 * The split never changes while the test runs (so every visitor keeps their version); at most one
 * running test per agent.
 */
export const agentAbTests = pgTable(
  "agent_ab_tests",
  {
    id: id(),
    organizationId: orgId(),
    agentId: agentId(),
    versionAId: text("version_a_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "cascade" }),
    versionBId: text("version_b_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "cascade" }),
    splitB: integer("split_b").notNull(),
    status: abTestStatus("status").notNull().default("running"),
    winnerVersionId: text("winner_version_id").references(() => agentVersions.id, { onDelete: "set null" }),
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_ab_tests_agent_idx").on(t.agentId, t.startedAt.desc()),
    uniqueIndex("agent_ab_tests_one_running_uq").on(t.agentId).where(sql`${t.status} = 'running'`),
  ],
);

// ---------------------------------------------------------------------------
// C. Test suites

/** One test question for an agent and what a good answer must (or must not) say. */
export const agentTestCases = pgTable(
  "agent_test_cases",
  {
    id: id(),
    organizationId: orgId(),
    agentId: agentId(),
    question: text("question").notNull(),
    mustSay: text("must_say").notNull().default(""),
    mustNotSay: text("must_not_say").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("agent_test_cases_agent_idx").on(t.agentId, t.createdAt)],
);

export const testRunStatus = pgEnum("agent_test_run_status", ["running", "done", "failed"]);

/** One press of "Run tests". Counted per workspace per day to keep model costs low. */
export const agentTestRuns = pgTable(
  "agent_test_runs",
  {
    id: id(),
    organizationId: orgId(),
    agentId: agentId(),
    /** The version tested; null = the agent's current settings. */
    versionId: text("version_id").references(() => agentVersions.id, { onDelete: "set null" }),
    /** Copied at run time so the history still reads right after the version is deleted. */
    versionName: text("version_name"),
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    status: testRunStatus("status").notNull().default("running"),
    total: integer("total").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    /** The model that answered (after any fallback), e.g. "openai/gpt-oss-20b". */
    model: text("model"),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_test_runs_agent_idx").on(t.agentId, t.createdAt.desc()),
    index("agent_test_runs_org_idx").on(t.organizationId, t.createdAt),
  ],
);

export const agentTestResults = pgTable(
  "agent_test_results",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => agentTestRuns.id, { onDelete: "cascade" }),
    caseId: text("case_id").references(() => agentTestCases.id, { onDelete: "set null" }),
    /** Copies of the case at run time. */
    question: text("question").notNull(),
    mustSay: text("must_say").notNull().default(""),
    mustNotSay: text("must_not_say").notNull().default(""),
    answer: text("answer").notNull().default(""),
    pass: boolean("pass").notNull().default(false),
    reason: text("reason").notNull().default(""),
    /** Set when the agent or the judge could not be reached; the case counts as failed. */
    error: text("error"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("agent_test_results_run_idx").on(t.runId, t.position)],
);
