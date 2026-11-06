/**
 * Checks for proactive.ts (the widget has no test runner). Run from the repo root:
 *
 *   node_modules/.bin/tsx packages/widget/src/proactive.check.ts
 *
 * Not part of the widget bundle (nothing imports it); it fails with an error when a check does.
 */
import { cleanOffer, cleanProactive, matchRule, normalizePath, OfferMemory, offerKey, ruleMatches, type KeyValueStore } from "./proactive";

let failures = 0;
function check(name: string, ok: boolean): void {
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}`);
  }
}

// Paths
check("trailing slash and case are one page", normalizePath("/Pricing/") === "/pricing");
check("root stays root", normalizePath("/") === "/" && normalizePath("") === "/");

// Rule matching
const rule = (match: "contains" | "starts_with" | "exact" | "any", path: string, id = "r") => ({ id, match, path, delaySec: 5, message: "Hi" });
check("contains", ruleMatches(rule("contains", "/pricing"), "/en/pricing/teams"));
check("contains is case blind", ruleMatches(rule("contains", "/Checkout"), "/checkout"));
check("contains misses", !ruleMatches(rule("contains", "/pricing"), "/blog/prices"));
check("starts with", ruleMatches(rule("starts_with", "/docs"), "/docs/start") && !ruleMatches(rule("starts_with", "/docs"), "/en/docs"));
check("exact ignores trailing slash", ruleMatches(rule("exact", "/checkout/"), "/checkout") && !ruleMatches(rule("exact", "/checkout"), "/checkout/done"));
check("any page", ruleMatches(rule("any", ""), "/whatever"));
check("empty path never matches", !ruleMatches(rule("contains", "  "), "/pricing"));
const rules = [rule("exact", "/checkout", "a"), rule("contains", "/pricing", "b"), rule("any", "", "c")];
check("first matching rule wins", matchRule(rules, "/pricing")?.id === "b");
check("falls through to any", matchRule(rules, "/about")?.id === "c");
check("no rule", matchRule(rules.slice(0, 2), "/about") === null);

// Config cleaning
const cleaned = cleanProactive({
  rules: [
    { id: "a", match: "contains", path: "/pricing", delaySec: 9999, message: " Plans? " },
    { id: "b", match: "regex", path: ".*", delaySec: 1, message: "x" },
    { id: "c", match: "any", path: "", delaySec: -4, message: "" },
    "junk",
  ],
  defaultMessage: "",
});
check("bad rules dropped", cleaned?.rules.length === 1);
check("delay capped", cleaned?.rules[0]?.delaySec === 600);
check("message trimmed", cleaned?.rules[0]?.message === "Plans?");
check("default message filled", !!cleaned?.defaultMessage);
check("missing config is off", cleanProactive(undefined) === undefined && cleanProactive("on") === undefined);

// offerHelp arguments
const o = cleanOffer({ reason: " checkout\nfailed ", message: "" }, "Default");
check("reason on one line", o.reason === "checkout failed");
check("message falls back", o.message === "Default");
check("long reason cut", cleanOffer({ reason: "x".repeat(500) }, "D").reason.length === 60);
check("no arguments", cleanOffer(undefined, "D").message === "D" && cleanOffer(undefined, "D").reason === "");

// Once per page per visit
function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const store = memoryStore();
const memory = new OfferMemory("agt_1", store);
const pricing = offerKey("/pricing/", "rule");
check("not shown yet", !memory.shown(pricing));
memory.remember(pricing);
check("shown once", memory.shown(pricing));
check("same page, other spelling", memory.shown(offerKey("/Pricing", "rule")));
check("another page is fresh", !memory.shown(offerKey("/checkout", "rule")));
check("an api offer has its own slot", !memory.shown(offerKey("/pricing", "api", "checkout_failed")));
check("a reload in the same visit remembers", new OfferMemory("agt_1", store).shown(pricing));
check("another agent does not", !new OfferMemory("agt_2", store).shown(pricing));

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};
const blocked = new OfferMemory("agt_1", throwing);
blocked.remember(pricing);
check("blocked storage still remembers in memory", blocked.shown(pricing));
check("no storage at all", (() => {
  const m = new OfferMemory("agt_1", null);
  m.remember(pricing);
  return m.shown(pricing);
})());
store.data.set("halochime.help.agt_3", "{not json");
check("broken stored value is ignored", !new OfferMemory("agt_3", store).shown(pricing));

// Remembered list stays small
const many = new OfferMemory("agt_4", store);
for (let i = 0; i < 150; i++) many.remember(offerKey(`/p${i}`, "rule"));
check("list is capped", (JSON.parse(store.data.get("halochime.help.agt_4") ?? "[]") as string[]).length === 100);

if (failures) throw new Error(`${failures} proactive check(s) failed`);
console.log("proactive checks passed");
