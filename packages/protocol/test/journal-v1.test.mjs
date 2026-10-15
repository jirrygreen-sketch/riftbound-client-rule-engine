import assert from "node:assert/strict";
import test from "node:test";
import {
  JOURNAL_FORMAT,
  JOURNAL_FORMAT_VERSION,
  JOURNAL_RULESET_VERSION,
  isJournal,
  isJournalEntries,
  isJournalEntry,
  isJournalHeader,
  parseJournalJsonl,
  serializeJournalJsonl
} from "../dist/index.js";

const header = {
  format: JOURNAL_FORMAT,
  formatVersion: JOURNAL_FORMAT_VERSION,
  engineVersion: "0.1.0+abc1234",
  rulesetVersion: JOURNAL_RULESET_VERSION,
  catalogDigest: "sha256:catalog",
  seed: "match-seed",
  seats: [
    { playerId: "player-1", name: "Alice" },
    { playerId: "player-2", name: "Bob" }
  ],
  createdAt: "2026-10-15T12:00:00.000Z"
};

const entries = [
  {
    seq: 1,
    playerId: "player-1",
    commandId: "command-1",
    command: { type: "pass" },
    acceptedAt: "2026-10-15T12:00:01.000Z"
  },
  {
    seq: 2,
    playerId: "player-2",
    commandId: "command-2",
    command: { type: "concede" },
    acceptedAt: "2026-10-15T12:00:02.000Z"
  }
];

test("journal v1 validates the header, entries, and JSONL round trip", () => {
  assert.equal(isJournalHeader(header), true);
  assert.equal(isJournalEntry(entries[0]), true);
  assert.equal(isJournalEntries(entries, header.seats), true);
  assert.equal(isJournal({ header, entries }), true);

  const serialized = serializeJournalJsonl({ header, entries });
  assert.deepEqual(parseJournalJsonl(serialized), { header, entries });
  assert.equal(serializeJournalJsonl(header, entries), serialized);
});

test("journal v1 rejects missing fields and incompatible versions", () => {
  const { commandId: _commandId, ...missingCommandId } = entries[0];
  assert.equal(isJournalEntry(missingCommandId), false);
  assert.equal(isJournalHeader({ ...header, formatVersion: 2 }), false);
  assert.equal(isJournalHeader({ ...header, rulesetVersion: "core-1.4" }), false);
  assert.throws(() => parseJournalJsonl(JSON.stringify({ ...header, formatVersion: 2 })), {
    name: "TypeError"
  });
});

test("journal v1 requires contiguous sequence numbers", () => {
  const skipped = [{ ...entries[0] }, { ...entries[1], seq: 3 }];
  assert.equal(isJournalEntries(skipped, header.seats), false);
  assert.equal(isJournal({ header, entries: skipped }), false);
  assert.throws(() => serializeJournalJsonl({ header, entries: skipped }), {
    name: "TypeError"
  });
});

test("journal v1 requires unique command ids for idempotency", () => {
  const duplicate = [{ ...entries[0] }, { ...entries[1], commandId: entries[0].commandId }];
  assert.equal(isJournalEntries(duplicate, header.seats), false);
  assert.equal(isJournal({ header, entries: duplicate }), false);
  assert.throws(() => serializeJournalJsonl({ header, entries: duplicate }), {
    name: "TypeError"
  });
});
