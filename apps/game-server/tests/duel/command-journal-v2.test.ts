import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adoptAdmittedDuelPlayingSessionV2, applyDuelResourceCommandV2,
  createDuelGoldTokenV2, createDuelPhaseSourceRegistryV2, referenceDuelPhysicalCardV2,
  type DuelCatalogCardTypeV2, type DuelCommandSessionV2,
  type DuelPhaseProgramEvidenceV2, type DuelPhaseSourceRequestV2,
  type DuelTurnServicesV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import {
  createDuelCommandJournalV2, createTrustedDuelCommandJournalReplayGateV2,
  replayDuelCommandJournalV2, type SealedDuelCommandJournalV2,
} from "../../src/duel/command-journal-v2.js";
import type { DuelRuntimeSeatV2 } from "../../src/duel/runtime-v2.js";
import { startDuelRuntimeTurnV2 } from "../../src/duel/runtime-v2.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
const roster: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2] = [
  { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
  { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
];
const matchId = "journal-v2-test";
const championIds = new Set([roster[0].deck.champion![0]!.cardId]);
const legendIds = new Set([roster[0].deck.legend![0]!.cardId]);
const runeIds = new Set(roster[0].deck.runes!.map(entry => entry.cardId));
const fieldIds = new Set(roster[0].deck.battlefields!.map(entry => entry.cardId));
function trustedCardType(cardId: string): DuelCatalogCardTypeV2 {
  if (championIds.has(cardId)) return "Champion";
  if (legendIds.has(cardId)) return "Legend";
  if (runeIds.has(cardId)) return "Rune";
  if (fieldIds.has(cardId)) return "Battlefield";
  return "Other";
}

let catalogPromise: Promise<CardCatalogRuntime> | undefined;
function catalog(): Promise<CardCatalogRuntime> {
  catalogPromise ??= loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  return catalogPromise;
}

async function fixture() {
  const source = await catalog();
  let uid = 0, randomCalls = 0;
  const randomIndex = (bound: number) => { randomCalls++; return bound - 1; };
  const recorder = createDuelCommandJournalV2(source, roster, matchId, {
    uidFactory: () => `journal-uid-${++uid}`, randomIndex, trustedCardType,
  });
  const gate = createTrustedDuelCommandJournalReplayGateV2(
    source, roster, matchId, trustedCardType, randomIndex);
  return { recorder, gate, source, calls: () => randomCalls };
}

function handUIDs(recorder: Awaited<ReturnType<typeof fixture>>["recorder"], actor: string): string[] {
  const projected = recorder.project(actor).match;
  if (projected.stage !== "setup") throw new Error("expected setup");
  return projected.setup.players.find(player => player.playerId === actor)!.hand!.slice(0, 2)
    .map(card => card.uid);
}

function currentOwner(recorder: Awaited<ReturnType<typeof fixture>>["recorder"]): string {
  const projected = recorder.project(null).match;
  if (projected.stage !== "setup") throw new Error("expected setup");
  return projected.setup.currentMulliganOwner!;
}

function mutable(journal: SealedDuelCommandJournalV2): any {
  return structuredClone(journal);
}

function testTurnServices(session: DuelCommandSessionV2): DuelTurnServicesV2 {
  const match = session.match;
  const printings = [...new Set(match.provenance.originalPhysicalCards.map(card => card.cardId))]
    .map(cardId => ({ cardId, programReference: `fixture:${cardId}` }));
  const complete = (request: DuelPhaseSourceRequestV2): DuelPhaseProgramEvidenceV2 => ({
    status: "complete", matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `fixture:${request.source.cardId ?? request.source.uid}`,
    event: request.event, eventSupported: true, scope: "known-no-handler",
    replacementsCovered: true, staticCovered: true, continuousCovered: true, triggersCovered: true,
  });
  return { sources: createDuelPhaseSourceRegistryV2({ matchId: match.matchId,
    dataVersion: match.dataVersion, catalogDigest: match.catalogDigest, printings }, complete),
    fepr: () => ({ status: "none" }) };
}

describe.skip("private V2 command journal [legacy-replay-e2cbcdf]", () => {
  it("replays factory UID/RNG/type calls, both mulligans and sticky receipts through playing", async () => {
    const { recorder, gate, calls } = await fixture();
    const start = recorder.seal();
    expect(start.creation.trace.some(item => item.kind === "uid")).toBe(true);
    expect(start.creation.trace.some(item => item.kind === "random")).toBe(true);
    expect(start.creation.trace.some(item => item.kind === "card-type")).toBe(true);
    const first = currentOwner(recorder);
    expect(JSON.stringify(recorder.project(null))).not.toContain(handUIDs(recorder, first)[0]);
    const alice = { commandId: "first-mulligan", expectedVersion: recorder.stateVersion,
      command: { type: "mulligan" as const, selectedUIDs: handUIDs(recorder, first) } };
    const before = calls();
    expect(recorder.apply(first, alice).outcome.status).toBe("applied");
    expect(calls()).toBeGreaterThan(before);
    const after = calls();
    expect(recorder.apply(first, alice)).toMatchObject({ duplicate: true, persistRequired: false });
    expect(calls()).toBe(after);
    expect(recorder.apply(first, { ...alice, command: { type: "mulligan", selectedUIDs: [] } }))
      .toMatchObject({ outcome: { status: "rejected", reason: "command-conflict" }, persistRequired: false });
    expect(calls()).toBe(after);
    const middle = recorder.seal();
    const resumed = replayDuelCommandJournalV2(JSON.parse(JSON.stringify(middle)), gate);
    expect(resumed.stage).toBe("setup");
    expect(resumed.apply(first, alice).duplicate).toBe(true);
    const second = currentOwner(resumed);
    const bob = { commandId: "second-mulligan", expectedVersion: resumed.stateVersion,
      command: { type: "mulligan" as const, selectedUIDs: handUIDs(resumed, second) } };
    expect(resumed.apply(second, bob).outcome.status).toBe("applied");
    expect(resumed.stage).toBe("playing");
    const playing = resumed.seal();
    expect(replayDuelCommandJournalV2(playing, gate).stage).toBe("playing");
    const match = resumed.project("alice").match;
    const actor = match.stage === "playing" ? match.frame.turnPlayerId : "alice";
    const resource = { commandId: "resource-before-turn", expectedVersion: resumed.stateVersion,
      command: { type: "rune-energy" as const, uid: "arbitrary-uid" } };
    expect(resumed.apply(actor, resource)).toMatchObject({
      outcome: { status: "rejected", reason: "invalid-phase" }, persistRequired: true,
    });
    expect(replayDuelCommandJournalV2(resumed.seal(), gate).apply(actor, resource).duplicate).toBe(true);
    const publicJson = JSON.stringify(resumed.project(null));
    expect(publicJson).not.toContain("selectedUIDs");
    expect(publicJson).not.toContain("receipts");
    expect(publicJson).not.toContain("catalogHash");
  });

  it("rejects missing, extra and reordered creation traces and catalog drift", async () => {
    const { recorder, gate, source } = await fixture();
    const base = recorder.seal();
    for (const kind of ["uid", "random"] as const) {
      const missing = mutable(base);
      missing.creation.trace.splice(missing.creation.trace.findIndex((item: any) => item.kind === kind), 1);
      expect(() => replayDuelCommandJournalV2(missing, gate)).toThrow();
    }
    const extra = mutable(base); extra.creation.trace.push({ kind: "uid", value: "extra" });
    expect(() => replayDuelCommandJournalV2(extra, gate)).toThrow();
    const order = mutable(base); [order.creation.trace[0], order.creation.trace[1]] =
      [order.creation.trace[1], order.creation.trace[0]];
    expect(() => replayDuelCommandJournalV2(order, gate)).toThrow();
    const random = mutable(base);
    const call = random.creation.trace.find((item: any) => item.kind === "random");
    call.value = call.bound;
    expect(() => replayDuelCommandJournalV2(random, gate)).toThrow();
    const bound = mutable(base);
    bound.creation.trace.find((item: any) => item.kind === "random").bound++;
    expect(() => replayDuelCommandJournalV2(bound, gate)).toThrow();
    const alteredCatalog = { ...source, publicCatalog: { ...source.publicCatalog,
      cards: [...source.publicCatalog.cards].reverse() } };
    const driftGate = createTrustedDuelCommandJournalReplayGateV2(
      alteredCatalog, roster, matchId, trustedCardType, () => 0);
    expect(() => replayDuelCommandJournalV2(base, driftGate)).toThrow(/creation context mismatch/);
  });

  it("rejects command, outcome, clock, identity and malformed descriptor tampering", async () => {
    const { recorder, gate } = await fixture();
    const owner = currentOwner(recorder);
    const command = { commandId: "one", expectedVersion: recorder.stateVersion,
      command: { type: "mulligan" as const, selectedUIDs: handUIDs(recorder, owner) } };
    expect(recorder.apply(owner, command).outcome.status).toBe("applied");
    const base = recorder.seal();
    for (const alter of [
      (x: any) => { x.entries[0].envelope.command.selectedUIDs = []; },
      (x: any) => { x.entries[0].outcome.appliedVersion++; },
      (x: any) => { x.entries[0].clock.eventSeq++; },
      (x: any) => { x.entries[0].actor = owner === "alice" ? "bob" : "alice"; },
      (x: any) => { x.entries[0].trace.push({ kind: "random", bound: 2, value: 0 }); },
    ]) {
      const candidate = mutable(base); alter(candidate);
      expect(() => replayDuelCommandJournalV2(candidate, gate)).toThrow();
    }
    const sparse = mutable(base); delete sparse.entries[0];
    expect(() => replayDuelCommandJournalV2(sparse, gate)).toThrow();
    const accessor = mutable(base);
    Object.defineProperty(accessor.entries[0], "actor", { get: () => owner, enumerable: true });
    expect(() => replayDuelCommandJournalV2(accessor, gate)).toThrow();
    const forged = { ...gate };
    expect(() => replayDuelCommandJournalV2(base, forged)).toThrow(/trusted replay gate required/);
    const internal = recorder as unknown as { session: DuelCommandSessionV2 };
    internal.session = structuredClone(internal.session);
    expect(() => recorder.seal()).toThrow(/foreign session identity/);
  });

  it("does not journal invalid commands or unknown actors", async () => {
    const { recorder, gate, calls } = await fixture();
    const start = recorder.seal();
    const before = calls();
    expect(recorder.apply("stranger", { commandId: "unknown", expectedVersion: recorder.stateVersion,
      command: { type: "mulligan", selectedUIDs: [] } })).toMatchObject({
      outcome: { status: "rejected", reason: "unknown-actor" }, persistRequired: false,
    });
    expect(recorder.apply("alice", { commandId: "invalid", expectedVersion: recorder.stateVersion,
      command: { type: "not-a-command" } } as any)).toMatchObject({
      outcome: { status: "rejected", reason: "invalid-command" }, persistRequired: false,
    });
    expect(calls()).toBe(before);
    expect(recorder.seal()).toEqual(start);
    expect(replayDuelCommandJournalV2(start, gate).stage).toBe("setup");
  });

  it("rejects real externally advanced turn, resource and Gold successors", async () => {
    const { recorder } = await fixture();
    for (let index = 0; index < 2; index++) {
      const actor = currentOwner(recorder);
      expect(recorder.apply(actor, { commandId: `mulligan-${index}`,
        expectedVersion: recorder.stateVersion,
        command: { type: "mulligan", selectedUIDs: [] } }).outcome.status).toBe("applied");
    }
    const internal = recorder as unknown as { session: DuelCommandSessionV2 };
    const turn = startDuelRuntimeTurnV2(internal.session, testTurnServices(internal.session));
    expect(turn.status).toBe("main");
    const playing = turn.session.match;
    if (playing.stage !== "playing") throw new Error("expected playing");
    const actor = playing.frame.turnPlayerId;
    const base = playing.resources.bases.find(item => item.playerId === actor)!;
    const runeUID = base.baseRunes[0]!.uid;
    const resource = applyDuelResourceCommandV2(turn.session, actor,
      { commandId: "external-rune-energy", expectedVersion: playing.stateVersion,
        command: { type: "rune-energy", uid: runeUID } });
    expect(resource.outcome.status).toBe("applied");
    internal.session = resource.session;
    expect(() => recorder.seal()).toThrow(/foreign session identity/);
    const gold = createDuelGoldTokenV2(playing, {
      kind: "gold", tokenUID: "fixture-external-gold", sourceEffectId: "fixture-gold-effect",
      eventId: "fixture-gold-event", sourceUID: runeUID,
      sourceZoneEpoch: referenceDuelPhysicalCardV2(playing, runeUID).zoneEpoch,
      sourceMode: "current", effectControllerPlayerId: actor, controllerPlayerId: actor,
      locationId: base.locationId, readied: true,
    }, ({ match, request }) => ({ ...request, matchId: match.matchId,
      dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
      sourceProofId: "fixture-only-gold-proof" }));
    expect(gold.resources.bases.find(item => item.playerId === actor)!.goldTokens)
      .toContainEqual(expect.objectContaining({ uid: "fixture-external-gold" }));
    internal.session = adoptAdmittedDuelPlayingSessionV2(gold);
    expect(() => recorder.seal()).toThrow(/foreign session identity/);
  });
});
