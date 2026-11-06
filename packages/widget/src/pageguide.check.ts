/**
 * Checks for pageguide.ts (the widget has no test runner). Plain objects stand in for the page's
 * elements. Run from the repo root:
 *
 *   node_modules/.bin/tsx packages/widget/src/pageguide.check.ts
 *
 * Not part of the widget bundle (nothing imports it); it fails with an error when a check does.
 */
import { collectElements, describe, idMaker, isSensitive, OVERLAY_ATTR, roleOf, sendDelay, signature, type CollectEnv, type ElementLike } from "./pageguide";

let failures = 0;
function check(name: string, ok: boolean): void {
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}`);
  }
}

interface Fake extends ElementLike {
  attrs: Record<string, string>;
  text?: string;
  label?: string;
  hiddenByCss?: boolean;
  /** What a visitor typed. Must never show up anywhere. */
  value?: string;
}

const el = (tagName: string, attrs: Record<string, string> = {}, more: Partial<Fake> = {}): Fake => ({
  tagName: tagName.toUpperCase(),
  attrs,
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name]! : null;
  },
  ...more,
});

const env: CollectEnv<Fake> = {
  visible: (e) => !e.hiddenByCss,
  text: (e) => e.text ?? "",
  labelText: (e) => e.label ?? "",
};

// Roles
check("link", roleOf(el("a", { href: "/" })) === "link");
check("button", roleOf(el("button")) === "button" && roleOf(el("input", { type: "submit" })) === "button");
check("field", roleOf(el("input", { type: "email" })) === "field" && roleOf(el("input")) === "field");
check("dropdown", roleOf(el("select")) === "dropdown");
check("aria role wins", roleOf(el("div", { role: "tab" })) === "tab" && roleOf(el("div", { role: "menuitem" })) === "menu item");
check("checkbox", roleOf(el("input", { type: "checkbox" })) === "checkbox");

// Labels: visible text, aria-label, <label>, placeholder; never the value
check("button text", describe(el("button", {}, { text: "  Start\n free trial " }), env)?.label === "Start free trial");
check("aria-label wins", describe(el("button", { "aria-label": "Open menu" }, { text: "≡" }), env)?.label === "Open menu");
const email = el("input", { type: "email", name: "email" }, { label: "Work email", value: "sam@example.com" });
check("field uses its label", describe(email, env)?.label === "Work email");
const search = el("input", { type: "search", placeholder: "Search plans" }, { value: "secret words" });
check("field falls back to placeholder", describe(search, env)?.label === "Search plans");
check("field without a name is left out", describe(el("input", { type: "text" }, { value: "typed" }), env) === null);
check("submit input shows its printed text", describe(el("input", { type: "submit", value: "Pay now" }), env)?.label === "Pay now");
check("long labels are cut", (describe(el("a", { href: "#" }, { text: "word ".repeat(60) }), env)?.label.length ?? 0) <= 80);
check("unnamed icon button is left out", describe(el("button", {}, { text: "  " }), env) === null);

// Skipped: hidden, private, ours
check("hidden attribute", describe(el("button", { hidden: "" }, { text: "Hidden" }), env) === null);
check("aria-hidden", describe(el("a", { href: "/", "aria-hidden": "true" }, { text: "x" }), env) === null);
check("hidden by css", describe(el("button", {}, { text: "Gone", hiddenByCss: true }), env) === null);
check("input type hidden", describe(el("input", { type: "hidden", "aria-label": "csrf" }), env) === null);
check("password", describe(el("input", { type: "password", "aria-label": "Password" }), env) === null);
check("card number by autocomplete", describe(el("input", { autocomplete: "cc-number", placeholder: "1234 1234 1234 1234" }), env) === null);
check("card number by name", isSensitive(el("input", { name: "cardNumber" })));
check("cvc by label", describe(el("input", { type: "text" }, { label: "CVC" }), env) === null);
check("expiry by placeholder", isSensitive(el("input", { placeholder: "Expiry (MM/YY)" })));
check("pin", isSensitive(el("input", { id: "pin" })));
check("one-time code", isSensitive(el("input", { autocomplete: "one-time-code" })));
check("iban", isSensitive(el("input", { name: "iban" })));
check("plain email is not private", !isSensitive(email, "Work email"));
check("a card button is still a button", describe(el("button", {}, { text: "Pay by card" }), env)?.label === "Pay by card");
check("our overlay", describe(el("div", { role: "button", [OVERLAY_ATTR]: "" }, { text: "Here" }), env) === null);

// The list
const page: Fake[] = [
  el("a", { href: "/" }, { text: "Home" }),
  el("a", { href: "/pricing" }, { text: "Pricing" }),
  el("input", { type: "password", "aria-label": "Password" }, { value: "hunter2" }),
  email,
  el("button", {}, { text: "Add to cart" }),
  el("button", {}, { text: "Add to cart" }),
  el("button", {}, { text: "add to cart" }),
  el("button", {}, { text: "Hidden", hiddenByCss: true }),
];
const ids = idMaker<Fake>();
const first = collectElements(page, env, ids);
check("order and filtering", first.elements.map((e) => e.label).join("|") === "Home|Pricing|Work email|Add to cart|Add to cart");
check("ids are short", first.elements.every((e) => /^e\d+$/.test(e.id)));
check("lookup by id", first.byId.get(first.elements[1]!.id) === page[1]);
check("no typed value anywhere", !JSON.stringify(first.elements).includes("sam@example.com") && !JSON.stringify(first.elements).includes("hunter2"));
// Same element, same id, after the page changes around it.
const again = collectElements([el("a", { href: "/new" }, { text: "New" }), ...page], env, ids);
check("ids stay the same", again.elements.find((e) => e.label === "Pricing")?.id === first.elements[1]!.id);
check("a new element gets a new id", again.elements[0]!.id !== first.elements[0]!.id);

const many = Array.from({ length: 200 }, (_, i) => el("a", { href: `/p${i}` }, { text: `Product ${i}` }));
check("capped at 60", collectElements(many, env, idMaker<Fake>()).elements.length === 60);
check("cap can be set", collectElements(many, env, idMaker<Fake>(), 5).elements.length === 5);

// Sending
check("same list, same signature", signature("/a", first.elements) === signature("/a", [...first.elements]));
check("other path, other signature", signature("/a", first.elements) !== signature("/b", first.elements));
check("first send waits only for the debounce", sendDelay(10_000, null, 800, 4000) === 800);
check("sends are spaced", sendDelay(10_000, 9_000, 800, 4000) === 3000);
check("long after, debounce only", sendDelay(60_000, 9_000, 800, 4000) === 800);

if (failures) throw new Error(`${failures} page guide check(s) failed`);
console.log("page guide checks passed");
