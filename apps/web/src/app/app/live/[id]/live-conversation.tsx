"use client";

import { ArrowUpRight, Bot, Hand, Info, ListTree, Send, UserRound } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Badge, Button, ButtonLink, Card, CardHeader, cx, EmptyState, ModeBadge, Notice, PageHeader, Textarea } from "@/components/ui";
import type { LiveConversation } from "@/lib/live";
import { AUTO_RELEASE_MIN, MAX_STAFF_MESSAGE, pageLabel, startedAgo, visitorLabel } from "@/lib/live-format";
import { handBackConversation, sendStaffMessage, takeOverConversation, type LiveActionResult } from "../actions";
import { usePoll } from "../use-poll";

const EVERY_MS = 2000;
/** A message sent from here shows as "sending" until the transcript has it, at most this long. */
const PENDING_MAX_MS = 30_000;

type Pending = { key: string; text: string; seenBefore: number; at: number };

const countStaff = (c: LiveConversation, text: string) => c.messages.filter((m) => m.role === "staff" && m.content === text).length;

export function LiveConversationView({ initial }: { initial: LiveConversation }) {
  const [conv, setConv] = useState(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [busy, startTransition] = useTransition();
  const [now, setNow] = useState<Date | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToEnd = useRef(true);

  useEffect(() => setNow(new Date()), []);

  const onData = useCallback((d: { conversation?: LiveConversation }) => {
    if (!d.conversation) return;
    const next = d.conversation;
    setPollFailed(false);
    setNow(new Date());
    setConv(next);
    setPending((list) => list.filter((p) => countStaff(next, p.text) <= p.seenBefore && Date.now() - p.at < PENDING_MAX_MS));
  }, []);
  const refresh = usePoll(`/api/live/${encodeURIComponent(initial.id)}`, EVERY_MS, onData, () => setPollFailed(true));

  // Keep the newest message in view while the reader is at the bottom (not while they scroll back).
  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  }, [conv.messages.length, pending.length]);

  const mine = conv.live && conv.takenOverByMe;
  const heldByOther = conv.live && conv.takenOverByName !== null && !conv.takenOverByMe;

  function run(action: () => Promise<LiveActionResult>, after?: (ok: boolean) => void) {
    setError(null);
    startTransition(async () => {
      let result: LiveActionResult;
      try {
        result = await action();
      } catch {
        result = { ok: false, error: "Something went wrong. Try again." };
      }
      if (!result.ok) setError(result.error);
      after?.(result.ok);
      refresh();
    });
  }

  function takeOver() {
    run(
      () => takeOverConversation(conv.id),
      (ok) => {
        if (!ok) return;
        setConv((c) => ({ ...c, takenOverByMe: true, takenOverByName: "You", takenOverAt: new Date().toISOString() }));
        // Straight to the reply box on a computer; on a phone the keyboard would cover the conversation.
        if (window.matchMedia("(pointer: fine)").matches) window.setTimeout(() => inputRef.current?.focus(), 0);
      },
    );
  }

  function handBack() {
    run(
      () => handBackConversation(conv.id),
      (ok) => {
        if (ok) setConv((c) => ({ ...c, takenOverByMe: false, takenOverByName: null, takenOverAt: null }));
      },
    );
  }

  function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const item: Pending = { key: crypto.randomUUID(), text, seenBefore: countStaff(conv, text), at: Date.now() };
    stickToEnd.current = true;
    setPending((p) => [...p, item]);
    setDraft("");
    run(
      () => sendStaffMessage(conv.id, text),
      (ok) => {
        if (ok) return;
        setPending((p) => p.filter((x) => x.key !== item.key));
        setDraft((d) => d || text);
      },
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const visitor = visitorLabel(conv.visitorName, conv.visitorEmail) ?? "Visitor";
  const page = pageLabel(conv.pageUrl, conv.pageTitle);
  const time = (iso: string) => (now ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

  return (
    <>
      <PageHeader
        title={visitor}
        back={{ href: "/app/live", label: "Live" }}
        description={`${conv.agentName}${now ? ` · started ${startedAgo(conv.startedAt, now)}` : ""}`}
        badge={
          conv.live ? (
            <Badge tone="green" dot>
              live
            </Badge>
          ) : (
            <Badge tone="gray">ended</Badge>
          )
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex min-w-0 flex-col">
          <CardHeader
            title="Conversation"
            icon={ListTree}
            description={
              mine
                ? "You are replying. The AI waits."
                : conv.takenOverByName
                  ? `${conv.takenOverByName} is replying. The AI waits.`
                  : conv.live
                    ? "The AI is answering."
                    : "This conversation has ended."
            }
          />
          {pollFailed ? (
            <div className="px-4 pt-3 sm:px-5">
              <Notice tone="error">Could not refresh. Trying again...</Notice>
            </div>
          ) : null}
          <div
            ref={listRef}
            onScroll={onScroll}
            className="max-h-[min(62dvh,600px)] min-h-48 overflow-y-auto"
            aria-live="polite"
            aria-relevant="additions"
          >
            {conv.messages.length === 0 && pending.length === 0 ? (
              <EmptyState icon={ListTree} title="Nothing said yet">
                Messages show up here a moment after they are said.
              </EmptyState>
            ) : (
              <ol className="space-y-3 p-4 sm:p-5">
                {conv.messages.map((m) => (
                  <MessageLine key={m.id} role={m.role} content={m.content} time={time(m.createdAt)} agentName={conv.agentName} />
                ))}
                {pending.map((p) => (
                  <MessageLine key={p.key} role="staff" content={p.text} time="Sending..." agentName={conv.agentName} pending />
                ))}
              </ol>
            )}
          </div>

          <div className="space-y-3 border-t border-slate-100 bg-slate-50/70 rounded-b-2xl px-4 py-4 sm:px-5">
            {error ? <Notice tone="error">{error}</Notice> : null}
            {!conv.live ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">This conversation has ended.</p>
                <ButtonLink href={`/app/conversations/${conv.id}`} variant="secondary" size="sm">
                  Open transcript
                  <ArrowUpRight aria-hidden />
                </ButtonLink>
              </div>
            ) : mine ? (
              <>
                <label htmlFor="staff-reply" className="sr-only">
                  Your reply to the visitor
                </label>
                <Textarea
                  id="staff-reply"
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  maxLength={MAX_STAFF_MESSAGE}
                  rows={2}
                  placeholder={conv.mode === "voice" ? "Type what the agent's voice should say..." : "Type your reply..."}
                  className="min-h-20 resize-y"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 text-xs leading-5 text-slate-500">
                    {conv.mode === "voice" ? "The agent's voice says your words to the visitor. " : ""}
                    Back to the AI after {AUTO_RELEASE_MIN} minutes with no message from you.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={handBack} disabled={busy}>
                      <Bot aria-hidden />
                      Hand back to AI
                    </Button>
                    <Button type="button" size="sm" onClick={send} disabled={busy || !draft.trim()}>
                      <Send aria-hidden />
                      Send
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm text-slate-600">
                  {heldByOther
                    ? `${conv.takenOverByName} has taken this conversation over.`
                    : "Take over to reply yourself. The visitor sees that a person from the team joined."}
                </p>
                <Button type="button" size="sm" variant={heldByOther ? "secondary" : "primary"} onClick={takeOver} disabled={busy}>
                  <Hand aria-hidden />
                  {heldByOther ? "Take over instead" : "Take over"}
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Details" icon={Info} />
          <dl className="divide-y divide-slate-100 text-sm">
            <Detail label="Agent">
              <span className="block truncate" title={conv.agentName}>
                {conv.agentName}
              </span>
            </Detail>
            <Detail label="Mode">
              <ModeBadge mode={conv.mode} />
            </Detail>
            <Detail label="Visitor">
              <span className="block truncate" title={visitor}>
                {visitor}
              </span>
            </Detail>
            {conv.visitorName && conv.visitorEmail ? (
              <Detail label="Email">
                <span className="block truncate" title={conv.visitorEmail}>
                  {conv.visitorEmail}
                </span>
              </Detail>
            ) : null}
            {page ? (
              <Detail label="Page">
                {conv.pageUrl && /^https?:\/\//i.test(conv.pageUrl) ? (
                  <a href={conv.pageUrl} target="_blank" rel="noreferrer noopener" title={conv.pageUrl} className="block truncate text-brand-700 hover:underline">
                    {page}
                  </a>
                ) : (
                  <span className="block truncate" title={page}>
                    {page}
                  </span>
                )}
              </Detail>
            ) : null}
            <Detail label="Replying">
              {conv.takenOverByName ? (
                <span className="inline-flex items-center gap-1 font-medium text-amber-800" title={conv.takenOverByName}>
                  <UserRound className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{conv.takenOverByMe ? "You" : conv.takenOverByName}</span>
                </span>
              ) : conv.live ? (
                "The AI"
              ) : (
                "-"
              )}
            </Detail>
          </dl>
        </Card>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-slate-900">{children}</dd>
    </div>
  );
}

function MessageLine({
  role,
  content,
  time,
  agentName,
  pending,
}: {
  role: LiveConversation["messages"][number]["role"];
  content: string;
  time: string;
  agentName: string;
  pending?: boolean;
}) {
  if (role === "system") {
    return (
      <li className="flex justify-center">
        <span className="max-w-[90%] rounded-full border border-slate-200 bg-white px-3 py-1 text-center text-xs text-slate-500">{content}</span>
      </li>
    );
  }
  if (role === "tool") {
    return (
      <li className="flex justify-start">
        <span className="block max-w-[85%] truncate rounded-lg border border-dashed border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500" title={content}>
          {toolLabel(content)}
        </span>
      </li>
    );
  }
  const who = role === "user" ? "Visitor" : role === "staff" ? "Team" : agentName;
  return (
    <li className={cx("flex flex-col", role === "user" ? "items-end" : "items-start")}>
      <span className="mb-1 flex max-w-[85%] items-center gap-1.5 px-1 text-[11px] text-slate-500">
        <span className={cx("truncate font-medium", role === "staff" && "text-amber-800")} title={who}>
          {who}
        </span>
        {time ? <span className="shrink-0 tabular-nums">{time}</span> : null}
      </span>
      <div
        className={cx(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-6",
          role === "user" && "rounded-br-md bg-brand-600 text-white",
          role === "assistant" && "rounded-bl-md border border-slate-200/80 bg-slate-50 text-slate-900",
          role === "staff" && "rounded-bl-md border border-amber-200 bg-amber-50 text-slate-900",
          pending && "opacity-60",
        )}
      >
        {content}
      </div>
    </li>
  );
}

/** A tool call line ("search_knowledge {...} -> ok: ...") in plain words; the full line stays in the hover title. */
function toolLabel(content: string): string {
  const name = content.match(/^([a-z_][a-z0-9_:-]*)/i)?.[1] ?? "";
  const query = content.match(/"query":\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const failed = /->\s*(error|failed)/i.test(content);
  if (name === "search_knowledge") return `${failed ? "Search failed" : "Looked up"}: ${query ?? "the knowledge"}`;
  if (name === "request_human") return "Prepared a message for the team";
  if (name === "confirm_message") return "Sent the message to the team";
  if (name === "end_call") return "Ended the call";
  if (name === "point_to") return "Pointed at something on the page";
  return `Used ${name.replace(/^int:[^:]+:/, "").replace(/_/g, " ") || "a tool"}${failed ? " (failed)" : ""}`;
}
