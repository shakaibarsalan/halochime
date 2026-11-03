import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

// Cached on globalThis so dev hot reloads reuse one pool instead of leaking connections.
const globalForDb = globalThis as unknown as { __talkfrontDb?: Db };

/** Opens the pool on first use, so importing this module (e.g. during `next build`) never connects. */
export function getDb(): Db {
  if (globalForDb.__talkfrontDb) return globalForDb.__talkfrontDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Serverless (Vercel) runs many small instances: keep each pool small and let idle connections go.
  const client = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });
  globalForDb.__talkfrontDb = db;
  return db;
}

/** Lazy handle: `db.select()...` works anywhere, but nothing connects until a query runs. */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
