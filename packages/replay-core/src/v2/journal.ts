import {
  canonicalJournalJson,
  computeJournalDigest,
  computeJournalHeaderDigest,
  computeJournalRecordDigest,
  isJournal,
  isJournalEntries,
  isJournalEntry,
  isJournalHeader,
  isJournalHead,
  isJournalIntegrity,
  isJournalOperation,
  type Journal,
} from "@riftbound/protocol";
import { JournalReplayError } from "./errors.js";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string, path: string, final: boolean): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new JournalReplayError(
      final ? "TRUNCATED_JOURNAL" : "INVALID_JSON", path,
      final ? "Invalid or incomplete JSON at end of journal" : "Invalid JSON", { cause },
    );
  }
}

function decode(text: string): unknown {
  // An envelope may be pretty printed; JSONL has the head on its first line.
  try {
    const value: unknown = JSON.parse(text);
    if (object(value) && value.kind === "header") {
      const { kind: _kind, head, integrity, ...header } = value;
      return { header, head, integrity, entries: [] };
    }
    return value;
  } catch { /* Try JSONL below. */ }
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.every(line => line.trim() === "")) {
    throw new JournalReplayError("TRUNCATED_JOURNAL", "$", "Journal is empty");
  }
  const first = parseJson(lines[0]!, "$line[1]", lines.length === 1);
  if (!object(first) || first.kind !== "header") {
    throw new JournalReplayError("INVALID_FORMAT", "$line[1]", "JSONL must start with a journal v1 header");
  }
  const { kind: _kind, head, integrity, ...header } = first;
  const entries = lines.slice(1).map((line, index) =>
    parseJson(line, `$line[${index + 2}]`, index === lines.length - 2));
  return { header, head, entries, integrity };
}

/** Validate the entire journal before any engine or setup code is invoked. */
export function readJournal(input: unknown): Journal {
  const decoded = typeof input === "string" ? decode(input) : input;
  let value: unknown;
  try {
    // Reject accessors, sparse arrays, non-finite numbers and cyclic data, and
    // detach the validated input from objects owned by the caller.
    value = JSON.parse(canonicalJournalJson(decoded)) as unknown;
  } catch (cause) {
    throw new JournalReplayError("INVALID_FORMAT", "$", "Journal must be finite JSON data", { cause });
  }
  if (!object(value)) throw new JournalReplayError("INVALID_FORMAT", "$", "Expected a journal v1 envelope");
  for (const field of ["header", "head", "entries", "integrity"]) {
    if (!Object.hasOwn(value, field)) {
      throw new JournalReplayError("TRUNCATED_JOURNAL", `$.${field}`, "Required journal section is missing");
    }
  }
  if (!isJournalHeader(value.header)) {
    throw new JournalReplayError("INVALID_FORMAT", "$.header", "Invalid journal v1 header");
  }
  if (!isJournalHead(value.head)) {
    throw new JournalReplayError("INVALID_FORMAT", "$.head", "Invalid journal head");
  }
  if (!isJournalIntegrity(value.integrity)) {
    throw new JournalReplayError("INVALID_FORMAT", "$.integrity", "Invalid integrity or protected head reference");
  }
  if (!Array.isArray(value.entries)) {
    throw new JournalReplayError("INVALID_FORMAT", "$.entries", "Expected an ordered record array");
  }
  const { header, head, integrity, entries } = value;
  let parent = computeJournalHeaderDigest(header);
  for (const [index, record] of entries.entries()) {
    const path = `$.entries[${index}]`;
    if (!isJournalEntry(record) && !isJournalOperation(record)) {
      throw new JournalReplayError("INVALID_FORMAT", path, "Invalid accepted command or operation record");
    }
    if (record.seq !== index + 1) {
      throw new JournalReplayError("INVALID_SEQUENCE", `${path}.seq`, `Expected sequence ${index + 1}`);
    }
    if (record.integrity.parentDigest !== parent) {
      throw new JournalReplayError("DIGEST_MISMATCH", `${path}.integrity.parentDigest`, "Broken parent digest link");
    }
    if (record.integrity.currentDigest !== computeJournalRecordDigest(record, parent)) {
      throw new JournalReplayError("DIGEST_MISMATCH", `${path}.integrity.currentDigest`, "Record digest does not match its contents");
    }
    parent = record.integrity.currentDigest;
  }
  if (!isJournalEntries(entries, header.seats)) {
    throw new JournalReplayError("INVALID_SEQUENCE", "$.entries", "Invalid actors, versions or duplicate command history");
  }
  const last = entries.at(-1);
  const lastVersion = last ? last.kind === "entry" ? last.appliedStateVersion : last.stateVersion : 0;
  if (head.stateVersion > lastVersion || (last && (head.eventSeq > last.eventSeq || head.roomVersion > last.roomVersion))) {
    throw new JournalReplayError("TRUNCATED_JOURNAL", "$.entries", "Journal body ends before its protected head");
  }
  if (head.parentJournalDigest !== integrity.parentDigest || head.journalDigest !== integrity.currentDigest ||
      integrity.currentDigest !== computeJournalDigest(value as unknown as Journal)) {
    throw new JournalReplayError("DIGEST_MISMATCH", "$.integrity", "Journal digest does not match its head and contents");
  }
  if (!isJournal(value)) {
    throw new JournalReplayError("INVALID_FORMAT", "$", "Journal does not match format v1 or its final head");
  }
  return value;
}
