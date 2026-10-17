import assert from "node:assert/strict";
import test from "node:test";
import { serializeJournalJsonl } from "../../../protocol/dist/journal-v1.js";
import { JournalReplayError, readJournal, replayJournal } from "../../dist/v2/index.js";
import { recordGame, replayOptions } from "./support.mjs";

const base = recordGame().journal;
const fixture = () => structuredClone(base);
function fails(input, code, path) {
  assert.throws(() => readJournal(input), error => error instanceof JournalReplayError && error.code === code &&
    (path === undefined || error.path === path));
}

test("header, parent link and current digest corruption are located precisely", () => {
  const header = fixture();
  header.header.seed = header.header.creation.deterministicSeed = "tampered-seed";
  fails(header, "DIGEST_MISMATCH", "$.entries[0].integrity.parentDigest");
  const parent = fixture();
  parent.entries[1].integrity.parentDigest = "f".repeat(64);
  fails(parent, "DIGEST_MISMATCH", "$.entries[1].integrity.parentDigest");
  const current = fixture();
  current.entries[0].result = { accepted: true, changed: true };
  fails(current, "DIGEST_MISMATCH", "$.entries[0].integrity.currentDigest");
});

test("head digests, CAS references and envelope checksum are validated", () => {
  const head = fixture();
  head.head.stateDigest = "f".repeat(64);
  fails(head, "DIGEST_MISMATCH", "$.integrity");
  const cas = fixture();
  cas.integrity.protectedHeadReference.nonce = "wrong-reference";
  fails(cas, "INVALID_FORMAT", "$.integrity");
  const outer = fixture();
  outer.integrity.currentDigest = outer.head.journalDigest = "f".repeat(64);
  fails(outer, "DIGEST_MISMATCH", "$.integrity");
});

test("missing or reordered records cannot pass as a complete replay", () => {
  const missing = fixture();
  missing.entries.splice(1, 1);
  fails(missing, "INVALID_SEQUENCE", "$.entries[1].seq");
  const reordered = fixture();
  [reordered.entries[0], reordered.entries[1]] = [reordered.entries[1], reordered.entries[0]];
  fails(reordered, "INVALID_SEQUENCE", "$.entries[0].seq");
  const tail = fixture();
  tail.entries.pop();
  fails(tail, "TRUNCATED_JOURNAL", "$.entries");
});

test("complete-line JSONL truncation is detected by the protected head", () => {
  const lines = serializeJournalJsonl(base).trimEnd().split("\n");
  fails(lines.slice(0, -1).join("\n") + "\n", "TRUNCATED_JOURNAL", "$.entries");
  fails(lines[0] + "\n", "TRUNCATED_JOURNAL", "$.entries");
});

test("partial JSON tail and corrupt JSON lines have explicit distinct errors", () => {
  const serialized = serializeJournalJsonl(base);
  fails(serialized.slice(0, -20), "TRUNCATED_JOURNAL", "$line[4]");
  const lines = serialized.trimEnd().split("\n");
  lines[1] = "not-json";
  fails(lines.join("\n") + "\n", "INVALID_JSON", "$line[2]");
  fails("", "TRUNCATED_JOURNAL", "$");
  fails('{"header":', "TRUNCATED_JOURNAL", "$line[1]");
});

test("missing envelope sections and invalid accepted commands are rejected", () => {
  const incomplete = fixture();
  delete incomplete.head;
  fails(incomplete, "TRUNCATED_JOURNAL", "$.head");
  const command = fixture();
  command.entries[0].command.type = command.entries[0].payload.type = "unknown-command";
  fails(command, "INVALID_FORMAT", "$.entries[0]");
  const rejected = fixture();
  rejected.entries[0].rejection = { reason: "illegal" };
  fails(rejected, "INVALID_FORMAT", "$.entries[0]");
});

test("non-data input is rejected without evaluating accessors", () => {
  let getterCalls = 0;
  const value = Object.defineProperty({}, "header", { enumerable: true, get() { getterCalls += 1; return base.header; } });
  fails(value, "INVALID_FORMAT", "$");
  assert.equal(getterCalls, 0);
  const cyclic = fixture();
  cyclic.loop = cyclic;
  fails(cyclic, "INVALID_FORMAT", "$");
});

test("engine version mismatch never disables journal integrity checks", () => {
  const journal = fixture();
  journal.entries[0].integrity.currentDigest = "f".repeat(64);
  assert.throws(() => replayJournal(journal, replayOptions("A", { engineVersion: "newer-engine" })),
    error => error instanceof JournalReplayError && error.code === "DIGEST_MISMATCH");
});
