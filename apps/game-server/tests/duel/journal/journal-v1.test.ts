import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, isJournal, parseJournalJsonl } from "@riftbound/protocol";
import {
  JOURNAL_ENGINE_VERSION,
  JournalReplayer,
  JournalWriter,
  digestJournalValue,
} from "../../../src/duel/runtime/journal/index.js";
import { loadCardCatalogRuntime } from "../../../src/card-catalog.js";
import { createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4 } from "../../../src/duel/command-journal-p4.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "../fixtures/setup-adapter-catalog.js";

const command = { type: "pass" as const };

function writer() {
  return new JournalWriter({
    header: {
      matchId: "match-1",
      roomId: "room-1",
      catalogDigest: digestJournalValue({ catalog: 1 }),
      seats: [{ playerId: "alice", name: "Alice" }, { playerId: "bob", name: "Bob" }],
      seed: "seed-1",
      creation: { entropy: [{ kind: "uid", value: "uid-1" }], uidSeed: "uid-1" },
    },
  });
}

describe("journal v1 runtime", () => {
  it("writes one digest-linked command and operation stream as canonical JSONL", () => {
    const journal = writer();
    journal.recordCommand({
      playerId: "alice", requestId: "request-1", commandId: "command-1", command,
      appliedStateVersion: 1, eventSeq: 1, result: { accepted: true },
      publicReceipt: { accepted: true }, projectionDigestByViewer: {
        alice: digestJournalValue({ viewer: "alice" }),
      },
    });
    journal.recordOperation({ operationId: "op-1", taskId: "task-1", phase: "main", pendingReason: "rules-pending" });
    const snapshot = journal.snapshot();
    expect(isJournal(snapshot)).toBe(true);
    expect(parseJournalJsonl(journal.serialize())).toEqual(snapshot);
    expect(snapshot.head.stateVersion).toBe(1);
    expect(snapshot.entries.map(entry => entry.kind)).toEqual(["entry", "operation"]);
  });

  it("reuses the original receipt for duplicate command ids and rejects conflicts", () => {
    const journal = writer();
    const first = journal.recordCommand({
      playerId: "alice", requestId: "request-1", commandId: "command-1", command,
      appliedStateVersion: 1, eventSeq: 1, result: { accepted: true, receipt: "r1" },
      publicReceipt: { accepted: true, receipt: "r1" },
    });
    const duplicate = journal.recordCommand({
      playerId: "alice", requestId: "request-1", commandId: "command-1", command,
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.result).toEqual(first.result);
    expect(duplicate.entropyConsumed).toEqual([]);
    const retry = journal.recordCommand({
      playerId: "alice", requestId: "request-2", commandId: "command-1", command,
    });
    expect(retry.duplicate).toBe(true);
    expect(retry.result).toEqual(first.result);
    expect(() => journal.recordCommand({
      playerId: "alice", requestId: "request-2", commandId: "command-1",
      command: { type: "concede" },
    })).toThrow(/commandId conflict/);
  });

  it("continues replay with an engine mismatch marker", () => {
    const journal = writer();
    journal.recordCommand({
      playerId: "alice", requestId: "request-1", commandId: "command-1", command,
      appliedStateVersion: 1, eventSeq: 1, result: { accepted: true },
    });
    const result = new JournalReplayer({ engineVersion: "engine-from-another-build", state: 0,
      applyCommand: state => state + 1 }).replay(journal.snapshot());
    expect(result.engineMismatch).toBe(true);
    expect(result.state).toBe(1);
    expect(result.appliedCommands).toBe(1);
    expect(JOURNAL_ENGINE_VERSION).toBeTruthy();
  });

  it("makes the P4 recorder expose the same protocol journal for replay", async () => {
    const catalog = await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog });
    const options = { catalog, matchId: "journal-p4-v1", randomIndex: () => 0,
      uidFactory: (() => { let value = 0; return () => `journal-p4-${++value}`; })(),
      roster: [{ playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
        { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission }] as const };
    const recorded = createDuelRecordedRuntimeP4(options);
    const setup = recorded.runtime.project(null).match;
    if (setup.stage !== "setup") throw new Error("setup required");
    const actor = setup.setup.currentMulliganOwner!;
    const packet = { type: "duel-command" as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: "journal-p4-request", commandId: "journal-p4-command", expectedVersion: setup.stateVersion,
      command: { type: "mulligan" as const, selectedUIDs: [] } };
    expect(recorded.runtime.dispatch(actor, packet).ack.ok).toBe(true);
    const archive = recorded.archive();
    expect(archive.journal && isJournal(archive.journal)).toBe(true);
    expect(archive.journal?.header.format).toBe("riftbound-journal");
    const replayed = createDuelReplayGateP4(options, digestDuelCommandArchiveP4(archive));
    const restored = replayDuelCommandArchiveP4(archive, replayed);
    expect(restored.runtime.project(null)).toEqual(recorded.runtime.project(null));
  });
});
