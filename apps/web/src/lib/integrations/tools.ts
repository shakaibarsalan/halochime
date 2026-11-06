import type { ActionParameter } from "@talkfront/shared";
import { ACTION_NAME_RE, parametersToJsonSchema, RESERVED_ACTION_NAMES, type JsonSchemaObject } from "@/lib/actions/schema";
import { isCrmKind, KIND_LABELS, type CrmKind, type DbQueryParameter, type IntegrationKind } from "./types";

// Integration tools in the runtime `actions` list (pure: no server imports). The voice agent turns
// every entry into a tool and runs it through POST /api/internal/conversations/:id/actions/:actionId;
// the "int:" id prefix tells that route to run an integration instead of a business HTTP action.

export const TOOL_ID_PREFIX = "int:";

export type CrmOp = "find_contact" | "save_lead" | "add_note";
export type ToolRef =
  | { kind: CrmKind; op: CrmOp }
  | { kind: "calcom"; op: "find_slots" | "book" }
  | { kind: "booking_link"; op: "get" }
  | { kind: "database"; queryId: string };

const CRM_OPS: readonly CrmOp[] = ["find_contact", "save_lead", "add_note"];

export const isIntegrationToolId = (id: string) => id.startsWith(TOOL_ID_PREFIX);

export function toolId(ref: ToolRef): string {
  return "queryId" in ref ? `${TOOL_ID_PREFIX}database:${ref.queryId}` : `${TOOL_ID_PREFIX}${ref.kind}:${ref.op}`;
}

/** "int:hubspot:find_contact" -> { kind, op }. null for anything that is not a known integration tool. */
export function parseToolId(id: string): ToolRef | null {
  if (!isIntegrationToolId(id) || id.length > 200) return null;
  const [kind, rest, ...extra] = id.slice(TOOL_ID_PREFIX.length).split(":");
  if (!kind || !rest || extra.length) return null;
  if (isCrmKind(kind)) return (CRM_OPS as readonly string[]).includes(rest) ? { kind, op: rest as CrmOp } : null;
  if (kind === "calcom") return rest === "find_slots" || rest === "book" ? { kind, op: rest } : null;
  if (kind === "booking_link") return rest === "get" ? { kind, op: "get" } : null;
  if (kind === "database") return /^[A-Za-z0-9-]{1,64}$/.test(rest) ? { kind, queryId: rest } : null;
  return null;
}

export type RuntimeTool = { id: string; name: string; description: string; parameters: JsonSchemaObject };

const str = (description: string) => ({ type: "string", description });

function schema(properties: JsonSchemaObject["properties"], required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, required, additionalProperties: false };
}

const CONTACT_ARGS = {
  email: str("The person's email address. Leave out to use the signed-in visitor's email."),
  phone: str("The person's phone number, with country code if known."),
};

/** The three CRM tools of one connected CRM. */
export function crmTools(kind: CrmKind): RuntimeTool[] {
  const label = KIND_LABELS[kind];
  const prefix = kind;
  return [
    {
      id: toolId({ kind, op: "find_contact" }),
      name: `${prefix}_find_contact`,
      description:
        `Check whether the visitor is already a contact in the business's CRM (${label}), by email or phone. ` +
        "Only look up the visitor's own details, never someone else's. Leave both empty to use the signed-in visitor's email.",
      parameters: schema(CONTACT_ARGS),
    },
    {
      id: toolId({ kind, op: "save_lead" }),
      name: `${prefix}_save_lead`,
      description:
        `Save the visitor as a lead in the business's CRM (${label}) when they want the business to follow up, ask for a quote or show buying interest. ` +
        "Ask the visitor first and only use details they gave you. Needs an email or a phone number. An existing contact only gets its empty fields filled in.",
      parameters: schema({
        ...CONTACT_ARGS,
        first_name: str("First name, as the visitor said it."),
        last_name: str("Last name, if given."),
        company: str("Company name, if given."),
      }),
    },
    {
      id: toolId({ kind, op: "add_note" }),
      name: `${prefix}_add_note`,
      description:
        `Add a short note to the visitor's contact in the CRM (${label}), e.g. what they are interested in. ` +
        "The contact must exist: save the lead first if needed.",
      parameters: schema({ note: str("The note, in a few plain sentences."), ...CONTACT_ARGS }, ["note"]),
    },
  ];
}

export function calcomTools(): RuntimeTool[] {
  return [
    {
      id: toolId({ kind: "calcom", op: "find_slots" }),
      name: "check_open_times",
      description:
        "Find open times to book a meeting with the business, for a date or a date range (at most 14 days). Use the visitor's time zone if they said it.",
      parameters: schema(
        {
          start_date: str("First day to check, as YYYY-MM-DD."),
          end_date: str("Last day to check, as YYYY-MM-DD. Leave out to check one day."),
          time_zone: str("The visitor's time zone, e.g. Europe/London. Leave out to use the business's time zone."),
        },
        ["start_date"],
      ),
    },
    {
      id: toolId({ kind: "calcom", op: "book" }),
      name: "book_meeting",
      description:
        "Book a meeting at one of the open times from check_open_times. Before calling, read back the day, time and time zone, the visitor's name and email, and wait for a clear yes. Never book without that confirmation.",
      parameters: schema(
        {
          start: str("The exact start value of the chosen open time from check_open_times."),
          name: str("The visitor's full name."),
          email: str("The visitor's email; the booking confirmation goes there."),
          time_zone: str("The visitor's time zone, e.g. Europe/London."),
          notes: str("Anything the visitor wants the business to know before the meeting."),
        },
        ["start", "name", "email"],
      ),
    },
  ];
}

export function bookingLinkTool(label: string): RuntimeTool {
  const what = label.trim() ? ` (${label.trim().slice(0, 80)})` : "";
  return {
    id: toolId({ kind: "booking_link", op: "get" }),
    name: "get_booking_link",
    description: `Get the link where the visitor can book a meeting or appointment with the business${what}. Use it when they want to book or schedule a call.`,
    parameters: schema({}),
  };
}

export type QueryForTool = { id: string; name: string; description: string; parameters: DbQueryParameter[] };

/** A database query as a tool. Verified-user-id inputs are never shown to the AI. */
export function queryTool(q: QueryForTool): RuntimeTool {
  const visible: ActionParameter[] = q.parameters
    .filter((p) => !p.verifiedUserId)
    .map((p) => ({ name: p.name, type: p.type, description: p.description, required: p.required }));
  const needsSignIn = q.parameters.some((p) => p.verifiedUserId);
  return {
    id: toolId({ kind: "database", queryId: q.id }),
    name: q.name,
    description: `${q.description.trim()}${needsSignIn ? " Only works for a signed-in visitor: it reads their own records." : ""}`,
    parameters: parametersToJsonSchema(visible),
  };
}

export type IntegrationForTools = {
  kind: IntegrationKind;
  config: Record<string, unknown>;
  queries?: (QueryForTool & { enabled: boolean })[];
};

/**
 * Every tool the connected integrations give one agent. `taken` holds names already in use (the
 * business's own actions); a tool whose name is taken, reserved or invalid is left out, so the
 * business's actions always win.
 */
export function buildIntegrationTools(list: IntegrationForTools[], taken: Iterable<string>): RuntimeTool[] {
  const used = new Set<string>([...RESERVED_ACTION_NAMES, ...taken]);
  const out: RuntimeTool[] = [];
  const order: IntegrationKind[] = ["hubspot", "gohighlevel", "zoho", "calcom", "booking_link", "database"];
  for (const kind of order) {
    for (const integration of list.filter((i) => i.kind === kind)) {
      let tools: RuntimeTool[] = [];
      if (isCrmKind(kind)) tools = crmTools(kind);
      else if (kind === "calcom") tools = calcomTools();
      else if (kind === "booking_link") tools = [bookingLinkTool(String(integration.config.label ?? ""))];
      else tools = (integration.queries ?? []).filter((q) => q.enabled).map(queryTool);
      for (const t of tools) {
        if (!ACTION_NAME_RE.test(t.name) || used.has(t.name)) continue;
        used.add(t.name);
        out.push(t);
      }
    }
  }
  return out;
}
