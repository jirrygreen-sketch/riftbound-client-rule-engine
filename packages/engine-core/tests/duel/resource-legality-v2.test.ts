import { describe, expect, it } from "vitest";
import {
  applyDuelResourceCommandV2,
  adoptAdmittedDuelPlayingSessionV2,
  inspectDuelResourceCommandV2,
  isDuelResourceCommandLegalV2,
} from "../../dist/duel/canonical-session-v2.js";
import {
  createDuelGoldTokenV2,
  inspectDuelNativeTokenHistoryV2,
  restoreDuelPlayingStateV2,
  type DuelTokenSourceAttestorV2,
} from "../../dist/duel/core-v2.js";
import { runDuelStartOfTurnV2 } from "../../dist/duel/turn-executor-v2.js";
import { oracle, playing } from "../../test/duel-phase-source-authority-v2.test.mjs";

function mainFixture() {
  const started = runDuelStartOfTurnV2(playing(), {
    sources: oracle(),
    fepr: () => ({ status: "none" }),
  });
  if (started.status !== "main") throw new Error(`expected Main, got ${started.status}`);
  return started.session;
}

const goldSourceOracle: DuelTokenSourceAttestorV2 = ({ match, request }) => ({
  ...request,
  matchId: match.matchId,
  dataVersion: match.dataVersion,
  catalogDigest: match.catalogDigest,
  sourceProofId: "test-resource-legality:gold-ready",
});

function restoredGoldFixture() {
  const session = mainFixture();
  const sourceUID = "alice-card-1";
  const base = session.match.resources.bases.find((item) => item.playerId === "alice");
  if (!base) throw new Error("Alice base is unavailable");
  const created = createDuelGoldTokenV2(session.match, {
    kind: "gold",
    tokenUID: "gold-ready",
    sourceEffectId: "effect:gold-ready",
    eventId: "event:gold-ready",
    sourceUID,
    sourceZoneEpoch: session.match.physicalCardsByUID[sourceUID]!.zoneEpoch,
    sourceMode: "current",
    effectControllerPlayerId: "alice",
    controllerPlayerId: "alice",
    locationId: base.locationId,
    readied: true,
  }, goldSourceOracle);
  const originalPhysicalCards = created.provenance.originalPhysicalCards.map((card) => ({ ...card }));
  const inventory = {
    matchId: created.matchId,
    dataVersion: created.dataVersion,
    catalogDigest: created.catalogDigest,
    rosterPlayerIds: created.roster.map((seat) => seat.playerId) as [string, string],
    originalPhysicalCards,
    submittedBattlefieldUIDs: [...created.provenance.submittedBattlefieldUIDs],
    expectedZoneEpochByUID: Object.fromEntries(originalPhysicalCards.map((card) => [
      card.uid, created.physicalCardsByUID[card.uid]?.zoneEpoch ?? 0,
    ])),
    retiredPhysicalUIDs: [...created.retiredPhysicalUIDs],
    goldOwnersByUID: { "gold-ready": "alice" },
    unitTokenOwnersByUID: {},
  };
  const restoreHistory = {
    matchId: created.matchId,
    dataVersion: created.dataVersion,
    catalogDigest: created.catalogDigest,
    rosterPlayerIds: inventory.rosterPlayerIds,
    originalPhysicalCards,
    submittedBattlefieldUIDs: inventory.submittedBattlefieldUIDs,
    retiredPhysicalUIDs: inventory.retiredPhysicalUIDs,
    initialZonesByUID: created.provenance.initialZonesByUID,
    transitions: created.provenance.transitions,
  };
  const restored = restoreDuelPlayingStateV2(
    structuredClone(created), inventory, restoreHistory,
    inspectDuelNativeTokenHistoryV2(created),
  );
  return { session: adoptAdmittedDuelPlayingSessionV2(restored), inventory };
}

describe("V2 resource legality query", () => {
  it("matches fresh Core command outcomes without changing the admitted session", () => {
    const session = mainFixture();
    const before = {
      match: session.match,
      resources: session.match.resources,
      receipts: session.receipts,
      tasks: session.requiredTasks,
      payments: session.priorityPayments,
    };
    const base = session.match.resources.bases.find((item) => item.playerId === "alice");
    expect(base).toBeDefined();
    for (const rune of base!.baseRunes) {
      for (const type of ["rune-energy", "rune-power"] as const) {
        const command = { type, uid: rune.uid } as const;
        const inspected = inspectDuelResourceCommandV2(
          session, "alice", session.match.stateVersion, command,
        );
        const fresh = applyDuelResourceCommandV2(session, "alice", {
          commandId: `fresh-${type}-${rune.uid}`,
          expectedVersion: session.match.stateVersion,
          command,
        });
        expect(inspected.status).toBe(fresh.outcome.status === "applied" ? "legal" : "blocked");
        if (fresh.outcome.status === "rejected" && inspected.status === "blocked")
          expect(inspected.reason).toBe(fresh.outcome.reason);
        expect(isDuelResourceCommandLegalV2(
          session, "alice", session.match.stateVersion, command,
        )).toBe(fresh.outcome.status === "applied");
      }
    }
    expect(session.match).toBe(before.match);
    expect(session.match.resources).toBe(before.resources);
    expect(session.receipts).toBe(before.receipts);
    expect(session.requiredTasks).toBe(before.tasks);
    expect(session.priorityPayments).toBe(before.payments);
  });

  it("keeps the same closed gates and rejects clones/accessors", () => {
    const session = playing();
    const uid = "fixture-rune";
    expect(inspectDuelResourceCommandV2(
      session, "alice", session.match.stateVersion, { type: "rune-energy", uid },
    )).toEqual({ status: "blocked", reason: "invalid-phase" });
    expect(inspectDuelResourceCommandV2(
      session, "outsider", session.match.stateVersion, { type: "rune-energy", uid },
    )).toEqual({ status: "blocked", reason: "unknown-actor" });
    expect(inspectDuelResourceCommandV2(
      session, "alice", session.match.stateVersion - 1, { type: "rune-energy", uid },
    )).toEqual({ status: "blocked", reason: "stale-version" });
    expect(() => inspectDuelResourceCommandV2(
      structuredClone(session), "alice", session.match.stateVersion,
      { type: "rune-energy", uid },
    )).toThrow(/unadmitted V2 session/);
    const accessor = Object.create(Object.prototype) as Record<string, unknown>;
    Object.defineProperties(accessor, {
      type: { get: () => "rune-energy", enumerable: true },
      uid: { value: uid, enumerable: true },
    });
    expect(inspectDuelResourceCommandV2(
      session, "alice", session.match.stateVersion, accessor,
    )).toEqual({ status: "blocked", reason: "invalid-command" });
  });

  it("rejects a mutated restored private inventory for Gold and both Rune queries", () => {
    const { session, inventory } = restoredGoldFixture();
    inventory.goldOwnersByUID["gold-ready"] = "bob";
    const before = {
      match: session.match,
      resources: session.match.resources,
      receipts: session.receipts,
      tasks: session.requiredTasks,
      payments: session.priorityPayments,
      bytes: JSON.stringify(session),
    };
    const rune = session.match.resources.bases.find((item) => item.playerId === "alice")!.baseRunes[0]!;
    const commands = [
      { type: "gold-power", uid: "gold-ready" },
      { type: "rune-energy", uid: rune.uid },
      { type: "rune-power", uid: rune.uid },
    ] as const;
    for (const [index, command] of commands.entries()) {
      const first = inspectDuelResourceCommandV2(session, "alice", session.match.stateVersion, command);
      const second = inspectDuelResourceCommandV2(session, "alice", session.match.stateVersion, command);
      expect(first).toEqual({ status: "blocked", reason: "resource-rejected" });
      expect(second).toEqual(first);
      const actual = applyDuelResourceCommandV2(session, "alice", {
        commandId: `mutated-inventory-${index}`,
        expectedVersion: session.match.stateVersion,
        command,
      });
      expect(actual.outcome).toEqual({ status: "rejected", reason: "resource-rejected" });
    }
    expect(session.match).toBe(before.match);
    expect(session.match.resources).toBe(before.resources);
    expect(session.receipts).toBe(before.receipts);
    expect(session.requiredTasks).toBe(before.tasks);
    expect(session.priorityPayments).toBe(before.payments);
    expect(JSON.stringify(session)).toBe(before.bytes);
  });
});
