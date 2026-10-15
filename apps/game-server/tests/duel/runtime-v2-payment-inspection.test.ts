import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  commitDuelPriorityPaymentV2,
  createDuelPhaseSourceRegistryV2,
  referenceDuelPhysicalCardV2,
  type DuelCatalogCardTypeV2,
  type DuelPhaseProgramEvidenceV2,
  type DuelPhaseSourceRequestV2,
  type DuelSourceAttestorV2,
} from "@riftbound/engine-core/duel";
import { isDuelProjectionV2, type DuelCommandMessage } from "@riftbound/protocol";
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
let runtimePromise: Promise<CardCatalogRuntime> | null = null;
function runtime(): Promise<CardCatalogRuntime> {
  runtimePromise ??= loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  return runtimePromise;
}
const a = setupAdapterFixtureDecks.a.submission;
const b = setupAdapterFixtureDecks.b.submission;
const seats: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2] = [
  { playerId: "alice", displayName: "Alice", deck: a },
  { playerId: "bob", displayName: "Bob", deck: b },
];
const championIds = new Set([a.champion[0]!.cardId]);
const legendIds = new Set([a.legend[0]!.cardId]);
const runeIds = new Set(a.runes.map(({ cardId }) => cardId));
const battlefieldIds = new Set(a.battlefields.map(({ cardId }) => cardId));
function trustedCardType(cardId: string): DuelCatalogCardTypeV2 {
  if (championIds.has(cardId)) return "Champion";
  if (legendIds.has(cardId)) return "Legend";
  if (runeIds.has(cardId)) return "Rune";
  if (battlefieldIds.has(cardId)) return "Battlefield";
  return "Other";
}
type Session = ReturnType<typeof createDuelRuntimeSessionV2>;
function packet(id: string, expectedVersion: number, command: DuelCommandMessage["command"]): DuelCommandMessage {
  return { type: "duel-command", requestId: id, commandId: id, expectedVersion, command };
}
const complete = (request: DuelPhaseSourceRequestV2): DuelPhaseProgramEvidenceV2 => ({
  status: "complete", matchId: request.matchId, dataVersion: request.dataVersion,
  catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
  uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
  controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
  programReference: `test-only-whole-program:${request.source.cardId ?? request.source.uid}`,
  event: request.event, eventSupported: true, scope: "known-no-handler",
  replacementsCovered: true, staticCovered: true, continuousCovered: true, triggersCovered: true,
});
async function main(): Promise<Session> {
  let uid = 0;
  let current = createDuelRuntimeSessionV2(await runtime(), seats, "runtime-payment-inspection", {
    randomIndex: () => 0, uidFactory: () => `runtime-payment-uid-${++uid}`, trustedCardType,
  });
  for (const [index, actor] of current.match.turnOrder.entries()) {
    const outcome = executeDuelRuntimeCommandV2(current, actor,
      packet(`mulligan-${index}`, current.match.stateVersion, { type: "mulligan", selectedUIDs: [] }));
    expect(outcome.internalResult?.outcome.status).toBe("applied");
    current = outcome.session;
  }
  const match = current.match;
  const printings = [...new Set(match.provenance.originalPhysicalCards.map(({ cardId }) => cardId))]
    .map((cardId) => ({ cardId, programReference: `test-only-whole-program:${cardId}` }));
  const sources = createDuelPhaseSourceRegistryV2({
    matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    printings,
  }, complete);
  const turn = startDuelRuntimeTurnV2(current, { sources, fepr: () => ({ status: "none" }) });
  expect(turn.status).toBe("main");
  return turn.session;
}
function withPendingPayment(s: Session): { session: Session; getCalls: () => number;
  attestor: DuelSourceAttestorV2 } {
  if (s.match.stage !== "playing") throw new Error("expected playing");
  const actor = s.match.frame.turnPlayerId;
  const uid = s.match.resources.bases.find((base) => base.playerId === actor)!.baseRunes[0]!.uid;
  const sourceReference = { kind: "card" as const, referenceId: "runtime-test-source", sourceUID: uid };
  let calls = 0;
  const attestor: DuelSourceAttestorV2 = (request) => {
    calls += 1;
    if (calls > 2) throw new Error("one-use attestor invoked more than once for real pay");
    return {
      matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
      sourceReference: request.sourceReference, sourceProofId: "runtime-test-proof",
      mode: "current", sourceZoneEpoch: referenceDuelPhysicalCardV2(request.match, uid).zoneEpoch,
    };
  };
  const pending = commitDuelPriorityPaymentV2(s, actor, "runtime-pending-payment",
    { energy: 0, power: [] }, sourceReference, attestor).session;
  expect(calls).toBe(1);
  return { session: pending, getCalls: () => calls, attestor };
}

describe("V2 payment projection never invokes source attestor", () => {
  it("inspects repeatedly without touching one-use proof, then re-attests exactly once on real pay", async () => {
    const { session, getCalls, attestor } = withPendingPayment(await main());
    if (session.match.stage !== "playing") throw new Error("expected playing");
    const actor = session.match.frame.turnPlayerId;
    const paymentId = session.match.frame.pendingPayment!.paymentId;
    const before = {
      match: session.match, resources: session.match.resources,
      receipts: session.receipts, requiredTasks: session.requiredTasks,
      priorityPayments: session.priorityPayments,
      version: session.match.stateVersion, epoch: session.match.physicalCardsByUID[
        session.priorityPayments[0]!.sourceBinding.sourceReference.sourceUID!]!.zoneEpoch,
    };
    for (let n = 0; n < 2; n++) {
      const projection = projectDuelRuntimeV2(session, actor, { paymentAttestationAvailable: true });
      expect(isDuelProjectionV2(projection)).toBe(true);
      expect(projection.actions.find((item) => item.kind === "pay-pending"))
        .toMatchObject({ kind: "pay-pending", enabled: true, paymentId });
      expect(projection.match.frame.pendingPayment).toMatchObject({ paymentId, active: true });
    }
    expect(getCalls()).toBe(1); // issuance only: 0 projection invocations
    expect(session.match).toBe(before.match);
    expect(session.match.resources).toBe(before.resources);
    expect(session.receipts).toBe(before.receipts);
    expect(session.requiredTasks).toBe(before.requiredTasks);
    expect(session.priorityPayments).toBe(before.priorityPayments);
    expect(session.match.stateVersion).toBe(before.version);
    expect(session.match.physicalCardsByUID[
      session.priorityPayments[0]!.sourceBinding.sourceReference.sourceUID!]!.zoneEpoch).toBe(before.epoch);
    expect(session.priorityPayments[0]!.status).toBe("active");

    const paid = executeDuelRuntimeCommandV2(session, actor,
      packet("actual-pay", session.match.stateVersion, { type: "pay-pending", paymentId }),
      { sourceAttestor: attestor });
    expect(paid.outbound).toMatchObject({ type: "request-result", ok: true, duplicate: false });
    expect(paid.internalResult?.outcome.status).toBe("applied");
    expect(paid.session.priorityPayments[0]!.status).toBe("completed");
    expect(paid.session.match.stage === "playing" && paid.session.match.frame.pendingPayment).toBe(null);
    expect(getCalls()).toBe(2); // exactly one genuine payment re-attestation
    const duplicate = executeDuelRuntimeCommandV2(paid.session, actor,
      packet("actual-pay", session.match.stateVersion, { type: "pay-pending", paymentId }),
      { sourceAttestor: attestor });
    expect(duplicate.internalResult?.duplicate).toBe(true);
    expect(getCalls()).toBe(2);
  }, 90_000);

  it("treats boolean as a hint, hides opponent/spectator cost, and fails real command closed", async () => {
    const { session, getCalls } = withPendingPayment(await main());
    if (session.match.stage !== "playing") throw new Error("expected playing");
    const actor = session.match.frame.turnPlayerId;
    const other = session.match.roster.find((seat) => seat.playerId !== actor)!.playerId;
    const paymentId = session.match.frame.pendingPayment!.paymentId;
    const disabled = projectDuelRuntimeV2(session, actor);
    expect(disabled.actions.find((item) => item.kind === "pay-pending"))
      .toMatchObject({ enabled: false, reason: "支付来源验证暂不可用" });
    const available = projectDuelRuntimeV2(session, actor, { paymentAttestationAvailable: true });
    expect(available.actions.find((item) => item.kind === "pay-pending"))
      .toMatchObject({ enabled: true, paymentId });
    const opponent = projectDuelRuntimeV2(session, other, { paymentAttestationAvailable: true });
    const spectator = projectDuelRuntimeV2(session, null, { paymentAttestationAvailable: true });
    expect(isDuelProjectionV2(opponent)).toBe(true);
    expect(isDuelProjectionV2(spectator)).toBe(true);
    for (const projection of [opponent, spectator]) {
      expect(projection.actions.some((item) => item.kind === "pay-pending")).toBe(false);
      expect(JSON.stringify(projection)).not.toContain(paymentId);
      expect(JSON.stringify(projection)).not.toContain("runtime-test-proof");
      expect(JSON.stringify(projection)).not.toContain("priorityPayments");
    }
    expect(getCalls()).toBe(1);
    const rejected = executeDuelRuntimeCommandV2(session, actor,
      packet("real-without-attestor", session.match.stateVersion, { type: "pay-pending", paymentId }));
    expect(rejected.internalResult?.outcome).toEqual({ status: "rejected", reason: "payment-rejected" });
    expect(rejected.persistRequired).toBe(true);
    expect(rejected.session.match).toBe(session.match);
    const externalFailure = executeDuelRuntimeCommandV2(session, actor,
      packet("external-proof-failure", session.match.stateVersion, { type: "pay-pending", paymentId }),
      { sourceAttestor: () => { throw new Error("external proof expired"); } });
    expect(externalFailure.internalResult?.outcome).toEqual({ status: "rejected", reason: "payment-rejected" });
    expect(externalFailure.persistRequired).toBe(true);
    expect(getCalls()).toBe(1);
  }, 90_000);
});
