"use client";

import { AudioWaveform, Mic, RotateCcw, Square, Trash2, Upload } from "lucide-react";
import { type FormEvent, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { ActionMessage } from "@/components/form-bits";
import { Badge, Button, Card, CardHeader, Field, Input, Notice } from "@/components/ui";
import { CLONE_CONSENT_TEXT, VOICE_SAMPLE_MAX_BYTES } from "@/lib/voices";
import { Segmented } from "./identity-panel";
import { createVoiceClone, deleteVoiceClone } from "./voice-actions";

export type CloneRow = { id: string; name: string; createdAt: string; inUse: boolean };

const MAX_RECORD_S = 180;
const MIN_RECORD_S = 20;
const READ_ALOUD =
  "Hi, thanks for getting in touch. I can help you with orders, bookings and any questions about our services. " +
  "If I can't answer something, I'll take a message and someone from our team will get back to you soon. " +
  "Is there anything else I can help you with today? Have a great day, and thank you for choosing us.";

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function DeleteClone({ agentId, clone }: { agentId: string; clone: CloneRow }) {
  const [state, action] = useActionState(deleteVoiceClone, null);
  return (
    <form action={action} className="contents">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="cloneId" value={clone.id} />
      <DeleteButton name={clone.name} />
      {state?.error ? (
        <div className="col-span-full">
          <Notice tone="error">{state.error}</Notice>
        </div>
      ) : null}
    </form>
  );
}

function DeleteButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-busy={pending}
      aria-label={`Delete ${name}`}
      title={`Delete ${name}`}
      onClick={(e) => {
        if (!window.confirm(`Delete the voice "${name}"? It is also deleted at ElevenLabs, and agents using it go back to the default voice.`)) {
          e.preventDefault();
        }
      }}
    >
      <Trash2 aria-hidden />
      {pending ? "Deleting..." : "Delete"}
    </Button>
  );
}

export function VoiceClonePanel({ agentId, clones, canClone, max }: { agentId: string; clones: CloneRow[]; canClone: boolean; max: number }) {
  const [state, createAction, creating] = useActionState(createVoiceClone, null);
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<"upload" | "record">("upload");
  const [problem, setProblem] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; seconds: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const full = clones.length >= max;

  function stopTracks() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  // Microphone off and the preview freed when the panel goes away or a take is replaced.
  useEffect(() => () => stopTracks(), []);
  useEffect(() => () => {
    if (take) URL.revokeObjectURL(take.url);
  }, [take]);
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setTake(null);
      setProblem(null);
    }
  }, [state]);

  async function startRecording() {
    setProblem(null);
    const mimeType = pickMimeType();
    if (!navigator.mediaDevices?.getUserMedia || mimeType === undefined) {
      setProblem("This browser can't record here. Upload a file instead.");
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setProblem("The microphone is blocked. Allow it for this site, or upload a file instead.");
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream.current, { mimeType });
    let elapsed = 0;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      stopTracks();
      setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType });
      setTake({ blob, url: URL.createObjectURL(blob), seconds: elapsed });
    };
    recorder.current = rec;
    rec.start(1000);
    setTake(null);
    setSeconds(0);
    setRecording(true);
    timer.current = setInterval(() => {
      elapsed += 1;
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORD_S && rec.state === "recording") rec.stop();
    }, 1000);
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProblem(null);
    const fd = new FormData(e.currentTarget);
    if (mode === "record") {
      if (recording) return setProblem("Stop the recording first.");
      if (!take) return setProblem("Record a sample first.");
      if (take.seconds < MIN_RECORD_S) return setProblem(`Record at least ${MIN_RECORD_S} seconds (about a minute works best).`);
      const ext = take.blob.type.includes("mp4") ? "m4a" : take.blob.type.includes("ogg") ? "ogg" : "webm";
      fd.set("sample", new File([take.blob], `recording.${ext}`, { type: take.blob.type }));
      fd.set("recorded", "1");
    } else {
      const file = fd.get("sample");
      if (!(file instanceof File) || file.size === 0) return setProblem("Choose an audio file first.");
      if (file.size > VOICE_SAMPLE_MAX_BYTES) return setProblem("That file is over 4 MB. Use a shorter clip or an MP3.");
      fd.set("recorded", "0");
    }
    if (fd.get("consent") !== "on") return setProblem("Tick the box to confirm you may clone this voice.");
    startTransition(() => createAction(fd));
  }

  return (
    <Card id="brand-voice">
      <CardHeader
        title="Brand voice"
        icon={AudioWaveform}
        description={`Clone a real voice so the agent sounds like your brand. Up to ${max} per workspace; owners only.`}
      />
      <div className="space-y-5 p-5">
        {clones.length > 0 ? (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50">
            {clones.map((c) => (
              <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900" title={c.name}>
                      {c.name}
                    </span>
                    {c.inUse ? <Badge tone="blue">This agent</Badge> : null}
                  </p>
                  <p className="text-xs text-slate-500">Created {new Date(c.createdAt).toLocaleDateString()}</p>
                </div>
                {canClone ? <DeleteClone agentId={agentId} clone={c} /> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {!canClone ? (
          <p className="text-sm text-slate-500">
            {clones.length > 0
              ? "Pick a brand voice under Voice above. Only workspace owners can create or delete brand voices."
              : "Only workspace owners can create a brand voice."}
          </p>
        ) : full ? (
          <p className="text-sm text-slate-500">This workspace has {max} brand voices. Delete one to make another.</p>
        ) : (
          <form ref={formRef} onSubmit={onSubmit} className="space-y-4" noValidate>
            <input type="hidden" name="agentId" value={agentId} />
            <Field label="Voice name" htmlFor="cloneName" hint="Only you see this name, e.g. Front desk voice.">
              <Input id="cloneName" name="name" required maxLength={40} placeholder="Front desk voice" />
            </Field>

            <div className="space-y-3">
              <Segmented
                label="How to add the sample"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setProblem(null);
                }}
                options={[
                  { id: "upload", label: "Upload a file" },
                  { id: "record", label: "Record here" },
                ]}
              />
              <p className="text-xs leading-5 text-slate-500">
                One speaker, 1 to 2 minutes of natural speech in a quiet room. No music, echo or other voices. The voice speaks the
                language you set for the agent.
              </p>
              {mode === "upload" ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <input
                    type="file"
                    name="sample"
                    accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,audio/flac,.mp3,.wav,.m4a,.webm,.ogg,.flac"
                    aria-label="Voice sample file"
                    className="block w-full text-sm text-slate-600 file:mr-3 file:h-8 file:cursor-pointer file:rounded-lg file:border file:border-solid file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-800 file:shadow-xs hover:file:border-slate-300 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  />
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <Upload className="size-3.5 shrink-0" aria-hidden />
                    MP3, WAV, M4A, WebM, Ogg or FLAC under 4 MB.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="rounded-lg bg-white p-3 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-400">Read this aloud, then keep talking</span>
                    {READ_ALOUD}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    {recording ? (
                      <Button type="button" variant="danger" size="sm" onClick={stopRecording}>
                        <Square aria-hidden />
                        Stop
                      </Button>
                    ) : (
                      <Button type="button" variant="secondary" size="sm" onClick={startRecording}>
                        {take ? <RotateCcw aria-hidden /> : <Mic aria-hidden />}
                        {take ? "Record again" : "Start recording"}
                      </Button>
                    )}
                    {recording ? (
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-red-700" role="status">
                        <span className="size-2 animate-pulse rounded-full bg-red-600" aria-hidden />
                        Recording {clock(seconds)} / {clock(MAX_RECORD_S)}
                      </span>
                    ) : take ? (
                      <span className="text-sm text-slate-600">Recorded {clock(take.seconds)}</span>
                    ) : null}
                  </div>
                  {take && !recording ? <audio controls src={take.url} className="h-10 w-full max-w-md" aria-label="Your recording" /> : null}
                </div>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700 hover:border-slate-300 has-[:checked]:border-brand-200 has-[:checked]:bg-brand-50/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
              <input type="checkbox" name="consent" required className="mt-1 size-4 shrink-0 accent-brand-600 focus:outline-none" />
              <span>{CLONE_CONSENT_TEXT}</span>
            </label>

            {problem ? <Notice tone="error">{problem}</Notice> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={creating || recording} aria-busy={creating}>
                <AudioWaveform aria-hidden />
                {creating ? "Creating voice..." : "Create voice"}
              </Button>
              <p className="text-xs text-slate-500">This agent switches to the new voice. You can pick it for other agents too.</p>
            </div>
          </form>
        )}
        <ActionMessage state={state} />
      </div>
    </Card>
  );
}
