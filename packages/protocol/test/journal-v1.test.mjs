import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  JOURNAL_FORMAT,
  JOURNAL_FORMAT_VERSION,
  JOURNAL_RULESET_VERSION,
  canonicalJournalJson,
  computeJournalDigest,
  computeJournalHeaderDigest,
  computeJournalRecordDigest,
  createJournalRecordIntegrity,
  isJournal,
  isJournalEntries,
  isJournalEntry,
  isJournalHead,
  isJournalHeader,
  isJournalIntegrity,
  isJournalOperation,
  parseJournalJsonl,
  serializeJournalJsonl,
  validateJournal,
  verifyJournalDigestChain
} from "../dist/index.js";

const digest = "a".repeat(64);
const otherDigest = "b".repeat(64);

function makeHeader() {
  return {
    format: JOURNAL_FORMAT,
    formatVersion: JOURNAL_FORMAT_VERSION,
    engineVersion: "0.1.0+abc1234",
    rulesetVersion: JOURNAL_RULESET_VERSION,
    matchId: "match-1",
    roomId: "room-1",
    catalogDigest: digest,
    rosterDigest: digest,
    trustedDeckDigest: digest,
    seed: "match-seed",
    seats: [
      { playerId: "player-1", name: "Alice" },
      { playerId: "player-2", name: "Bob" }
    ],
    createdAt: "2026-10-15T12:00:00.000Z",
    creation: {
      entropy: [{ kind: "random", bound: 2, value: 1 }, { kind: "uid", value: "setup-uid" }],
      deterministicSeed: "match-seed",
      uidSeed: "uid-seed",
      creator: "server-1"
    }
  };
}

function makeEntry(overrides = {}) {
  return {
    kind: "entry",
    seq: 1,
    playerId: "player-1",
    actor: "player-1",
    requestId: "request-1",
    commandId: "command-1",
    command: { type: "pass" },
    payload: { type: "pass" },
    acceptedAt: "2026-10-15T12:00:01.000Z",
    expectedStateVersion: 0,
    expectedRoomVersion: 8,
    appliedStateVersion: 1,
    roomVersion: 9,
    eventSeq: 3,
    result: { accepted: true, appliedStateVersion: 1 },
    publicReceipt: { type: "command-result", commandId: "command-1", appliedVersion: 1 },
    duplicate: false,
    rejection: null,
    entropyConsumed: [{ kind: "random", bound: 10, value: 3 }, { kind: "uid", value: "unit-1" }],
    projectionDigestByViewer: { "player-1": digest, "player-2": otherDigest },
    ...overrides
  };
}

function makeOperation(overrides = {}) {
  return {
    kind: "operation",
    seq: 2,
    operationId: "operation-1",
    taskId: "task-1",
    phase: "resolve-effect",
    stateVersion: 2,
    eventSeq: 4,
    roomVersion: 9,
    sourceClosureEvidence: [{ sourceUID: "unit-1", zoneEpoch: 2, status: "resolved", proofId: "proof-1" }],
    costCensus: { sources: [{ uid: "rune-1", carrier: "object", status: "live" }], revision: 1 },
    paymentPlan: { energy: 1, sources: ["rune-1"] },
    paymentReceipt: { spent: ["rune-1"], transactionId: "payment-1" },
    effectIRDigest: digest,
    primitiveReceipts: [{ opcode: "create-token", status: "applied", proofId: "primitive-1" }],
    tokenBirths: [{ uid: "token-1", sourceUID: "unit-1", zoneEpoch: 0 }],
    tokenRetirements: [{ uid: "token-0", reason: "leave-play" }],
    zoneTransitions: [{ uid: "unit-1", from: { kind: "hand" }, to: { kind: "base" } }],
    pendingReason: null,
    entropyConsumed: [{ kind: "uid", value: "token-1" }],
    ...overrides
  };
}

function sealRecords(header, inputs) {
  let parentDigest = computeJournalHeaderDigest(header);
  return inputs.map(input => {
    const { integrity: _integrity, ...body } = input;
    const integrity = createJournalRecordIntegrity(body, parentDigest);
    parentDigest = integrity.currentDigest;
    return { ...body, integrity };
  });
}

function makeJournal(inputs, header = makeHeader()) {
  const entries = sealRecords(header, inputs ?? [
    makeEntry(),
    makeOperation(),
    makeEntry({
      seq: 3,
      playerId: "player-2",
      actor: "player-2",
      requestId: "request-2",
      commandId: "command-2",
      command: { type: "concede" },
      payload: { type: "concede" },
      expectedStateVersion: 2,
      expectedRoomVersion: 9,
      appliedStateVersion: 3,
      roomVersion: 10,
      eventSeq: 5,
      result: { accepted: true, appliedStateVersion: 3 },
      publicReceipt: { type: "command-result", commandId: "command-2", appliedVersion: 3 },
      entropyConsumed: []
    })
  ]);
  const last = entries.at(-1);
  const journal = {
    header,
    head: {
      stateVersion: last ? (last.kind === "entry" ? last.appliedStateVersion : last.stateVersion) : 0,
      eventSeq: last?.eventSeq ?? 0,
      roomVersion: last?.roomVersion ?? 8,
      parentJournalDigest: null,
      journalDigest: digest,
      stateDigest: digest,
      privateStateDigest: otherDigest
    },
    entries,
    integrity: {
      parentDigest: null,
      currentDigest: digest,
      revision: 0,
      nonce: "nonce-0",
      protectedHeadReference: { revision: 0, nonce: "nonce-0" }
    }
  };
  const currentDigest = computeJournalDigest(journal);
  journal.head.journalDigest = currentDigest;
  journal.integrity.currentDigest = currentDigest;
  return journal;
}

function withDuplicate(journal = makeJournal(), overrides = {}) {
  const original = journal.entries[0];
  const duplicate = {
    ...original,
    seq: journal.entries.length + 1,
    requestId: "request-retry",
    duplicate: true,
    appliedStateVersion: journal.head.stateVersion,
    roomVersion: journal.head.roomVersion,
    eventSeq: journal.head.eventSeq,
    entropyConsumed: [],
    ...overrides
  };
  return sealRecords(journal.header, [...journal.entries, duplicate]);
}

test("journal v1 validates every extended contract section", () => {
  const journal = makeJournal();
  assert.equal(isJournalHeader(journal.header), true);
  assert.equal(isJournalHead(journal.head), true);
  assert.equal(isJournalIntegrity(journal.integrity), true);
  assert.equal(isJournalEntry(journal.entries[0]), true);
  assert.equal(isJournalOperation(journal.entries[1]), true);
  assert.equal(isJournalEntries(journal.entries, journal.header.seats), true);
  assert.equal(isJournal(journal), true);
  assert.equal(validateJournal(journal), true);
});

for (const [section, guard] of [
  ["header", isJournalHeader],
  ["head", isJournalHead],
  ["integrity", isJournalIntegrity],
  ["entry", isJournalEntry],
  ["operation", isJournalOperation]
]) {
  test(`journal v1 rejects every missing or unknown ${section} field`, () => {
    const journal = makeJournal();
    const value = section === "entry" ? journal.entries[0]
      : section === "operation" ? journal.entries[1] : journal[section];
    for (const key of Object.keys(value)) {
      const candidate = structuredClone(value);
      delete candidate[key];
      assert.equal(guard(candidate), false, `missing ${section}.${key}`);
    }
    assert.equal(guard({ ...value, unexpected: true }), false);
  });
}

test("journal v1 rejects missing creation, seat, entropy, and protected head fields", () => {
  for (const key of Object.keys(makeHeader().creation)) {
    const header = makeHeader();
    delete header.creation[key];
    assert.equal(isJournalHeader(header), false, key);
  }
  const journal = makeJournal();
  assert.equal(isJournalHeader({ ...journal.header, seats: [{ playerId: "player-1" }] }), false);
  for (const key of ["revision", "nonce"]) {
    const integrity = structuredClone(journal.integrity);
    delete integrity.protectedHeadReference[key];
    assert.equal(isJournalIntegrity(integrity), false);
  }
});

test("journal v1 rejects incompatible format, schema, and ruleset versions", () => {
  for (const overrides of [{ format: "other" }, { formatVersion: 2 }, { formatVersion: "1" }, { rulesetVersion: "core-1.4" }]) {
    assert.equal(isJournalHeader({ ...makeHeader(), ...overrides }), false);
  }
});

test("journal v1 permits a different engine build for replay mismatch handling", () => {
  assert.equal(isJournal(makeJournal(undefined, { ...makeHeader(), engineVersion: "future-engine+1234567" })), true);
});

test("journal v1 rejects empty, duplicate, or malformed seats", () => {
  const header = makeHeader();
  for (const seats of [[], [header.seats[0], header.seats[0]], [{ playerId: "", name: "Alice" }]]) {
    assert.equal(isJournalHeader({ ...header, seats }), false);
  }
});

test("journal v1 rejects command actors outside the roster or different from playerId", () => {
  const journal = makeJournal();
  journal.entries[0].actor = "player-2";
  assert.equal(isJournalEntry(journal.entries[0]), false);
  journal.entries[0].actor = "outsider";
  journal.entries[0].playerId = "outsider";
  assert.equal(isJournalEntries(journal.entries, journal.header.seats), false);
});

test("journal v1 rejects conflicting deterministic seed aliases", () => {
  const header = makeHeader();
  header.creation.deterministicSeed = "another-seed";
  assert.equal(isJournalHeader(header), false);
});

test("journal v1 validates random bounds, values, and UID transcript entries", () => {
  for (const entropy of [
    [{ kind: "random", bound: 0, value: 0 }],
    [{ kind: "random", bound: 2, value: 2 }],
    [{ kind: "random", bound: 2, value: -1 }],
    [{ kind: "random", bound: 2.5, value: 1 }],
    [{ kind: "random", bound: 2, value: 0.5 }],
    [{ kind: "random", value: 1 }],
    [{ kind: "uid", value: "" }],
    [{ kind: "unknown", value: "uid-1" }]
  ]) {
    const journal = makeJournal();
    journal.header.creation.entropy = entropy;
    journal.entries[0].entropyConsumed = entropy;
    journal.entries[1].entropyConsumed = entropy;
    assert.equal(isJournalHeader(journal.header), false);
    assert.equal(isJournalEntry(journal.entries[0]), false);
    assert.equal(isJournalOperation(journal.entries[1]), false);
  }
});

for (const seq of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
  test(`journal v1 rejects invalid seq ${seq}`, () => {
    const entry = makeJournal().entries[0];
    assert.equal(isJournalEntry({ ...entry, seq }), false);
  });
}

test("journal v1 requires a single contiguous sequence across command and operation records", () => {
  for (const [index, seq] of [[0, 2], [1, 3], [2, 2], [2, 4]]) {
    const journal = makeJournal();
    journal.entries[index].seq = seq;
    assert.equal(isJournalEntries(journal.entries), false);
  }
});

test("journal v1 accepts a marked duplicate without advancing versions after later commands", () => {
  const journal = makeJournal();
  journal.entries = withDuplicate(journal);
  const currentDigest = computeJournalDigest(journal);
  journal.head.journalDigest = currentDigest;
  journal.integrity.currentDigest = currentDigest;
  assert.equal(isJournal(journal), true);
  assert.deepEqual(journal.entries.at(-1).result, journal.entries[0].result);
  assert.equal(journal.entries.at(-1).appliedStateVersion, 3);
});

test("journal v1 accepts an immediate duplicate and the next new command", () => {
  const journal = makeJournal([makeEntry()]);
  const inputs = withDuplicate(journal);
  inputs.push(makeEntry({
    seq: 3, commandId: "command-2", requestId: "request-2", expectedStateVersion: 1,
    expectedRoomVersion: 9, appliedStateVersion: 2, roomVersion: 10, eventSeq: 4
  }));
  assert.equal(isJournal(makeJournal(inputs)), true);
});

test("journal v1 rejects an unmarked duplicate commandId", () => {
  const journal = makeJournal();
  const entries = withDuplicate(journal, { duplicate: false, expectedStateVersion: 3, expectedRoomVersion: 10, appliedStateVersion: 4 });
  assert.equal(isJournalEntries(entries), false);
});

test("journal v1 rejects duplicate flags without an original command", () => {
  const journal = makeJournal();
  journal.entries[0].duplicate = true;
  assert.equal(isJournalEntries(journal.entries), false);
  assert.equal(isJournalEntries(withDuplicate(makeJournal(), { commandId: "unknown-command" })), false);
});

for (const [label, overrides] of [
  ["state advancement", { appliedStateVersion: 4 }],
  ["state rewind", { appliedStateVersion: 1 }],
  ["room advancement", { roomVersion: 11 }],
  ["event advancement", { eventSeq: 6 }],
  ["entropy consumption", { entropyConsumed: [{ kind: "uid", value: "duplicate-uid" }] }],
  ["different actor", { actor: "player-2", playerId: "player-2" }],
  ["different payload", { command: { type: "concede" }, payload: { type: "concede" } }],
  ["different expected state version", { expectedStateVersion: 3 }],
  ["different expected room version", { expectedRoomVersion: 10 }],
  ["different result", { result: { accepted: true, appliedStateVersion: 3 } }],
  ["different public receipt", { publicReceipt: { type: "command-result", appliedVersion: 3 } }]
]) {
  test(`journal v1 rejects duplicate ${label}`, () => {
    assert.equal(isJournalEntries(withDuplicate(makeJournal(), overrides)), false);
  });
}

test("journal v1 requires globally unique original command ids across actors", () => {
  const journal = makeJournal();
  journal.entries[2].commandId = journal.entries[0].commandId;
  assert.equal(isJournalEntries(journal.entries), false);
});

test("journal v1 rejects nonmonotonic or stale expected and applied command versions", () => {
  for (const overrides of [
    { expectedStateVersion: 1 }, { expectedStateVersion: 3 }, { appliedStateVersion: 1 },
    { appliedStateVersion: 2 }, { expectedRoomVersion: 8 }, { expectedRoomVersion: 10 }, { roomVersion: 8 }, { eventSeq: 3 }
  ]) {
    const journal = makeJournal();
    Object.assign(journal.entries[2], overrides);
    assert.equal(isJournalEntries(journal.entries), false, JSON.stringify(overrides));
  }
});

test("journal v1 rejects malformed version counters", () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "1"]) {
    for (const key of ["expectedStateVersion", "expectedRoomVersion", "appliedStateVersion", "roomVersion", "eventSeq"]) {
      assert.equal(isJournalEntry({ ...makeJournal().entries[0], [key]: value }), false, key);
    }
  }
});

test("journal v1 rejects nonmonotonic operation versions and duplicate operation ids", () => {
  for (const overrides of [{ stateVersion: 0 }, { eventSeq: 2 }, { roomVersion: 8 }]) {
    const journal = makeJournal();
    Object.assign(journal.entries[1], overrides);
    assert.equal(isJournalEntries(journal.entries), false);
  }
  const journal = makeJournal();
  journal.entries.push({ ...journal.entries[1], seq: 4, stateVersion: 3, eventSeq: 5, roomVersion: 10 });
  assert.equal(isJournalEntries(journal.entries), false);
});

test("journal v1 never writes rejected commands to the body", () => {
  for (const overrides of [
    { rejection: "stale-version" }, { rejection: { code: "not-authorized" } },
    { result: { accepted: false } }, { result: { rejected: true } },
    { result: { status: "rejected" } }, { result: { error: "illegal-command" } },
    { publicReceipt: { rejection: "invalid-command" } }, { publicReceipt: { status: "error" } }
  ]) {
    const journal = makeJournal();
    Object.assign(journal.entries[0], overrides);
    assert.equal(isJournalEntry(journal.entries[0]), false);
    assert.equal(isJournal(journal), false);
    assert.throws(() => serializeJournalJsonl(journal), TypeError);
  }
});

test("journal v1 rejects existing server error and blocked acknowledgement shapes", () => {
  for (const receipt of [
    { type: "error", requestId: "request-1", code: "command-rejected", message: "Illegal command" },
    { type: "blocked", requestId: "request-1", commandId: "command-1", pending: true, message: "Source not closed" },
    { ok: false, code: "invalid-command" }
  ]) {
    for (const field of ["result", "publicReceipt"]) {
      const entry = makeJournal().entries[0];
      entry[field] = receipt;
      assert.equal(isJournalEntry(entry), false, field);
    }
  }
});

test("journal v1 preserves UID transcript mode without a manufactured UID seed", () => {
  const header = makeHeader();
  header.creation.uidSeed = null;
  const journal = makeJournal(undefined, header);
  assert.equal(isJournal(journal), true);
  assert.deepEqual(parseJournalJsonl(serializeJournalJsonl(journal)), journal);
});

test("journal v1 validates command and payload identity without accepting unknown commands", () => {
  const entry = makeJournal().entries[0];
  assert.equal(isJournalEntry({ ...entry, payload: { type: "concede" } }), false);
  for (const command of [{ type: "unknown" }, { type: "pass", rejected: true }, { type: "play-card", instanceId: "card-1" }]) {
    assert.equal(isJournalEntry({ ...entry, command, payload: command }), false);
  }
});

test("journal v1 accepts each current FullProductCommand and validates targets", () => {
  const entry = makeJournal().entries[0];
  for (const command of [
    { type: "pass" }, { type: "concede" },
    { type: "play-card", instanceId: "card-1", targets: [{ targetKind: "object", targetId: "unit-1" }] },
    { type: "respond-to-prompt", promptId: "prompt-1", optionId: "option-1", targets: [{ targetKind: "player", targetId: "player-2" }] }
  ]) {
    assert.equal(isJournalEntry({ ...entry, command, payload: command }), true);
  }
  const target = { targetKind: "object", targetId: "unit-1" };
  for (const targets of [[target, target], [{ targetKind: "unknown", targetId: "unit-1" }], [{ targetKind: "object", targetId: "" }]]) {
    const command = { type: "play-card", instanceId: "card-1", targets };
    assert.equal(isJournalEntry({ ...entry, command, payload: command }), false);
  }
});

test("journal v1 preserves pending operations without manufacturing closure or payment proofs", () => {
  const operation = makeOperation({
    seq: 1, stateVersion: 0, roomVersion: 8, eventSeq: 0,
    sourceClosureEvidence: [{ status: "pending", requirement: "unknown-source" }],
    costCensus: null, paymentPlan: null, paymentReceipt: null, effectIRDigest: null,
    primitiveReceipts: [], tokenBirths: [], tokenRetirements: [], zoneTransitions: [],
    pendingReason: "judge-required: unsupported source", entropyConsumed: []
  });
  const journal = makeJournal([operation]);
  assert.equal(isJournal(journal), true);
  assert.deepEqual(parseJournalJsonl(serializeJournalJsonl(journal)), journal);
});

test("journal v1 rejects malformed operation proof containers and pending reasons", () => {
  const operation = makeJournal().entries[1];
  for (const overrides of [
    { sourceClosureEvidence: [null] }, { costCensus: [] }, { paymentPlan: "paid" },
    { paymentReceipt: false }, { effectIRDigest: "invalid" }, { primitiveReceipts: ["no-op"] },
    { tokenBirths: [1] }, { tokenRetirements: [false] }, { zoneTransitions: [null] }, { pendingReason: "" }
  ]) {
    assert.equal(isJournalOperation({ ...operation, ...overrides }), false);
  }
});

test("journal v1 validates projection and integrity digests", () => {
  const journal = makeJournal();
  assert.equal(isJournalEntry({ ...journal.entries[0], projectionDigestByViewer: { "player-1": "invalid" } }), false);
  assert.equal(isJournalEntry({ ...journal.entries[0], integrity: { parentDigest: null, currentDigest: digest } }), false);
  assert.equal(isJournalHead({ ...journal.head, stateDigest: "invalid" }), false);
  assert.equal(isJournalIntegrity({ ...journal.integrity, currentDigest: "SHA256" }), false);
});

test("journal v1 validates CAS lineage and protected head coordinates", () => {
  const journal = makeJournal();
  assert.equal(isJournalIntegrity({ ...journal.integrity, revision: 1 }), false);
  assert.equal(isJournalIntegrity({ ...journal.integrity, parentDigest: digest }), false);
  assert.equal(isJournalIntegrity({ ...journal.integrity, protectedHeadReference: { revision: 0, nonce: "foreign-nonce" } }), false);
  journal.head.parentJournalDigest = digest;
  journal.integrity.parentDigest = digest;
  journal.integrity.revision = 1;
  journal.integrity.nonce = "nonce-1";
  journal.integrity.protectedHeadReference = { revision: 1, nonce: "nonce-1" };
  journal.head.journalDigest = computeJournalDigest(journal);
  journal.integrity.currentDigest = journal.head.journalDigest;
  assert.equal(isJournal(journal), true);
});

test("journal v1 rejects head counters that differ from the last record even after rehashing", () => {
  for (const key of ["stateVersion", "eventSeq", "roomVersion"]) {
    const journal = makeJournal();
    journal.head[key] += 1;
    journal.head.journalDigest = computeJournalDigest(journal);
    journal.integrity.currentDigest = journal.head.journalDigest;
    assert.equal(isJournal(journal), false, key);
  }
});

test("journal v1 rejects divergent journal and integrity parent/current digest aliases", () => {
  const journal = makeJournal();
  assert.equal(isJournal({ ...journal, head: { ...journal.head, parentJournalDigest: digest } }), false);
  assert.equal(isJournal({ ...journal, head: { ...journal.head, journalDigest: otherDigest } }), false);
});

test("journal v1 canonical JSON sorts nested and numeric object keys while preserving array order", () => {
  const value = { z: [{ b: 2, a: 1 }, 0], a: { "2": true, "10": false } };
  assert.equal(canonicalJournalJson(value), '{"a":{"10":false,"2":true},"z":[{"a":1,"b":2},0]}');
  assert.equal(canonicalJournalJson(value), canonicalJournalJson({ a: { "10": false, "2": true }, z: [{ a: 1, b: 2 }, 0] }));
  assert.notEqual(canonicalJournalJson([1, 2]), canonicalJournalJson([2, 1]));
});

test("journal v1 digests match independent Node SHA-256 over canonical input", () => {
  const journal = makeJournal();
  const expectedHeader = createHash("sha256").update(canonicalJournalJson(journal.header), "utf8").digest("hex");
  assert.equal(computeJournalHeaderDigest(journal.header), expectedHeader);
  const { integrity: _integrity, ...record } = journal.entries[0];
  const expectedEntry = createHash("sha256").update(canonicalJournalJson({ parentDigest: expectedHeader, record }), "utf8").digest("hex");
  assert.equal(computeJournalRecordDigest(record, expectedHeader), expectedEntry);
  assert.equal(journal.entries[0].integrity.currentDigest, expectedEntry);
  const { journalDigest: _journalDigest, ...head } = journal.head;
  const { currentDigest: _currentDigest, ...integrity } = journal.integrity;
  const expectedJournal = createHash("sha256").update(canonicalJournalJson({
    header: journal.header, head, entries: journal.entries, integrity
  }), "utf8").digest("hex");
  assert.equal(computeJournalDigest(journal), expectedJournal);
  assert.equal(journal.integrity.currentDigest, expectedJournal);
});

test("journal v1 digest computation ignores only the self-referential digest fields", () => {
  const journal = makeJournal();
  const expected = computeJournalDigest(journal);
  journal.head.journalDigest = otherDigest;
  journal.integrity.currentDigest = otherDigest;
  assert.equal(computeJournalDigest(journal), expected);
  journal.head.privateStateDigest = digest;
  assert.notEqual(computeJournalDigest(journal), expected);
});

test("journal v1 digest and serialization are independent of property insertion order", () => {
  const journal = makeJournal();
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
  const reversed = reverseKeys(journal);
  assert.equal(isJournal(reversed), true);
  assert.equal(computeJournalDigest(journal), computeJournalDigest(reversed));
  assert.equal(serializeJournalJsonl(journal), serializeJournalJsonl(reversed));
});

test("journal v1 detects tampering with every command and operation entry", () => {
  const original = makeJournal();
  assert.equal(verifyJournalDigestChain(original.header, original.entries), true);
  for (let index = 0; index < original.entries.length; index += 1) {
    const journal = structuredClone(original);
    const entry = journal.entries[index];
    if (entry.kind === "entry") entry.acceptedAt = "2026-10-15T13:00:00.000Z";
    else entry.sourceClosureEvidence[0].proofId = "tampered-proof";
    assert.equal(isJournalEntries(journal.entries), true);
    assert.equal(verifyJournalDigestChain(journal.header, journal.entries), false);
    assert.equal(isJournal(journal), false);
  }
});

test("journal v1 detects altered header context and creation entropy", () => {
  for (const change of [
    journal => { journal.header.matchId = "another-match"; },
    journal => { journal.header.rosterDigest = otherDigest; },
    journal => { journal.header.creation.entropy[0].value = 0; },
    journal => { journal.header.creation.uidSeed = "another-uid-seed"; }
  ]) {
    const journal = makeJournal();
    change(journal);
    assert.equal(verifyJournalDigestChain(journal.header, journal.entries), false);
    assert.equal(isJournal(journal), false);
  }
});

test("journal v1 detects changed, spliced, reordered, or truncated digest chains", () => {
  const journal = makeJournal();
  for (const entries of [
    [{ ...journal.entries[0], integrity: { parentDigest: otherDigest, currentDigest: digest } }, ...journal.entries.slice(1)],
    [journal.entries[1], journal.entries[0], journal.entries[2]],
    journal.entries.slice(0, -1),
    [...journal.entries, journal.entries[0]]
  ]) {
    assert.equal(isJournal({ ...journal, entries }), false);
  }
});

test("journal v1 detects a rehashed middle entry with an unchanged successor", () => {
  const journal = makeJournal();
  journal.entries[1].pendingReason = "tampered";
  journal.entries[1].integrity.currentDigest = computeJournalRecordDigest(journal.entries[1], journal.entries[1].integrity.parentDigest);
  assert.equal(verifyJournalDigestChain(journal.header, journal.entries), false);
});

test("journal v1 protects final head metadata, CAS nonce, and rehashed last entry", () => {
  const original = makeJournal();
  for (const change of [
    journal => { journal.head.stateDigest = otherDigest; },
    journal => { journal.head.privateStateDigest = digest; },
    journal => {
      journal.integrity.nonce = "nonce-other";
      journal.integrity.protectedHeadReference.nonce = "nonce-other";
    },
    journal => {
      const last = journal.entries.at(-1);
      last.acceptedAt = "2026-10-15T14:00:00.000Z";
      last.integrity.currentDigest = computeJournalRecordDigest(last, last.integrity.parentDigest);
    }
  ]) {
    const journal = structuredClone(original);
    change(journal);
    assert.equal(verifyJournalDigestChain(journal.header, journal.entries), true);
    assert.equal(isJournal(journal), false);
  }
});

test("journal v1 canonical JSON preserves null costs and prototype-named evidence keys", () => {
  const evidence = JSON.parse('{"__proto__":{"power":null},"constructor":{"energy":null}}');
  assert.equal(canonicalJournalJson(evidence), '{"__proto__":{"power":null},"constructor":{"energy":null}}');
  const journal = makeJournal([makeOperation({ seq: 1, sourceClosureEvidence: [evidence] })]);
  const parsed = parseJournalJsonl(serializeJournalJsonl(journal));
  assert.deepEqual(parsed.entries[0].sourceClosureEvidence, [evidence]);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.entries[0].sourceClosureEvidence[0], "__proto__"), true);
});

test("journal v1 rejects non-JSON values instead of dropping or coercing evidence", () => {
  const sparse = Array(2);
  const cyclic = {};
  cyclic.self = cyclic;
  for (const value of [undefined, NaN, Infinity, 1n, () => 1, Symbol("value"), new Date(), new Map(), sparse, cyclic, { field: undefined }]) {
    assert.throws(() => canonicalJournalJson(value), TypeError);
    const journal = makeJournal();
    journal.entries[0].result = { value };
    assert.equal(isJournal(journal), false);
  }
});

test("journal v1 rejects accessors and toJSON without invoking them", () => {
  let calls = 0;
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { calls += 1; return 1; } });
  const arrayGetter = [1];
  Object.defineProperty(arrayGetter, "0", { enumerable: true, get() { calls += 1; return 1; } });
  const toJSON = { toJSON() { calls += 1; return "hidden"; } };
  for (const value of [getter, arrayGetter, toJSON]) {
    assert.throws(() => canonicalJournalJson(value), TypeError);
    const journal = makeJournal();
    journal.entries[1].paymentReceipt = value;
    assert.equal(isJournal(journal), false);
  }
  assert.equal(calls, 0);
});

test("journal v1 rejects hidden properties, symbol keys, and extra array properties", () => {
  for (const value of [
    Object.defineProperty({}, "hidden", { value: true }),
    { [Symbol("hidden")]: true },
    Object.assign([1], { extra: 2 })
  ]) assert.throws(() => canonicalJournalJson(value), TypeError);
});

test("journal v1 validates null-prototype JSON objects without altering their keys", () => {
  const journal = makeJournal();
  const plain = Object.assign(Object.create(null), journal.header);
  assert.equal(isJournalHeader(plain), true);
  assert.equal(computeJournalHeaderDigest(plain), computeJournalHeaderDigest(journal.header));
});

test("journal v1 JSONL writes one header followed by tagged command and operation records", () => {
  const journal = makeJournal();
  const serialized = serializeJournalJsonl(journal);
  const lines = serialized.trimEnd().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.length, journal.entries.length + 1);
  assert.deepEqual(lines.map(line => line.kind), ["header", "entry", "operation", "entry"]);
  assert.deepEqual(lines[0].head, journal.head);
  assert.deepEqual(lines[0].integrity, journal.integrity);
  assert.deepEqual(parseJournalJsonl(serialized), journal);
});

test("journal v1 JSONL preserves complete evidence, entropy, receipts, and duplicate records", () => {
  const journal = makeJournal();
  const retried = makeJournal(withDuplicate(journal));
  assert.deepEqual(parseJournalJsonl(serializeJournalJsonl(retried)), retried);
});

test("journal v1 JSONL accepts CRLF and an omitted final newline", () => {
  const journal = makeJournal();
  const serialized = serializeJournalJsonl(journal);
  assert.deepEqual(parseJournalJsonl(serialized.replaceAll("\n", "\r\n")), journal);
  assert.deepEqual(parseJournalJsonl(serialized.trimEnd()), journal);
});

test("journal v1 supports a header-only journal and protects its head", () => {
  const journal = makeJournal([]);
  assert.equal(isJournal(journal), true);
  assert.equal(verifyJournalDigestChain(journal.header, []), true);
  assert.equal(serializeJournalJsonl(journal).trimEnd().split("\n").length, 1);
  assert.deepEqual(parseJournalJsonl(serializeJournalJsonl(journal)), journal);
  journal.head.stateDigest = otherDigest;
  assert.equal(isJournal(journal), false);
});

test("journal v1 JSONL rejects malformed JSON with the failing line number", () => {
  const serialized = serializeJournalJsonl(makeJournal());
  assert.throws(() => parseJournalJsonl("{\n"), /line 1/u);
  assert.throws(() => parseJournalJsonl(`${serialized.split("\n")[0]}\n{\n`), /line 2/u);
});

test("journal v1 JSONL rejects blank lines, empty input, and non-string input", () => {
  const serialized = serializeJournalJsonl(makeJournal());
  for (const value of ["", "\n", " \n", `${serialized}\n`, serialized.replace("\n", "\n\n")]) {
    assert.throws(() => parseJournalJsonl(value), SyntaxError);
  }
  assert.throws(() => parseJournalJsonl(null), TypeError);
});

test("journal v1 JSONL rejects absent, repeated, misplaced, and unknown record kinds", () => {
  const serialized = serializeJournalJsonl(makeJournal());
  const lines = serialized.trimEnd().split("\n");
  const withoutKind = JSON.parse(lines[1]);
  delete withoutKind.kind;
  for (const value of [
    lines.slice(1).join("\n"),
    [lines[0], lines[0]].join("\n"),
    [lines[0], JSON.stringify(withoutKind)].join("\n"),
    [lines[0], JSON.stringify({ ...JSON.parse(lines[1]), kind: "rejection" })].join("\n")
  ]) assert.throws(() => parseJournalJsonl(value), TypeError);
});

test("journal v1 JSONL rejects invalid versions and tampered records on both read and write", () => {
  const journal = makeJournal();
  const serialized = serializeJournalJsonl(journal);
  assert.throws(() => parseJournalJsonl(serialized.replace('"formatVersion":1', '"formatVersion":2')), TypeError);
  assert.throws(() => parseJournalJsonl(serialized.replace('"proofId":"proof-1"', '"proofId":"tampered"')), TypeError);
  journal.entries[0].acceptedAt = "tampered";
  assert.throws(() => serializeJournalJsonl(journal), TypeError);
});

test("journal v1 guards reject primitive inputs and malformed digest helper inputs", () => {
  for (const guard of [isJournalHeader, isJournalHead, isJournalIntegrity, isJournalEntry, isJournalOperation, isJournalEntries, isJournal]) {
    for (const value of [null, undefined, 1, "journal", true]) assert.equal(guard(value), false);
  }
  assert.throws(() => computeJournalHeaderDigest({}), TypeError);
  assert.throws(() => computeJournalRecordDigest(makeEntry(), "bad-parent"), TypeError);
  assert.throws(() => computeJournalDigest({}), TypeError);
  assert.equal(verifyJournalDigestChain({}, []), false);
});
