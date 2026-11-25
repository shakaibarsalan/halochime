/**
 * Checks for the config normaliser in api.ts (the widget has no test runner). Run from packages/widget:
 *
 *   npx tsx src/config.check.ts
 */
import { normalizeConfig } from "./api";

function same(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) throw new Error(`${what}: got ${String(actual)}, expected ${String(expected)}`);
}

const base = { agentId: "a1", name: "Ava", greeting: "Hi", modes: ["voice", "text"] as ("voice" | "text")[] };
const theme = { color: "#111214", position: "bottom-right" as const, label: "Ask us" };

// "Opens on" survives the normaliser (25 Nov: it was dropped, so the widget always opened on Talk).
same(normalizeConfig({ ...base, theme: { ...theme, startMode: "text" } }).theme.startMode, "text", "typing kept");
same(normalizeConfig({ ...base, theme: { ...theme, startMode: "voice" } }).theme.startMode, "voice", "talking kept");
// Missing or unknown: no value, so the widget keeps its old default (talking).
same(normalizeConfig({ ...base, theme }).theme.startMode, undefined, "missing stays missing");
same(normalizeConfig({ ...base, theme: { ...theme, startMode: "video" as never } }).theme.startMode, undefined, "unknown dropped");

console.log("config checks passed");
