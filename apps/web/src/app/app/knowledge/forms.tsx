"use client";

import { FileText, FileUp, Globe, Network, Plus, Trash2, Type, type LucideIcon } from "lucide-react";
import { type ReactNode, useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ActionMessage, type ActionState, SubmitButton } from "@/components/form-bits";
import { Button, Card, CardHeader, cx, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { addTextSource, addUrlSource, deleteSource, importSiteSource, type SiteImportState, uploadFileSource } from "./actions";

type AgentOption = { id: string; name: string };
type Tab = "text" | "url" | "site" | "file";

function ScopeSelect({ agents }: { agents: AgentOption[] }) {
  return (
    <Field label="Used by" htmlFor="agentId">
      <Select id="agentId" name="agentId" defaultValue="">
        <option value="">All agents (shared)</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            Only {a.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Clears the form after a successful submit. */
function useResetOnSuccess(state: ActionState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

function TextForm({ agents }: { agents: AgentOption[] }) {
  const [state, action] = useActionState(addTextSource, null);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="title">
          <Input id="title" name="title" required maxLength={200} placeholder="Opening hours and FAQ" />
        </Field>
        <ScopeSelect agents={agents} />
      </div>
      <Field label="Text" htmlFor="content" hint="Plain text or Markdown. Questions and answers work well.">
        <Textarea id="content" name="content" required rows={8} placeholder={"Q: When are you open?\nA: Monday to Friday, 9am to 6pm."} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Adding...">
          <Plus aria-hidden />
          Add text
        </SubmitButton>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function UrlForm({ agents }: { agents: AgentOption[] }) {
  const [state, action] = useActionState(addUrlSource, null);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Page URL" htmlFor="url" hint="One public page. We read its main text.">
          <Input id="url" name="url" type="url" required maxLength={2048} placeholder="https://example.com/faq" />
        </Field>
        <ScopeSelect agents={agents} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Importing...">
          <Globe aria-hidden />
          Import page
        </SubmitButton>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

/** Shown only while the form's action runs. */
function PendingNote({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <p className="text-sm text-slate-500" role="status">
      {children}
    </p>
  );
}

/** The summary stays on screen (unlike the fading success message of the other forms); hidden while a new import runs. */
function SiteImportResult({ state }: { state: SiteImportState }) {
  const { pending } = useFormStatus();
  if (pending || !state) return null;
  return (
    <>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.ok && state.message ? <Notice tone="success">{state.message}</Notice> : null}
      <SiteImportDetails state={state} />
    </>
  );
}

function SiteImportDetails({ state }: { state: SiteImportState }) {
  const details = state?.details ?? [];
  if (details.length === 0) return null;
  const failed = details.filter((d) => d.failed).length;
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium text-slate-700">
        Skipped and failed pages ({details.length}
        {failed ? `, ${failed} failed` : ""})
      </summary>
      <ul className="mt-2 space-y-1.5">
        {details.map((d) => (
          <li key={d.url} className="min-w-0">
            <span className="block truncate text-slate-700" title={d.url}>
              {d.url}
            </span>
            <span className={cx("block text-xs", d.failed ? "text-red-600" : "text-slate-500")}>{d.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function SiteForm({ agents }: { agents: AgentOption[] }) {
  const [state, action] = useActionState(importSiteSource, null);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Site address"
          htmlFor="site"
          hint="We read its sitemap (or the home page links) and import up to 25 pages, each as its own source."
        >
          <Input id="site" name="site" required maxLength={2048} placeholder="example.com" autoComplete="url" inputMode="url" />
        </Field>
        <ScopeSelect agents={agents} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Importing up to 25 pages...">
          <Network aria-hidden />
          Import site
        </SubmitButton>
        <PendingNote>This can take up to a minute. Keep this page open.</PendingNote>
      </div>
      <SiteImportResult state={state} />
    </form>
  );
}

/** Checked in the browser too: a body over the server's limit fails before the action can answer. */
function fileSizeError(file: File | undefined): string | null {
  if (!file) return null;
  const isPdf = /\.pdf$/i.test(file.name);
  if (isPdf && file.size > 4 * 1024 * 1024) return "PDFs can be up to 4 MB.";
  if (!isPdf && file.size > 1024 * 1024) return "Text files can be up to 1 MB.";
  return null;
}

function FileForm({ agents }: { agents: AgentOption[] }) {
  const [state, action] = useActionState(uploadFileSource, null);
  const [localError, setLocalError] = useState<string | null>(null);
  const ref = useResetOnSuccess(state);
  return (
    <form
      ref={ref}
      action={action}
      className="space-y-4"
      onSubmit={(e) => {
        const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
        const error = fileSizeError(input?.files?.[0]);
        setLocalError(error);
        if (error) e.preventDefault();
      }}
      onChange={() => setLocalError(null)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="File" htmlFor="file" hint="PDF up to 4 MB (with selectable text), or .txt / .md up to 1 MB.">
          <Input id="file" name="file" type="file" accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown" required className="h-auto py-1.5 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-50 file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100" />
        </Field>
        <ScopeSelect agents={agents} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Uploading...">
          <FileUp aria-hidden />
          Upload
        </SubmitButton>
        {localError ? <Notice tone="error">{localError}</Notice> : <ActionMessage state={state} />}
      </div>
    </form>
  );
}

const TABS: { id: Tab; label: string; extra?: string; icon: LucideIcon }[] = [
  { id: "text", label: "Paste text / FAQ", icon: Type },
  { id: "url", label: "Web page", icon: Globe },
  { id: "site", label: "Whole site", extra: "(sitemap)", icon: Network },
  { id: "file", label: "Upload file", icon: FileText },
];

export function AddSourceForms({ agents }: { agents: AgentOption[] }) {
  const [tab, setTab] = useState<Tab>("text");
  return (
    <Card>
      <CardHeader title="Add knowledge" icon={Plus} description="Questions and answers, policies, prices, opening hours: anything visitors ask about." />
      <div className="overflow-x-auto px-5 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Source type">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={(e) => {
              setTab(t.id);
              // The row scrolls sideways on phones: bring the chosen tab fully into view.
              e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
            className={cx(
              "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600",
              tab === t.id ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800",
            )}
          >
            <t.icon className={cx("size-4", tab === t.id ? "text-brand-600" : "opacity-70")} aria-hidden />
            {t.label}
            {t.extra ? <span className="-ml-1 hidden sm:inline">{t.extra}</span> : null}
          </button>
        ))}
        </div>
      </div>
      <div className="p-5">
        {tab === "text" ? (
          <TextForm agents={agents} />
        ) : tab === "url" ? (
          <UrlForm agents={agents} />
        ) : tab === "site" ? (
          <SiteForm agents={agents} />
        ) : (
          <FileForm agents={agents} />
        )}
      </div>
    </Card>
  );
}

export function DeleteSourceButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={deleteSource}
      onSubmit={(e) => {
        if (!confirm(`Delete "${title}"? Agents will stop using it.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" className="text-slate-500 hover:bg-red-50 hover:text-red-700" title={`Delete ${title}`}>
        <Trash2 aria-hidden />
        <span className="sr-only sm:not-sr-only">Delete</span>
      </Button>
    </form>
  );
}
