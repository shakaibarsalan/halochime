"use client";

import { CircleAlert, CircleCheck, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { type ReactNode, useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ActionMessage, CopyButton, SubmitButton } from "@/components/form-bits";
import { Badge, Button, Card, CardHeader, cx, Input, Notice, Textarea } from "@/components/ui";
import { CodeBlock } from "./code-block";
import { checkIdentityToken, createIdentitySecret, removeIdentitySecret } from "./identity-actions";
import { SIGN_SNIPPETS, type SnippetLang, widgetSnippets } from "./identity-snippets";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="inline-flex max-w-full gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "inline-flex min-w-0 items-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600",
            value === o.id ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Step({ n, title, hint, children }: { n: number; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-3">
      <span className="grid size-7 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 ring-1 ring-brand-100" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 pt-0.5">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {hint ? <p className="mt-0.5 text-sm leading-6 text-slate-500">{hint}</p> : null}
      </div>
      <div className="col-span-2 min-w-0 sm:col-start-2 sm:col-span-1">{children}</div>
    </section>
  );
}

function ConfirmSubmit({ children, confirmText, variant = "secondary" }: { children: ReactNode; confirmText: string; variant?: "secondary" | "danger" | "ghost" }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}

const MASK = `tfid_${"•".repeat(12)}`;

function SecretStep({ agentId, hasSecret, canManage }: { agentId: string; hasSecret: boolean; canManage: boolean }) {
  const [created, createAction] = useActionState(createIdentitySecret, null);
  const [removed, removeAction] = useActionState(removeIdentitySecret, null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (created?.secret) setRevealed(created.secret);
  }, [created]);
  useEffect(() => {
    if (removed?.ok) setRevealed(null);
  }, [removed]);

  if (revealed && hasSecret) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4" role="status">
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
          <CircleCheck className="size-4 text-emerald-600" aria-hidden />
          Your identity secret
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            ref={secretRef}
            readOnly
            value={revealed}
            aria-label="Identity secret"
            className="min-w-0 flex-1 bg-white font-mono text-xs"
            onFocus={() => secretRef.current?.select()}
          />
          <CopyButton text={revealed} label="Copy" />
        </div>
        <p className="mt-2 text-xs leading-5 text-emerald-900/80">
          Copy it now and keep it on your server, for example as <code className="font-mono">TALKFRONT_IDENTITY_SECRET</code>. You
          won&apos;t see it again.
        </p>
        <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setRevealed(null)}>
          I&apos;ve saved it
        </Button>
      </div>
    );
  }

  if (hasSecret) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
          <Badge tone="green" dot>
            set up
          </Badge>
          <span className="min-w-28 flex-1 truncate font-mono text-xs text-slate-500" aria-label="Secret, hidden">
            {MASK}
          </span>
          {canManage ? (
            <div className="ml-auto flex items-center gap-1">
              <form action={createAction}>
                <input type="hidden" name="agentId" value={agentId} />
                <ConfirmSubmit confirmText="Make a new secret? Tokens signed with the current one stop working right away, so update your server straight after.">
                  <RefreshCw aria-hidden />
                  Regenerate
                </ConfirmSubmit>
              </form>
              <form action={removeAction}>
                <input type="hidden" name="agentId" value={agentId} />
                <ConfirmSubmit variant="ghost" confirmText="Remove the secret? Visitors will start as anonymous until you create a new one.">
                  <Trash2 aria-hidden />
                  <span className="sr-only sm:not-sr-only">Remove</span>
                </ConfirmSubmit>
              </form>
            </div>
          ) : null}
        </div>
        {created?.error ? <Notice tone="error">{created.error}</Notice> : null}
        <ActionMessage state={removed} />
        <p className="text-xs leading-5 text-slate-500">The secret is stored encrypted and only shown once, when it is made.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canManage ? (
        <form action={createAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="agentId" value={agentId} />
          <SubmitButton pendingLabel="Creating...">
            <KeyRound aria-hidden />
            Create secret
          </SubmitButton>
          <span className="text-xs text-slate-500">Not set up yet: every visitor starts as anonymous.</span>
        </form>
      ) : (
        <p className="text-sm text-slate-500">Not set up yet. Only owners and admins can create the secret.</p>
      )}
      {created?.error ? <Notice tone="error">{created.error}</Notice> : null}
      <ActionMessage state={removed} />
    </div>
  );
}

function SignStep() {
  const [lang, setLang] = useState<SnippetLang>("node");
  const snippet = SIGN_SNIPPETS.find((s) => s.id === lang) ?? SIGN_SNIPPETS[0]!;
  return (
    <div className="space-y-3">
      <Segmented label="Language" options={SIGN_SNIPPETS.map((s) => ({ id: s.id, label: s.label }))} value={lang} onChange={setLang} />
      <p className="font-mono text-xs text-slate-500">{snippet.install}</p>
      <CodeBlock code={snippet.code} label={`${snippet.label} example`} />
      <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-500 marker:text-slate-300">
        <li>
          <span className="font-medium text-slate-700">sub</span> (your user id) is required; name, email and attributes are optional.
        </li>
        <li>Tokens must expire within 24 hours. Sign a fresh one when the page loads.</li>
        <li>
          <span className="font-medium text-slate-700">attributes</span>: up to 30 flat values (text up to 500 characters, numbers or true/false), e.g. plan or
          open orders.
        </li>
      </ul>
    </div>
  );
}

function WidgetStep({ scriptUrl, publicKey }: { scriptUrl: string; publicKey: string }) {
  const [how, setHow] = useState<"tag" | "js">("tag");
  const s = widgetSnippets(scriptUrl, publicKey);
  return (
    <div className="space-y-3">
      <Segmented
        label="How to pass the token"
        options={[
          { id: "tag", label: "Script tag" },
          { id: "js", label: "JavaScript" },
        ]}
        value={how}
        onChange={setHow}
      />
      <CodeBlock code={how === "tag" ? s.tag : s.js} label={how === "tag" ? "script tag" : "JavaScript example"} />
      <p className="text-xs leading-5 text-slate-500">
        The token is kept in memory only and applies to the next conversation. A missing, wrong or expired token never blocks the chat: the visitor just
        starts as anonymous.
      </p>
    </div>
  );
}

function fmtTime(sec: number) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(sec * 1000));
}

function relative(sec: number) {
  const diff = sec - Date.now() / 1000;
  const abs = Math.abs(diff);
  const text = abs < 90 ? `${Math.round(abs)} seconds` : abs < 5400 ? `${Math.round(abs / 60)} minutes` : `${Math.round((abs / 3600) * 10) / 10} hours`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

function ClaimRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-900 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function CheckStep({ agentId, hasSecret }: { agentId: string; hasSecret: boolean }) {
  const [state, action] = useActionState(checkIdentityToken, null);
  // Controlled, so the pasted token stays in the box after checking (forms reset uncontrolled fields).
  const [token, setToken] = useState("");
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <input type="hidden" name="agentId" value={agentId} />
        <Textarea
          name="token"
          aria-label="Identity token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={3}
          maxLength={8192}
          spellCheck={false}
          autoComplete="off"
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          className="min-h-20 font-mono text-xs [overflow-wrap:anywhere]"
          disabled={!hasSecret}
        />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="secondary" pendingLabel="Checking..." disabled={!hasSecret}>
            <ShieldCheck aria-hidden />
            Check token
          </SubmitButton>
          {!hasSecret ? <span className="text-xs text-slate-500">Create a secret first.</span> : null}
        </div>
      </form>

      {state && "error" in state ? <Notice tone="error">{state.error}</Notice> : null}

      {state && "valid" in state && state.valid ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
            <CircleCheck className="size-4 text-emerald-600" aria-hidden />
            Valid. The agent will know who this visitor is.
          </p>
          <dl className="mt-2 divide-y divide-emerald-100">
            <ClaimRow label="User id (sub)">
              <span className="font-mono text-xs">{state.claims.sub}</span>
            </ClaimRow>
            <ClaimRow label="Name">{state.claims.name ?? <span className="text-slate-400">Not given</span>}</ClaimRow>
            <ClaimRow label="Email">{state.claims.email ?? <span className="text-slate-400">Not given</span>}</ClaimRow>
            <ClaimRow label="Attributes">
              {state.claims.attributes && Object.keys(state.claims.attributes).length ? (
                <span className="flex flex-wrap gap-1.5">
                  {Object.entries(state.claims.attributes).map(([k, v]) => (
                    <span key={k} className="max-w-full truncate rounded-md bg-white px-2 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-emerald-100" title={`${k}: ${String(v)}`}>
                      {k}: {String(v)}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-slate-400">None</span>
              )}
            </ClaimRow>
            <ClaimRow label="Expires">
              {fmtTime(state.claims.exp)} <span className="text-slate-500">({relative(state.claims.exp)})</span>
            </ClaimRow>
          </dl>
        </div>
      ) : null}

      {state && "valid" in state && !state.valid ? (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4" role="alert">
          <p className="flex items-start gap-2 text-sm font-medium text-red-800">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">{state.reason}</span>
          </p>
          {state.decoded ? (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-red-900/70">What the token contains (not verified)</p>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-xs leading-5 text-slate-700 ring-1 ring-red-100 [overflow-wrap:anywhere]">
                {JSON.stringify(state.decoded, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function IdentityPanel({
  agentId,
  hasSecret,
  canManage,
  scriptUrl,
  publicKey,
}: {
  agentId: string;
  hasSecret: boolean;
  canManage: boolean;
  scriptUrl: string;
  publicKey: string;
}) {
  return (
    <Card id="identity">
      <CardHeader
        title="Signed-in visitors"
        icon={KeyRound}
        description="Tell the agent who is signed in on your site, so it can greet them and look up their account."
      />
      <div className="space-y-7 p-5">
        <Step n={1} title="Create a secret" hint="Your server signs tokens with it. Keep it on the server, never in the browser.">
          <SecretStep agentId={agentId} hasSecret={hasSecret} canManage={canManage} />
        </Step>
        <Step n={2} title="Sign a token on your server" hint="For the signed-in user, each time the page loads.">
          <SignStep />
        </Step>
        <Step n={3} title="Give the token to the widget">
          <WidgetStep scriptUrl={scriptUrl} publicKey={publicKey} />
        </Step>
        <Step n={4} title="Check a token" hint="Paste one your server made to see what the agent will get, or the exact problem.">
          <CheckStep agentId={agentId} hasSecret={hasSecret} />
        </Step>
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-200/70">
          The agent treats verified details as true and uses them naturally, without reading them out unless asked. Actions also get the user id in the{" "}
          <code className="font-mono">X-Halochime-Visitor</code> header.
        </p>
      </div>
    </Card>
  );
}
