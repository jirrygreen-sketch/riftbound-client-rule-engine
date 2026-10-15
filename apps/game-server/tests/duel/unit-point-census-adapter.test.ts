/**
 * Focused regression for the reviewed point-damage Spell source inside the
 * production P8 Unit Chain census adapter.
 *
 * The witness (`inputs/normal-point`) proved that with the combined 81-program
 * authority the journal is readable while a reviewed Point printing is live, yet
 * the Unit Chain helper still returned `sourceCensus: "unknown"` because
 * `noCardPlayCostEffect` had no exact branch for the reviewed
 * `point-damage-spell-resolution` IR. This file pins the minimal red -> green
 * adapter fix with real decks only:
 *
 * - a real Point81 mixed deck (3x reviewed Point Spell `ogn-009-298`) must reach
 *   a real, native Main head and complete the Unit Chain source census;
 * - the same deck on the 77 authority must stay exactly as before (unknown);
 * - an unresolved new DSL source must stay unknown, never no-effect;
 * - the census must not fabricate Point damage: no effect executes here.
 *
 * Two clearly separated layers are covered and must NOT be conflated:
 *
 * 1. SYNTHETIC FRAME FIXTURE (describe "synthetic frame fixture ...").
 *    `commitDuelPlayingMutationV2` opens Main, readies Legends and sets the
 *    priority/turn player by hand. It isolates the source-census adapter surface
 *    only and does NOT prove a normal turn. These three tests are the reviewed
 *    fixture source-census unit tests.
 * 2. REAL NATIVE NORMAL TURN (describe "real native normal turn ...").
 *    No frame/resource/zone/readiness mutation. The production
 *    `createDuelProductionSourceServicesV2(...).phaseRegistry` plus the native
 *    turn/command APIs drive setup -> double mulligan -> `runDuelStartOfTurnV2`
 *    (awaken/begin/hold/channel/draw) -> real Main; only then does the real
 *    printed Unit Chain `begin` open the Chain and the source census have to
 *    complete. When a live source cannot be resolved the native turn stays
 *    `pending` and the test asserts that instead of skipping to a fake Main.
 *
 * Scope note: this proves SOURCE census acceptance only. The Point Spell's own
 * damage/closure wiring is a separate task and remains pending; no Point damage
 * is executed or claimed anywhere in this file.
 */
import { describe, expect, it } from "vitest";
import {
  applyDuelResourceCommandV2,
  advanceDuelCommandSessionNativeV2,
  beginDuelPrintedUnitPhysicalChainV4,
  commitDuelPlayingMutationV2,
  createDuelCommandSessionV2,
  createDuelPrintedUnitChainSessionV4,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  inspectDuelNativeCommitPathV2,
  inspectDuelPrintedUnitPhysicalChainV4,
  runDuelStartOfTurnV2,
  type DuelCanonicalPlayingStateV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelTurnCheckpointV2,
  type DuelTurnServicesV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { buildDuelSetupSeats } from "../../src/duel/setup-seats.js";
import { createCatalogCardTypeResolverV2 } from "../../src/duel/catalog-card-type-v2.js";
import {
  createDuelFuryOptionalRosterCardProgramAuthorityV1,
  createDuelPointDamageCardProgramAuthorityV1,
  getCardProgramRegistryForRuntime,
  type CardProgramAuthority,
} from "../../src/duel/card-program-authority.js";
import {
  createDuelNativeOperationJournalV2,
  type DuelNativeObservedCommitV2,
} from "../../src/duel/operation-journal-v2.js";
import { createDuelProductionSourceServicesV2 } from "../../src/duel/production-source-services-v2.js";
import { createDuelPrintedUnitChainServicesP8 } from "../../src/duel/printed-unit-chain-services-p8.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";
import type { DeckSubmission } from "@riftbound/protocol";

const runtime = await loadCardCatalogRuntime();
const accelerateUnitIds = ["ogn-001-298", "ogn-010-298"];
const pointSpellId = "ogn-009-298";
// A real, reviewed-catalog-ready 77 printing that the Point81 authority does NOT
// resolve: a legal Fury Spell that keeps the deck valid but stays unknown.
const unresolvedSpellId = "ven-015-166";

/** Replace one equal copy count with another; never add or drop a card. */
function swapMainDeck(from: string, to: string): DeckSubmission {
  const deck = JSON.parse(JSON.stringify(fury77RealDecks.a)) as DeckSubmission;
  return {
    ...deck,
    mainDeck: deck.mainDeck.map((entry) =>
      entry.cardId === from ? { cardId: to, quantity: entry.quantity } : entry),
  } as DeckSubmission;
}

type AuthorityKind = "fury77" | "point81";

function authority(kind: AuthorityKind): CardProgramAuthority {
  return kind === "fury77"
    ? createDuelFuryOptionalRosterCardProgramAuthorityV1(runtime)
    : createDuelPointDamageCardProgramAuthorityV1(runtime);
}

function contextFor(match: DuelCanonicalPlayingStateV2,
  event: DuelPhaseSourceClosureContextV2["event"], taskId: string): DuelPhaseSourceClosureContextV2 {
  return { matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    turn: match.frame.turnNumber, taskId, phase: event, event,
    clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq } };
}

/**
 * SYNTHETIC FRAME FIXTURE host.
 *
 * Real decks and real setup/double-mulligan, but the Main frame is FABRICATED:
 * `commitDuelPlayingMutationV2` writes `frame.phase = "main"`, sets
 * priority/turn player and readies every Legend by hand. This fixture isolates
 * the source-census adapter surface only; it must never be cited as a normal
 * turn. The real native normal turn is covered below.
 */
async function syntheticFrameHost(label: string, deck: DeckSubmission, kind: AuthorityKind) {
  const programs = authority(kind);
  const registry = getCardProgramRegistryForRuntime(programs);
  let entropy = 0;
  const setup = buildDuelSetupSeats(runtime, {
    matchId: label,
    seats: [{ playerId: "alice", displayName: "alice", deck },
      { playerId: "bob", displayName: "bob", deck }],
  }, () => `${label}-${++entropy}`);
  if (!setup.ok) throw new TypeError(`${label}: real setup rejected with ${setup.code}`);
  const types = createCatalogCardTypeResolverV2(runtime);
  let command = createDuelCommandSessionV2(setup.seats, setup.metadata, () => 0,
    types.forMatch(setup.metadata));
  const genesis = command.match;
  let current: DuelCanonicalPlayingStateV2 = command.match;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  let seq = 0;
  const observe = (before: DuelCanonicalPlayingStateV2, after: DuelCanonicalPlayingStateV2,
    event: "mulligan" | "main" | "chain", uid?: string) => {
    const native = inspectDuelNativeCommitPathV2(before, after);
    const stamp = ++seq;
    journal.observe({ ancestor: before, descendant: after,
      commits: native.map((_, index) => ({ operationId: `${label}-${stamp}-${index}`,
        eventId: `${label}-${stamp}-${index}`, event, phase: "main" as const,
        ...(index === 0 && uid ? { sourceUID: uid } : {}) })) });
    current = after;
    return native.length;
  };
  for (const actor of ["alice", "bob"]) {
    const before = command.match;
    const applied = applyDuelResourceCommandV2(command, actor, { commandId: `${label}-mulligan-${actor}`,
      expectedVersion: before.stateVersion, command: { type: "mulligan", selectedUIDs: [] } });
    if (applied.outcome.status !== "applied") throw new TypeError(`${label}: mulligan ${applied.outcome.status}`);
    command = applied.session;
    observe(before, command.match, "mulligan");
  }
  // SYNTHETIC: open Main and ready Legends by hand. Not a normal turn.
  const beforeMain = command.match;
  const opened = commitDuelPlayingMutationV2(command.match, (draft) => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" as const }])),
    frame: { ...draft.frame, phase: "main" as const, stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  command = advanceDuelCommandSessionNativeV2(command, opened).session;
  observe(beforeMain, command.match, "main");
  const services = createDuelPrintedUnitChainServicesP8({ catalog: runtime, programs,
    currentHead: () => current, currentJournal: () => journal, currentSession: () => command,
    nextOpaqueId: () => `${label}-id-${++entropy}` });
  const target = command.match.players[0]!.hand.find((card) => accelerateUnitIds.includes(card.cardId));
  if (!target) throw new TypeError(`${label}: no Accelerate Unit was dealt`);
  const session = createDuelPrintedUnitChainSessionV4(command, services);
  const beforeBegin = current;
  const begun = beginDuelPrintedUnitPhysicalChainV4(session, "alice", {
    commandId: `${label}-begin`, expectedVersion: command.match.stateVersion,
    command: { cardUID: target.uid },
  });
  if (begun.outcome.status !== "choice") throw new TypeError(`${label}: begin ${begun.outcome.status}`);
  const chain = begun.session.commandSession.match;
  command = begun.session.commandSession;
  const commitCount = observe(beforeBegin, chain, "chain", target.uid);
  const context = { matchId: chain.matchId, dataVersion: chain.dataVersion, catalogDigest: chain.catalogDigest,
    turn: chain.frame.turnNumber,
    taskId: `duel-v4:${chain.matchId}:turn-${chain.frame.turnNumber}:printed-unit:${target.uid}:${chain.stateVersion}`,
    phase: "main" as const, event: "chain" as const,
    clock: { stateVersion: chain.stateVersion, eventSeq: chain.eventSeq } };
  journal.bindContext(context, `${label}-${seq}-${commitCount - 1}`);
  const fingerprint = services.program({ match: chain, matchId: chain.matchId,
    dataVersion: chain.dataVersion, catalogDigest: chain.catalogDigest, actor: "alice",
    uid: target.uid, cardId: target.cardId,
    sourceEpoch: chain.physicalCardsByUID[target.uid]!.zoneEpoch });
  const request = { match: chain, matchId: chain.matchId, stateVersion: chain.stateVersion,
    eventSeq: chain.eventSeq, actor: "alice", uid: target.uid, cardId: target.cardId,
    sourceEpoch: chain.physicalCardsByUID[target.uid]!.zoneEpoch,
    baseLocationId: chain.board.bases.find((base) => base.ownerPlayerId === "alice")!.locationId,
    programId: fingerprint.programFingerprint };
  const census = enumerateDuelPhaseSourceClosureCandidatesV2(chain);
  return { services, programs, registry, chain, context, request,
    entry: services.entry(request), closure: services.inspectClosure(request, context), census };
}

describe("synthetic frame fixture: Point81 Unit Chain source census adapter", () => {
  it("SYNTHETIC fixture: completes the census for a mixed Point deck without executing the Point effect", async () => {
    const mixed = swapMainDeck("ogn-013-298", pointSpellId);
    const h = await syntheticFrameHost("census-mixed-81", mixed, "point81");

    const pointInCensus = h.census.filter((candidate) =>
      candidate.cardId === pointSpellId);
    expect(pointInCensus.length).toBeGreaterThan(0);
    expect(pointInCensus.every((candidate) =>
      h.registry.getProgram(candidate.cardId!)?.semantics.kind === "point-damage-spell-resolution"))
      .toBe(true);
    expect(h.census.every((candidate) => candidate.cardId === null ||
      h.programs.resolvedProgramReference(candidate.cardId) !== undefined)).toBe(true);

    expect(h.closure.status).toBe("ready");
    expect(h.entry.sourceCensus).toBe("complete");
    expect(h.entry.resolution).toBe("complete");
    expect(h.entry.sources).toHaveLength(h.census.length);
    expect(h.entry.sources.every((source) => source.disposition === "known-no-effect")).toBe(true);
    expect(h.entry.sources.some((source) => source.programId === h.request.programId)).toBe(true);

    // The census is source metadata only: the Point Spell's damage is NOT
    // executed here and no Unit entered, paid or finished resolution.
    expect(h.chain.board.units.some((unit) => unit.objectId === h.request.uid)).toBe(false);
    expect(h.chain.frame.pendingPayment).toBeNull();
    expect(h.chain.chainCards?.some((card) => card.uid === h.request.uid)).toBe(true);
  });

  it("SYNTHETIC fixture: keeps the 77 authority behaviour on the same real decks", async () => {
    const control = JSON.parse(JSON.stringify(fury77RealDecks.a)) as DeckSubmission;
    const untouched = await syntheticFrameHost("census-control-77", control, "fury77");
    expect(untouched.closure.status).toBe("ready");
    expect(untouched.entry.sourceCensus).toBe("complete");
    expect(untouched.entry.sources).toHaveLength(untouched.census.length);

    // The 77 authority does not resolve the reviewed Point Spell, so the live
    // printing keeps the census unknown exactly as the witness recorded.
    const mixed = swapMainDeck("ogn-013-298", pointSpellId);
    const blocked = await syntheticFrameHost("census-mixed-77", mixed, "fury77");
    expect(blocked.programs.resolvedProgramReference(pointSpellId)).toBeUndefined();
    expect(blocked.closure.status).toBe("pending");
    expect(blocked.entry.sourceCensus).toBe("unknown");
    expect(blocked.entry.resolution).toBe("unknown");
    expect(blocked.entry.sources).toHaveLength(0);
  });

  it("SYNTHETIC fixture: keeps an unresolved new DSL source unknown instead of no-effect", async () => {
    const unresolved = swapMainDeck("ogn-013-298", unresolvedSpellId);
    const h = await syntheticFrameHost("census-unresolved-81", unresolved, "point81");
    expect(h.programs.resolvedProgramReference(unresolvedSpellId)).toBeUndefined();
    expect(h.census.some((candidate) => candidate.cardId === unresolvedSpellId)).toBe(true);
    expect(h.closure.status).toBe("pending");
    expect(h.entry.sourceCensus).toBe("unknown");
    expect(h.entry.resolution).toBe("unknown");
    expect(h.entry.sources).toHaveLength(0);
  });
});

/**
 * REAL native normal-turn host.
 *
 * Everything below uses only real, admitted inputs: real decks and real setup,
 * the two real resource (mulligan) commands, then the native
 * `runDuelStartOfTurnV2` over the production
 * `createDuelProductionSourceServicesV2(...).phaseRegistry`. The runtime opens
 * Awaken, readies the turn player's Legend/Units/Runes, Holds, Channels, Draws
 * and enters Main itself. The harness NEVER writes frame, resources, zones or
 * readiness; it only records each native commit into the operation journal
 * (labeling) exactly as the production owner does, and binds phase contexts.
 *
 * The only judgement made here is the operation-journal label for each native
 * commit and the Chain opening, mirroring `authoritative-runtime-p4.ts`
 * `recordHead`. A wrong label fails closed as `pending`, never as a fake
 * `complete`.
 */
type NativeHost = {
  readonly kind: AuthorityKind;
  readonly turnStatus: string;
  readonly phase: string;
  readonly cursorStep: string | undefined;
  readonly pendingTaskId: string | null | undefined;
  readonly aliceRunes: number;
  readonly aliceHandCards: number;
  readonly legendReadiness: readonly string[];
  readonly pointInHand: number;
  readonly awakenInspection: string;
  readonly targetCardId?: string;
  readonly targetUID?: string;
  readonly census?: readonly ReturnType<typeof enumerateDuelPhaseSourceClosureCandidatesV2>[number][];
  readonly entry?: { readonly sourceCensus: string; readonly resolution: string;
    readonly sources: readonly { readonly disposition: string; readonly programId: string }[] };
  readonly closure?: { readonly status: string; readonly reason?: string };
  readonly registry?: ReturnType<typeof getCardProgramRegistryForRuntime>;
  readonly targetInChain?: boolean;
  readonly pendingPayment?: unknown;
  readonly unitOnBoard?: boolean;
};

async function realNormalTurnHost(label: string, deck: DeckSubmission,
  kind: AuthorityKind): Promise<NativeHost> {
  const programs = authority(kind);
  const registry = getCardProgramRegistryForRuntime(programs);
  let entropy = 0;
  const setup = buildDuelSetupSeats(runtime, {
    matchId: label,
    seats: [{ playerId: "alice", displayName: "alice", deck },
      { playerId: "bob", displayName: "bob", deck }],
  }, () => `${label}-${++entropy}`);
  if (!setup.ok) throw new TypeError(`${label}: real setup rejected with ${setup.code}`);
  const types = createCatalogCardTypeResolverV2(runtime);
  let command = createDuelCommandSessionV2(setup.seats, setup.metadata, () => 0,
    types.forMatch(setup.metadata));
  const genesis = command.match;
  let current: DuelCanonicalPlayingStateV2 = command.match;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  let physical: ReturnType<typeof inspectDuelPrintedUnitPhysicalChainV4> | null = null;
  // Mirror authoritative-runtime-p4.ts recordHead: one label per native commit,
  // plus the draw / zone-transition / pre-exit context binding. Never mutates state.
  const recordHead = (next: DuelCanonicalPlayingStateV2, taskId?: string): number => {
    const ancestor = journal.observedHead();
    const path = inspectDuelNativeCommitPathV2(ancestor, next);
    if (!path.length) return 0;
    const chainOpening = physical?.phase === "choice" && next.stage === "playing" && path.length === 2 &&
      path[0]!.transitions.length === 1 && path[0]!.transitions[0]!.uid === physical.cardUID &&
      path[0]!.transitions[0]!.from.kind === "hand" && path[0]!.transitions[0]!.to.kind === "chain" &&
      path[1]!.transitions.length === 0;
    const labels = path.map((commit, index) => {
      const event = chainOpening ? "chain" : commit.before.stage === "setup" ? "mulligan" :
        commit.transitions.some((t) => t.from.kind === "main-deck" && t.to.kind === "hand") ? "draw" :
          commit.transitions.some((t) => t.to.kind === "trash") ? "pre-exit" :
            commit.transitions.length ? "zone-transition" : "intrinsic-step";
      return { operationId: `p4-native:${next.matchId}:${commit.after.stateVersion}`,
        eventId: `p4-event:${next.matchId}:${commit.after.eventSeq}`,
        event: event as DuelNativeObservedCommitV2["event"],
        ...(chainOpening && index === 0 ? { sourceUID: physical!.cardUID! } : {}),
        ...(taskId ? { taskId } : {}) };
    });
    journal.observe({ ancestor, descendant: next, commits: labels });
    current = next;
    if (next.stage === "playing") {
      const latest = labels.at(-1)!;
      const openChainUID = physical?.phase !== "completed" ? physical?.cardUID ?? null : null;
      if (openChainUID !== null && next.chainCards?.some((card) => card.uid === openChainUID)) {
        journal.bindContext({ matchId: next.matchId, dataVersion: next.dataVersion,
          catalogDigest: next.catalogDigest, turn: next.frame.turnNumber,
          taskId: `duel-v4:${next.matchId}:turn-${next.frame.turnNumber}:printed-unit:${openChainUID}:${next.stateVersion}`,
          phase: "main", event: "chain",
          clock: { stateVersion: next.stateVersion, eventSeq: next.eventSeq } });
      }
      if (latest.event === "draw" || latest.event === "pre-exit" || latest.event === "zone-transition") {
        journal.bindContext({ matchId: next.matchId, dataVersion: next.dataVersion,
          catalogDigest: next.catalogDigest, turn: next.frame.turnNumber,
          taskId: taskId ?? `duel-v2:${next.matchId}:turn-${next.frame.turnNumber}:native:${next.stateVersion}`,
          phase: "main", event: latest.event, clock: { stateVersion: next.stateVersion, eventSeq: next.eventSeq } });
      }
    }
    return path.length;
  };
  for (const actor of ["alice", "bob"]) {
    const before = command.match;
    const applied = applyDuelResourceCommandV2(command, actor, { commandId: `${label}-mulligan-${actor}`,
      expectedVersion: before.stateVersion, command: { type: "mulligan", selectedUIDs: [] } });
    if (applied.outcome.status !== "applied") throw new TypeError(`${label}: mulligan ${applied.outcome.status}`);
    command = applied.session;
    recordHead(command.match, `duel-v2:${label}:turn-1:setup:${actor}`);
  }
  const services = createDuelProductionSourceServicesV2({
    catalog: runtime, matchId: label, currentHead: () => current, programs, globalJournal: journal });
  let awakenInspection = "unobserved";
  const turn: DuelTurnServicesV2 = {
    sources: services.phaseRegistry,
    observeCheckpoint: (checkpoint: DuelTurnCheckpointV2) => {
      try {
        recordHead(checkpoint.match, checkpoint.taskId);
        const context = contextFor(checkpoint.match, checkpoint.event as never, checkpoint.taskId);
        journal.bindContext(context);
        if (checkpoint.step === "awaken") awakenInspection = services.inspect(context).status;
      } catch { return false; }
      return true;
    },
    fepr: (match, taskId) => journal.read(contextFor(match, "fepr", taskId))
      ? { status: "none" } : { status: "pending" },
    firstBurnout: () => ({ status: "pending" }),
    burnoutIntervention: () => ({ status: "pending" }),
  };
  const started = runDuelStartOfTurnV2(command, turn);
  const after = (started.session ?? command) as typeof command;
  const match = after.match as DuelCanonicalPlayingStateV2;
  const base: NativeHost = { kind, turnStatus: started.status, phase: match.frame.phase,
    cursorStep: after.turnCursorV2?.step, pendingTaskId: after.turnCursorV2?.pendingTaskID,
    aliceRunes: match.resources.bases.find((entry) => entry.playerId === "alice")!.baseRunes.length,
    aliceHandCards: match.players[0]!.hand.length,
    legendReadiness: Object.values(match.legendStates).map((state) => state.readiness),
    pointInHand: match.players[0]!.hand.filter((card) => card.cardId === pointSpellId).length,
    awakenInspection };
  if (started.status !== "main") return base;
  command = after;
  const target = match.players[0]!.hand.find((card) => accelerateUnitIds.includes(card.cardId));
  if (!target) return { ...base, targetCardId: undefined };
  const chainServices = createDuelPrintedUnitChainServicesP8({ catalog: runtime, programs,
    currentHead: () => current, currentJournal: () => journal, currentSession: () => command,
    nextOpaqueId: () => `${label}-id-${++entropy}` });
  const session = createDuelPrintedUnitChainSessionV4(command, chainServices);
  const beforeBegin = current;
  const begun = beginDuelPrintedUnitPhysicalChainV4(session, "alice", {
    commandId: `${label}-begin`, expectedVersion: command.match.stateVersion,
    command: { cardUID: target.uid },
  });
  if (begun.outcome.status !== "choice") throw new TypeError(`${label}: begin ${begun.outcome.status}`);
  physical = inspectDuelPrintedUnitPhysicalChainV4(begun.session);
  const chain = begun.session.commandSession.match as DuelCanonicalPlayingStateV2;
  command = begun.session.commandSession;
  recordHead(chain,
    `duel-v4:${chain.matchId}:turn-${chain.frame.turnNumber}:printed-unit:${target.uid}:${chain.stateVersion}`);
  const context = { matchId: chain.matchId, dataVersion: chain.dataVersion, catalogDigest: chain.catalogDigest,
    turn: chain.frame.turnNumber,
    taskId: `duel-v4:${chain.matchId}:turn-${chain.frame.turnNumber}:printed-unit:${target.uid}:${chain.stateVersion}`,
    phase: "main" as const, event: "chain" as const,
    clock: { stateVersion: chain.stateVersion, eventSeq: chain.eventSeq } };
  const fingerprint = chainServices.program({ match: chain, matchId: chain.matchId,
    dataVersion: chain.dataVersion, catalogDigest: chain.catalogDigest, actor: "alice",
    uid: target.uid, cardId: target.cardId,
    sourceEpoch: chain.physicalCardsByUID[target.uid]!.zoneEpoch });
  const request = { match: chain, matchId: chain.matchId, stateVersion: chain.stateVersion,
    eventSeq: chain.eventSeq, actor: "alice", uid: target.uid, cardId: target.cardId,
    sourceEpoch: chain.physicalCardsByUID[target.uid]!.zoneEpoch,
    baseLocationId: chain.board.bases.find((base_) => base_.ownerPlayerId === "alice")!.locationId,
    programId: fingerprint.programFingerprint };
  return { ...base, targetCardId: target.cardId, targetUID: target.uid,
    closure: chainServices.inspectClosure(request, context),
    entry: chainServices.entry(request),
    census: enumerateDuelPhaseSourceClosureCandidatesV2(chain),
    registry,
    targetInChain: chain.chainCards?.some((card) => card.uid === target.uid) ?? false,
    pendingPayment: chain.frame.pendingPayment,
    unitOnBoard: chain.board.units.some((unit) => unit.objectId === target.uid) };
}

describe("real native normal turn: Point81 Unit Chain source census", () => {
  it("reaches real Main via setup -> double mulligan -> StartOfTurn and completes the census", async () => {
    const mixed = swapMainDeck("ogn-013-298", pointSpellId);
    const h = await realNormalTurnHost("normal-mixed-81", mixed, "point81");

    // The turn was driven by the native kernel, not a fabricated frame: Awaken
    // readied the Legend, Channel took real Runes and Draw added a real card.
    expect(h.turnStatus).toBe("main");
    expect(h.phase).toBe("main");
    expect(h.cursorStep).toBe("main");
    expect(h.pendingTaskId).toBeNull();
    expect(h.awakenInspection).toBe("ready");
    expect(h.legendReadiness).toEqual(["ready", "ready"]);
    expect(h.aliceRunes).toBe(2);
    expect(h.aliceHandCards).toBe(5);

    // The real Unit Chain opened over that same real Main head.
    expect(h.targetCardId).toBeDefined();
    expect(h.closure?.status).toBe("ready");
    expect(h.entry?.sourceCensus).toBe("complete");
    expect(h.entry?.resolution).toBe("complete");
    expect(h.entry?.sources).toHaveLength(h.census!.length);
    expect(h.entry?.sources.every((source) => source.disposition === "known-no-effect")).toBe(true);

    const pointInCensus = (h.census ?? []).filter((candidate) => candidate.cardId === pointSpellId);
    expect(pointInCensus.length).toBeGreaterThan(0);
    expect(pointInCensus.every((candidate) =>
      h.registry!.getProgram(candidate.cardId!)?.semantics.kind === "point-damage-spell-resolution"))
      .toBe(true);
    expect(h.entry?.sources.some((source) => source.programId.length > 0)).toBe(true);

    // Source census only: the Point damage did NOT execute; the Accelerate Unit
    // is still a Chain card and never entered or paid.
    expect(h.unitOnBoard).toBe(false);
    expect(h.pendingPayment).toBeNull();
    expect(h.targetInChain).toBe(true);
  }, 60_000);

  it("accepts the 77 authority on the untouched real deck through the same normal turn", async () => {
    const control = JSON.parse(JSON.stringify(fury77RealDecks.a)) as DeckSubmission;
    const h = await realNormalTurnHost("normal-control-77", control, "fury77");
    expect(h.turnStatus).toBe("main");
    expect(h.phase).toBe("main");
    expect(h.awakenInspection).toBe("ready");
    expect(h.aliceRunes).toBe(2);
    expect(h.pointInHand).toBe(0);
    expect(h.closure?.status).toBe("ready");
    expect(h.entry?.sourceCensus).toBe("complete");
    expect(h.entry?.sources).toHaveLength(h.census!.length);
  }, 60_000);

  it("stays pending in a real normal turn when a live source stays unresolved (no manual skip)", async () => {
    // The same real decks with one reviewed Point Spell on the 77 authority: the
    // pre-turn Awaken global census cannot resolve the live Point printing, so
    // the native turn refuses to open and NOTHING is fabricated to reach Main.
    const mixed = swapMainDeck("ogn-013-298", pointSpellId);
    const blocked = await realNormalTurnHost("normal-mixed-77", mixed, "fury77");
    expect(blocked.turnStatus).toBe("pending");
    expect(blocked.phase).toBe("awaiting-turn-start");
    expect(blocked.cursorStep).toBe("awaken");
    expect(blocked.pendingTaskId).toBe("duel-v2:normal-mixed-77:turn-1:awaken:0");
    expect(blocked.awakenInspection).toBe("pending");
    expect(blocked.aliceRunes).toBe(0);
    expect(blocked.legendReadiness).toEqual(["not-established", "not-established"]);
    expect(blocked.entry).toBeUndefined();

    // A genuinely unresolved new DSL source on the 81 authority is the same
    // pre-turn refusal: pending, never silently no-effect.
    const unresolved = swapMainDeck("ogn-013-298", unresolvedSpellId);
    const unknown = await realNormalTurnHost("normal-unresolved-81", unresolved, "point81");
    expect(unknown.turnStatus).toBe("pending");
    expect(unknown.phase).toBe("awaiting-turn-start");
    expect(unknown.awakenInspection).toBe("pending");
    expect(unknown.aliceRunes).toBe(0);
  }, 60_000);
});
