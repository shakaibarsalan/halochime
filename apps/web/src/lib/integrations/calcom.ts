import type { RunActionResponse } from "@talkfront/shared";
import { normalizeEmail } from "./crm";
import { obj, requestJson, s, VendorError, type FetchLike } from "./http";
import { isTimeZone } from "./types";

// Cal.com API v2 with the business's API key and one event type: open times and booking.
// Also the plain "booking link" tool. Pure apart from the fetch, so it is checked with mock fetches.

const BASE = "https://api.cal.com/v2";
const SLOTS_VERSION = "2024-09-04";
const BOOKINGS_VERSION = "2024-08-13";
const EVENT_TYPES_VERSION = "2024-06-14";
export const MAX_RANGE_DAYS = 14;
const MAX_SLOTS = 30;

export type CalcomSettings = { apiKey: string; eventTypeId: number; timeZone: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseDay(v: unknown): number | null {
  if (typeof v !== "string" || !DATE_RE.test(v.trim())) return null;
  const t = Date.parse(`${v.trim()}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v.trim() ? t : null;
}

const ok = (result: string): RunActionResponse => ({ ok: true, status: 200, result });
const fail = (result: string, status: number | null = null): RunActionResponse => ({ ok: false, status, result });

function pickTimeZone(arg: unknown, fallback: string): string | { error: string } {
  const tz = typeof arg === "string" ? arg.trim() : "";
  if (!tz) return fallback;
  return isTimeZone(tz) ? tz : { error: `${tz.slice(0, 60)} is not a time zone name. Use one like Europe/London, or leave it out.` };
}

/** "Tuesday 10 November 2026, 09:00" in the given time zone. */
export function spokenTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Slots from either v2 answer shape: { "2026-11-10": [{ start }] } or { slots: { date: [{ time }] } }. */
export function readSlots(body: unknown): Record<string, string[]> {
  const data = obj(obj(body).data);
  const days = obj(data.slots && typeof data.slots === "object" ? data.slots : data);
  const out: Record<string, string[]> = {};
  for (const [day, list] of Object.entries(days)) {
    if (!DATE_RE.test(day) || !Array.isArray(list)) continue;
    const starts = list.map((x) => s(obj(x).start) ?? s(obj(x).time) ?? s(x)).filter((x): x is string => !!x && Number.isFinite(Date.parse(x)));
    if (starts.length) out[day] = starts;
  }
  return out;
}

export function calcomClient(settings: CalcomSettings, fetchImpl: FetchLike = fetch, now: () => number = Date.now) {
  const auth = { authorization: `Bearer ${settings.apiKey}` };

  async function findSlots(args: Record<string, unknown>): Promise<RunActionResponse> {
    const start = parseDay(args.start_date);
    if (start === null) return fail("start_date must be a date like 2026-11-10.");
    const end = args.end_date === undefined || args.end_date === null || args.end_date === "" ? start : parseDay(args.end_date);
    if (end === null) return fail("end_date must be a date like 2026-11-12, or left out.");
    if (end < start) return fail("end_date is before start_date.");
    if ((end - start) / DAY_MS + 1 > MAX_RANGE_DAYS) return fail(`Check at most ${MAX_RANGE_DAYS} days at a time.`);
    const today = Math.floor(now() / DAY_MS) * DAY_MS;
    if (end < today - DAY_MS) return fail("Those dates are in the past. Ask the visitor which upcoming day suits them.");
    const tz = pickTimeZone(args.time_zone, settings.timeZone);
    if (typeof tz !== "string") return fail(tz.error);

    const params = new URLSearchParams({
      eventTypeId: String(settings.eventTypeId),
      start: new Date(Math.max(start, today - DAY_MS)).toISOString().slice(0, 10),
      end: new Date(end).toISOString().slice(0, 10),
      timeZone: tz,
    });
    try {
      const res = await requestJson(fetchImpl, `${BASE}/slots?${params}`, { headers: { ...auth, "cal-api-version": SLOTS_VERSION }, vendor: "Cal.com" });
      const days = readSlots(res.body);
      const future: Record<string, string[]> = {};
      let count = 0;
      let cut = false;
      for (const day of Object.keys(days).sort()) {
        for (const t of days[day]!) {
          if (Date.parse(t) <= now()) continue;
          if (count >= MAX_SLOTS) {
            cut = true;
            break;
          }
          (future[day] ??= []).push(t);
          count += 1;
        }
      }
      if (!count) return ok(`No open times between ${params.get("start")} and ${params.get("end")}. Offer to check other days.`);
      return ok(
        JSON.stringify({
          time_zone: tz,
          open_times: future,
          note: `Times are in ${tz}. To book, pass the exact start value to book_meeting.${cut ? ` Only the first ${MAX_SLOTS} times are listed.` : ""}`,
        }),
      );
    } catch (err) {
      return fail(err instanceof VendorError ? err.message : "Cal.com could not be reached.", err instanceof VendorError ? err.status : null);
    }
  }

  async function book(args: Record<string, unknown>): Promise<RunActionResponse> {
    const startRaw = typeof args.start === "string" ? args.start.trim() : "";
    const startMs = Date.parse(startRaw);
    if (!startRaw || !Number.isFinite(startMs)) return fail("start must be the exact start value of an open time from check_open_times.");
    if (startMs <= now()) return fail("That time has already passed. Check the open times again.");
    const name = typeof args.name === "string" ? args.name.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    if (!name) return fail("Ask the visitor for their name first.");
    const email = normalizeEmail(args.email);
    if (!email) return fail("Ask the visitor for a valid email address first; the confirmation goes there.");
    const tz = pickTimeZone(args.time_zone, settings.timeZone);
    if (typeof tz !== "string") return fail(tz.error);
    const notes = typeof args.notes === "string" ? args.notes.trim().slice(0, 1000) : "";

    try {
      const res = await requestJson(fetchImpl, `${BASE}/bookings`, {
        method: "POST",
        headers: { ...auth, "cal-api-version": BOOKINGS_VERSION },
        body: {
          start: new Date(startMs).toISOString(),
          eventTypeId: settings.eventTypeId,
          attendee: { name, email, timeZone: tz },
          ...(notes ? { bookingFieldsResponses: { notes } } : {}),
          metadata: { source: "halochime" },
        },
        vendor: "Cal.com",
      });
      const data = obj(obj(res.body).data);
      const startIso = s(data.start) ?? new Date(startMs).toISOString();
      const ref = s(data.uid);
      return ok(`Booked for ${spokenTime(startIso, tz)} (${tz}). Cal.com sends the confirmation to ${email}.${ref ? ` Booking reference: ${ref}.` : ""}`);
    } catch (err) {
      return fail(err instanceof VendorError ? `The booking did not go through. ${err.message}` : "Cal.com could not be reached, so nothing was booked.", err instanceof VendorError ? err.status : null);
    }
  }

  /** Checks the key and that the event type exists. Throws VendorError. */
  async function test(): Promise<string> {
    const res = await requestJson(fetchImpl, `${BASE}/event-types/${settings.eventTypeId}`, {
      headers: { ...auth, "cal-api-version": EVENT_TYPES_VERSION },
      allow: [404],
      vendor: "Cal.com",
    });
    if (res.status === 404) throw new VendorError(`Cal.com has no event type ${settings.eventTypeId} for this API key.`, 404);
    const title = s(obj(obj(res.body).data).title);
    return title ? `Event type: ${title}.` : "Connected.";
  }

  return { findSlots, book, test };
}

/** get_booking_link: just the owner's link. */
export function bookingLinkResult(url: string, mode: "voice" | "text"): RunActionResponse {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // keep the raw value
  }
  return ok(
    mode === "voice"
      ? `The booking page is ${url}. Don't read the address out: say the visitor can pick a time on the booking page at ${host}.`
      : `Booking link: ${url}. Share it with the visitor so they can pick a time.`,
  );
}
