import "server-only";
import net from "node:net";
import mysql from "mysql2/promise";
import postgres from "postgres";
import { FetchError, isBlockedAddress, safeLookup } from "@/lib/knowledge/safe-fetch";
import { blockedHostReason, type DbTarget } from "./db-url";
import type { DbDialect } from "./types";

// Runs one owner-defined query against the business's own Postgres or MySQL database.
// One connection per call (serverless: no pools), short timeouts, a read-only transaction, and the
// host is checked so it can't point at a private network (the check runs again after DNS, at connect).

export const CONNECT_TIMEOUT_MS = 5000;
export const STATEMENT_TIMEOUT_MS = 3000;

/** A query failed. `forAi` is what the agent hears; `detail` is for the owner in the dashboard. */
export class DbError extends Error {
  constructor(
    readonly forAi: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** Only for local development against a database on this machine. Ignored in production. */
const allowPrivate = () => process.env.NODE_ENV !== "production" && process.env.INTEGRATIONS_ALLOW_PRIVATE_DB === "1";

function safeSocket(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, lookup: allowPrivate() ? undefined : safeLookup });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new DbError("The database did not answer in time.", `Could not connect within ${CONNECT_TIMEOUT_MS / 1000} seconds.`));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function explain(err: unknown): DbError {
  if (err instanceof DbError) return err;
  if (err instanceof FetchError) return new DbError("The database could not be reached.", err.message);
  const e = err as { code?: string; errno?: number; message?: string };
  const code = String(e?.code ?? "");
  const raw = String(e?.message ?? "").replace(/\s+/g, " ").slice(0, 300);
  if (code === "57014" || code === "ER_QUERY_TIMEOUT" || e?.errno === 3024 || /timeout/i.test(code) || /timed? ?out|maximum statement execution time/i.test(raw)) {
    return new DbError("The lookup took too long, so it was stopped.", `The query was stopped after ${STATEMENT_TIMEOUT_MS / 1000} seconds.`);
  }
  if (code === "42P18" || code === "42P08") {
    return new DbError("The lookup is set up wrongly, so it was not run.", `${raw}. Postgres can't tell that input's type here: add a cast right after it, for example ::text or ::int.`);
  }
  if (code === "25006" || code === "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION") {
    return new DbError("The lookup could not be run.", "The query tried to change data. Only reading is allowed.");
  }
  if (code === "28P01" || code === "28000" || code === "ER_ACCESS_DENIED_ERROR" || code === "ER_DBACCESS_DENIED_ERROR") {
    return new DbError("The database could not be reached.", "The database refused the user name or password.");
  }
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "CONNECT_TIMEOUT", "CONNECTION_CLOSED"].includes(code)) {
    return new DbError("The database could not be reached.", `Could not connect to the database (${code}).`);
  }
  return new DbError("The database lookup failed.", raw || "The query failed.");
}

async function runPostgres(target: DbTarget, ssl: boolean, text: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  // `socket` (a custom connect, here DNS-checked) is supported by postgres.js but missing from its types.
  const options = {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    // Encrypted without checking the certificate (like sslmode=require); SNI keeps hosted poolers working.
    ssl: ssl ? { rejectUnauthorized: false, ...(net.isIP(target.host) ? {} : { servername: target.host }) } : false,
    socket: () => safeSocket(target.host, target.port),
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: CONNECT_TIMEOUT_MS / 1000,
    idle_timeout: 1,
    max_lifetime: 60,
    connection: { application_name: "halochime" },
    onnotice: () => {},
  };
  const sql = postgres(options as unknown as postgres.Options<Record<string, never>>);
  try {
    const rows = await sql.begin("read only", async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      await tx.unsafe("SET LOCAL idle_in_transaction_session_timeout = 10000");
      // simple: false keeps the extended protocol (one statement only) even without values.
      return tx.unsafe(text, values as never[], { simple: false } as never);
    });
    return [...rows] as Record<string, unknown>[];
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function runMysql(target: DbTarget, ssl: boolean, text: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  const conn = await mysql.createConnection({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    connectTimeout: CONNECT_TIMEOUT_MS,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    stream: () => {
      const socket = net.connect({ host: target.host, port: target.port, lookup: allowPrivate() ? undefined : safeLookup });
      socket.setNoDelay(true);
      return socket;
    },
  });
  // A connection error with no query running is emitted as an event; without a listener it would crash the process.
  conn.on("error", () => {});
  let timer: NodeJS.Timeout | undefined;
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    // Server-side limit: MySQL 5.7.8+ (milliseconds); MariaDB has max_statement_time (seconds).
    await conn.query(`SET SESSION max_execution_time = ${STATEMENT_TIMEOUT_MS}`).catch(() =>
      conn.query(`SET SESSION max_statement_time = ${STATEMENT_TIMEOUT_MS / 1000}`).catch(() => {}),
    );
    await conn.query("START TRANSACTION READ ONLY");
    // Client-side limit too, in case the server ignores the settings above.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        conn.destroy();
        reject(new DbError("The lookup took too long, so it was stopped.", `The query was stopped after ${STATEMENT_TIMEOUT_MS / 1000} seconds.`));
      }, STATEMENT_TIMEOUT_MS + 500);
    });
    const [rows] = await Promise.race([conn.execute(text, values as never[]), timeout]);
    await conn.query("ROLLBACK").catch(() => {});
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]).map((r) => ({ ...r })) : [];
  } finally {
    clearTimeout(timer);
    conn.destroy();
  }
}

/** Connects, runs the compiled query read-only, disconnects. Throws DbError. */
export async function runReadOnlyQuery(
  dialect: DbDialect,
  target: DbTarget,
  ssl: boolean,
  text: string,
  values: unknown[],
): Promise<Record<string, unknown>[]> {
  if (!allowPrivate()) {
    const blocked = blockedHostReason(target.host, isBlockedAddress);
    if (blocked) throw new DbError("The database could not be reached.", blocked);
  }
  try {
    return dialect === "postgres" ? await runPostgres(target, ssl, text, values) : await runMysql(target, ssl, text, values);
  } catch (err) {
    const e = explain(err);
    const code = String((err as { code?: string })?.code ?? "");
    if (ssl && (code === "ECONNRESET" || /ssl|tls/i.test(String((err as Error)?.message ?? "")))) {
      throw new DbError(e.forAi, `${e.detail} If this database does not use SSL, turn SSL off.`);
    }
    throw e;
  }
}
