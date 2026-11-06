import { isIP } from "node:net";
import type { DbDialect } from "./types";

// Connection strings for the database connector (pure). The password stays inside the parsed
// object and is never put in a message.

export type DbTarget = { host: string; port: number; user: string; password: string; database: string };

export type DbUrlCheck = { ok: true; target: DbTarget } | { ok: false; reason: string };

const PROTOCOLS: Record<DbDialect, string[]> = {
  postgres: ["postgres:", "postgresql:"],
  mysql: ["mysql:", "mysql2:"],
};

function decode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function parseConnectionString(raw: string, dialect: DbDialect): DbUrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: `That is not a connection string. It looks like ${dialect === "postgres" ? "postgres://user:password@host:5432/dbname" : "mysql://user:password@host:3306/dbname"}.` };
  }
  if (!PROTOCOLS[dialect].includes(url.protocol)) {
    return { ok: false, reason: `For ${dialect === "postgres" ? "Postgres" : "MySQL"} the connection string starts with ${PROTOCOLS[dialect][0]}//.` };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "The connection string has no host." };
  const user = decode(url.username);
  if (!user) return { ok: false, reason: "The connection string has no user name." };
  const database = decode(url.pathname.replace(/^\//, ""));
  if (!database || database.includes("/")) return { ok: false, reason: "Add the database name at the end, e.g. .../dbname." };
  const port = url.port ? Number(url.port) : dialect === "postgres" ? 5432 : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: "The port is not valid." };
  return { ok: true, target: { host, port, user, password: decode(url.password), database } };
}

/** What the dashboard shows instead of the connection string: host and database, never the user or password. */
export const describeTarget = (t: DbTarget) => `${t.host}:${t.port}/${t.database}`;

/**
 * Hosts that are not on the public internet. IP literals are checked here (they skip DNS); names are
 * checked again after DNS, at connect time, by safeLookup.
 */
export function blockedHostReason(host: string, isBlockedAddress: (ip: string) => boolean): string | null {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) {
    return "That host is on a private network. The database must be reachable from the internet.";
  }
  if (isIP(h) && isBlockedAddress(h)) return "That address is on a private or reserved network. The database must be reachable from the internet.";
  return null;
}
