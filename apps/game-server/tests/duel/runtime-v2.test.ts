/**
 * Focused V2 runtime facade tests.
 *
 * These tests are SELF-CONTAINED: they use the tracked `setup-adapter-catalog`
 * fixture (real `validateCatalogDeck` + real setup adapter) and a REAL admitted V2
 * command session. The trusted card-type resolver, the whole-program phase registry
 * and the source attestor below are deliberately TEST-ONLY: nothing here is exported
 * from the production `runtime-v2.ts` module, and no fixture/no-op provider ships there.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  commitDuelPriorityPaymentV2,
  createDuelPhaseSourceRegistryV2,
  referenceDuelPhysicalCardV2,
  type DuelCatalogCardTypeV2,
  type DuelPhaseProgramEvidenceV2,
  type DuelPhaseSourceRequestV2,
  type DuelPhaseRegistryV2,
  type DuelSourceAttestorV2,
  type DuelTurnServicesV2,
} from "@riftbound/engine-core/duel";
import { isDuelProjectionV2, type DuelCommandMessage as WireCommandMessage } from "@riftbound/protocol";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import {
  createDuelRuntimeSessionV2,
  endDuelRuntimeTurnV2,
  executeDuelRuntimeCommandV2,
  projectDuelRuntimeV2,
  resumeDuelRuntimeTurnV2,
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

function seats(): readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2] {
  return [
    { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
    { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
  ];
}

/** TEST-ONLY: maps the fixture printings into the trusted V2 constructor slot kinds. */
const championIds = new Set([setupAdapterFixtureDecks.a.submission.champion[0]!.cardId]);
const legendIds = new Set([setupAdapterFixtureDecks.a.submission.legend[0]!.cardId]);
const runeIds = new Set(setupAdapterFixtureDecks.a.submission.runes.map((entry) => entry.cardId));
const battlefieldIds = new Set(setupAdapterFixtureDecks.a.submission.battlefields.map((entry) => entry.cardId));

function testTrustedCardType(cardId: string): DuelCatalogCardTypeV2 {
  if (championIds.has(cardId)) return "Champion";
  if (legendIds.has(cardId)) return "Legend";
  if (runeIds.has(cardId)) return "Rune";
  if (battlefieldIds.has(cardId)) return "Battlefield";
  // Fixture main decks are Units and Spells; V2 admits them as main-deck "Other".
  return "Other";
}

async function makeSession(): Promise<ReturnType<typeof createDuelRuntimeSessionV2>> {
  const catalog = await runtime();
  let uid = 0;
  return createDuelRuntimeSessionV2(catalog, seats(), "runtime-v2-match", {
    randomIndex: () => 0,
    uidFactory: () => `runtime-v2-uid-${++uid}`,
    trustedCardType: testTrustedCardType,
  });
}

function command(
  requestId: string,
  commandId: string,
  expectedVersion: number,
  value: WireCommandMessage["command"],
): WireCommandMessage {
  return { type: "duel-command", requestId, commandId, expectedVersion, command: value };
}

type Session = Awaited<ReturnType<typeof makeSession>>;

function mulliganBoth(session: Session): Session {
  let current = session;
  for (const [index, seat] of current.match.turnOrder.entries()) {
    const actor = seat;
    const executed = executeDuelRuntimeCommandV2(current, actor,
      command(`mulligan-${index}`, `mulligan-${index}`, current.match.stateVersion,
        { type: "mulligan", selectedUIDs: [] }));
    expect(executed.outbound.type).toBe("request-result");
    current = executed.session;
  }
  return current;
}

// ---- TEST-ONLY trusted services (never shipped in the production module) ---------

function indexFor(session: Session,
  omitted: readonly string[] = []): {
  matchId: string; dataVersion: string; catalogDigest: string;
  printings: readonly { cardId: string; programReference: string }[];
} {
  const match = session.match;
  const cardIds = [...new Set(match.provenance.originalPhysicalCards.map((card) => card.cardId))]
    .filter((cardId) => !omitted.includes(cardId));
  return {
    matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    printings: cardIds.map((cardId) => ({ cardId, programReference: `test-only-whole-program:${cardId}` })),
  };
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

function registry(session: Session): DuelPhaseRegistryV2 {
  return createDuelPhaseSourceRegistryV2(indexFor(session), complete);
}

function services(session: Session, extras: Partial<DuelTurnServicesV2> = {}): DuelTurnServicesV2 {
  return { sources: registry(session), fepr: () => ({ status: "none" }), ...extras };
}

/** TEST-ONLY source attestor: binds a genuine live physical card at its current epoch. */
const testAttestor: DuelSourceAttestorV2 = (request) => {
  const sourceUID = request.sourceReference.sourceUID;
  return {
    matchId: request.match.matchId, actor: request.actor, paymentId: request.paymentId,
    sourceReference: request.sourceReference, sourceProofId: "test-only-source-proof",
    mode: "current",
    sourceZoneEpoch: sourceUID === undefined
      ? undefined
      : referenceDuelPhysicalCardV2(request.match, sourceUID).zoneEpoch,
    ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
    ...(request.continuationId === undefined ? {} : { continuationId: request.continuationId }),
  };
};

/** Drive the real V2 turn executor to Main using test-only services. */
function reachMain(source: Session): Session {
  const started = startDuelRuntimeTurnV2(source, services(source));
  expect(started.status).toBe("main");
  return started.session;
}

/** Install a real pending (priority) payment owned by Alice at Main, counting re-attestations. */
function withPendingPayment(source: Session): {
  session: Session;
  attestor: DuelSourceAttestorV2;
  getAttestorCalls: () => number;
} {
  const match = source.match;
  if (match.stage !== "playing") throw new Error("expected playing match");
  const actor = match.frame.turnPlayerId;
  const sourceUID = match.resources.bases.find((base) => base.playerId === actor)!.baseRunes[0]!.uid;
  let calls = 0;
  const attestor: DuelSourceAttestorV2 = (request) => {
    calls += 1;
    return testAttestor(request);
  };
  const installed = commitDuelPriorityPaymentV2(
    source, actor, "runtime-v2-pending-payment", { energy: 0, power: [] },
    { kind: "card", referenceId: "runtime-v2-test-source", sourceUID }, attestor,
  );
  expect(calls).toBe(1); // issuance binds the source exactly once
  return { session: installed.session, attestor, getAttestorCalls: () => calls };
}

describe("duel runtime V2 facade", () => {
  it("validates the trusted roster before UID allocation and setup RNG", async () => {
    const catalog = await runtime();
    let uidCalls = 0;
    let rngCalls = 0;
    const good = seats();
    const broken: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2] = [
      { ...good[0], deck: { ...good[0].deck, mainDeck: [{ cardId: "not-in-catalog", quantity: 1 }] } },
      good[1],
    ];
    expect(() => createDuelRuntimeSessionV2(catalog, broken, "invalid-runtime-v2-match", {
      randomIndex: () => { rngCalls += 1; return 0; },
      uidFactory: () => { uidCalls += 1; return `uid-${uidCalls}`; },
      trustedCardType: testTrustedCardType,
    })).toThrow(/invalid_deck/);
    expect(uidCalls).toBe(0);
    expect(rngCalls).toBe(0);
  });

  it("projects a real V2 match with owner-only hand data, spectator privacy and schema 2", async () => {
    const session = await makeSession();
    const owner = projectDuelRuntimeV2(session, "alice");
    const spectator = projectDuelRuntimeV2(session, null);
    expect(isDuelProjectionV2(owner)).toBe(true);
    expect(isDuelProjectionV2(spectator)).toBe(true);
    expect(owner.match.schemaVersion).toBe(2);
    expect(owner.match.stage).toBe("setup");
    if (owner.match.stage !== "setup" || spectator.match.stage !== "setup") throw new Error("expected setup");
    expect(owner.match.setup.players.find((player) => player.playerId === "alice")?.hand).toHaveLength(4);
    expect(owner.match.setup.players.find((player) => player.playerId === "bob")).not.toHaveProperty("hand");
    expect(spectator.actions).toEqual([]);
    expect(spectator.match.setup.players.every((player) => !Object.hasOwn(player, "hand"))).toBe(true);
    expect(JSON.stringify(spectator)).not.toContain("receipts");
    expect(JSON.stringify(spectator)).not.toContain("requiredTasks");
    expect(JSON.stringify(spectator)).not.toContain("priorityPayments");
    expect(JSON.stringify(spectator)).not.toContain("provenance");
    expect(() => projectDuelRuntimeV2(session, "outsider")).toThrow(/unknown viewer/);
  });

  it("offers only the current mulligan owner's own hand as a V2 action", async () => {
    const session = await makeSession();
    const projection = projectDuelRuntimeV2(session, "alice");
    expect(projection.actions).toHaveLength(1);
    const action = projection.actions[0]!;
    expect(action.kind).toBe("mulligan");
    expect(action.enabled).toBe(true);
    if (action.kind !== "mulligan" || projection.match.stage !== "setup") throw new Error("expected mulligan");
    expect(action.selectableUIDs).toEqual(
      projection.match.setup.players.find((player) => player.playerId === "alice")?.hand?.map((card) => card.uid),
    );
    expect(action.maxSelections).toBe(2);
    expect(projectDuelRuntimeV2(session, "bob").actions).toEqual([]);
  });

  it("reaches playing through two real mulligans with no actions before Main", async () => {
    const playing = mulliganBoth(await makeSession());
    expect(playing.match.stage).toBe("playing");
    const projection = projectDuelRuntimeV2(playing, null);
    expect(isDuelProjectionV2(projection)).toBe(true);
    if (projection.match.stage !== "playing") throw new Error("expected playing");
    expect(projection.match.frame.phase).toBe("awaiting-turn-start");
    expect(projection.match.resources.players[0]?.runePool.energy).toBe(0);
    expect(projection.actions).toEqual([]);
    expect(projectDuelRuntimeV2(playing, playing.match.turnOrder[0]!).actions).toEqual([]);
  });

  it("drives the real V2 turn executor to Main with test services and exposes Rune actions", async () => {
    const playing = mulliganBoth(await makeSession());
    const source = playing.match.turnOrder[0]!;
    const bytes = JSON.stringify(playing);
    const receiptCount = playing.receipts.length;

    const main = reachMain(playing);
    if (main.match.stage !== "playing") throw new Error("expected playing");
    expect(main.match.frame.phase).toBe("main");
    expect(main.match.turnOrder[0]).toBe(source);

    const projection = projectDuelRuntimeV2(main, source);
    expect(isDuelProjectionV2(projection)).toBe(true);
    expect(projection.actions.some((action) => action.kind === "rune-energy" && action.enabled)).toBe(true);
    expect(projection.actions.some((action) => action.kind === "rune-power" && action.enabled)).toBe(true);
    // The action probes ran on the live capability but installed nothing.
    expect(main.receipts).toHaveLength(receiptCount);
    expect(JSON.stringify(playing)).toBe(bytes);
  });

  it("does not silently certify an unknown whole program as no-effect", async () => {
    const playing = mulliganBoth(await makeSession());
    const unknown = createDuelPhaseSourceRegistryV2(indexFor(playing), () => ({ status: "unknown" }));
    const pending = startDuelRuntimeTurnV2(playing, { sources: unknown });
    expect(pending.status).toBe("pending");
    expect(pending.session.match).toBe(playing.match);
    expect(pending.session.match.stage === "playing" && pending.session.match.frame.phase)
      .toBe("awaiting-turn-start");
  });

  it("keeps duplicate, wrong-actor, stale and extra-field packets safe", async () => {
    const session = await makeSession();
    const first = session.match.turnOrder[0]!;
    const second = session.match.turnOrder[1]!;

    const outsider = executeDuelRuntimeCommandV2(session, "outsider",
      command("outsider", "outsider", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] }));
    expect(outsider.outbound).toMatchObject({ type: "error", code: "command-rejected", requestId: "outsider" });
    expect(outsider.internalResult?.outcome).toEqual({ status: "rejected", reason: "unknown-actor" });
    expect(outsider.persistRequired).toBe(false);

    // A seated but non-due actor is a sticky, non-duplicate semantic rejection.
    const wrongActor = executeDuelRuntimeCommandV2(session, second,
      command("wrong", "wrong", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] }));
    expect(wrongActor.outbound).toMatchObject({ type: "error", code: "command-rejected", requestId: "wrong" });
    expect(wrongActor.internalResult?.outcome).toEqual({ status: "rejected", reason: "mulligan-rejected" });
    expect(wrongActor.persistRequired).toBe(true);

    const packet = command("dup", "dup", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] });
    const applied = executeDuelRuntimeCommandV2(session, first, packet);
    expect(applied.outbound).toMatchObject({ type: "request-result", requestId: "dup", ok: true, duplicate: false });
    expect(applied.persistRequired).toBe(true);
    const duplicate = executeDuelRuntimeCommandV2(applied.session, first, packet);
    expect(duplicate.internalResult?.duplicate).toBe(true);
    expect(duplicate.persistRequired).toBe(false);
    expect(duplicate.internalResult?.match).toBe(applied.session.match);

    const stale = executeDuelRuntimeCommandV2(applied.session, second,
      command("stale", "stale", 99, { type: "mulligan", selectedUIDs: [] }));
    expect(stale.outbound).toMatchObject({ type: "error", code: "command-rejected", requestId: "stale" });
    expect(stale.internalResult?.outcome).toEqual({ status: "rejected", reason: "stale-version" });

    const extra = { ...command("extra", "extra", applied.session.match.stateVersion,
      { type: "mulligan", selectedUIDs: [] }), actor: second };
    const parsed = executeDuelRuntimeCommandV2(applied.session, second, extra);
    expect(parsed.internalResult).toBeNull();
    expect(parsed.session).toBe(applied.session);
    expect(parsed.persistRequired).toBe(false);
    expect(parsed.outbound).toEqual({
      type: "error", requestId: "extra", code: "command-rejected", message: "Invalid duel command",
    });
  });

  it("disables and rejects pay-pending without a trusted attestor, then publishes a safe ACK", async () => {
    const main = reachMain(mulliganBoth(await makeSession()));
    const actor = main.match.turnOrder[0]!;
    const { session: pending, attestor, getAttestorCalls } = withPendingPayment(main);
    if (pending.match.stage !== "playing") throw new Error("expected playing");
    const paymentId = pending.match.frame.pendingPayment?.paymentId;
    if (paymentId === undefined) throw new Error("expected pending payment");
    const matchBefore = pending.match;
    const versionBefore = pending.match.stateVersion;

    const noAttestor = projectDuelRuntimeV2(pending, actor);
    expect(isDuelProjectionV2(noAttestor)).toBe(true);
    const disabledPay = noAttestor.actions.find((action) => action.kind === "pay-pending");
    expect(disabledPay?.enabled).toBe(false);

    // Availability is only a trusted server hint: repeated projections must never
    // invoke the source attestor or mutate the pending session.
    const available = projectDuelRuntimeV2(pending, actor, { paymentAttestationAvailable: true });
    expect(isDuelProjectionV2(available)).toBe(true);
    const enabledPay = available.actions.find((action) => action.kind === "pay-pending");
    expect(enabledPay?.enabled).toBe(true);
    expect(projectDuelRuntimeV2(pending, actor, { paymentAttestationAvailable: true })
      .actions.find((action) => action.kind === "pay-pending")?.enabled).toBe(true);
    expect(getAttestorCalls()).toBe(1); // issuance only: projections re-attest zero times
    expect(pending.match).toBe(matchBefore);
    expect(pending.match.stateVersion).toBe(versionBefore);
    expect(pending.match.frame.pendingPayment?.paymentId).toBe(paymentId);
    // A spectator never sees the payment identity or a pay action.
    expect(projectDuelRuntimeV2(pending, "bob").actions.some((action) => action.kind === "pay-pending")).toBe(false);

    const rejected = executeDuelRuntimeCommandV2(pending, actor,
      command("pay-no-attestor", "pay-no-attestor", pending.match.stateVersion,
        { type: "pay-pending", paymentId }));
    expect(rejected.persistRequired).toBe(true);
    expect(rejected.internalResult?.outcome).toEqual({ status: "rejected", reason: "payment-rejected" });
    expect(rejected.outbound).toMatchObject({ type: "error", requestId: "pay-no-attestor", code: "command-rejected" });
    expect(rejected.session.match).toBe(matchBefore);
    expect(getAttestorCalls()).toBe(1); // a real command without an attestor never attests

    const accepted = executeDuelRuntimeCommandV2(pending, actor,
      command("pay-ok", "pay-ok", pending.match.stateVersion, { type: "pay-pending", paymentId }),
      { sourceAttestor: attestor });
    expect(getAttestorCalls()).toBe(2); // the genuine payment path re-attests exactly once
    expect(accepted.internalResult?.outcome.status).toBe("applied");
    expect(accepted.persistRequired).toBe(true);
    expect(accepted.outbound).toEqual({
      type: "request-result", requestId: "pay-ok", ok: true, commandId: "pay-ok",
      appliedVersion: pending.match.stateVersion + 1, eventSeq: pending.match.eventSeq + 1, duplicate: false,
    });
    expect(JSON.stringify(accepted.outbound)).not.toContain("paymentCompleted");
    expect(JSON.stringify(accepted.outbound)).not.toContain("continuationId");
    expect(accepted.session.match.stage === "playing" &&
      accepted.session.match.frame.pendingPayment).toBe(null);
  }, 90_000);

  it("forwards turn wrappers and never fabricates a no-op resume", async () => {
    const main = reachMain(mulliganBoth(await makeSession()));
    const actor = main.match.turnOrder[0]!;

    const ended = endDuelRuntimeTurnV2(main, actor, services(main));
    expect(ended.status).toBe("awaiting-turn-start");
    expect(ended.persistRequired).toBe(true);

    // Resume only accepts the exact outstanding task; a fabricated no-op is rejected.
    const pending = startDuelRuntimeTurnV2(ended.session, {
      sources: createDuelPhaseSourceRegistryV2(indexFor(ended.session), () => ({ status: "unknown" })),
    });
    expect(pending.status).toBe("pending");
    const taskId = pending.pending?.taskId;
    if (taskId === undefined) throw new Error("expected pending task");
    const wrong = resumeDuelRuntimeTurnV2(pending.session, `${taskId}-stale`, { status: "retry" },
      services(pending.session));
    expect(wrong.status).toBe("rejected");
    expect(wrong.session.match).toBe(pending.session.match);
    const resumed = resumeDuelRuntimeTurnV2(pending.session, taskId,
      { status: "retry", matchId: pending.session.match.matchId,
        turn: pending.session.match.frame.turnNumber, taskId }, services(pending.session));
    expect(resumed.status).toBe("main");
  });
});
