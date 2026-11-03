// Owner only: add paid voice minutes to a workspace, close its open minutes request and email the
// customer. See "Credit minutes after payment" in deploy/README.md for the env and the SSH tunnel.
//
//   cd apps/web
//   npx tsx --conditions=react-server --env-file=.env.local scripts/credit-minutes.ts <workspace id> <minutes> [note] [--dry-run] [--no-email]
//
// --conditions=react-server lets the app's "server-only" modules load outside Next.
// Env set on the command line wins over --env-file, so DATABASE_URL can point at production.

import { and, desc, eq } from "drizzle-orm";
import { db, getDb } from "@/db";
import { minuteRequests, organization, wallets } from "@/db/schema";
import { creditWallet } from "@/lib/conversations";
import { appUrl } from "@/lib/env";
import { managerEmails } from "@/lib/email/notify";
import { minutesAddedEmail } from "@/lib/email/templates";
import { sendEmail, supportAddress, usesOutbox } from "@/lib/email/transport";

const USAGE =
  "Usage: npx tsx --conditions=react-server --env-file=.env.local scripts/credit-minutes.ts <workspace id> <minutes> [note] [--dry-run] [--no-email]";
const MAX_MINUTES = 100_000;
const FLAGS = new Set(["--dry-run", "--no-email", "--help"]);

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

/** host:port/db of DATABASE_URL, never the password. */
function databaseLabel(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) fail("DATABASE_URL is not set.");
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    fail("DATABASE_URL is not a valid URL.");
  }
}

const minutesText = (seconds: number) => `${(seconds / 60).toLocaleString("en-US", { maximumFractionDigits: 1 })} min`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  if (flags.has("--help")) {
    console.log(USAGE);
    return 0;
  }
  for (const f of flags) if (!FLAGS.has(f)) fail(`Unknown option ${f}.`);
  const [workspaceId, minutesArg, ...noteParts] = args.filter((a) => !a.startsWith("--"));
  if (!workspaceId) fail("Give the workspace id (it is in the request email).");
  const minutes = Number(minutesArg);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) fail(`Minutes must be a whole number from 1 to ${MAX_MINUTES}.`);
  const note = noteParts.join(" ").trim().slice(0, 200);
  const dryRun = flags.has("--dry-run");
  const sendEmails = !flags.has("--no-email");

  console.log(`Database:  ${databaseLabel()}`);
  const [ws] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, workspaceId)).limit(1);
  if (!ws) fail(`No workspace with id ${workspaceId}.`);
  const [[wallet], [open]] = await Promise.all([
    db.select({ balance: wallets.balanceSeconds }).from(wallets).where(eq(wallets.organizationId, workspaceId)),
    db
      .select({
        minutes: minuteRequests.minutes,
        createdAt: minuteRequests.createdAt,
        requesterName: minuteRequests.requesterName,
        requesterEmail: minuteRequests.requesterEmail,
      })
      .from(minuteRequests)
      .where(and(eq(minuteRequests.organizationId, workspaceId), eq(minuteRequests.status, "open")))
      .orderBy(desc(minuteRequests.createdAt))
      .limit(1),
  ]);

  console.log(`Workspace: ${ws.name} (${workspaceId})`);
  console.log(`Balance:   ${minutesText(wallet?.balance ?? 0)}`);
  console.log(
    open
      ? `Request:   ${open.minutes} min on ${open.createdAt.toISOString().slice(0, 10)} by ${open.requesterName} <${open.requesterEmail}> (will be marked done)`
      : "Request:   none open (the minutes are added anyway)",
  );
  console.log(`Add:       ${minutes} min${note ? `, note "${note}"` : ""}`);

  const recipients = !sendEmails ? [] : open ? [open.requesterEmail] : await managerEmails(workspaceId);
  if (sendEmails) {
    console.log(`Email to:  ${recipients.length ? recipients.join(", ") : "nobody (no owner or admin found)"}`);
    if (usesOutbox()) console.log("           written to apps/web/.outbox, NOT sent (set EMAIL_DEV_SEND=1 and SMTP_* to send)");
    if (/localhost|127\.0\.0\.1/.test(appUrl())) console.log(`           links point to ${appUrl()} (set NEXT_PUBLIC_APP_URL)`);
  }

  if (dryRun) {
    console.log("\nDry run: nothing changed.");
    return 0;
  }

  const result = await creditWallet(workspaceId, minutes * 60, {
    kind: "topup",
    note: `Top up: ${minutes} minutes${note ? ` (${note})` : ""}`,
  });
  console.log(`\nAdded ${minutes} min. New balance: ${minutesText(result.balanceSeconds)}.`);
  console.log(result.closedRequest ? `Request ${result.closedRequest.id} marked done.` : "No open request to close.");

  let failed = 0;
  const replyTo = supportAddress() ?? undefined;
  for (const to of recipients) {
    const isRequester = Boolean(result.closedRequest && to === result.closedRequest.requesterEmail);
    const email = minutesAddedEmail({
      name: isRequester ? result.closedRequest!.requesterName : null,
      workspace: ws.name,
      minutes,
      balanceSeconds: result.balanceSeconds,
      reason: isRequester ? "requester" : "manager",
    });
    try {
      const d = await sendEmail({ to, replyTo, ...email });
      console.log(d.via === "smtp" ? `Emailed ${to} (${d.messageId}).` : `Email for ${to} written to ${d.file} (not sent).`);
    } catch (err) {
      failed++;
      console.error(`Could not email ${to}: ${err instanceof Error ? err.message : String(err)}. The minutes are added; tell them yourself.`);
    }
  }
  return failed ? 2 : 0;
}

main()
  .then(async (code) => {
    // Close the pool (drizzle keeps the postgres client on $client); exit() also drops the SMTP pool.
    if (process.env.DATABASE_URL) {
      const client = (getDb() as unknown as { $client?: { end(opts: { timeout: number }): Promise<void> } }).$client;
      await client?.end({ timeout: 5 }).catch(() => {});
    }
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
