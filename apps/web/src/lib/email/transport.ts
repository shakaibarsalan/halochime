import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { isProduction } from "../env";

// Sends every Halochime email. Gmail SMTP for now (about 500 emails a day, and the From address
// must be that Gmail account). Outside production, emails are written to apps/web/.outbox instead,
// unless EMAIL_DEV_SEND=1.

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Short template name, used for outbox file names and logs. */
  template: string;
  replyTo?: string;
  /** Inline files (e.g. a cid: logo for one-off test sends). Normal emails link the hosted PNG instead. */
  attachments?: { filename: string; path: string; cid: string }[];
};

export type Delivery = { via: "smtp"; messageId: string } | { via: "outbox"; file: string };

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM).");
    this.name = "EmailNotConfiguredError";
  }
}

type SmtpEnv = { host: string; port: number; user: string; pass: string; from: string };

/** The bare address in EMAIL_FROM ("Name <a@b.c>" or "a@b.c"), or null when it is not set. */
function fromAddress(): string | null {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return null;
  return from.match(/<([^>]+)>/)?.[1]?.trim() || from;
}

/**
 * Where emails meant for the Halochime team go (e.g. requests for voice minutes): SUPPORT_EMAIL,
 * else the sender address in EMAIL_FROM. null when neither holds an email address.
 */
export function supportAddress(): string | null {
  const address = process.env.SUPPORT_EMAIL?.trim() || fromAddress();
  return address && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : null;
}

function smtpEnv(): SmtpEnv | null {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const address = fromAddress();
  if (!host || !user || !pass || !address || !Number.isFinite(port)) return null;
  // Inboxes show the product name as the sender, whatever name EMAIL_FROM carries (it predates the rename).
  return { host, port, user, pass, from: `"Halochime" <${address}>` };
}

const state = globalThis as unknown as { __talkfrontMailer?: Transporter; __talkfrontMailerWarned?: boolean };

function transporter(env: SmtpEnv): Transporter {
  return (state.__talkfrontMailer ??= nodemailer.createTransport({
    host: env.host,
    port: env.port,
    // 465 = TLS from the first byte; 587 = STARTTLS (required, never plain text).
    secure: env.port === 465,
    requireTLS: env.port !== 465,
    auth: { user: env.user, pass: env.pass },
    pool: true,
    maxConnections: 2,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  }));
}

/** true when emails go to the local outbox folder instead of SMTP. */
export const usesOutbox = () => !isProduction() && process.env.EMAIL_DEV_SEND !== "1";

async function writeOutbox(msg: OutgoingEmail): Promise<Delivery> {
  const dir = path.join(process.cwd(), ".outbox");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `${stamp}-${randomBytes(2).toString("hex")}-${msg.template}`);
  const meta = {
    to: msg.to,
    replyTo: msg.replyTo ?? null,
    subject: msg.subject,
    template: msg.template,
    createdAt: new Date().toISOString(),
  };
  await Promise.all([
    writeFile(`${base}.html`, msg.html, "utf8"),
    writeFile(`${base}.txt`, msg.text, "utf8"),
    writeFile(`${base}.json`, `${JSON.stringify(meta, null, 2)}\n`, "utf8"),
  ]);
  console.info(`[email] ${msg.template} to ${msg.to} written to ${base}.html (set EMAIL_DEV_SEND=1 to really send)`);
  return { via: "outbox", file: `${base}.html` };
}

/** Sends one email. Throws when it can't be sent; callers decide whether that reaches the user. */
export async function sendEmail(msg: OutgoingEmail): Promise<Delivery> {
  if (usesOutbox()) return writeOutbox(msg);
  const env = smtpEnv();
  if (!env) {
    if (!state.__talkfrontMailerWarned) {
      state.__talkfrontMailerWarned = true;
      console.error(
        "[email] Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and EMAIL_FROM. " +
          "Verification codes, invites and alerts cannot be sent until then.",
      );
    }
    throw new EmailNotConfiguredError();
  }
  const info = await transporter(env).sendMail({
    from: env.from,
    to: msg.to,
    replyTo: msg.replyTo,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    attachments: msg.attachments,
    headers: {
      // Automatic message: stops out-of-office replies and mail loops.
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
    },
  });
  console.info(`[email] ${msg.template} sent (${info.messageId})`);
  return { via: "smtp", messageId: info.messageId };
}
