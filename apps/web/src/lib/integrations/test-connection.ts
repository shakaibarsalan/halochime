import "server-only";
import { calcomClient } from "./calcom";
import { DbError, runReadOnlyQuery } from "./db-connector";
import { describeTarget, parseConnectionString } from "./db-url";
import { VendorError } from "./http";
import { crmClientFor, type Secrets } from "./store";
import { isCrmKind, type DbDialect, type IntegrationKind } from "./types";

/** Dashboard "Test connection": one harmless read with the saved credentials. Never throws. */
export async function testConnection(kind: IntegrationKind, config: Record<string, unknown>, secrets: Secrets): Promise<{ ok: boolean; message: string }> {
  try {
    if (isCrmKind(kind)) {
      await crmClientFor(kind, config, secrets).test();
      return { ok: true, message: "Connected. The credentials can read contacts." };
    }
    if (kind === "calcom") {
      const eventTypeId = Number(config.eventTypeId);
      const message = await calcomClient({ apiKey: secrets.apiKey ?? "", eventTypeId, timeZone: String(config.timeZone ?? "UTC") }).test();
      return { ok: true, message: `Connected. ${message}` };
    }
    if (kind === "database") {
      const dialect = (config.dialect === "mysql" ? "mysql" : "postgres") as DbDialect;
      const target = parseConnectionString(secrets.connectionString ?? "", dialect);
      if (!target.ok) return { ok: false, message: target.reason };
      await runReadOnlyQuery(dialect, target.target, config.ssl === true, "SELECT 1 AS ok", []);
      return { ok: true, message: `Connected to ${describeTarget(target.target)}.` };
    }
    return { ok: true, message: "Nothing to test: the agent shares the link as it is." };
  } catch (err) {
    if (err instanceof VendorError) return { ok: false, message: err.message };
    if (err instanceof DbError) return { ok: false, message: err.detail };
    if (err instanceof Error && err.message === "missing token") return { ok: false, message: "Some credentials are missing. Enter them again." };
    console.error(`integration test (${kind}) failed unexpectedly`, (err as Error).message);
    return { ok: false, message: "The test failed because of an unexpected error." };
  }
}
