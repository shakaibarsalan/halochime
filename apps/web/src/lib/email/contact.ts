import "server-only";
import { z } from "zod";
import { appUrl } from "../env";
import { details, esc, escLines, heading, layout, link, p, quote } from "./layout";
import type { OutgoingEmail } from "./transport";

// The contact form's email to the owner. Kept out of templates.ts: it goes to us, not to a customer.

const Address = z.email().max(320);

/**
 * Where contact messages go: SUPPORT_EMAIL, or else the address inside EMAIL_FROM
 * ("Name <a@b.c>" or a bare address). null when neither holds a valid address.
 */
export function supportAddress(): string | null {
  const candidates = [process.env.SUPPORT_EMAIL, process.env.EMAIL_FROM].map((v) => {
    const raw = v?.trim() ?? "";
    return (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim();
  });
  for (const c of candidates) {
    const ok = Address.safeParse(c);
    if (ok.success) return ok.data;
  }
  return null;
}

export function contactEmail(opts: {
  name: string;
  email: string;
  topic: string;
  message: string;
  at: Date;
}): Omit<OutgoingEmail, "to" | "replyTo"> {
  const base = appUrl();
  const when = `${new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(opts.at)} UTC`;
  const subject = `Contact form: ${opts.topic} from ${opts.name}`;
  const footer = "Sent from the contact form on Halochime. Reply to this email to answer the sender.";
  const body = [
    heading(`New message: ${opts.topic}`),
    p(`${esc(opts.name)} wrote through the contact form. Replying to this email goes straight to them.`),
    details([
      { label: "Name", html: esc(opts.name) },
      { label: "Email", html: link(`mailto:${opts.email}`, opts.email) },
      { label: "Topic", html: esc(opts.topic) },
      { label: "Sent", html: esc(when) },
    ]),
    quote(escLines(opts.message)),
    p("Check the sender's address before acting on account, billing or deletion requests.", { muted: true, small: true, last: true }),
  ].join("\n");
  return {
    template: "contact-form",
    subject,
    html: layout({ appUrl: base, subject, preheader: opts.message.slice(0, 120), body, footer: esc(footer) }),
    text: [
      `New message: ${opts.topic}`,
      "",
      `Name: ${opts.name}`,
      `Email: ${opts.email}`,
      `Topic: ${opts.topic}`,
      `Sent: ${when}`,
      "",
      opts.message,
      "",
      "--",
      footer,
      `Halochime: ${base}`,
      "",
    ].join("\n"),
  };
}
