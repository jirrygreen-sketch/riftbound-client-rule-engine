import type { FullProductCommand } from "./full-product-contract.js";

export const JOURNAL_FORMAT = "riftbound-journal" as const;
export const JOURNAL_FORMAT_VERSION = 1 as const;
export const JOURNAL_RULESET_VERSION = "core-1.5" as const;

export interface SeatInfo {
  playerId: string;
  name: string;
}

export interface JournalHeader {
  format: typeof JOURNAL_FORMAT;
  formatVersion: typeof JOURNAL_FORMAT_VERSION;
  engineVersion: string;
  rulesetVersion: typeof JOURNAL_RULESET_VERSION;
  catalogDigest: string;
  seed: string;
  seats: SeatInfo[];
  createdAt: string;
}

export type JournalCommand = FullProductCommand;

export interface JournalEntry {
  seq: number;
  playerId: string;
  commandId: string;
  command: JournalCommand;
  acceptedAt: string;
}

export interface Journal {
  header: JournalHeader;
  entries: JournalEntry[];
}

function data(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every(key => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined &&
        descriptor.get === undefined &&
        descriptor.set === undefined;
    });
  } catch {
    return false;
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  return Object.keys(value).length === expected.length &&
    expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function text(value: unknown, maximumLength = 512): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value;
}

function safeSequence(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1;
}

function isSeatInfo(value: unknown): value is SeatInfo {
  return data(value) &&
    exactKeys(value, ["playerId", "name"]) &&
    text(value.playerId, 256) &&
    text(value.name, 128);
}

function isTargetSelection(value: unknown): value is {
  targetKind: "object" | "player";
  targetId: string;
} {
  return data(value) &&
    exactKeys(value, ["targetKind", "targetId"]) &&
    (value.targetKind === "object" || value.targetKind === "player") &&
    text(value.targetId, 256);
}

function isTargetArray(value: unknown): value is readonly {
  targetKind: "object" | "player";
  targetId: string;
}[] {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  for (const target of value) {
    if (!isTargetSelection(target)) return false;
    const key = `${target.targetKind}:${target.targetId}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function isJournalCommand(value: unknown): value is JournalCommand {
  if (!data(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "pass":
    case "concede":
      return exactKeys(value, ["type"]);
    case "play-card":
      return exactKeys(value, ["type", "instanceId", "targets"]) &&
        text(value.instanceId, 256) &&
        isTargetArray(value.targets);
    case "respond-to-prompt":
      return exactKeys(value, ["type", "promptId", "optionId", "targets"]) &&
        text(value.promptId, 256) &&
        text(value.optionId, 256) &&
        isTargetArray(value.targets);
    default:
      return false;
  }
}

export function isJournalHeader(value: unknown): value is JournalHeader {
  if (!data(value) || !exactKeys(value, [
    "format",
    "formatVersion",
    "engineVersion",
    "rulesetVersion",
    "catalogDigest",
    "seed",
    "seats",
    "createdAt"
  ])) {
    return false;
  }

  if (value.format !== JOURNAL_FORMAT ||
      value.formatVersion !== JOURNAL_FORMAT_VERSION ||
      value.rulesetVersion !== JOURNAL_RULESET_VERSION ||
      !text(value.engineVersion) ||
      !text(value.catalogDigest) ||
      !text(value.seed) ||
      !text(value.createdAt) ||
      !Array.isArray(value.seats) ||
      value.seats.length === 0 ||
      !value.seats.every(isSeatInfo)) {
    return false;
  }

  const playerIds = value.seats.map(seat => seat.playerId);
  return new Set(playerIds).size === playerIds.length;
}

export function isJournalEntry(value: unknown): value is JournalEntry {
  return data(value) &&
    exactKeys(value, ["seq", "playerId", "commandId", "command", "acceptedAt"]) &&
    safeSequence(value.seq) &&
    text(value.playerId, 256) &&
    text(value.commandId, 256) &&
    isJournalCommand(value.command) &&
    text(value.acceptedAt);
}

export function isJournalEntries(
  value: unknown,
  seats?: readonly SeatInfo[]
): value is JournalEntry[] {
  if (!Array.isArray(value)) return false;

  const commandIds = new Set<string>();
  const playerIds = seats === undefined ? null : new Set(seats.map(seat => seat.playerId));
  return value.every((entry, index) => {
    if (!isJournalEntry(entry) || entry.seq !== index + 1) return false;
    if (commandIds.has(entry.commandId)) return false;
    if (playerIds !== null && !playerIds.has(entry.playerId)) return false;
    commandIds.add(entry.commandId);
    return true;
  });
}

export function isJournal(value: unknown): value is Journal;
export function isJournal(
  header: unknown,
  entries: unknown
): header is JournalHeader;
export function isJournal(
  valueOrHeader: unknown,
  suppliedEntries?: unknown
): boolean {
  if (suppliedEntries !== undefined) {
    return isJournalHeader(valueOrHeader) &&
      isJournalEntries(suppliedEntries, valueOrHeader.seats);
  }

  if (!data(valueOrHeader) ||
      !exactKeys(valueOrHeader, ["header", "entries"]) ||
      !isJournalHeader(valueOrHeader.header)) {
    return false;
  }
  return isJournalEntries(valueOrHeader.entries, valueOrHeader.header.seats);
}

export const validateJournalHeader = isJournalHeader;
export const validateJournalEntry = isJournalEntry;
export const validateJournalEntries = isJournalEntries;
export const validateJournal = isJournal;

function parseJsonLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    throw new SyntaxError(
      `Invalid journal JSON on line ${lineNumber}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function parseJournalJsonl(serialized: string): Journal {
  if (typeof serialized !== "string") {
    throw new TypeError("Journal JSONL must be a string");
  }

  const lines = serialized.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.some(line => line.trim() === "")) {
    throw new SyntaxError("Journal JSONL must contain one JSON value per line");
  }

  const header = parseJsonLine(lines[0]!, 1);
  const entries = lines.slice(1).map((line, index) =>
    parseJsonLine(line, index + 2)
  );
  const journal = { header, entries };
  if (!isJournal(journal)) {
    throw new TypeError("Journal JSONL does not match journal format v1");
  }
  return journal;
}

export function serializeJournalJsonl(journal: Journal): string;
export function serializeJournalJsonl(
  header: JournalHeader,
  entries: readonly JournalEntry[]
): string;
export function serializeJournalJsonl(
  journalOrHeader: Journal | JournalHeader,
  suppliedEntries?: readonly JournalEntry[]
): string {
  const journal: Journal = suppliedEntries === undefined
    ? journalOrHeader as Journal
    : {
        header: journalOrHeader as JournalHeader,
        entries: [...suppliedEntries]
      };
  if (!isJournal(journal)) {
    throw new TypeError("Journal does not match journal format v1");
  }
  return [
    JSON.stringify(journal.header),
    ...journal.entries.map(entry => JSON.stringify(entry))
  ].join("\n") + "\n";
}
