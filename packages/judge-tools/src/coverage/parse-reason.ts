import type { CoverageDependencyKind, JudgeReasonDependencies } from "./types.js";

const KNOWN_OP_PREFIXES = new Set([
  "ability",
  "card",
  "chain",
  "condition",
  "cost",
  "continuous",
  "effect",
  "event",
  "keyword",
  "location",
  "object",
  "player",
  "resource",
  "target",
  "token",
  "trigger",
  "zone"
]);



const KNOWN_TIMINGS = [
  "awaken",
  "begin",
  "beginning",
  "channel",
  "combat",
  "conquer",
  "cleanup",
  "draw",
  "hold",
  "main",
  "main-start",
  "main-end",
  "showdown",
  "turn-start",
  "turn-end"
] as const;

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeKeyword(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^[-–—\s]+|[-–—\s]+$/g, "")
    .split(/[\s\d:()[\]{}]+/, 1)[0]
    ?.toLowerCase();
  return normalized && normalized.length >= 2 && /^[a-z][a-z-]*$/.test(normalized) ? normalized : null;
}

function extractOps(reason: string): string[] {
  const values: string[] = [];
  const candidates = reason.match(/\b[a-z][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_.:-]*)+\b/gi) ?? [];
  for (const candidate of candidates) {
    const value = candidate.toLowerCase();
    const prefix = value.split(".", 1)[0] ?? "";
    if (KNOWN_OP_PREFIXES.has(prefix)) values.push(value);
  }
  return uniqueSorted(values);
}

function extractKeywords(reason: string): string[] {
  const values: string[] = [];
  for (const match of reason.matchAll(/\[([^\]\n]+)\]/g)) {
    const keyword = normalizeKeyword(match[1] ?? "");
    if (keyword) values.push(keyword);
  }
  return uniqueSorted(values);
}

function extractTimings(reason: string): string[] {
  const values: string[] = [];
  for (const timing of KNOWN_TIMINGS.filter(value => value.includes("-"))) {
    const escaped = timing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(reason)) values.push(timing);
  }
  for (const match of reason.matchAll(/\b(?:at the )?start of (?:your|the) next ([a-z]+) phase\b/gi)) {
    values.push(`start-of-next-${(match[1] ?? "phase").toLowerCase()}-phase`);
  }
  for (const match of reason.matchAll(/\bwhen i ([a-z-]+)\b/gi)) {
    values.push(`when-i-${(match[1] ?? "event").toLowerCase()}`);
  }
  return uniqueSorted(values);
}

function extractTasks(reason: string): string[] {
  const values: string[] = [];
  for (const match of reason.matchAll(/\bRIFT-(\d+(?:[\\/~]\d+)*)\b/gi)) {
    const raw = match[1] ?? "";
    for (const part of raw.split(/[\\/~]/g)) {
      if (part) values.push(`RIFT-${part}`);
    }
  }
  for (const match of reason.matchAll(/(?:^|\s)#(\d+)\b/g)) values.push(`#${match[1]}`);
  return uniqueSorted(values);
}

function extractRules(reason: string): string[] {
  const values: string[] = [];
  for (const match of reason.matchAll(/\b(?:CR|Core Rules|规则|条款|条目)\s*([0-9]{1,3}(?:\.[0-9]+)*(?:\.[a-z])?)\b/gi)) {
    if (match[1]) values.push(`CR ${match[1]}`);
  }
  for (const match of reason.matchAll(/(?<!RIFT-)\b([1-9][0-9]{2}(?:\.[0-9]+)*(?:\.[a-z])?)\b/g)) {
    if (match[1]) values.push(`CR ${match[1]}`);
  }
  return uniqueSorted(values);
}

export function parseJudgeReason(reason: string | undefined): JudgeReasonDependencies {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    return { ops: [], keywords: [], timings: [], tasks: [], rules: [] };
  }
  return {
    ops: extractOps(reason),
    keywords: extractKeywords(reason),
    timings: extractTimings(reason),
    tasks: extractTasks(reason),
    rules: extractRules(reason)
  };
}

export function dependencyEntries(
  dependencies: JudgeReasonDependencies
): readonly { readonly kind: CoverageDependencyKind; readonly value: string }[] {
  const entries: { kind: CoverageDependencyKind; value: string }[] = [];
  for (const value of dependencies.ops) entries.push({ kind: "op", value });
  for (const value of dependencies.keywords) entries.push({ kind: "keyword", value });
  for (const value of dependencies.timings) entries.push({ kind: "timing", value });
  for (const value of dependencies.tasks) entries.push({ kind: "task", value });
  for (const value of dependencies.rules) entries.push({ kind: "rule", value });
  return entries;
}
