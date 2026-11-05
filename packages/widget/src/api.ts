import {
  WIDGET_APPEARANCES,
  WIDGET_ICONS,
  type ConversationMode,
  type WidgetConfigResponse,
  type WidgetSessionRequest,
  type WidgetSessionResponse,
} from "@talkfront/shared";

/** Every failure the widget can show the visitor. */
export type ErrorKind =
  | "mic_denied"
  | "mic_missing"
  | "out_of_credit"
  | "not_configured"
  | "origin_not_allowed"
  | "not_found"
  | "rate_limited"
  | "network"
  | "agent_unavailable"
  | "unknown";

export class WidgetError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | undefined;

  constructor(kind: ErrorKind, message?: string, status?: number) {
    super(message || kind);
    this.name = "WidgetError";
    this.kind = kind;
    this.status = status;
  }
}

export function toWidgetError(err: unknown): WidgetError {
  if (err instanceof WidgetError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new WidgetError("unknown", message);
}

/** Maps `{ error: { code, message } }` + HTTP status to an error kind (code wins, status is the fallback). */
function errorFromResponse(status: number, body: unknown): WidgetError {
  const apiError =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  const code = typeof apiError?.code === "string" ? apiError.code : "";
  const message = typeof apiError?.message === "string" ? apiError.message : `HTTP ${status}`;

  const byCode: Record<string, ErrorKind> = {
    out_of_credit: "out_of_credit",
    not_configured: "not_configured",
    origin_not_allowed: "origin_not_allowed",
    forbidden: "origin_not_allowed",
    not_found: "not_found",
    rate_limited: "rate_limited",
  };
  let kind = byCode[code];
  if (!kind) {
    if (status === 402) kind = "out_of_credit";
    else if (status === 403) kind = "origin_not_allowed";
    else if (status === 404) kind = "not_found";
    else if (status === 429) kind = "rate_limited";
    else if (status === 503) kind = "not_configured";
    else kind = "unknown";
  }
  return new WidgetError(kind, message, status);
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    // "same-origin": only on Halochime's own pages (the dashboard's test widget) is the sign-in cookie
    // sent, which draft agents need; embeds on a business's site never send any cookie.
    res = await fetch(url, { ...init, mode: "cors", credentials: "same-origin", cache: "no-store" });
  } catch (err) {
    throw new WidgetError("network", err instanceof Error ? err.message : "fetch failed");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (proxy error page, empty body). Status decides below.
  }
  if (!res.ok) throw errorFromResponse(res.status, body);
  if (body === null || typeof body !== "object") {
    throw new WidgetError("unknown", "Unexpected response", res.status);
  }
  return body as T;
}

const DEFAULT_COLOR = "#2563eb";

/** Light runtime check of the config shape (no zod in the bundle). Fills safe defaults. */
function normalizeConfig(raw: Partial<WidgetConfigResponse>): WidgetConfigResponse {
  const modes = Array.isArray(raw.modes)
    ? raw.modes.filter((m): m is ConversationMode => m === "voice" || m === "text")
    : [];
  const theme: Partial<WidgetConfigResponse["theme"]> = raw.theme ?? {};
  const color =
    typeof theme.color === "string" && typeof CSS !== "undefined" && CSS.supports("color", theme.color)
      ? theme.color
      : DEFAULT_COLOR;
  return {
    agentId: String(raw.agentId ?? ""),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Support",
    greeting: typeof raw.greeting === "string" ? raw.greeting : "",
    modes: modes.length ? modes : ["text"],
    theme: {
      color,
      position: theme.position === "bottom-left" ? "bottom-left" : "bottom-right",
      label: typeof theme.label === "string" && theme.label.trim() ? theme.label.trim() : "Talk to us",
      icon: (WIDGET_ICONS as readonly string[]).includes(theme.icon as string) ? theme.icon : "auto",
      appearance: (WIDGET_APPEARANCES as readonly string[]).includes(theme.appearance as string)
        ? theme.appearance
        : "light",
    },
    ...(typeof raw.livekitUrl === "string" && /^wss?:\/\//.test(raw.livekitUrl) ? { livekitUrl: raw.livekitUrl } : {}),
    ...(typeof raw.greetingAudioUrl === "string" && /^https?:\/\//.test(raw.greetingAudioUrl)
      ? { greetingAudioUrl: raw.greetingAudioUrl }
      : {}),
    ...(typeof raw.iconUrl === "string" && /^https?:\/\//.test(raw.iconUrl) ? { iconUrl: raw.iconUrl } : {}),
    ...(raw.poweredBy && typeof raw.poweredBy.label === "string" && typeof raw.poweredBy.url === "string" &&
    /^https?:\/\//.test(raw.poweredBy.url)
      ? { poweredBy: { label: raw.poweredBy.label, url: raw.poweredBy.url } }
      : {}),
  };
}

export async function fetchConfig(api: string, key: string): Promise<WidgetConfigResponse> {
  const raw = await request<Partial<WidgetConfigResponse>>(
    `${api}/api/widget/config?key=${encodeURIComponent(key)}`,
    { method: "GET" },
  );
  return normalizeConfig(raw);
}

export async function createSession(
  api: string,
  body: WidgetSessionRequest,
): Promise<WidgetSessionResponse> {
  const res = await request<Partial<WidgetSessionResponse>>(`${api}/api/widget/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (typeof res.livekitUrl !== "string" || typeof res.token !== "string") {
    throw new WidgetError("unknown", "Session response is missing livekitUrl or token");
  }
  return {
    conversationId: String(res.conversationId ?? ""),
    livekitUrl: res.livekitUrl,
    token: res.token,
    roomName: String(res.roomName ?? ""),
  };
}
