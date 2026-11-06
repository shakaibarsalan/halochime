"use client";

import { ImageUp, RotateCcw, Save } from "lucide-react";
import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { useFormStatus } from "react-dom";
import { ActionMessage, SubmitButton } from "@/components/form-bits";
import { Button, Field, Input, cx } from "@/components/ui";
import { resetBranding, saveBranding } from "./branding-actions";

type Mode = "halochime" | "hidden" | "custom";

export type BrandingValues = {
  poweredBy: Mode;
  poweredByLabel: string;
  poweredByUrl: string;
  brandName: string;
  logoUrl: string | null;
  saved: boolean;
};

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "halochime", label: "by Halochime", hint: "The usual small line under the chat." },
  { value: "hidden", label: "Hide it", hint: "No line under the chat." },
  { value: "custom", label: "Your agency", hint: "Your own name and link instead." },
];

const LOGO_MAX_KB = 100;

function ResetSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending} aria-busy={pending}>
      <RotateCcw aria-hidden />
      {pending ? "Resetting..." : "Back to Halochime"}
    </Button>
  );
}

export function BrandingForm({ values }: { values: BrandingValues }) {
  const [state, action] = useActionState(saveBranding, null);
  const [resetState, reset] = useActionState(resetBranding, null);
  const [mode, setMode] = useState<Mode>(values.poweredBy);
  const [label, setLabel] = useState(values.poweredByLabel);
  const [picked, setPicked] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logo = picked ?? (removeLogo ? null : values.logoUrl);

  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked);
  }, [picked]);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setLogoError(null);
    setPicked(null);
    if (!file) return;
    let problem: string | null = null;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) problem = "Use a PNG, JPG or WebP logo.";
    else if (file.size > LOGO_MAX_KB * 1024) problem = `That logo is ${Math.ceil(file.size / 1024)} KB. Use one under ${LOGO_MAX_KB} KB.`;
    if (problem) {
      e.target.value = "";
      setLogoError(problem);
      return;
    }
    setRemoveLogo(false);
    setPicked(URL.createObjectURL(file));
  }

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-5">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-800">Under the chat in the widget</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <label
                key={m.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-xs transition-colors hover:border-slate-300 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600"
              >
                <input
                  type="radio"
                  name="poweredBy"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                  className="mt-0.5 size-3.5 accent-brand-600 focus:outline-none"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">{m.label}</span>
                  <span className="block text-xs leading-5 text-slate-500">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "custom" ? (
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <Field label="Name to show" htmlFor="pb-label" hint={`Shown as "by ${label.trim() || "Your agency"}".`}>
              <Input id="pb-label" name="poweredByLabel" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={40} autoComplete="off" />
            </Field>
            <Field label="Link" htmlFor="pb-url" hint="Where the name links to, e.g. your agency's website.">
              <Input id="pb-url" name="poweredByUrl" type="url" defaultValue={values.poweredByUrl} required maxLength={500} placeholder="https://youragency.com" />
            </Field>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Brand in this dashboard (optional)"
            htmlFor="brand-name"
            hint="Everyone in this workspace sees this name and logo at the top of the menu instead of Halochime."
          >
            <Input id="brand-name" name="brandName" defaultValue={values.brandName} maxLength={60} autoComplete="off" placeholder="Your agency" />
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-800">Logo (optional)</p>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              {logo ? (
                <img src={logo} alt="" className="size-10 shrink-0 rounded-lg bg-white object-contain ring-1 ring-slate-200" />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200" aria-hidden>
                  <ImageUp className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <input
                  type="file"
                  name="logo"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={onPick}
                  aria-label="Upload logo"
                  className="block w-full text-sm text-slate-600 file:mr-3 file:h-8 file:cursor-pointer file:rounded-lg file:border file:border-solid file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-800 file:shadow-xs hover:file:border-slate-300 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                />
                {logoError ? (
                  <p className="text-xs font-medium text-red-600">{logoError}</p>
                ) : (
                  <p className="text-xs leading-5 text-slate-500">PNG, JPG or WebP under {LOGO_MAX_KB} KB. Square works best.</p>
                )}
                {values.logoUrl && !picked ? (
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      name="removeLogo"
                      checked={removeLogo}
                      onChange={(e) => setRemoveLogo(e.target.checked)}
                      className="size-3.5 accent-brand-600"
                    />
                    Remove the logo
                  </label>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>
            <Save aria-hidden />
            Save white label
          </SubmitButton>
          <div className={cx("min-w-0", !state && "hidden")}>
            <ActionMessage state={state} />
          </div>
        </div>
      </form>

      {values.saved ? (
        <form
          action={reset}
          onSubmit={(e) => {
            if (!window.confirm("Remove the white label settings and show Halochime again?")) e.preventDefault();
          }}
          className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4"
        >
          <ResetSubmit />
          <div className="min-w-0">
            <ActionMessage state={resetState} />
          </div>
        </form>
      ) : null}
    </div>
  );
}
