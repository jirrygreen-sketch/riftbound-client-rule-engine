/**
 * Focused V3 permanent-facade tests.
 *
 * Self-contained: they use the tracked `setup-adapter-catalog` fixture (real
 * `validateCatalogDeck` + real setup adapter) and a REAL admitted V2 command session
 * driven through the V3 facade. The trusted card-type resolver, the whole-program
 * phase registry and the source attestor below are TEST-ONLY: nothing here is exported
 * from the production `runtime-v3.ts` module, and no fixture/no-op provider ships there.
 *
 * The V3 facade only re-maps the public wire schema: it must publish exactly
 * `riftbound-duel-v3` / schemaVersion 3, reuse the genuine V3 permanent projector on
 * the live authority and reuse the five existing V2 actions/commands. These tests pin
 * that contract, the viewer isolation, the rejection boundaries and the fact that no
 * production provider is realized by the server.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adoptAdmittedDuelPlayingSessionV2,
  commitDuelPriorityPaymentV2,
  createDuelPhaseSourceRegistryV2,
  referenceDuelPhysicalCardV2,
  registerDuelGearFromTrustedSourceV2,
  type DuelCatalogCardTypeV2,
  type DuelPhaseProgramEvidenceV2,
  type DuelPhaseSourceRequestV2,
  type DuelPhaseRegistryV2,
  type DuelSourceAttestorV2,
  type DuelTurnServicesV2,
} from "@riftbound/engine-core/duel";
import {
  DUEL_PROJECTION_SCHEMA_V3,
  isDuelProjectionV2,
  isDuelProjectionV3,
  type DuelCommandMessage as WireCommandMessage,
} from "@riftbound/protocol";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import { executeDuelRuntimeCommandV2 } from "../../src/duel/runtime-v2.js";
import {
  createDuelRuntimeSessionV3,
  endDuelRuntimeTurnV3,
  executeDuelRuntimeCommandV3,
  projectDuelRuntimeV3,
  resumeDuelRuntimeTurnV3,
  startDuelRuntimeTurnV3,
  type DuelRuntimeSessionV3,
} from "../../src/duel/runtime-v3.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
let runtimePromise: Promise<CardCatalogRuntime> | null = null;
function runtime(): Promise<CardCatalogRuntime> {
  runtimePromise ??= loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  return runtimePromise;
}

function seats() {
  return [
    { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
    { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
  ] as const;
}

/** TEST-ONLY: maps the fixture printings into the trusted V2 constructor slot kinds. */
const fixtureDeck = setupAdapterFixtureDecks.a.submission;
const championIds = new Set([fixtureDeck.champion![0]!.cardId]);
const legendIds = new Set([fixtureDeck.legend![0]!.cardId]);
const runeIds = new Set(fixtureDeck.runes!.map((entry) => entry.cardId));
const battlefieldIds = new Set(fixtureDeck.battlefields!.map((entry) => entry.cardId));

/**
 * TEST-ONLY trusted classifier. Main-deck printings are deliberately classified as
 * "Gear" so the test can exercise the real V3 gear path by registering a genuine Gear
 * from an authenticated hand; this is a test fixture classification, not a claim about
 * the real catalog and not a production provider.
 */
function testTrustedCardType(cardId: string): DuelCatalogCardTypeV2 {
  if (championIds.has(cardId)) return "Champion";
  if (legendIds.has(cardId)) return "Legend";
  if (runeIds.has(cardId)) return "Rune";
  if (battlefieldIds.has(cardId)) return "Battlefield";
  return "Gear";
}

type Session = DuelRuntimeSessionV3;

async function makeSession(matchId = "runtime-v3-match"): Promise<Session> {
  const catalog = await runtime();
  let uid = 0;
  return createDuelRuntimeSessionV3(catalog, seats(), matchId, {
    randomIndex: () => 0,
    uidFactory: () => `runtime-v3-uid-${++uid}`,
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

function mulliganBoth(session: Session): Session {
  let current = session;
  for (const [index, actor] of current.match.turnOrder.entries()) {
    const executed = executeDuelRuntimeCommandV3(current, actor,
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
  if (match.stage !== "playing") throw new Error("expected playing match");
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

/** Drive the real V2 turn executor to Main through the V3 facade. */
function reachMain(source: Session): Session {
  const started = startDuelRuntimeTurnV3(source, services(source));
  expect(started.status).toBe("main");
  return started.session;
}

/** Register one genuine Gear from the actor's authenticated hand and adopt the V2 authority. */
function withGear(source: Session): Session {
  const match = source.match;
  if (match.stage !== "playing") throw new Error("expected playing match");
  const actor = match.turnOrder[0]!;
  const player = match.players.find((entry) => entry.playerId === actor)!;
  const handCard = player.hand[0]!;
  const base = match.board.bases.find((entry) => entry.ownerPlayerId === actor)!;
  const withGearMatch = registerDuelGearFromTrustedSourceV2(match, handCard.uid, actor, base.locationId, true);
  return adoptAdmittedDuelPlayingSessionV2(withGearMatch);
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
    source, actor, "runtime-v3-pending-payment", { energy: 0, power: [] },
    { kind: "card", referenceId: "runtime-v3-test-source", sourceUID }, attestor,
  );
  expect(calls).toBe(1);
  return { session: installed.session, attestor, getAttestorCalls: () => calls };
}

/** A fabricated, non-admitted session-shaped object; must never be read. */
function forgedSession(match: unknown): DuelRuntimeSessionV3 {
  return { schemaVersion: 2, match, receipts: [], requiredTasks: [], priorityPayments: [] } as unknown as DuelRuntimeSessionV3;
}

describe("duel runtime V3 permanent facade", () => {
  it("publishes schemaVersion 3 / riftbound-duel-v3 for real setup, keeping the V2 authority untouched", async () => {
    const session = await makeSession();
    const owner = projectDuelRuntimeV3(session, "alice");
    const spectator = projectDuelRuntimeV3(session, null);
    expect(owner.projectionSchema).toBe(DUEL_PROJECTION_SCHEMA_V3);
    expect(owner.match.schemaVersion).toBe(3);
    expect(isDuelProjectionV3(owner)).toBe(true);
    expect(isDuelProjectionV3(spectator)).toBe(true);
    // Not a V2 packet, and the V3 packet is not accepted by the V2 guard.
    expect(isDuelProjectionV2(owner)).toBe(false);
    expect(owner.match.stage).toBe("setup");
    if (owner.match.stage !== "setup" || spectator.match.stage !== "setup") throw new Error("expected setup");
    // V3 setup has no permanent fields at all.
    expect(Object.hasOwn(owner.match, "board")).toBe(false);
    expect(Object.hasOwn(owner.match.setup.players[0]!.legend, "readiness")).toBe(false);
    const alice = owner.match.setup.players.find((player) => player.playerId === "alice")!;
    expect(alice.hand?.map((card) => card.uid)).toEqual(
      session.match.stage === "setup"
        ? session.match.setup.players.find((player) => player.playerId === "alice")!.hand.map((card) => card.uid)
        : []);
    const other = owner.match.setup.players.find((player) => player.playerId === "bob")!;
    expect(Object.hasOwn(other, "hand")).toBe(false);
    expect(JSON.stringify(spectator)).not.toContain("provenance");
    expect(JSON.stringify(spectator)).not.toContain("legend-private");
    // The facade reads the live authority only: the source session is unchanged.
    expect(projectDuelRuntimeV3(session, "alice")).toEqual(owner);
  });

  it("reuses the five-action mulligan option at setup and keeps V3 actions bound to the viewer", async () => {
    const session = await makeSession();
    const projection = projectDuelRuntimeV3(session, "alice");
    const action = projection.actions[0]!;
    expect(projection.actions).toHaveLength(1);
    expect(action.kind).toBe("mulligan");
    expect(action.enabled).toBe(true);
    if (action.kind !== "mulligan" || projection.match.stage !== "setup") throw new Error("expected mulligan");
    expect(action.selectableUIDs).toEqual(
      projection.match.setup.players.find((player) => player.playerId === "alice")?.hand?.map((card) => card.uid),
    );
    expect(action.maxSelections).toBe(2);
    expect(projectDuelRuntimeV3(session, "bob").actions).toEqual([]);
    expect(projectDuelRuntimeV3(session, null).actions).toEqual([]);
  });

  it("reaches playing through two real mulligans with empty gears and unestablished Legend tri-states", async () => {
    const playing = mulliganBoth(await makeSession());
    expect(playing.match.stage).toBe("playing");
    const projection = projectDuelRuntimeV3(playing, null);
    expect(isDuelProjectionV3(projection)).toBe(true);
    if (projection.match.stage !== "playing") throw new Error("expected playing");
    expect(projection.match.board.gears).toEqual([]);
    expect(projection.match.players.map((player) => player.legend)).toEqual([
      { cardId: legendIds.values().next().value, controllerPlayerId: "alice", readiness: "not-established" },
      { cardId: legendIds.values().next().value, controllerPlayerId: "bob", readiness: "not-established" },
    ]);
    expect(projection.actions).toEqual([]);
    expect(projectDuelRuntimeV3(playing, "alice").actions).toEqual([]);
  });

  it("projects a genuine Gear and Legend from the trusted permanent carriers, never from a V2 DTO", async () => {
    const geared = withGear(reachMain(mulliganBoth(await makeSession())));
    const projection = projectDuelRuntimeV3(geared, "alice");
    expect(isDuelProjectionV3(projection)).toBe(true);
    if (projection.match.stage !== "playing") throw new Error("expected playing");
    expect(projection.match.board.gears).toHaveLength(1);
    const gear = projection.match.board.gears[0]!;
    expect(Object.keys(gear).sort()).toEqual(
      ["uid", "cardId", "controllerPlayerId", "locationId", "readied", "attachedToUID"].sort(),
    );
    expect(gear.controllerPlayerId).toBe("alice");
    expect(gear.readied).toBe(true);
    expect(gear.attachedToUID).toBeNull();
    expect(Object.hasOwn(gear, "ownerPlayerId")).toBe(false);
    expect(Object.hasOwn(gear, "zoneEpoch")).toBe(false);
    expect(JSON.stringify(projection)).not.toContain("zoneEpoch");
    expect(JSON.stringify(projection)).not.toContain("physicalCardsByUID");
    // Legend readiness is now established for both seats.
    expect(projection.match.players.map((player) => player.legend.readiness)).toEqual(["ready", "ready"]);
    // Spectator view contains the same public gear without hidden zones.
    const spectator = projectDuelRuntimeV3(geared, null);
    expect(isDuelProjectionV3(spectator)).toBe(true);
    if (spectator.match.stage !== "playing") throw new Error("expected playing");
    expect(spectator.match.board.gears).toHaveLength(1);
  });

  it("keeps owner hand and pending-payment cost, and gives opponents/spectators only a summary", async () => {
    const main = reachMain(mulliganBoth(await makeSession()));
    const actor = main.match.turnOrder[0]!;
    const { session: pending } = withPendingPayment(main);
    if (pending.match.stage !== "playing") throw new Error("expected playing");
    const paymentId = pending.match.frame.pendingPayment?.paymentId;
    if (paymentId === undefined) throw new Error("expected pending payment");

    const owner = projectDuelRuntimeV3(pending, actor);
    expect(isDuelProjectionV3(owner)).toBe(true);
    if (owner.match.stage !== "playing") throw new Error("expected playing");
    const ownSeat = owner.match.players.find((player) => player.playerId === actor)!;
    expect(ownSeat.hand?.length).toBe(ownSeat.handCount);
    expect(owner.match.frame.pendingPayment).toEqual({ active: true, paymentId,
      resolvedCost: { energy: 0, power: [] } });

    for (const viewer of ["bob", null] as const) {
      const other = projectDuelRuntimeV3(pending, viewer);
      expect(isDuelProjectionV3(other)).toBe(true);
      if (other.match.stage !== "playing") throw new Error("expected playing");
      for (const player of other.match.players) {
        // Only the authenticated viewer ever carries a hand; the other seat's hand is absent.
        expect(Object.hasOwn(player, "hand")).toBe(player.playerId === viewer);
      }
      expect(other.match.frame.pendingPayment).toEqual({ active: true });
      expect(JSON.stringify(other)).not.toContain(paymentId);
      expect(other.actions.some((action) => action.kind === "pay-pending")).toBe(false);
    }
    expect(JSON.stringify(owner)).not.toContain("sourceProofId");
    expect(JSON.stringify(owner)).not.toContain("sourceReference");
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

    const noAttestor = projectDuelRuntimeV3(pending, actor);
    expect(isDuelProjectionV3(noAttestor)).toBe(true);
    expect(noAttestor.actions.find((action) => action.kind === "pay-pending")?.enabled).toBe(false);

    const available = projectDuelRuntimeV3(pending, actor, { paymentAttestationAvailable: true });
    expect(isDuelProjectionV3(available)).toBe(true);
    expect(available.actions.find((action) => action.kind === "pay-pending")?.enabled).toBe(true);
    expect(getAttestorCalls()).toBe(1); // issuance only: projections neither re-attest nor mutate
    expect(pending.match).toBe(matchBefore);
    expect(pending.match.stateVersion).toBe(versionBefore);

    const rejected = executeDuelRuntimeCommandV3(pending, actor,
      command("pay-no-attestor", "pay-no-attestor", pending.match.stateVersion,
        { type: "pay-pending", paymentId }));
    expect(rejected.persistRequired).toBe(true);
    expect(rejected.internalResult?.outcome).toEqual({ status: "rejected", reason: "payment-rejected" });
    expect(rejected.outbound).toMatchObject({ type: "error", requestId: "pay-no-attestor", code: "command-rejected" });
    expect(rejected.session.match).toBe(matchBefore);
    expect(getAttestorCalls()).toBe(1);

    const accepted = executeDuelRuntimeCommandV3(pending, actor,
      command("pay-ok", "pay-ok", pending.match.stateVersion, { type: "pay-pending", paymentId }),
      { sourceAttestor: attestor });
    expect(getAttestorCalls()).toBe(2);
    expect(accepted.internalResult?.outcome.status).toBe("applied");
    expect(accepted.outbound).toMatchObject({ type: "request-result", requestId: "pay-ok", ok: true });
    expect(JSON.stringify(accepted.outbound)).not.toContain("paymentCompleted");
    expect(accepted.session.match.stage === "playing" &&
      accepted.session.match.frame.pendingPayment).toBe(null);
  }, 90_000);

  it("forwards the five existing commands verbatim and keeps stale/duplicate/extra packets safe", async () => {
    const session = await makeSession();
    const first = session.match.turnOrder[0]!;
    const second = session.match.turnOrder[1]!;

    // Verbatim forwarding: the V3 wrapper is exactly the V2 result for the same input.
    const mulliganPacket = command("dup", "dup", session.match.stateVersion, { type: "mulligan", selectedUIDs: [] });
    const applied = executeDuelRuntimeCommandV3(session, first, mulliganPacket);
    expect(applied.outbound).toMatchObject({ type: "request-result", requestId: "dup", ok: true, duplicate: false });
    const direct = executeDuelRuntimeCommandV2(applied.session, first, mulliganPacket);
    expect(direct.outbound).toEqual(executeDuelRuntimeCommandV3(applied.session, first, mulliganPacket).outbound);

    const duplicate = executeDuelRuntimeCommandV3(applied.session, first, mulliganPacket);
    expect(duplicate.internalResult?.duplicate).toBe(true);
    expect(duplicate.persistRequired).toBe(false);
    expect(duplicate.internalResult?.match).toBe(applied.session.match);

    const stale = executeDuelRuntimeCommandV3(applied.session, second,
      command("stale", "stale", 99, { type: "mulligan", selectedUIDs: [] }));
    expect(stale.outbound).toMatchObject({ type: "error", code: "command-rejected", requestId: "stale" });
    expect(stale.internalResult?.outcome).toEqual({ status: "rejected", reason: "stale-version" });

    const extra = { ...command("extra", "extra", applied.session.match.stateVersion,
      { type: "mulligan", selectedUIDs: [] }), actor: second };
    const parsed = executeDuelRuntimeCommandV3(applied.session, second, extra);
    expect(parsed.internalResult).toBeNull();
    expect(parsed.session).toBe(applied.session);
    expect(parsed.outbound).toEqual({
      type: "error", requestId: "extra", code: "command-rejected", message: "Invalid duel command",
    });

    // The other four command types are forwarded unchanged too.
    const main = reachMain(mulliganBoth(await makeSession()));
    if (main.match.stage !== "playing") throw new Error("expected playing");
    const actor = main.match.turnOrder[0]!;
    const runeUID = main.match.resources.bases.find((base) => base.playerId === actor)!.baseRunes[0]!.uid;
    for (const value of [
      { type: "rune-energy", uid: runeUID } as const,
      { type: "rune-power", uid: runeUID } as const,
      { type: "gold-power", uid: "no-such-gold" } as const,
      { type: "pay-pending", paymentId: "no-such-payment" } as const,
    ]) {
      const v3 = executeDuelRuntimeCommandV3(main, actor,
        command(`probe-${value.type}`, `probe-${value.type}`, main.match.stateVersion, value));
      const v2 = executeDuelRuntimeCommandV2(main, actor,
        command(`probe-${value.type}`, `probe-${value.type}`, main.match.stateVersion, value));
      expect(v3.outbound).toEqual(v2.outbound);
      expect(v3.persistRequired).toBe(v2.persistRequired);
    }
  }, 90_000);

  it("never exposes the three turn wrappers differently from V2 and never fabricates a resume", async () => {
    const main = reachMain(mulliganBoth(await makeSession()));
    const actor = main.match.turnOrder[0]!;

    const ended = endDuelRuntimeTurnV3(main, actor, services(main));
    expect(ended.status).toBe("awaiting-turn-start");
    expect(ended.persistRequired).toBe(true);

    const pending = startDuelRuntimeTurnV3(ended.session,
      { sources: createDuelPhaseSourceRegistryV2(indexFor(ended.session), () => ({ status: "unknown" })) });
    expect(pending.status).toBe("pending");
    const taskId = pending.pending?.taskId;
    if (taskId === undefined) throw new Error("expected pending task");
    if (pending.session.match.stage !== "playing") throw new Error("expected playing");
    const wrong = resumeDuelRuntimeTurnV3(pending.session, `${taskId}-stale`, { status: "retry" }, services(pending.session));
    expect(wrong.status).toBe("rejected");
    expect(wrong.session.match).toBe(pending.session.match);
    const resumed = resumeDuelRuntimeTurnV3(pending.session, taskId,
      { status: "retry", matchId: pending.session.match.matchId,
        turn: pending.session.match.frame.turnNumber, taskId }, services(pending.session));
    expect(resumed.status).toBe("main");
  });

  it("rejects unknown viewers and V1/cloned/unadmitted authorities before reading their fields", async () => {
    const session = await makeSession();
    expect(() => projectDuelRuntimeV3(session, "outsider")).toThrow(/unknown viewer/);

    // A V1 relabel, an untrusted clone and a structurally-shaped copy are all rejected by the
    // genuine V3 projector's membership check (they are not in the engine's private live set).
    const V1 = forgedSession({ ...session.match, schemaVersion: 1 });
    const V2clone = forgedSession(structuredClone(session.match));
    const unadmitted = forgedSession({ ...(session.match as unknown as Record<string, unknown>) });
    for (const forged of [V1, V2clone, unadmitted]) {
      expect(() => projectDuelRuntimeV3(forged, "alice")).toThrow(TypeError);
    }
    // A V3 packet is never accepted by the V2 guard, and vice versa.
    const v3 = projectDuelRuntimeV3(session, "alice");
    expect(isDuelProjectionV2(v3)).toBe(false);
    expect(isDuelProjectionV3({ ...v3, projectionSchema: "riftbound-duel-v2" })).toBe(false);
  });

  it("rejects a seamless no-op provider: an unknown whole program is not certified no-effect", async () => {
    const playing = mulliganBoth(await makeSession());
    const unknown = createDuelPhaseSourceRegistryV2(indexFor(playing), () => ({ status: "unknown" }));
    const pending = startDuelRuntimeTurnV3(playing, { sources: unknown });
    expect(pending.status).toBe("pending");
    expect(pending.session.match).toBe(playing.match);
  });

  it("keeps every V3 output detached from the private authority", async () => {
    const geared = withGear(reachMain(mulliganBoth(await makeSession())));
    const original = projectDuelRuntimeV3(geared, "alice");
    const authority = JSON.stringify(geared.match);
    const mutable = projectDuelRuntimeV3(geared, "alice");
    if (mutable.match.stage !== "playing" || original.match.stage !== "playing") throw new Error("expected playing");
    const loosened = mutable.match as unknown as {
      roster: { displayName: string }[];
      players: { legend: { controllerPlayerId: string } }[];
      board: { gears: { readied: boolean }[] };
    };
    loosened.roster[0]!.displayName = "changed";
    loosened.players[0]!.legend.controllerPlayerId = "bob";
    loosened.board.gears[0]!.readied = false;
    expect(projectDuelRuntimeV3(geared, "alice")).toEqual(original);
    expect(JSON.stringify(geared.match)).toBe(authority);
  });

  it("publishes no production provider, fixture or constant resolver from the module", async () => {
    // The module only forwards to V2; it must not publish a built-in trusted card-type
    // resolver, turn services, source attestor or constant no-effect registry.
    const module = await import("../../src/duel/runtime-v3.js");
    expect(Object.keys(module).sort()).toEqual([
      "createDuelRuntimeSessionV3",
      "endDuelRuntimeTurnV3",
      "executeDuelRuntimeCommandV3",
      "projectDuelRuntimeV3",
      "resumeDuelRuntimeEndV3",
      "resumeDuelRuntimeTurnV3",
      "startDuelRuntimeTurnV3",
    ]);
    expect(DUEL_PROJECTION_SCHEMA_V3).toBe("riftbound-duel-v3");
  });
});
