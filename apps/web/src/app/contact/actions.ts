"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { contactEmail, supportAddress } from "@/lib/email/contact";
import { EmailNotConfiguredError, sendEmail } from "@/lib/email/transport";
import { rateLimit } from "@/lib/rate-limit";
import { type ContactField, type ContactState, HONEYPOT, TOPIC_VALUES, TOPICS } from "./topics";

/** One line, no control characters: the name goes into the subject line. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

const Input = z.object({
  name: z.string().transform(oneLine).pipe(z.string().min(1, "Enter your name.").max(100, "Use at most 100 characters.")),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320, "That email address is too long.")
    .pipe(z.email("Enter a valid email address.")),
  topic: z.enum(TOPIC_VALUES, "Choose a topic."),
  message: z
    .string()
    .trim()
    .min(10, "Write a little more so we can help.")
    .max(5000, "Keep it under 5,000 characters."),
});

const wait = (sec: number) =>
  sec >= 90 ? `about ${Math.ceil(sec / 60)} minutes` : `${sec} ${sec === 1 ? "second" : "seconds"}`;

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Emails a contact form message to the owner, with the sender as Reply-To. */
export async function sendContactMessage(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    topic: String(formData.get("topic") ?? ""),
    message: String(formData.get("message") ?? ""),
  };

  // Bots fill in the hidden field. Tell them it worked and send nothing.
  if (String(formData.get(HONEYPOT) ?? "").trim() !== "") {
    return { ok: true, email: raw.email.trim() };
  }

  const parsed = Input.safeParse(raw);
  if (!parsed.success) {
    const fields: Partial<Record<ContactField, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as ContactField | undefined;
      if (key && !fields[key]) fields[key] = issue.message;
    }
    return { ok: false, error: "Please check the highlighted fields.", fields };
  }
  const data = parsed.data;

  // 5 messages per network per hour, and 3 per sender address per 10 minutes.
  const blocked = [
    rateLimit(`contact:ip:${await clientIp()}`, 5, 60 * 60 * 1000),
    rateLimit(`contact:email:${data.email}`, 3, 10 * 60 * 1000),
  ].find((l) => !l.ok);
  if (blocked) {
    return { ok: false, error: `You've sent several messages in a short time. Please wait ${wait(blocked.retryAfterSec)} and try again.` };
  }

  const to = supportAddress();
  if (!to) {
    console.error("[contact] no recipient: set SUPPORT_EMAIL (or EMAIL_FROM)");
    return { ok: false, error: "Our contact form isn't working right now. Please try again later." };
  }

  const topic = TOPICS.find((t) => t.value === data.topic)!.label;
  try {
    await sendEmail({ to, replyTo: data.email, ...contactEmail({ ...data, topic, at: new Date() }) });
  } catch (err) {
    console.error("[contact] message could not be sent", err instanceof EmailNotConfiguredError ? err.message : err);
    return { ok: false, error: "We couldn't send your message just now. Please try again in a few minutes." };
  }
  return { ok: true, email: data.email };
}
