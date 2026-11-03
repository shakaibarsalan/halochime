import type { ActionParameter } from "@talkfront/shared";

// Pure helpers for actions (no server imports), shared by the dashboard form, the server actions,
// the runtime route and the internal action route. Spec: docs/integrations.md section 4.

export const ACTION_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
/** Tool names the voice agent already uses. An action with one of these names would clash. */
export const RESERVED_ACTION_NAMES = ["search_knowledge", "request_human", "confirm_message"] as const;
export const MAX_ACTIONS_PER_AGENT = 20;
export const MAX_PARAMETERS = 20;
export const MAX_HEADERS = 20;
export const DEFAULT_TIMEOUT_MS = 8000;
export const MAX_TIMEOUT_MS = 15_000;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_STRING_ARG = 1000;

export const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
export const MAX_HEADER_VALUE = 4000;

/** Headers we set ourselves or that would break the request. Compared lowercase. */
export function isReservedHeader(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.startsWith("x-halochime-") ||
    ["host", "content-length", "content-type", "transfer-encoding", "connection", "accept-encoding", "te", "upgrade", "expect"].includes(n)
  );
}

export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required: string[];
  additionalProperties: false;
};

/** ActionParameter[] -> the JSON Schema the model sees for the tool's arguments. */
export function parametersToJsonSchema(params: ActionParameter[]): JsonSchemaObject {
  const properties: JsonSchemaObject["properties"] = {};
  const required: string[] = [];
  for (const p of params) {
    const prop: JsonSchemaObject["properties"][string] = { type: p.type };
    if (p.description.trim()) prop.description = p.description.trim();
    if (p.type === "string" && p.enum?.length) prop.enum = [...p.enum];
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export type ArgValue = string | number | boolean;
export type ArgsCheck = { ok: true; args: Record<string, ArgValue> } | { ok: false; reason: string };

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Checks the model's arguments against the action's parameters. Unknown keys are dropped (the business
 * only ever receives the inputs it defined); light coercion fixes common model slips ("3" for 3, "true").
 * Reasons are plain sentences the model can act on.
 */
export function validateArguments(params: ActionParameter[], raw: Record<string, unknown>): ArgsCheck {
  const args: Record<string, ArgValue> = {};
  for (const p of params) {
    const value = raw[p.name];
    if (isBlank(value)) {
      if (p.required) return { ok: false, reason: `Missing ${p.name}. Ask the visitor for it, then try again.` };
      continue;
    }
    switch (p.type) {
      case "string": {
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
          return { ok: false, reason: `${p.name} must be text.` };
        }
        const text = String(value).trim();
        if (text.length > MAX_STRING_ARG) return { ok: false, reason: `${p.name} is too long (at most ${MAX_STRING_ARG} characters).` };
        if (p.enum?.length) {
          const match = p.enum.find((e) => e === text) ?? p.enum.find((e) => e.toLowerCase() === text.toLowerCase());
          if (!match) return { ok: false, reason: `${p.name} must be one of: ${p.enum.join(", ")}.` };
          args[p.name] = match;
        } else {
          args[p.name] = text;
        }
        break;
      }
      case "number":
      case "integer": {
        const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
        if (!Number.isFinite(n)) return { ok: false, reason: `${p.name} must be a number.` };
        if (p.type === "integer" && !Number.isInteger(n)) return { ok: false, reason: `${p.name} must be a whole number.` };
        args[p.name] = n;
        break;
      }
      case "boolean": {
        if (typeof value === "boolean") args[p.name] = value;
        else if (value === "true" || value === "false") args[p.name] = value === "true";
        else return { ok: false, reason: `${p.name} must be true or false.` };
        break;
      }
    }
  }
  return { ok: true, args };
}

/** Plain-language label for a parameter type in the dashboard. */
export const PARAMETER_TYPE_LABELS: Record<ActionParameter["type"], string> = {
  string: "Text",
  number: "Number",
  integer: "Whole number",
  boolean: "Yes / no",
};
