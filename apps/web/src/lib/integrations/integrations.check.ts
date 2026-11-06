// Checks for the integration logic that needs no database or real accounts.
// Run from apps/web: npx tsx src/lib/integrations/integrations.check.ts
import assert from "node:assert/strict";
import { bookingLinkResult, calcomClient, readSlots } from "./calcom";
import { contactQueryFrom, logSummary, missingFields, normalizePhone, runAddNote, runFindContact, runSaveLead, type VisitorContext } from "./crm";
import { blockedHostReason, parseConnectionString } from "./db-url";
import { goHighLevelClient } from "./gohighlevel";
import type { FetchLike } from "./http";
import { hubspotClient } from "./hubspot";
import { bindQueryArgs, checkReadOnlySql, compileSql, formatRows, MAX_ROWS } from "./sql";
import { buildIntegrationTools, isIntegrationToolId, parseToolId, queryTool, toolId } from "./tools";
import { ConfigSchemas, isTimeZone, lastFour, type DbQueryParameter } from "./types";
import { clearZohoTokenCache, zohoClient } from "./zoho";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
/** A fetch that answers from a list of [matcher, status, body] and records every call. */
function mockFetch(routes: [RegExp, number, unknown][]): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const raw = typeof init?.body === "string" ? init.body : undefined;
    let body: unknown = raw;
    if (raw && headers["content-type"] === "application/json") body = JSON.parse(raw);
    const method = init?.method ?? "GET";
    calls.push({ url, method, headers, body });
    const hit = routes.find(([re]) => re.test(`${method} ${url}`));
    if (!hit) throw new Error(`unexpected call ${method} ${url}`);
    const [, status, resBody] = hit;
    return new Response(status === 204 || resBody === undefined ? null : JSON.stringify(resBody), { status });
  }) as FetchLike & { calls: Call[] };
  f.calls = calls;
  return f;
}

const anon: VisitorContext = { verified: false, email: null, name: null };
const signedIn: VisitorContext = { verified: true, email: "Ana@Example.com", name: "Ana Lopez" };

// ---------------------------------------------------------------------------- tool ids and definitions

await check("tool ids round trip and dispatch on the prefix", () => {
  for (const ref of [
    { kind: "hubspot", op: "find_contact" },
    { kind: "gohighlevel", op: "save_lead" },
    { kind: "zoho", op: "add_note" },
    { kind: "calcom", op: "find_slots" },
    { kind: "calcom", op: "book" },
    { kind: "booking_link", op: "get" },
    { kind: "database", queryId: "5d1c7e9a-0b3f-4e2d-8a6c-1f9e3b7d5a20" },
  ] as const) {
    assert.deepEqual(parseToolId(toolId(ref)), ref);
    assert.ok(isIntegrationToolId(toolId(ref)));
  }
  assert.equal(toolId({ kind: "hubspot", op: "find_contact" }), "int:hubspot:find_contact");
  // Business action ids are UUIDs: never routed to integrations.
  assert.equal(isIntegrationToolId("5d1c7e9a-0b3f-4e2d-8a6c-1f9e3b7d5a20"), false);
  for (const bad of ["int:", "int:hubspot", "int:hubspot:drop", "int:salesforce:find_contact", "int:database:a:b", "int:database:../x", "int:calcom:get", "hubspot:find_contact"]) {
    assert.equal(parseToolId(bad), null, bad);
  }
});

const query = (over: Partial<{ id: string; name: string; description: string; parameters: DbQueryParameter[]; enabled: boolean }> = {}) => ({
  id: "q1",
  name: "order_status",
  description: "Look up the visitor's latest orders.",
  parameters: [
    { name: "user_id", type: "string", description: "", required: true, verifiedUserId: true },
    { name: "status", type: "string", description: "Order status", required: false },
  ] as DbQueryParameter[],
  enabled: true,
  ...over,
});

await check("tool definitions: names, clashes, hidden verified inputs", () => {
  const tools = buildIntegrationTools(
    [
      { kind: "database", config: {}, queries: [query(), query({ id: "q2", name: "off_query", enabled: false }), query({ id: "q3", name: "check_open_times" })] },
      { kind: "calcom", config: {} },
      { kind: "hubspot", config: {} },
      { kind: "booking_link", config: { label: "Free demo" } },
    ],
    ["hubspot_add_note"],
  );
  const names = tools.map((t) => t.name);
  assert.deepEqual(names, ["hubspot_find_contact", "hubspot_save_lead", "check_open_times", "book_meeting", "get_booking_link", "order_status"]);
  // A disabled query, a name the business already uses and a clash with another integration are left out.
  assert.ok(!names.includes("off_query") && !names.includes("hubspot_add_note"));
  const order = tools.find((t) => t.name === "order_status")!;
  assert.equal(order.id, "int:database:q1");
  assert.deepEqual(Object.keys(order.parameters.properties), ["status"]);
  assert.deepEqual(order.parameters.required, []);
  assert.match(order.description, /signed-in visitor/);
  assert.match(tools.find((t) => t.name === "book_meeting")!.description, /wait for a clear yes/);
  assert.match(tools.find((t) => t.name === "get_booking_link")!.description, /Free demo/);
  assert.deepEqual(tools.find((t) => t.name === "book_meeting")!.parameters.required, ["start", "name", "email"]);
  for (const t of tools) assert.match(t.name, /^[a-z][a-z0-9_]{0,39}$/);
  assert.equal(queryTool(query({ parameters: [] })).description, "Look up the visitor's latest orders.");
});

await check("settings validation", () => {
  assert.ok(isTimeZone("Europe/London") && !isTimeZone("Mars/Base") && !isTimeZone(""));
  assert.equal(ConfigSchemas.calcom.safeParse({ eventTypeId: 12, timeZone: "Asia/Karachi" }).success, true);
  assert.equal(ConfigSchemas.calcom.safeParse({ eventTypeId: 12, timeZone: "Nowhere" }).success, false);
  assert.equal(ConfigSchemas.booking_link.safeParse({ url: "http://cal.example.com/x" }).success, false);
  assert.equal(ConfigSchemas.booking_link.safeParse({ url: "https://calendly.com/acme/demo" }).success, true);
  assert.equal(ConfigSchemas.zoho.safeParse({ dataCentre: "eu" }).success, true);
  assert.equal(ConfigSchemas.zoho.safeParse({ dataCentre: "evil.com" }).success, false);
  assert.equal(lastFour("pat-na1-0123456789abcd"), "ends in abcd");
  assert.equal(lastFour("short"), "saved");
});

// ---------------------------------------------------------------------------- SQL

await check("SQL: only one read-only SELECT / WITH", () => {
  const okSql = (q: string, params: string[] = [], d: "postgres" | "mysql" = "postgres") => {
    const r = checkReadOnlySql(q, d, params);
    assert.ok(r.ok, `${q}: ${r.ok ? "" : r.reason}`);
    return r;
  };
  const bad = (q: string, re: RegExp, params: string[] = [], d: "postgres" | "mysql" = "postgres") => {
    const r = checkReadOnlySql(q, d, params);
    assert.ok(!r.ok, `${q} should be refused`);
    assert.match(r.reason, re, q);
  };
  okSql("select id, status from orders where user_id = :user_id", ["user_id"]);
  okSql("WITH o AS (SELECT * FROM orders) SELECT count(*) FROM o");
  okSql("(SELECT 1)");
  okSql('select "update", created_at::date from t'); // quoted name and a cast are fine
  okSql("select 'delete; into' as x from t".replace(";", ","));
  okSql("select $$ drop table x $$ as y");
  okSql("select * from `orders` where note = 'it\\'s' and id = :id", ["id"], "mysql");
  bad("select 1;", /semicolon/);
  bad("select 1; drop table users", /semicolon/);
  bad("select ';'", /semicolon/);
  bad("delete from users", /start with SELECT/);
  bad("update users set a = 1", /start with SELECT/);
  bad("with x as (delete from users returning *) select * from x", /DELETE is not allowed/);
  bad("select * into backup from users", /INTO is not allowed/);
  bad("select * from t for update", /UPDATE is not allowed/);
  bad("select pg_sleep(10)", /pg_sleep\(\) is not allowed/);
  bad("select * from t into outfile '/tmp/x'", /INTO is not allowed/, [], "mysql");
  bad("select * from t where id = $1", /:name placeholders/);
  bad("select * from t where id = ?", /:name placeholders/, [], "mysql");
  bad("select * from t where id = :id", /no input called id/);
  bad("select 1", /email is not used/, ["email"]);
  bad("select 'unclosed", /not closed/);
  bad("select 1 /* open", /not closed/);
  bad("", /Enter the SQL/);
  // A placeholder inside a string or a comment is not a placeholder.
  const r = okSql("select ':nope' as a, :id as b -- :also_nope\n from t", ["id"]);
  assert.deepEqual(r.ok && r.placeholders.map((p) => p.name), ["id"]);
});

await check("SQL: placeholders compiled per driver and wrapped with a row limit", () => {
  const q = "select * from orders where user_id = :uid and (status = :status or :status is null) -- latest";
  const r = checkReadOnlySql(q, "postgres", ["uid", "status"]);
  assert.ok(r.ok);
  const pg = compileSql(q, "postgres", r.placeholders);
  assert.match(pg.text, /user_id = \$1 and \(status = \$2 or \$2 is null\) -- latest\n\) AS halochime_q LIMIT 21$/);
  assert.deepEqual(pg.order, ["uid", "status"]);
  const r2 = checkReadOnlySql(q, "mysql", ["uid", "status"]);
  assert.ok(r2.ok);
  const my = compileSql(q, "mysql", r2.placeholders);
  assert.match(my.text, /user_id = \? and \(status = \? or \? is null\)/);
  assert.deepEqual(my.order, ["uid", "status", "status"]);
  assert.ok(my.text.startsWith("SELECT * FROM (\n"));
});

await check("SQL: verified user id is bound from the visitor, never from the AI", () => {
  const params = query().parameters;
  const ok1 = bindQueryArgs(params, ["user_id", "status"], { user_id: "someone_else", status: "Shipped" }, "user_1042");
  assert.deepEqual(ok1, { ok: true, values: ["user_1042", "Shipped"] });
  const optional = bindQueryArgs(params, ["user_id", "status"], {}, "user_1042");
  assert.deepEqual(optional, { ok: true, values: ["user_1042", null] });
  const anonymous = bindQueryArgs(params, ["user_id", "status"], { user_id: "user_1042" }, null);
  assert.ok(!anonymous.ok && anonymous.needsSignIn && /signed in/.test(anonymous.reason));
  const numeric: DbQueryParameter[] = [{ name: "uid", type: "integer", description: "", required: true, verifiedUserId: true }];
  assert.deepEqual(bindQueryArgs(numeric, ["uid"], {}, "42"), { ok: true, values: [42] });
  assert.ok(!bindQueryArgs(numeric, ["uid"], {}, "user_42").ok);
  const required: DbQueryParameter[] = [{ name: "order_id", type: "integer", description: "", required: true }];
  const missing = bindQueryArgs(required, ["order_id"], {}, null);
  assert.ok(!missing.ok && /Missing order_id/.test(missing.reason));
  assert.deepEqual(bindQueryArgs(required, ["order_id"], { order_id: "7" }, null), { ok: true, values: [7] });
});

await check("SQL: results capped in rows and size", () => {
  assert.equal(formatRows([]), "No matching rows.");
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: i, at: new Date(Date.UTC(2026, 10, 6)), big: BigInt("9007199254740993"), bin: Buffer.from("x") }));
  const parsed = JSON.parse(formatRows(rows));
  assert.equal(parsed.rows.length, MAX_ROWS);
  assert.match(parsed.note, /first 20 rows/);
  assert.equal(parsed.rows[0].at, "2026-11-06T00:00:00.000Z");
  assert.equal(parsed.rows[0].big, "9007199254740993");
  assert.equal(parsed.rows[0].bin, "[binary data]");
  const wide = formatRows(Array.from({ length: 20 }, () => ({ text: "x".repeat(2000) })));
  assert.ok(wide.length <= 4000);
  const w = JSON.parse(wide);
  assert.ok(w.rows.length < 20 && w.cut && w.rows[0].text.endsWith("... [cut]"));
});

await check("connection strings and private hosts", () => {
  const pg = parseConnectionString("postgres://ro_user:p%40ss@db.example.com/shop?sslmode=require", "postgres");
  assert.deepEqual(pg, { ok: true, target: { host: "db.example.com", port: 5432, user: "ro_user", password: "p@ss", database: "shop" } });
  const my = parseConnectionString("mysql://u:p@db.example.com:3307/app", "mysql");
  assert.ok(my.ok && my.target.port === 3307);
  assert.ok(!parseConnectionString("mysql://u:p@h/app", "postgres").ok);
  assert.ok(!parseConnectionString("postgres://u:p@h", "postgres").ok);
  const bad = parseConnectionString("not a url with secret123", "postgres");
  assert.ok(!bad.ok && !bad.reason.includes("secret123"));
  const blocked = (ip: string) => ip.startsWith("10.") || ip === "127.0.0.1";
  assert.ok(blockedHostReason("localhost", blocked));
  assert.ok(blockedHostReason("127.0.0.1", blocked));
  assert.ok(blockedHostReason("db.internal", blocked));
  assert.equal(blockedHostReason("db.example.com", blocked), null);
});

// ---------------------------------------------------------------------------- CRM

await check("contact lookups default to the verified email only", () => {
  assert.deepEqual(contactQueryFrom({}, signedIn), { ok: true, query: { email: "ana@example.com" } });
  assert.ok(!contactQueryFrom({}, { ...signedIn, verified: false }).ok);
  assert.ok(!contactQueryFrom({ email: "nope" }, anon).ok);
  assert.deepEqual(contactQueryFrom({ phone: "+44 (20) 7946-0958" }, anon), { ok: true, query: { phone: "+442079460958" } });
  assert.equal(normalizePhone("12"), undefined);
  assert.deepEqual(missingFields({ id: "1", email: "a@b.co", firstName: "Ana" }, { email: "x@y.co", firstName: "Bo", phone: "+1555000111", company: "Acme" }), { phone: "+1555000111", company: "Acme" });
});

const hsContact = { id: "901", properties: { firstname: "Ana", lastname: "Lopez", email: "ana@example.com", phone: "", company: "", lifecyclestage: "lead" } };

await check("HubSpot: find contact, privacy for other people's records", async () => {
  const f = mockFetch([[/POST .*\/contacts\/search$/, 200, { results: [hsContact] }]]);
  const hs = hubspotClient("pat-test-token-0000", f);
  const own = await runFindContact(hs, {}, signedIn);
  assert.ok(own.ok);
  assert.deepEqual(JSON.parse(own.result), { found: true, id: "901", name: "Ana Lopez", email: "ana@example.com", stage: "lead" });
  assert.equal(f.calls[0]!.headers.authorization, "Bearer pat-test-token-0000");
  assert.deepEqual((f.calls[0]!.body as { filterGroups: unknown }).filterGroups, [{ filters: [{ propertyName: "email", operator: "EQ", value: "ana@example.com" }] }]);
  const other = await runFindContact(hs, { email: "ana@example.com" }, anon);
  assert.ok(other.ok && !other.result.includes("Lopez") && /already a contact/.test(other.result));
});

await check("HubSpot: save lead creates, or fills only empty fields", async () => {
  const create = mockFetch([
    [/POST .*\/contacts\/search$/, 200, { results: [] }],
    [/POST .*\/crm\/v3\/objects\/contacts$/, 201, { id: "77", properties: {} }],
  ]);
  const r = await runSaveLead(hubspotClient("pat-test-token-0000", create), { email: "new@example.com", first_name: "Sam", phone: "+1 555 0100 222" }, anon);
  assert.ok(r.ok && /new lead/.test(r.result) && /77/.test(r.result));
  // Searched by email, then phone, then created.
  assert.equal(create.calls.length, 3);
  assert.deepEqual((create.calls[2]!.body as { properties: unknown }).properties, { email: "new@example.com", phone: "+15550100222", firstname: "Sam", lifecyclestage: "lead" });

  const update = mockFetch([
    [/POST .*\/contacts\/search$/, 200, { results: [hsContact] }],
    [/PATCH .*\/contacts\/901$/, 200, { id: "901" }],
  ]);
  const u = await runSaveLead(hubspotClient("pat-test-token-0000", update), { email: "ana@example.com", first_name: "Someone", phone: "+15550100222" }, anon);
  assert.ok(u.ok && /Added the missing phone/.test(u.result));
  assert.deepEqual((update.calls[1]!.body as { properties: unknown }).properties, { phone: "+15550100222" });

  const noAccess = mockFetch([[/POST .*\/contacts\/search$/, 401, { message: "Authentication credentials not found." }]]);
  const denied = await runSaveLead(hubspotClient("bad-token-0000000", noAccess), { email: "a@example.com" }, anon);
  assert.ok(!denied.ok && denied.status === 401 && /credentials were refused/.test(denied.result) && !denied.result.includes("bad-token"));
});

await check("HubSpot: note is linked to the contact", async () => {
  const f = mockFetch([
    [/POST .*\/contacts\/search$/, 200, { results: [hsContact] }],
    [/POST .*\/objects\/notes$/, 201, { id: "n1" }],
  ]);
  const r = await runAddNote(hubspotClient("pat-test-token-0000", f), { note: "Wants the Pro plan." }, signedIn, "voice");
  assert.ok(r.ok);
  const body = f.calls[1]!.body as { properties: { hs_note_body: string }; associations: { to: { id: string }; types: { associationTypeId: number }[] }[] };
  assert.match(body.properties.hs_note_body, /Halochime call:\nWants the Pro plan\./);
  assert.equal(body.associations[0]!.to.id, "901");
  assert.equal(body.associations[0]!.types[0]!.associationTypeId, 202);
  const none = mockFetch([[/POST .*\/contacts\/search$/, 200, { results: [] }]]);
  const missing = await runAddNote(hubspotClient("pat-test-token-0000", none), { note: "x", email: "z@example.com" }, anon, "text");
  assert.ok(!missing.ok && /Save them as a lead first/.test(missing.result));
});

await check("GoHighLevel: v2 headers, duplicate search, create with location", async () => {
  const f = mockFetch([
    [/GET .*\/contacts\/search\/duplicate\?/, 200, { contact: null }],
    [/POST .*\/contacts\/$/, 201, { contact: { id: "ghl1" } }],
  ]);
  const r = await runSaveLead(goHighLevelClient("pit-test-token-0000", "LOC123", f), { email: "new@example.com", first_name: "Sam", last_name: "Lee", company: "Acme" }, anon);
  assert.ok(r.ok && /ghl1/.test(r.result));
  assert.equal(f.calls[0]!.headers.version, "2021-07-28");
  assert.match(f.calls[0]!.url, /locationId=LOC123&email=new%40example.com/);
  assert.deepEqual(f.calls[1]!.body, { locationId: "LOC123", email: "new@example.com", firstName: "Sam", lastName: "Lee", companyName: "Acme", source: "Halochime", tags: ["halochime"] });
  const notes = mockFetch([
    [/GET .*\/contacts\/search\/duplicate\?/, 200, { contact: { id: "ghl1", email: "ana@example.com" } }],
    [/POST .*\/contacts\/ghl1\/notes$/, 201, { note: { id: "n" } }],
  ]);
  assert.ok((await runAddNote(goHighLevelClient("pit-test-token-0000", "LOC123", notes), { note: "Hi" }, signedIn, "text")).ok);
  assert.match(String((notes.calls[1]!.body as { body: string }).body), /Halochime chat/);
});

await check("Zoho: access token refreshed once and cached; 204 = not found; lead defaults", async () => {
  clearZohoTokenCache();
  const creds = { clientId: "1000.CLIENT", clientSecret: "secret-value", refreshToken: "1000.refresh.token", dataCentre: "eu" as const };
  const f = mockFetch([
    [/POST https:\/\/accounts\.zoho\.eu\/oauth\/v2\/token$/, 200, { access_token: "1000.access", expires_in: 3600 }],
    [/GET https:\/\/www\.zohoapis\.eu\/crm\/v7\/(Contacts|Leads)\/search\?/, 204, undefined],
    [/POST https:\/\/www\.zohoapis\.eu\/crm\/v7\/Leads$/, 201, { data: [{ code: "SUCCESS", details: { id: "5551" }, status: "success" }] }],
  ]);
  const zoho = zohoClient(creds, f);
  const r = await runSaveLead(zoho, { email: "new@example.com", first_name: "Sam" }, anon);
  assert.ok(r.ok && /5551/.test(r.result), r.result);
  assert.equal(f.calls.filter((c) => c.url.includes("/oauth/")).length, 1);
  assert.equal(f.calls[1]!.headers.authorization, "Zoho-oauthtoken 1000.access");
  const created = (f.calls.at(-1)!.body as { data: Record<string, string>[] }).data[0]!;
  assert.deepEqual(created, { Email: "new@example.com", Lead_Source: "Chat", Last_Name: "Sam", Company: "Not given" });
  assert.match(String(f.calls[0]!.body), /grant_type=refresh_token/);
  // A second client with the same credentials reuses the cached token.
  await zohoClient(creds, f).findContact({ email: "x@example.com" });
  assert.equal(f.calls.filter((c) => c.url.includes("/oauth/")).length, 1);

  clearZohoTokenCache();
  const refused = mockFetch([[/oauth\/v2\/token$/, 200, { error: "invalid_code" }]]);
  const res = await runFindContact(zohoClient(creds, refused), { email: "a@example.com" }, anon);
  assert.ok(!res.ok && /refused the saved credentials \(invalid_code\)/.test(res.result) && !res.result.includes("secret-value"));
});

await check("conversation log: find or create, then the summary as a note", async () => {
  const f = mockFetch([
    [/POST .*\/contacts\/search$/, 200, { results: [] }],
    [/POST .*\/crm\/v3\/objects\/contacts$/, 201, { id: "88", properties: {} }],
    [/POST .*\/objects\/notes$/, 201, { id: "n1" }],
  ]);
  const outcome = await logSummary(hubspotClient("pat-test-token-0000", f), { email: "Ana@Example.com", name: "Ana Lopez", summary: "Asked about pricing.", heading: "Halochime chat" });
  assert.equal(outcome, "created");
  assert.deepEqual((f.calls[1]!.body as { properties: unknown }).properties, { email: "ana@example.com", firstname: "Ana", lastname: "Lopez", lifecyclestage: "lead" });
  assert.match((f.calls[2]!.body as { properties: { hs_note_body: string } }).properties.hs_note_body, /Halochime chat\nAsked about pricing\./);
  assert.equal(await logSummary(hubspotClient("pat-test-token-0000", f), { name: null, summary: "x", heading: "h" }), "skipped");
});

// ---------------------------------------------------------------------------- calendar

await check("Cal.com: open times and booking", async () => {
  const now = () => Date.parse("2026-11-09T12:00:00Z");
  const f = mockFetch([
    [/GET https:\/\/api\.cal\.com\/v2\/slots\?/, 200, { status: "success", data: { "2026-11-09": [{ start: "2026-11-09T09:00:00.000+00:00" }, { start: "2026-11-09T15:00:00.000+00:00" }], "2026-11-10": [{ start: "2026-11-10T09:30:00.000+00:00" }] } }],
    [/POST https:\/\/api\.cal\.com\/v2\/bookings$/, 201, { status: "success", data: { uid: "bk_1", start: "2026-11-10T09:30:00.000Z" } }],
  ]);
  const cal = calcomClient({ apiKey: "cal_live_test0000", eventTypeId: 321, timeZone: "Europe/London" }, f, now);
  const slots = await cal.findSlots({ start_date: "2026-11-09", end_date: "2026-11-10" });
  assert.ok(slots.ok, slots.result);
  const parsed = JSON.parse(slots.result);
  // 09:00 today has passed.
  assert.deepEqual(parsed.open_times, { "2026-11-09": ["2026-11-09T15:00:00.000+00:00"], "2026-11-10": ["2026-11-10T09:30:00.000+00:00"] });
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.searchParams.get("eventTypeId"), "321");
  assert.equal(url.searchParams.get("timeZone"), "Europe/London");
  assert.equal(f.calls[0]!.headers["cal-api-version"], "2024-09-04");
  assert.equal(f.calls[0]!.headers.authorization, "Bearer cal_live_test0000");

  const booked = await cal.book({ start: "2026-11-10T09:30:00.000+00:00", name: "Ana Lopez", email: "Ana@Example.com", time_zone: "Asia/Karachi" });
  assert.ok(booked.ok && /bk_1/.test(booked.result) && /ana@example\.com/.test(booked.result), booked.result);
  assert.match(booked.result, /14:30/); // shown in the visitor's time zone
  assert.deepEqual(f.calls[1]!.body, {
    start: "2026-11-10T09:30:00.000Z",
    eventTypeId: 321,
    attendee: { name: "Ana Lopez", email: "ana@example.com", timeZone: "Asia/Karachi" },
    metadata: { source: "halochime" },
  });

  assert.ok(!(await cal.findSlots({ start_date: "2026-11-09", end_date: "2026-12-30" })).ok);
  assert.ok(!(await cal.findSlots({ start_date: "9 Nov" })).ok);
  assert.ok(!(await cal.findSlots({ start_date: "2026-11-09", time_zone: "Mars/Base" })).ok);
  assert.ok(!(await cal.book({ start: "2026-11-01T09:00:00Z", name: "A", email: "a@example.com" })).ok);
  assert.ok(!(await cal.book({ start: "2026-11-10T09:30:00Z", name: "A", email: "nope" })).ok);
  assert.equal(f.calls.length, 2);

  const taken = mockFetch([[/POST .*\/bookings$/, 400, { status: "error", error: { message: "User either already has booking at this time or is not available" } }]]);
  const clash = await calcomClient({ apiKey: "cal_live_test0000", eventTypeId: 321, timeZone: "UTC" }, taken, now).book({ start: "2026-11-10T09:30:00Z", name: "A", email: "a@example.com" });
  assert.ok(!clash.ok && /did not go through/.test(clash.result) && /not available/.test(clash.result));
  assert.deepEqual(readSlots({ data: { slots: { "2026-11-10": [{ time: "2026-11-10T09:00:00Z" }] } } }), { "2026-11-10": ["2026-11-10T09:00:00Z"] });
});

await check("booking link", () => {
  assert.match(bookingLinkResult("https://calendly.com/acme/demo", "text").result, /Booking link: https:\/\/calendly\.com\/acme\/demo/);
  assert.match(bookingLinkResult("https://calendly.com/acme/demo", "voice").result, /Don't read the address out/);
});

console.log(`integrations checks: ${passed} passed`);
