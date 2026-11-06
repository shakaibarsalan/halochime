"use client";

import { MessageCircle, Phone, Power, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useActionState, useState, useTransition } from "react";
import { ActionMessage, type ActionState, CopyButton, SubmitButton } from "@/components/form-bits";
import { Badge, Button, Card, CardHeader, Field, Input, Notice, Select, Textarea, Toggle } from "@/components/ui";
import {
  checkWhatsappConnection,
  removePhoneChannel,
  removeWhatsappChannel,
  savePhoneChannel,
  saveWhatsappChannel,
  setPhoneEnabled,
  setWhatsappEnabled,
} from "./actions";

export type ChannelStatus = { enabled: boolean; lastEventAt: string | null; lastError: string | null; lastErrorAt: string | null };

export type PhoneView = ChannelStatus & {
  available: boolean;
  originationUri: string | null;
  sipHost: string | null;
  saved: {
    number: string;
    provider: "twilio" | "other";
    allowedAddresses: string[];
    authUsername: string | null;
    passwordHint: string | null;
  } | null;
};

export type WhatsappView = ChannelStatus & {
  audioAvailable: boolean;
  webhookUrl: string | null;
  saved: { phoneNumberId: string; replyWithVoice: boolean; hints: Record<string, string> } | null;
};

export function AgentPicker({ agents, current }: { agents: { id: string; name: string; status: string }[]; current: string }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Agent"
      value={current}
      onChange={(e) => router.replace(`/app/channels?agent=${encodeURIComponent(e.target.value)}`, { scroll: false })}
      className="w-full sm:w-64"
    >
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.status === "published" ? "" : " (draft)"}
        </option>
      ))}
    </Select>
  );
}

function StatusBadge({ enabled, saved }: { enabled: boolean; saved: boolean }) {
  if (enabled) return <Badge tone="green" dot>on</Badge>;
  return <Badge tone={saved ? "amber" : "gray"} dot>{saved ? "off" : "not set up"}</Badge>;
}

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : null;

function Activity({ status, noun }: { status: ChannelStatus; noun: string }) {
  const last = when(status.lastEventAt);
  const errAt = when(status.lastErrorAt);
  if (!last && !status.lastError) return null;
  return (
    <div className="space-y-2">
      {last ? <p className="text-xs text-slate-500">Last {noun}: {last}</p> : null}
      {status.lastError ? (
        <Notice tone="error">
          <span className="block font-medium">Last problem{errAt ? ` (${errAt})` : ""}</span>
          <span className="block [overflow-wrap:anywhere]">{status.lastError}</span>
        </Notice>
      ) : null}
    </div>
  );
}

/** A value the owner copies into their provider's dashboard. Long values wrap, never scroll sideways. */
function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <CopyButton text={value} />
      </div>
      <p className="mt-1 font-mono text-[13px] text-slate-900 [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600 marker:text-slate-400 [&_b]:font-semibold [&_b]:text-slate-900">{children}</ol>;
}

/** On/off and remove buttons, run as server actions with a confirm for the destructive ones. */
function ChannelButtons({
  enabled,
  canEnable,
  onToggle,
  onRemove,
  removeText,
}: {
  enabled: boolean;
  canEnable: boolean;
  onToggle: (next: boolean) => Promise<ActionState>;
  onRemove: () => Promise<ActionState>;
  removeText: string;
}) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={enabled ? "secondary" : "primary"}
          disabled={pending || (!enabled && !canEnable)}
          aria-busy={pending}
          onClick={() => start(async () => setState(await onToggle(!enabled)))}
        >
          <Power aria-hidden />
          {pending ? "Working..." : enabled ? "Turn off" : "Turn on"}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (window.confirm(removeText)) start(async () => setState(await onRemove()));
          }}
        >
          <Trash2 aria-hidden />
          Remove
        </Button>
      </div>
      <ActionMessage state={state} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------- phone

export function PhoneCard({ agentId, view, canManage }: { agentId: string; view: PhoneView; canManage: boolean }) {
  const [state, action] = useActionState(savePhoneChannel, null);
  const saved = view.saved;
  const [provider, setProvider] = useState<"twilio" | "other">(saved?.provider ?? "twilio");
  const [requireAuth, setRequireAuth] = useState(Boolean(saved?.authUsername));

  return (
    <Card>
      <CardHeader
        title="Phone calls"
        icon={Phone}
        description="Callers to your business number talk to this agent. Calls use your voice minutes."
        action={<StatusBadge enabled={view.enabled} saved={Boolean(saved)} />}
      />
      <div className="space-y-6 p-5">
        {!view.available ? (
          <Notice tone="info">Phone calls are not available on this server yet. The Halochime team has to finish the phone setup first.</Notice>
        ) : null}

        {canManage ? (
          <form action={action} className="space-y-4">
            <input type="hidden" name="agentId" value={agentId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your phone number" htmlFor="phone-number" hint="International format, e.g. +14155550100.">
                <Input id="phone-number" name="number" inputMode="tel" autoComplete="off" defaultValue={saved?.number ?? ""} placeholder="+14155550100" required />
              </Field>
              <Field label="Where the number is" htmlFor="phone-provider">
                <Select id="phone-provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value === "other" ? "other" : "twilio")}>
                  <option value="twilio">Twilio (Elastic SIP Trunking)</option>
                  <option value="other">Another SIP provider</option>
                </Select>
              </Field>
            </div>
            <Field
              label="Only accept calls from these addresses (optional)"
              htmlFor="phone-addresses"
              hint="IP addresses or ranges of your provider's SIP servers, one per line, e.g. 54.172.60.0/30. Empty accepts calls to your number from anywhere."
            >
              <Textarea id="phone-addresses" name="allowedAddresses" defaultValue={saved?.allowedAddresses.join("\n") ?? ""} className="min-h-20 font-mono text-[13px]" />
            </Field>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-slate-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-600">
              <input
                type="checkbox"
                name="requireAuth"
                checked={requireAuth}
                onChange={(e) => setRequireAuth(e.target.checked)}
                className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">Require a username and password</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                  For providers that sign in when they send calls. Twilio does not do this on incoming calls: use the addresses above instead.
                </span>
              </span>
            </label>
            {requireAuth && saved?.authUsername ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="newPassword" className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30" />
                Make a new password (the old one stops working)
              </label>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Save</SubmitButton>
            </div>
            <ActionMessage state={state} />
            {state?.password && state.username ? (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">Copy the password now. It is not shown again.</p>
                <CopyValue label="Username" value={state.username} />
                <CopyValue label="Password" value={state.password} />
              </div>
            ) : null}
          </form>
        ) : saved ? (
          <p className="text-sm text-slate-600">
            Number: <span className="font-medium text-slate-900">{saved.number}</span>
          </p>
        ) : (
          <p className="text-sm text-slate-500">Not set up. Ask an owner or admin to connect a phone number.</p>
        )}

        {saved && view.originationUri && view.sipHost ? (
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">Point your number to us</h3>
            {saved.provider === "twilio" ? (
              <Steps>
                <li>
                  In the Twilio Console open <b>Elastic SIP Trunking</b>, then <b>Trunks</b>, and create a trunk (or open the one you have).
                </li>
                <li>
                  On the trunk&apos;s <b>Origination</b> tab, add this <b>Origination URI</b>:
                  <div className="mt-2">
                    <CopyValue label="Origination URI" value={view.originationUri} />
                  </div>
                </li>
                <li>
                  On the <b>Numbers</b> tab, add {saved.number} to the trunk.
                </li>
                <li>Come back here and press Turn on. Then call the number to test.</li>
              </Steps>
            ) : (
              <Steps>
                <li>
                  In your provider&apos;s dashboard, send incoming calls for {saved.number} to this SIP address (TCP or UDP, port 5060; TLS on 5061):
                  <div className="mt-2">
                    <CopyValue label="SIP address" value={`sip:${view.sipHost}`} />
                  </div>
                </li>
                {saved.authUsername ? (
                  <li>
                    Use the username <b className="[overflow-wrap:anywhere]">{saved.authUsername}</b> and the password you copied when you saved
                    {saved.passwordHint ? ` (ends in ${saved.passwordHint})` : ""}.
                  </li>
                ) : null}
                <li>The number must reach us in international format ({saved.number}).</li>
                <li>Press Turn on, then call the number to test.</li>
              </Steps>
            )}
          </div>
        ) : null}

        {saved ? <Activity status={view} noun="call" /> : null}

        {canManage && saved ? (
          <ChannelButtons
            enabled={view.enabled}
            canEnable={view.available}
            onToggle={(next) => setPhoneEnabled(agentId, next)}
            onRemove={() => removePhoneChannel(agentId)}
            removeText="Remove the phone channel? Calls to the number stop being answered."
          />
        ) : null}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------- WhatsApp

function secretHint(hints: Record<string, string>, key: string) {
  return hints[key] ? `Saved (ends in ${hints[key]}). Leave empty to keep it.` : undefined;
}

export function WhatsappCard({ agentId, view, canManage }: { agentId: string; view: WhatsappView; canManage: boolean }) {
  const [state, action] = useActionState(saveWhatsappChannel, null);
  const [check, setCheck] = useState<ActionState>(null);
  const [checking, startCheck] = useTransition();
  const saved = view.saved;
  const hints = saved?.hints ?? {};

  return (
    <Card>
      <CardHeader
        title="WhatsApp"
        icon={MessageCircle}
        description="Answers WhatsApp messages and voice notes on your business number (WhatsApp Business Cloud API)."
        action={<StatusBadge enabled={view.enabled} saved={Boolean(saved)} />}
      />
      <div className="space-y-6 p-5">
        {!view.audioAvailable ? (
          <Notice tone="info">Voice notes are not available on this server yet, so voice notes get a short text asking to type instead.</Notice>
        ) : null}

        {canManage ? (
          <form action={action} className="space-y-4" autoComplete="off">
            <input type="hidden" name="agentId" value={agentId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone number ID" htmlFor="wa-phone-id" hint="In Meta: WhatsApp, API Setup. Digits, not the phone number.">
                <Input id="wa-phone-id" name="phoneNumberId" inputMode="numeric" defaultValue={saved?.phoneNumberId ?? ""} required />
              </Field>
              <Field label="Permanent access token" htmlFor="wa-token" hint={secretHint(hints, "accessToken") ?? "A System User token with whatsapp_business_messaging."}>
                <Input id="wa-token" name="accessToken" type="password" autoComplete="new-password" required={!hints.accessToken} />
              </Field>
              <Field label="App secret" htmlFor="wa-secret" hint={secretHint(hints, "appSecret") ?? "In Meta: App settings, Basic. Used to check that messages come from Meta."}>
                <Input id="wa-secret" name="appSecret" type="password" autoComplete="new-password" required={!hints.appSecret} />
              </Field>
              <Field label="Verify token" htmlFor="wa-verify" hint={secretHint(hints, "verifyToken") ?? "Any text you choose (8+ characters). You type the same text in Meta."}>
                <Input id="wa-verify" name="verifyToken" type="password" autoComplete="new-password" required={!hints.verifyToken} />
              </Field>
            </div>
            <Toggle
              name="replyWithVoice"
              defaultChecked={saved?.replyWithVoice ?? true}
              label="Answer voice notes with a voice note"
              hint="The text answer is always sent. This adds a voice note with the same answer."
            />
            <SubmitButton>Save</SubmitButton>
            <ActionMessage state={state} />
          </form>
        ) : !saved ? (
          <p className="text-sm text-slate-500">Not set up. Ask an owner or admin to connect WhatsApp.</p>
        ) : null}

        {saved && view.webhookUrl ? (
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">Connect it in Meta</h3>
            <Steps>
              <li>
                In your Meta app open <b>WhatsApp</b>, then <b>Configuration</b>, and press <b>Edit</b> next to Webhook. Paste this as the <b>Callback URL</b>:
                <div className="mt-2">
                  <CopyValue label="Callback URL" value={view.webhookUrl} />
                </div>
              </li>
              <li>
                Type your verify token in <b>Verify token</b> and press <b>Verify and save</b>.
              </li>
              <li>
                Under <b>Webhook fields</b>, subscribe to <b>messages</b>.
              </li>
              <li>Press Turn on here, then send a message or a voice note to your WhatsApp number.</li>
            </Steps>
            {canManage ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={checking}
                  aria-busy={checking}
                  onClick={() => startCheck(async () => setCheck(await checkWhatsappConnection(agentId)))}
                >
                  {checking ? "Checking..." : "Check the token"}
                </Button>
                <ActionMessage state={check} />
              </div>
            ) : null}
          </div>
        ) : null}

        {saved ? <Activity status={view} noun="message" /> : null}

        {canManage && saved ? (
          <ChannelButtons
            enabled={view.enabled}
            canEnable
            onToggle={(next) => setWhatsappEnabled(agentId, next)}
            onRemove={() => removeWhatsappChannel(agentId)}
            removeText="Remove the WhatsApp channel? The saved tokens are deleted and messages stop being answered."
          />
        ) : null}
      </div>
    </Card>
  );
}
