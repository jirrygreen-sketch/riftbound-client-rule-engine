import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyDuelResourceCommandV2,
  createDuelPhaseSourceRegistryV2,
  inspectDuelResourceCommandV2,
  type DuelCatalogCardTypeV2,
  type DuelPhaseProgramEvidenceV2,
  type DuelPhaseSourceRequestV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import {
  createDuelRuntimeSessionV2,
  executeDuelRuntimeCommandV2,
  projectDuelRuntimeV2,
  startDuelRuntimeTurnV2,
  type DuelRuntimeSeatV2,
} from "../../src/duel/runtime-v2.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
let runtimePromise: Promise<CardCatalogRuntime> | undefined;
const runtime = (): Promise<CardCatalogRuntime> => {
  runtimePromise ??= loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  return runtimePromise;
};
const seats: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2] = [
  { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
  { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
];
const championIds = new Set([setupAdapterFixtureDecks.a.submission.champion[0]!.cardId]);
const legendIds = new Set([setupAdapterFixtureDecks.a.submission.legend[0]!.cardId]);
const runeIds = new Set(setupAdapterFixtureDecks.a.submission.runes.map((entry) => entry.cardId));
const battlefieldIds = new Set(setupAdapterFixtureDecks.a.submission.battlefields.map((entry) => entry.cardId));
const trustedCardType = (cardId: string): DuelCatalogCardTypeV2 =>
  championIds.has(cardId) ? "Champion" : legendIds.has(cardId) ? "Legend" :
    runeIds.has(cardId) ? "Rune" : battlefieldIds.has(cardId) ? "Battlefield" : "Other";

async function mainSession() {
  let uid = 0;
  let session = createDuelRuntimeSessionV2(await runtime(), seats, "resource-query-runtime", {
    randomIndex: () => 0,
    uidFactory: () => `resource-query-uid-${++uid}`,
    trustedCardType,
  });
  for (const actor of session.match.turnOrder) {
    session = executeDuelRuntimeCommandV2(session, actor, {
      type: "duel-command", requestId: `m-${actor}`, commandId: `m-${actor}`,
      expectedVersion: session.match.stateVersion,
      command: { type: "mulligan", selectedUIDs: [] },
    }).session;
  }
  const match = session.match;
  const printings = [...new Set(match.provenance.originalPhysicalCards.map((card) => card.cardId))]
    .map((cardId) => ({ cardId, programReference: `test-only-whole-program:${cardId}` }));
  const complete = (request: DuelPhaseSourceRequestV2): DuelPhaseProgramEvidenceV2 => ({
    status: "complete", matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `test-only-whole-program:${request.source.cardId ?? request.source.uid}`,
    event: request.event, eventSupported: true, scope: "known-no-handler",
    replacementsCovered: true, staticCovered: true, continuousCovered: true, triggersCovered: true,
  });
  const started = startDuelRuntimeTurnV2(session, {
    sources: createDuelPhaseSourceRegistryV2({
      matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest, printings,
    }, complete),
    fepr: () => ({ status: "none" }),
  });
  if (started.status !== "main") throw new Error(`expected Main, got ${started.status}`);
  return started.session;
}

describe("V2 runtime resource legality projection", () => {
  it("keeps repeated projections deeply equal and does not install mutation probes", async () => {
    const session = await mainSession();
    const before = {
      match: session.match, resources: session.match.resources,
      receipts: session.receipts, tasks: session.requiredTasks, payments: session.priorityPayments,
    };
    const first = projectDuelRuntimeV2(session, "alice");
    const second = projectDuelRuntimeV2(session, "alice");
    expect(second).toEqual(first);
    expect(session.match).toBe(before.match);
    expect(session.match.resources).toBe(before.resources);
    expect(session.receipts).toBe(before.receipts);
    expect(session.requiredTasks).toBe(before.tasks);
    expect(session.priorityPayments).toBe(before.payments);
    for (const action of first.actions) {
      if (action.kind !== "rune-energy" && action.kind !== "rune-power" && action.kind !== "gold-power") continue;
      const inspected = inspectDuelResourceCommandV2(session, "alice", session.match.stateVersion, {
        type: action.kind, uid: action.uid,
      });
      expect(action.enabled).toBe(inspected.status === "legal");
      const fresh = applyDuelResourceCommandV2(session, "alice", {
        commandId: `fresh-${action.kind}-${action.uid}`,
        expectedVersion: session.match.stateVersion,
        command: { type: action.kind, uid: action.uid },
      });
      expect(action.enabled).toBe(fresh.outcome.status === "applied");
    }
  });
});
