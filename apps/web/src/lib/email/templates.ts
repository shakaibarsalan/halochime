import "server-only";
import { appUrl } from "../env";
import { button, codeBox, details, divider, esc, escLines, heading, layout, link, p, quote, steps, strong } from "./layout";

// One function per email. Each returns the subject, the HTML and a plain-text version.
// Copy rules: short, plain, honest, no em dashes, nothing we don't actually do.

export type Rendered = { template: string; subject: string; html: string; text: string };

const fullDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" });
const fmtDate = (d: Date) => `${fullDate.format(d)} (UTC)`;
const fmtDateTime = (d: Date) => `${dateTime.format(d).replace(",", " at")} UTC`;

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "";

function render(opts: {
  template: string;
  subject: string;
  preheader: string;
  body: string;
  footer: string;
  text: string[];
}): Rendered {
  const base = appUrl();
  return {
    template: opts.template,
    subject: opts.subject,
    html: layout({ appUrl: base, subject: opts.subject, preheader: opts.preheader, body: opts.body, footer: esc(opts.footer) }),
    text: `${opts.text.join("\n")}\n\n--\n${opts.footer}\nHalochime: ${base}\n`,
  };
}

// a + b. One-time codes -------------------------------------------------------------------------

export type CodePurpose = "verify" | "reset";

export function codeEmail(opts: { purpose: CodePurpose; code: string; email: string; minutes: number }): Rendered {
  const { code, email, minutes } = opts;
  if (opts.purpose === "verify") {
    return render({
      template: "verify-email",
      subject: `${code} is your Halochime verification code`,
      preheader: `Enter this code to verify your email. It expires in ${minutes} minutes.`,
      body: [
        heading("Verify your email"),
        p(`Enter this code in Halochime to finish creating your account.`),
        codeBox(code),
        p(`The code expires in ${minutes} minutes. Don't share it with anyone.`, { muted: true, small: true }),
        p(`If you didn't try to sign up, you can ignore this email. No account is created until the code is used.`, {
          muted: true,
          small: true,
          last: true,
        }),
      ].join("\n"),
      footer: `You got this email because someone signed up for Halochime with ${email}.`,
      text: [
        "Verify your email",
        "",
        "Enter this code in Halochime to finish creating your account:",
        "",
        `    ${code}`,
        "",
        `The code expires in ${minutes} minutes. Don't share it with anyone.`,
        "If you didn't try to sign up, you can ignore this email. No account is created until the code is used.",
      ],
    });
  }
  return render({
    template: "reset-password",
    subject: `${code} is your Halochime password reset code`,
    preheader: `Use this code to set a new password. It expires in ${minutes} minutes.`,
    body: [
      heading("Reset your password"),
      p(`Enter this code in Halochime to choose a new password for ${strong(email)}.`),
      codeBox(code),
      p(`The code expires in ${minutes} minutes. Don't share it with anyone.`, { muted: true, small: true }),
      p(`If you didn't ask to reset your password, you can ignore this email. Your password stays the same.`, {
        muted: true,
        small: true,
        last: true,
      }),
    ].join("\n"),
    footer: `You got this email because a password reset was requested for ${email} on Halochime.`,
    text: [
      "Reset your password",
      "",
      `Enter this code in Halochime to choose a new password for ${email}:`,
      "",
      `    ${code}`,
      "",
      `The code expires in ${minutes} minutes. Don't share it with anyone.`,
      "If you didn't ask to reset your password, you can ignore this email. Your password stays the same.",
    ],
  });
}

// c. Password changed ---------------------------------------------------------------------------

export function passwordChangedEmail(opts: { email: string; name?: string | null; at: Date }): Rendered {
  const resetUrl = `${appUrl()}/forgot-password`;
  const hi = firstName(opts.name);
  const when = fmtDateTime(opts.at);
  return render({
    template: "password-changed",
    subject: "Your Halochime password was changed",
    preheader: `The password for ${opts.email} was changed on ${when}.`,
    body: [
      heading("Your password was changed"),
      p(`${hi ? `Hi ${esc(hi)}, the` : "The"} password for ${strong(opts.email)} was changed on ${esc(when)}. For safety, we signed you out on your other devices.`),
      p(`If this was you, there's nothing else to do.`),
      divider(),
      p(`${strong("Wasn't you?")} Someone may have access to your email. Secure your email account first, then reset your Halochime password and reply to this email so we can help.`),
      button(resetUrl, "Reset password"),
    ].join("\n"),
    footer: `You got this security notice because the password for your Halochime account (${opts.email}) changed.`,
    text: [
      "Your password was changed",
      "",
      `${hi ? `Hi ${hi}, the` : "The"} password for ${opts.email} was changed on ${when}. For safety, we signed you out on your other devices.`,
      "",
      "If this was you, there's nothing else to do.",
      "",
      "Wasn't you? Someone may have access to your email. Secure your email account first, then reset your Halochime password and reply to this email so we can help.",
      "",
      `Reset password: ${resetUrl}`,
    ],
  });
}

// d. Welcome ------------------------------------------------------------------------------------

export function welcomeEmail(opts: { email: string; name?: string | null; trialMinutes: number }): Rendered {
  const base = appUrl();
  const hi = firstName(opts.name);
  const items = [
    {
      title: "Add your knowledge",
      text: "Paste text, add pages from your website or upload PDFs. Your agent answers from these.",
      href: `${base}/app/knowledge`,
      cta: "Add knowledge",
    },
    {
      title: "Customise your agent",
      text: "Set its greeting, voice, language and the rules it should always follow.",
      href: `${base}/app/agents`,
      cta: "Open agents",
    },
    {
      title: "Install it on your site",
      text: "Copy one script tag into your website. It works on any site that lets you add custom code.",
      href: `${base}/app/install`,
      cta: "See how to install",
    },
  ];
  return render({
    template: "welcome",
    subject: "Welcome to Halochime",
    preheader: "Your email is verified. Three steps to get your agent talking on your website.",
    body: [
      heading(hi ? `Welcome to Halochime, ${hi}` : "Welcome to Halochime"),
      p(`Your email is verified. Here's how to get your agent answering visitors on your website. New workspaces include ${opts.trialMinutes} free voice minutes, and text chat is free during the beta.`),
      steps(items),
      button(`${base}/app`, "Open your dashboard"),
    ].join("\n"),
    footer: `You got this email because you created a Halochime account with ${opts.email}.`,
    text: [
      hi ? `Welcome to Halochime, ${hi}` : "Welcome to Halochime",
      "",
      `Your email is verified. Here's how to get your agent answering visitors on your website. New workspaces include ${opts.trialMinutes} free voice minutes, and text chat is free during the beta.`,
      "",
      ...items.flatMap((s, i) => [`${i + 1}. ${s.title}`, `   ${s.text}`, `   ${s.href}`, ""]),
      `Open your dashboard: ${base}/app`,
    ],
  });
}

// e. Team invite --------------------------------------------------------------------------------

const ROLE = { owner: "an owner", admin: "an admin", member: "a member" } as Record<string, string>;
const roleText = (role: string) => ROLE[role.split(",")[0]?.trim() ?? ""] ?? "a member";

export function inviteEmail(opts: {
  invitationId: string;
  email: string;
  workspace: string;
  role: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
  expiresAt: Date;
}): Rendered {
  const url = `${appUrl()}/invite/${encodeURIComponent(opts.invitationId)}`;
  const inviter = opts.inviterName?.trim() || opts.inviterEmail || "A teammate";
  const inviterHtml =
    opts.inviterName?.trim() && opts.inviterEmail
      ? `${strong(opts.inviterName.trim())} (${esc(opts.inviterEmail)})`
      : strong(inviter);
  const role = roleText(opts.role);
  const expires = fmtDate(opts.expiresAt);
  return render({
    template: "invite",
    subject: `${inviter} invited you to ${opts.workspace} on Halochime`,
    preheader: `Join ${opts.workspace} as ${role}. The invite expires on ${expires}.`,
    body: [
      heading(`Join ${opts.workspace} on Halochime`),
      p(`${inviterHtml} invited you to the ${strong(opts.workspace)} workspace as ${esc(role)}.`),
      p(`Halochime is a voice and chat agent that answers visitors on a business website. As a teammate you can see conversations and messages left for the team.`),
      button(url, "Accept invite"),
      p(`This invite is for ${strong(opts.email)} and expires on ${esc(expires)}. Sign in or create an account with this email to accept it.`, {
        muted: true,
        small: true,
      }),
      p(`Button not working? Open this link: ${link(url, url)}`, { muted: true, small: true }),
      p(`If you weren't expecting this, you can ignore this email.`, { muted: true, small: true, last: true }),
    ].join("\n"),
    footer: `You got this email because ${inviter} invited ${opts.email} to a Halochime workspace.`,
    text: [
      `Join ${opts.workspace} on Halochime`,
      "",
      `${opts.inviterName?.trim() && opts.inviterEmail ? `${opts.inviterName.trim()} (${opts.inviterEmail})` : inviter} invited you to the ${opts.workspace} workspace as ${role}.`,
      "",
      `Accept the invite: ${url}`,
      "",
      `This invite is for ${opts.email} and expires on ${expires}. Sign in or create an account with this email to accept it.`,
      "If you weren't expecting this, you can ignore this email.",
    ],
  });
}

// f. Handoff: a visitor left a message for the team ----------------------------------------------

export function handoffEmail(opts: {
  created: boolean;
  workspace: string;
  agentName: string;
  conversationId: string | null;
  visitor: { name: string | null; email: string | null; phone: string | null };
  /** true when Reply-To is the visitor's (valid) email address. */
  replyable: boolean;
  message: string;
  /** Why this recipient gets it: the agent's handoff address, or owner/admin of the workspace. */
  reason: "handoff-email" | "manager";
}): Rendered {
  const base = appUrl();
  const href = opts.conversationId ? `${base}/app/conversations/${encodeURIComponent(opts.conversationId)}` : `${base}/app/handoffs`;
  const who = opts.visitor.name?.trim() || opts.visitor.email || "A visitor";
  const subject = opts.created
    ? `New message from ${who} via ${opts.agentName}`
    : `Updated message from ${who} via ${opts.agentName}`;
  const notGiven = `<span style="color:#9a97a8;">Not given</span>`;
  const { name, email, phone } = opts.visitor;
  const rows = [
    { label: "Name", html: name ? esc(name) : notGiven },
    { label: "Email", html: email ? (opts.replyable ? link(`mailto:${email}`, email) : esc(email)) : notGiven },
    { label: "Phone", html: phone ? link(`tel:${phone.replace(/[^\d+]/g, "")}`, phone) : notGiven },
  ];
  const lead = opts.created
    ? `${esc(who)} asked ${strong(opts.agentName)} to pass a message to your team.`
    : `${esc(who)} added to or corrected the message they left with ${strong(opts.agentName)}.`;
  const footer =
    opts.reason === "handoff-email"
      ? `You got this email because this address is set as the handoff email for "${opts.agentName}" in ${opts.workspace} on Halochime.`
      : `You got this email because you're an owner or admin of ${opts.workspace} on Halochime.`;
  return render({
    template: opts.created ? "handoff-new" : "handoff-updated",
    subject,
    preheader: opts.message.replace(/\s+/g, " ").slice(0, 140),
    body: [
      heading(opts.created ? "New message for your team" : "Updated message for your team"),
      p(lead),
      details(rows),
      quote(escLines(opts.message)),
      opts.replyable ? p(`Reply to this email to answer ${esc(who)} directly.`, { muted: true, small: true }) : "",
      button(href, opts.conversationId ? "Open conversation" : "Open messages"),
    ].join("\n"),
    footer,
    text: [
      opts.created ? "New message for your team" : "Updated message for your team",
      "",
      opts.created
        ? `${who} asked ${opts.agentName} to pass a message to your team.`
        : `${who} added to or corrected the message they left with ${opts.agentName}.`,
      "",
      `Name:  ${name || "Not given"}`,
      `Email: ${email || "Not given"}`,
      `Phone: ${phone || "Not given"}`,
      "",
      "Message:",
      opts.message,
      "",
      ...(opts.replyable ? [`Reply to this email to answer ${who} directly.`, ""] : []),
      `${opts.conversationId ? "Open the conversation" : "Open messages"}: ${href}`,
    ],
  });
}

// g. Voice minutes running low / out --------------------------------------------------------------

export function lowMinutesEmail(opts: { workspace: string; balanceSeconds: number }): Rendered {
  const href = `${appUrl()}/app/billing`;
  const out = opts.balanceSeconds <= 0;
  const minutes = Math.max(0, Math.floor(opts.balanceSeconds / 60));
  const left = `${minutes} voice ${minutes === 1 ? "minute" : "minutes"}`;
  return render({
    template: out ? "minutes-out" : "minutes-low",
    subject: out ? `Voice is paused for ${opts.workspace}: no minutes left` : `${opts.workspace} has ${left} left`,
    preheader: out
      ? "Your voice minutes have run out. Text chat still works."
      : `Voice calls pause when the balance reaches 0. Text chat keeps working.`,
    body: out
      ? [
          heading("You're out of voice minutes"),
          p(`${strong(opts.workspace)} has no voice minutes left, so visitors can't start voice calls right now. Text chat still works.`),
          p(`Card top ups are coming soon. You can see your balance and every call on the Billing page.`),
          button(href, "View billing"),
        ].join("\n")
      : [
          heading("Voice minutes running low"),
          p(`${strong(opts.workspace)} has ${strong(left)} left. When the balance reaches 0, visitors can't start voice calls until more minutes are added. Text chat keeps working.`),
          p(`Card top ups are coming soon. You can see your balance and every call on the Billing page.`),
          button(href, "View billing"),
        ].join("\n"),
    footer: `You got this email because you're an owner or admin of ${opts.workspace} on Halochime. We send it once until the balance goes up again.`,
    text: out
      ? [
          "You're out of voice minutes",
          "",
          `${opts.workspace} has no voice minutes left, so visitors can't start voice calls right now. Text chat still works.`,
          "",
          "Card top ups are coming soon. You can see your balance and every call on the Billing page.",
          "",
          `View billing: ${href}`,
        ]
      : [
          "Voice minutes running low",
          "",
          `${opts.workspace} has ${left} left. When the balance reaches 0, visitors can't start voice calls until more minutes are added. Text chat keeps working.`,
          "",
          "Card top ups are coming soon. You can see your balance and every call on the Billing page.",
          "",
          `View billing: ${href}`,
        ],
  });
}
