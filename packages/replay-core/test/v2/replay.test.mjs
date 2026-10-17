import assert from "node:assert/strict";
import test from "node:test";
import { serializeJournalJsonl } from "../../../protocol/dist/journal-v1.js";
import { JournalReplayError, readJournal, replayJournal } from "../../dist/v2/index.js";
import { ENGINE_VERSION, VIEWERS, makeSetup, recordGame, replayOptions, seal } from "./support.mjs";

function fails(action, code, path) {
  assert.throws(action, error => error instanceof JournalReplayError && error.code === code &&
    (path === undefined || error.path === path));
}

for (const seed of ["RIFT-345-seed-1", "RIFT-345-seed-2", "RIFT-345-seed-3"]) {
  test(`current engine replays every live headless-deck snapshot (${seed})`, () => {
    const { journal, liveSteps, match, setup } = recordGame({ seed });
    for (const [index, viewer] of VIEWERS.entries()) {
      const result = replayJournal(journal, replayOptions(viewer));
      assert.equal(result.engineMismatch, false);
      assert.equal(result.matchId, journal.header.matchId);
      assert.deepEqual(result.steps.map(step => step.projection), liveSteps.map(step => step.projections[index]));
      assert.deepEqual(result.steps.map(({ seq, kind, stateVersion, eventSeq }) => ({ seq, kind, stateVersion, eventSeq })),
        liveSteps.map(({ seq, kind, stateVersion, eventSeq }) => ({ seq, kind, stateVersion, eventSeq })));
      assert.equal(result.summary.winner, match.result().winner);
      assert.equal(result.summary.turnNumber, match.result().turnNumber);
      assert.deepEqual(result.summary.scores, { A: setup.kernel.player("A").score, B: setup.kernel.player("B").score });
      assert.equal(result.summary.appliedCommands, 3);
      assert.equal(result.summary.projectionDigest, result.steps.at(-1).projectionDigest);
    }
  });
}

test("JSON envelope and protocol JSONL replay to the same result without changing input", () => {
  const { journal } = recordGame();
  const before = structuredClone(journal);
  const expected = replayJournal(journal, replayOptions());
  assert.deepEqual(replayJournal(JSON.stringify(journal, null, 2), replayOptions()), expected);
  assert.deepEqual(replayJournal(serializeJournalJsonl(journal), replayOptions()), expected);
  assert.deepEqual(replayJournal(serializeJournalJsonl(journal).replaceAll("\n", "\r\n"), replayOptions()), expected);
  assert.deepEqual(journal, before);
});

test("duplicate commands return another snapshot without reapplying, and operations are audited", () => {
  const recorded = recordGame({ turns: 2, duplicate: true, operation: true });
  const result = replayJournal(recorded.journal, replayOptions());
  assert.equal(result.summary.appliedCommands, 3);
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.summary.operations, 1);
  const duplicate = result.steps.find(step => step.kind === "duplicate");
  const previous = result.steps[duplicate.seq - 1];
  assert.deepEqual(duplicate.projection, previous.projection);
  assert.deepEqual(result.steps.map(step => step.projection), recorded.liveSteps.map(step => step.projections[0]));
});

test("engineMismatch recomputes with current engine and ignores old byte comparisons", () => {
  const { journal, liveSteps, match } = recordGame();
  journal.header.engineVersion = "@riftbound/engine-core/older+build";
  for (const record of journal.entries) {
    record.eventSeq += 100;
    record.result = { accepted: true, winner: "untrusted-receipt-winner", privateState: "secret-receipt" };
    record.projectionDigestByViewer = { A: "f".repeat(64) };
  }
  journal.head.eventSeq += 100;
  seal(journal);
  const result = replayJournal(journal, replayOptions());
  assert.equal(result.engineMismatch, true);
  assert.equal(result.engineVersion, ENGINE_VERSION);
  assert.equal(result.recordedEngineVersion, journal.header.engineVersion);
  assert.equal(result.summary.winner, match.result().winner);
  assert.equal(result.summary.eventSeq, liveSteps.at(-1).eventSeq);
  assert.deepEqual(result.steps.map(step => step.projection), liveSteps.map(step => step.projections[0]));
  assert.equal(JSON.stringify(result).includes("secret-receipt"), false);
});

test("same engine rejects altered recomputed versions and projection digests", () => {
  const first = recordGame().journal;
  first.entries.at(-1).eventSeq += 1;
  first.head.eventSeq += 1;
  seal(first);
  fails(() => replayJournal(first, replayOptions()), "REPLAY_MISMATCH", "$.entries[2]");
  const second = recordGame().journal;
  second.entries[0].projectionDigestByViewer.A = "f".repeat(64);
  seal(second);
  fails(() => replayJournal(second, replayOptions()), "REPLAY_MISMATCH", "$.entries[0].projectionDigestByViewer");
});

test("invalid viewers and an out-of-turn accepted command are explicit failures", () => {
  const journal = recordGame().journal;
  fails(() => replayJournal(journal, replayOptions("other-seat")), "INVALID_VIEWER", "options.viewer");
  journal.entries[0].playerId = "B";
  journal.entries[0].actor = "B";
  seal(journal);
  fails(() => replayJournal(journal, replayOptions()), "COMMAND_REJECTED", "$.entries[0].command");
});

test("setup is recreated from the header seed and cannot rewrite validated commands", () => {
  const { journal } = recordGame();
  const expected = replayJournal(journal, replayOptions());
  const result = replayJournal(journal, replayOptions("A", {
    resolveSetup: header => {
      header.seed = "resolver-mutated-copy";
      const setup = makeSetup();
      return { ...setup, options: { ...setup.options, seed: "wrong-caller-seed", rulesetVersion: "core-1.4" } };
    },
  }));
  assert.deepEqual(result, expected);
  const broken = replayOptions("A", { resolveSetup: () => { throw new Error("Missing trusted catalog"); } });
  fails(() => replayJournal(journal, broken), "ENGINE_SETUP_FAILED", "$.header");
});

test("replays allocate detached snapshots and never mutate another replay or live match", () => {
  const { journal, setup } = recordGame();
  const before = setup.kernel.stateForTest();
  const first = replayJournal(journal, replayOptions());
  const second = replayJournal(journal, replayOptions());
  const finalHand = structuredClone(first.steps.at(-1).projection.players.A.hand);
  first.steps[0].projection.players.A.hand.cards[0].name = "local-change";
  assert.deepEqual(first.steps.at(-1).projection.players.A.hand, finalHand);
  assert.notEqual(second.steps[0].projection.players.A.hand.cards[0].name, "local-change");
  assert.deepEqual(setup.kernel.stateForTest(), before);
});

test("complete journal validation runs before trusted setup code", () => {
  const journal = recordGame().journal;
  journal.entries[0].integrity.currentDigest = "f".repeat(64);
  let setupCalls = 0;
  fails(() => replayJournal(journal, replayOptions("A", { resolveSetup: () => { setupCalls += 1; return makeSetup(); } })), "DIGEST_MISMATCH");
  assert.equal(setupCalls, 0);
});

test("readJournal returns a validated detached journal", () => {
  const journal = recordGame().journal;
  const read = readJournal(journal);
  assert.deepEqual(read, journal);
  read.entries[0].result.accepted = false;
  assert.equal(journal.entries[0].result.accepted, true);
});
