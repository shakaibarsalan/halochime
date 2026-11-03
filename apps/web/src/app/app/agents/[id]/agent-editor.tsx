"use client";

import {
  WIDGET_ICON_SHAPES,
  type ConversationMode,
  type WidgetAppearance,
  type WidgetIcon,
  type WidgetIconShape,
  type WidgetTheme,
} from "@talkfront/shared";
import { AudioLines, Globe, ImageUp, MessageSquare, Mic, Palette, Save, ScrollText, UserRound, type LucideIcon } from "lucide-react";
import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { ActionMessage, SubmitButton } from "@/components/form-bits";
import { Card, CardHeader, Field, Input, Select, Textarea, Toggle } from "@/components/ui";
import { LLM_MODELS, STT_MODELS, TTS_VOICES } from "@/lib/agent-defaults";
import { LANGUAGES } from "@/lib/languages";
import { saveAgent } from "../actions";

export type EditableAgent = {
  id: string;
  name: string;
  persona: string;
  instructions: string;
  greeting: string;
  language: string;
  sttModel: string;
  ttsVoice: string;
  llmModel: string;
  maxDurationSec: number;
  handoffEnabled: boolean;
  handoffEmail: string;
  theme: WidgetTheme;
  /** The uploaded icon picture, if there is one. */
  imageUrl: string | null;
  modes: ConversationMode[];
  allowedDomains: string[];
  published: boolean;
};

function Options({ items, current }: { items: { value: string; label: string }[]; current: string }) {
  const list = items.some((i) => i.value === current) ? items : [{ value: current, label: current }, ...items];
  return list.map((i) => (
    <option key={i.value} value={i.value}>
      {i.label}
    </option>
  ));
}

function ModeCheck({ value, defaultChecked, label, icon: Icon }: { value: string; defaultChecked: boolean; label: string; icon: LucideIcon }) {
  return (
    <label className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-800 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600">
      <input type="checkbox" name="modes" value={value} defaultChecked={defaultChecked} className="size-3.5 accent-brand-600 focus:outline-none" />
      <Icon className="size-4 opacity-70" aria-hidden />
      {label}
    </label>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;
const IMAGE_MAX_KB = 300;

const ICON_CHOICES: { value: WidgetIcon; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "wave", label: "Sound wave" },
  { value: "chat", label: "Chat" },
  { value: "headset", label: "Headset" },
  { value: "sparkle", label: "Sparkle" },
  { value: "help", label: "Question" },
  { value: "phone", label: "Phone" },
  { value: "image", label: "Your picture" },
];

/** Same drawing the widget uses (our own static SVG, never user data). */
function Glyph({ shape, className }: { shape: WidgetIconShape; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      dangerouslySetInnerHTML={{ __html: WIDGET_ICON_SHAPES[shape] }}
    />
  );
}

/** The small round icon as the widget draws it: the business's colour with an icon, or its picture. */
function IconOrb({ icon, color, image, big }: { icon: WidgetIcon; color: string; image: string | null; big?: boolean }) {
  const box = big ? "size-10" : "size-7";
  if (icon === "image" && image) {
    return <img src={image} alt="" className={`${box} shrink-0 rounded-full bg-white object-cover ring-1 ring-slate-200`} />;
  }
  return (
    <span
      className={`grid ${box} shrink-0 place-items-center rounded-full text-white`}
      style={{ background: `radial-gradient(circle at 30% 30%, rgb(255 255 255 / 0.45), transparent 45%), ${color}` }}
    >
      {icon === "image" ? (
        <ImageUp className={big ? "size-4" : "size-3.5"} aria-hidden />
      ) : (
        <Glyph shape={icon === "auto" ? "wave" : icon} className={big ? "size-4" : "size-3.5"} />
      )}
    </span>
  );
}

function LauncherPreview({ dark, icon, color, image, label }: { dark: boolean; icon: WidgetIcon; color: string; image: string | null; label: string }) {
  return (
    <span
      className={
        "inline-flex max-w-full items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-semibold shadow-lift ring-1 " +
        (dark ? "bg-[#15171d] text-slate-100 ring-white/10" : "bg-white text-slate-900 ring-slate-200")
      }
    >
      <IconOrb icon={icon} color={color} image={image} />
      <span className="truncate">{label || "Talk to us"}</span>
    </span>
  );
}

export function AgentEditor({ agent, canManage }: { agent: EditableAgent; canManage: boolean }) {
  const [state, action] = useActionState(saveAgent, null);
  const [color, setColor] = useState(agent.theme.color);
  const [label, setLabel] = useState(agent.theme.label);
  const [iconChoice, setIconChoice] = useState<WidgetIcon>(agent.theme.icon ?? "auto");
  const [appearance, setAppearance] = useState<WidgetAppearance>(agent.theme.appearance ?? "light");
  const [picked, setPicked] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const validColor = HEX.test(color) ? color : "#4f46e5";
  const image = picked ?? agent.imageUrl;

  // Free the local preview of a picked file when it is replaced or the page closes.
  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked);
  }, [picked]);

  function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setImageError(null);
    setPicked(null);
    if (!file) return;
    let problem: string | null = null;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) problem = "Use a PNG, JPG or WebP picture.";
    else if (file.size > IMAGE_MAX_KB * 1024) {
      problem = `That picture is ${Math.ceil(file.size / 1024)} KB. Use one under ${IMAGE_MAX_KB} KB.`;
    }
    if (problem) {
      e.target.value = "";
      setImageError(problem);
      return;
    }
    setPicked(URL.createObjectURL(file));
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={agent.id} />

      <Card>
        <CardHeader title="Identity" icon={UserRound} description="Who the agent is and how it opens the conversation." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" hint="The name the agent uses for itself.">
            <Input id="name" name="name" defaultValue={agent.name} required maxLength={80} />
          </Field>
          <Field label="Language" htmlFor="language">
            <Select id="language" name="language" defaultValue={agent.language}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Greeting" htmlFor="greeting" hint="Said (or shown) first when a visitor starts.">
              <Input id="greeting" name="greeting" defaultValue={agent.greeting} required maxLength={500} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Persona" htmlFor="persona" hint="e.g. a warm, patient receptionist for a dental clinic.">
              <Textarea id="persona" name="persona" defaultValue={agent.persona} maxLength={1000} rows={2} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Behaviour" icon={ScrollText} description="Rules it always follows, and what happens when it can't help." />
        <div className="space-y-5 p-5">
          <Field
            label="Business rules"
            htmlFor="instructions"
            hint="Anything it must always follow: what it may promise, topics to avoid, when to take a message."
          >
            <Textarea id="instructions" name="instructions" defaultValue={agent.instructions} maxLength={8000} rows={6} />
          </Field>
          <Toggle
            name="handoffEnabled"
            defaultChecked={agent.handoffEnabled}
            label="Offer to take a message"
            hint="When it can't answer, it collects contact details and creates a handoff."
          />
          <Field
            label="Handoff email (optional)"
            htmlFor="handoffEmail"
            hint={canManage ? "Messages for your team are emailed here. Leave empty to email the workspace owners and admins." : "Only owners and admins can change this."}
          >
            <Input id="handoffEmail" name="handoffEmail" type="email" defaultValue={agent.handoffEmail} maxLength={320} disabled={!canManage} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Voice and models" icon={AudioLines} description="Speech, voice and language model settings." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Speech to text" htmlFor="sttModel" hint="Used by classic voices only.">
            <Select id="sttModel" name="sttModel" defaultValue={agent.sttModel}>
              <Options items={STT_MODELS} current={agent.sttModel} />
            </Select>
          </Field>
          <Field label="Voice" htmlFor="ttsVoice" hint="Realtime voices answer fastest and speak many languages. Classic voices speak English.">
            <Select id="ttsVoice" name="ttsVoice" defaultValue={agent.ttsVoice}>
              <Options items={TTS_VOICES} current={agent.ttsVoice} />
            </Select>
          </Field>
          <Field label="Language model" htmlFor="llmModel" hint="For text chats and classic voices. Realtime voices use their own model.">
            <Select id="llmModel" name="llmModel" defaultValue={agent.llmModel}>
              <Options items={LLM_MODELS} current={agent.llmModel} />
            </Select>
          </Field>
          <Field label="Max call length (minutes)" htmlFor="maxDurationMin" hint="Between 1 and 60.">
            <Input
              id="maxDurationMin"
              name="maxDurationMin"
              type="number"
              min={1}
              max={60}
              defaultValue={Math.round(agent.maxDurationSec / 60)}
              required
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Widget" icon={Palette} description="How the button and the chat look on your site." />
        <div className="grid gap-5 p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Theme"
              htmlFor="themeAppearance"
              hint={appearance === "auto" ? "Light or dark, following each visitor's phone or computer." : undefined}
            >
              <Select
                id="themeAppearance"
                name="themeAppearance"
                value={appearance}
                onChange={(e) => setAppearance(e.target.value as WidgetAppearance)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="auto">Match the visitor&apos;s device</option>
              </Select>
            </Field>
            <Field
              label="Theme colour"
              htmlFor="themeColorText"
              error={HEX.test(color) ? undefined : "Use a hex colour like #4f46e5."}
            >
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick theme colour"
                  value={validColor}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 shadow-xs hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                />
                <Input
                  id="themeColorText"
                  name="themeColor"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  maxLength={7}
                  required
                  className="font-mono"
                  aria-invalid={HEX.test(color) ? undefined : true}
                />
              </div>
            </Field>
            <Field label="Position" htmlFor="themePosition">
              <Select id="themePosition" name="themePosition" defaultValue={agent.theme.position}>
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
              </Select>
            </Field>
            <Field label="Button label" htmlFor="themeLabel">
              <Input id="themeLabel" name="themeLabel" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={40} />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium text-slate-800">Icon</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ICON_CHOICES.map((c) => (
                  <label
                    key={c.value}
                    className="flex h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-800 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600"
                  >
                    <input
                      type="radio"
                      name="themeIcon"
                      value={c.value}
                      checked={iconChoice === c.value}
                      onChange={() => setIconChoice(c.value)}
                      className="sr-only"
                    />
                    <IconOrb icon={c.value} color={validColor} image={c.value === "image" ? image : null} />
                    <span className="truncate">{c.label}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                Shown on the chat button and at the top of the chat. Automatic is a sound wave for voice agents and a
                chat bubble for text-only ones.
              </p>
              {iconChoice === "image" && (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <IconOrb icon="image" color={validColor} image={image} big />
                  <div className="min-w-0 flex-1 space-y-1">
                    <input
                      type="file"
                      name="themeImage"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={onPickImage}
                      aria-label="Upload icon picture"
                      className="block w-full text-sm text-slate-600 file:mr-3 file:h-8 file:cursor-pointer file:rounded-lg file:border file:border-solid file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-800 file:shadow-xs hover:file:border-slate-300 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    />
                    {imageError ? (
                      <p className="text-xs font-medium text-red-600">{imageError}</p>
                    ) : (
                      <p className="text-xs leading-5 text-slate-500">
                        {agent.imageUrl && !picked ? "Choose a file to replace the current picture. " : ""}
                        PNG, JPG or WebP under {IMAGE_MAX_KB} KB. A square logo works best: it is shown in a circle.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-800">Modes</legend>
              <div className="grid grid-cols-2 gap-2">
                <ModeCheck value="voice" defaultChecked={agent.modes.includes("voice")} label="Voice" icon={Mic} />
                <ModeCheck value="text" defaultChecked={agent.modes.includes("text")} label="Text chat" icon={MessageSquare} />
              </div>
            </fieldset>
          </div>

          <div
            aria-hidden
            className={
              "dot-grid relative flex min-h-28 flex-wrap items-end justify-end gap-3 rounded-xl border p-4 pt-10 " +
              (appearance === "dark" ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50")
            }
          >
            <span className="absolute left-3 top-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">
              {appearance === "auto" ? "Preview: light and dark devices" : "Preview"}
            </span>
            {appearance !== "dark" && (
              <LauncherPreview dark={false} icon={iconChoice} color={validColor} image={image} label={label} />
            )}
            {appearance !== "light" && <LauncherPreview dark icon={iconChoice} color={validColor} image={image} label={label} />}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Where it runs" icon={Globe} description="The domains it may load on, and whether it is live." />
        <div className="space-y-5 p-5">
          <Field
            label="Allowed domains"
            htmlFor="allowedDomains"
            hint={
              canManage
                ? "One per line. example.com matches only that host; *.example.com matches its subdomains (add both if you need both)."
                : "Only owners and admins can change this."
            }
          >
            <Textarea
              id="allowedDomains"
              name="allowedDomains"
              disabled={!canManage}
              defaultValue={agent.allowedDomains.join("\n")}
              rows={3}
              placeholder={"example.com\n*.example.com"}
              className="font-mono text-xs"
            />
          </Field>
          <Toggle
            name="published"
            defaultChecked={agent.published}
            label="Published"
            disabled={!canManage}
            hint={
              canManage
                ? "Drafts only load inside this dashboard. Publish to go live on your allowed domains."
                : "Drafts only load inside this dashboard. Only owners and admins can change this."
            }
          />
        </div>
      </Card>

      {/* Save on the left: the test widget's launcher sits in the bottom-right corner. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-md sm:bottom-4 sm:mx-0 sm:rounded-2xl sm:border sm:px-5 sm:shadow-lift">
        <SubmitButton className="shrink-0">
          <Save aria-hidden />
          Save changes
        </SubmitButton>
        <div className="min-w-0">
          <ActionMessage state={state} />
        </div>
      </div>
    </form>
  );
}
