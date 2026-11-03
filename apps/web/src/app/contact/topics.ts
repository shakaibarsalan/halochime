// Shared by the contact form (client) and its server action.

export const TOPICS = [
  { value: "support", label: "Support", hint: "What happened, and on which agent or page? Include any error message you saw." },
  {
    value: "billing",
    label: "Billing",
    hint: "Tell us the workspace and how many voice minutes you want, or which purchase you want refunded.",
  },
  {
    value: "privacy",
    label: "Privacy or data deletion",
    hint: "Tell us what to delete: your account, a workspace or particular conversations. Send it from the email on the account.",
  },
  { value: "other", label: "Something else", hint: "Anything you'd like to ask or tell us." },
] as const;

export type Topic = (typeof TOPICS)[number]["value"];

export const TOPIC_VALUES = TOPICS.map((t) => t.value) as [Topic, ...Topic[]];

export const isTopic = (v: unknown): v is Topic => TOPIC_VALUES.includes(v as Topic);

export type ContactField = "name" | "email" | "topic" | "message";

export type ContactState =
  | { ok: true; email: string }
  | { ok: false; error: string; fields?: Partial<Record<ContactField, string>> }
  | null;

/** Name of the hidden field bots fill in and people never see. */
export const HONEYPOT = "website";
