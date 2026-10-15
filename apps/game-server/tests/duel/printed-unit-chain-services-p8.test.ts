import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2,
  createDuelCommandSessionV2,
  createDuelPrintedUnitChainSessionV4,
  beginDuelPrintedUnitPhysicalChainV4,
  answerDuelPrintedUnitPhysicalChainV4,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  inspectDuelNativeCommitPathV2,
  inspectDuelPhaseSourceClosureV2,
  applyDuelResourceCommandV2,
  advanceDuelCommandSessionNativeV2,
  moveDuelPhysicalCardToChainV2,
  referenceDuelPhysicalCardV2,
  commitDuelCommandFrameV2,
  type DuelCanonicalPlayingStateV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { buildDuelSetupSeats } from "../../src/duel/setup-seats.js";
import { createCatalogCardTypeResolverV2 } from "../../src/duel/catalog-card-type-v2.js";
import { createDuelFuryOptionalRosterCardProgramAuthorityV1 } from "../../src/duel/card-program-authority.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import { createDuelPrintedUnitChainServicesP8 } from "../../src/duel/printed-unit-chain-services-p8.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

const runtime = await loadCardCatalogRuntime();
const targetId = "ogn-001-298";

async function fixture() {
  const programs = createDuelFuryOptionalRosterCardProgramAuthorityV1(runtime);
  let entropy = 0;
  const setup = buildDuelSetupSeats(runtime, {
    matchId: "printed-unit-chain-services-p8",
    seats: [{ playerId: "alice", displayName: "alice", deck: fury77RealDecks.a },
      { playerId: "bob", displayName: "bob", deck: fury77RealDecks.b }],
  }, () => `p8-${++entropy}`);
  if (!setup.ok) throw new TypeError(`setup failed: ${setup.code}`);
  const types = createCatalogCardTypeResolverV2(runtime);
  let command = createDuelCommandSessionV2(setup.seats, setup.metadata, () => 0, types.forMatch(setup.metadata));
  const genesis = command.match;
  let current: DuelCanonicalPlayingStateV2 | typeof genesis = command.match;
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  const observe = (before: DuelCanonicalPlayingStateV2 | typeof genesis,
    after: DuelCanonicalPlayingStateV2, event: "chain" | "main", uid?: string) => {
    current = after;
    const native = inspectDuelNativeCommitPathV2(before, after);
    journal.observe({ ancestor: before, descendant: after,
      commits: native.map((_, index) => ({ operationId: `p8-${event}-${after.stateVersion}-${index}`,
        eventId: `p8-${event}-${after.eventSeq}-${index}`, event, phase: "main" as const,
        ...(index === 0 && uid ? { sourceUID: uid } : {}) })) });
  };
  const afterAlice = applyDuelResourceCommandV2(command, "alice", { commandId: "p8-mulligan-a",
    expectedVersion: command.match.stateVersion, command: { type: "mulligan", selectedUIDs: [] } });
  command = afterAlice.session;
  current = command.match;
  journal.observe({ ancestor: genesis, descendant: command.match,
    commits: [{ operationId: "p8-mulligan-a", eventId: "p8-mulligan-a", event: "mulligan" }] });
  const afterBob = applyDuelResourceCommandV2(command, "bob", { commandId: "p8-mulligan-b",
    expectedVersion: command.match.stateVersion, command: { type: "mulligan", selectedUIDs: [] } });
  command = afterBob.session;
  current = command.match;
  journal.observe({ ancestor: afterAlice.session.match, descendant: command.match,
    commits: [{ operationId: "p8-mulligan-b", eventId: "p8-mulligan-b", event: "mulligan" }] });
  const opened = commitDuelPlayingMutationV2(command.match, draft => ({ match: { ...draft,
    legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
      [uid, { ...state, readiness: "ready" }])),
    frame: { ...draft.frame, phase: "main", stateOpen: true,
      priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
  command = advanceDuelCommandSessionNativeV2(command, opened).session;
  current = command.match;
  journal.observe({ ancestor: afterBob.session.match, descendant: command.match,
    commits: [{ operationId: "p8-main", eventId: "p8-main", event: "main" }] });
  const services = createDuelPrintedUnitChainServicesP8({ catalog: runtime, programs,
    currentHead: () => current as DuelCanonicalPlayingStateV2,
    currentJournal: () => journal,
    currentSession: () => command,
    nextOpaqueId: () => `p8-choice-${++entropy}` });
  const target = command.match.players[0]!.hand.find(card => card.cardId === targetId);
  if (!target) throw new TypeError("target printing was not dealt");
  const session = createDuelPrintedUnitChainSessionV4(command, services);
  return { services, session, target, opened: command.match, journal, get current() { return current; }, set current(value: DuelCanonicalPlayingStateV2) { current = value; },
    get command() { return command; }, set command(value: typeof command) { command = value; }, observe };
}

describe("printed Unit Chain P8 source services", () => {
  it("binds a real Fury77 printing in Hand and rejects a foreign source", async () => {
    const f = await fixture();
    const source = f.services.program({ match: f.opened, matchId: f.opened.matchId,
      dataVersion: f.opened.dataVersion, catalogDigest: f.opened.catalogDigest,
      actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
      sourceEpoch: f.opened.physicalCardsByUID[f.target.uid]!.zoneEpoch });
    expect(source.status).toBe("known");
    expect(source.kind).toBe("Unit");
    expect(source.optionalCost).toBe("accelerate");
    expect(f.services.program({ ...f.opened, match: structuredClone(f.opened), actor: "alice", uid: f.target.uid,
      cardId: f.target.cardId, sourceEpoch: 0 } as never).status).toBe("unknown");
  });

  it("moves the genuine physical UID to Chain before choice and keeps pre-payment entry blocked", async () => {
    const f = await fixture();
    const before = f.current;
    const result = beginDuelPrintedUnitPhysicalChainV4(f.session, "alice", {
      commandId: "p8-begin", expectedVersion: before.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(result.outcome.status).toBe("choice");
    const chain = result.session.commandSession.match;
    expect(chain.chainCards.some(card => card.uid === f.target.uid)).toBe(true);
    expect(chain.players.flatMap(player => player.hand).some(card => card.uid === f.target.uid)).toBe(false);
    expect(chain.frame.stateOpen).toBe(false);
    expect(chain.physicalCardsByUID[f.target.uid]!.zoneEpoch).toBeGreaterThan(
      before.physicalCardsByUID[f.target.uid]!.zoneEpoch);
    const entry = f.services.entry({ match: chain, matchId: chain.matchId, stateVersion: chain.stateVersion,
      eventSeq: chain.eventSeq, actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
      sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch,
      baseLocationId: chain.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
      programId: (f.services.program({ match: chain, matchId: chain.matchId, dataVersion: chain.dataVersion,
        catalogDigest: chain.catalogDigest, actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
        sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch })).programFingerprint });
    expect(entry.sourceCensus).toBe("unknown");
  });

  it("rejects a same-origin, same-clock sibling after the actual V4 choice head is pinned", async () => {
    const f = await fixture();
    const prePinMoved = moveDuelPhysicalCardToChainV2(f.opened,
      referenceDuelPhysicalCardV2(f.opened, f.target.uid), "alice");
    const prePinSession = advanceDuelCommandSessionNativeV2(f.command, prePinMoved).session;
    const prePinSibling = commitDuelCommandFrameV2(prePinSession,
      { ...prePinMoved.frame, stateOpen: false }, () => undefined).session.match;
    expect(() => f.services.choice.readSource(prePinSibling, "alice", f.target.uid)).toThrow(/stale|foreign/);
    const begun = beginDuelPrintedUnitPhysicalChainV4(f.session, "alice", {
      commandId: "p8-real-head", expectedVersion: f.opened.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(begun.outcome.status).toBe("choice");
    const moved = moveDuelPhysicalCardToChainV2(f.opened,
      referenceDuelPhysicalCardV2(f.opened, f.target.uid), "alice");
    const movedSession = advanceDuelCommandSessionNativeV2(f.command, moved).session;
    const sibling = commitDuelCommandFrameV2(movedSession,
      { ...moved.frame, stateOpen: false }, () => undefined).session.match;
    expect(sibling.stateVersion).toBe(begun.session.commandSession.match.stateVersion);
    expect(sibling).not.toBe(begun.session.commandSession.match);
    expect(f.services.program({ match: sibling, matchId: sibling.matchId,
      dataVersion: sibling.dataVersion, catalogDigest: sibling.catalogDigest, actor: "alice",
      uid: f.target.uid, cardId: f.target.cardId,
      sourceEpoch: sibling.physicalCardsByUID[f.target.uid]!.zoneEpoch }).status).toBe("unknown");
    expect(() => f.services.choice.readSource(sibling, "alice", f.target.uid)).toThrow(/sibling|stale|foreign/);
    expect(() => f.services.choice.readSourceV4?.(sibling, "alice", f.target.uid, () => undefined as never))
      .toThrow(/attempt source proof/);
    expect(() => f.services.choice.readSourceV4?.(sibling, "alice", f.target.uid,
      Object.freeze({ matchId: sibling.matchId, actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
        chainEpoch: sibling.physicalCardsByUID[f.target.uid]!.zoneEpoch }) as never))
      .toThrow(/attempt source proof/);
  });

  it("does not issue a cost authority or attest payment from a stale/foreign Chain head", async () => {
    const f = await fixture();
    const result = beginDuelPrintedUnitPhysicalChainV4(f.session, "alice", {
      commandId: "p8-stale", expectedVersion: f.current.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(result.outcome.status).toBe("choice");
    const chain = result.session.commandSession.match;
    const program = f.services.program({ match: chain, matchId: chain.matchId, dataVersion: chain.dataVersion,
      catalogDigest: chain.catalogDigest, actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
      sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch });
    expect(program.status).toBe("known");
    expect(() => f.services.sourceAttestor({ match: chain, actor: "alice",
      paymentId: "printed-unit-chain-v4-payment:alice:p8-stale",
      sourceReference: { kind: "card", referenceId: f.target.cardId, sourceUID: f.target.uid },
      finalResolvedCost: { energy: 1, power: [] }, taskId: "fake-task", continuationId: "fake-continuation" }))
      .toThrow(/proof required/);
    expect(() => f.services.sourceAttestor({ match: structuredClone(chain) as never, actor: "alice",
      paymentId: "foreign-payment", sourceReference: { kind: "card", referenceId: f.target.cardId, sourceUID: f.target.uid },
      finalResolvedCost: { energy: 1, power: [] } })).toThrow();
  });

  it("keeps the genuine Chain cost/entry path pending when the journal has not observed Core's native commits", async () => {
    const f = await fixture();
    const before = f.current;
    const begun = beginDuelPrintedUnitPhysicalChainV4(f.session, "alice", {
      commandId: "p8-unobserved", expectedVersion: before.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(begun.outcome.status).toBe("choice");
    const chain = begun.session.commandSession.match;
    f.current = chain;
    const context = { matchId: chain.matchId, dataVersion: chain.dataVersion, catalogDigest: chain.catalogDigest,
      turn: chain.frame.turnNumber, taskId: `duel-v4:${chain.matchId}:turn-${chain.frame.turnNumber}:printed-unit:${f.target.uid}:${chain.stateVersion}`,
      phase: "main" as const, event: "chain" as const,
      clock: { stateVersion: chain.stateVersion, eventSeq: chain.eventSeq } };
    const request = { match: chain, matchId: chain.matchId, stateVersion: chain.stateVersion, eventSeq: chain.eventSeq,
      actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
      sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch,
      baseLocationId: chain.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
      programId: f.services.program({ match: chain, matchId: chain.matchId, dataVersion: chain.dataVersion,
        catalogDigest: chain.catalogDigest, actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
        sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch }).programFingerprint };
    expect(f.services.inspectClosure(request, context).status).toBe("pending");
    expect(f.services.entry(request).sourceCensus).toBe("unknown");
  });

  it("does not turn an observed Chain with unresolved closure into a false payment", async () => {
    const f = await fixture();
    const before = f.current;
    const begun = beginDuelPrintedUnitPhysicalChainV4(f.session, "alice", {
      commandId: "p8-observed", expectedVersion: before.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(begun.outcome.status).toBe("choice");
    const chain = begun.session.commandSession.match;
    f.current = chain;
    const path = inspectDuelNativeCommitPathV2(before, chain);
    f.journal.observe({ ancestor: before, descendant: chain,
      commits: path.map((_, index) => ({ operationId: `p8-observed-${index}`, eventId: `p8-observed-${index}`,
        event: "chain" as const, phase: "main" as const })) });
    const answered = answerDuelPrintedUnitPhysicalChainV4(begun.session, "alice", {
      commandId: "p8-observed", expectedVersion: chain.stateVersion,
      command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId },
    });
    expect(answered.outcome.status).toBe("blocked");
    expect(["optional-choice-unproved", "cost-or-payment-unproved", "unproven-entry"]).toContain(
      answered.outcome.reason,
    );
    expect(answered.session.commandSession.requiredTasks).toHaveLength(0);
    expect(answered.session.commandSession.match.board.units.some(unit => unit.objectId === f.target.uid)).toBe(false);
  });

  it("accepts a journal-bound native Chain and reaches the genuine required payment task", async () => {
    const f = await fixture();
    const before = f.current;
    const begun = beginDuelPrintedUnitPhysicalChainV4(f.session, "alice", {
      commandId: "p8-genuine-pay", expectedVersion: before.stateVersion, command: { cardUID: f.target.uid },
    });
    expect(begun.outcome.status).toBe("choice");
    if (begun.outcome.status !== "choice") return;
    const chain = begun.session.commandSession.match;
    f.current = chain;
    f.command = begun.session.commandSession;
    const native = inspectDuelNativeCommitPathV2(before, chain);
    expect(native).toHaveLength(2);
    f.journal.observe({ ancestor: before, descendant: chain, commits: native.map((_, index) => ({
      operationId: `p8-genuine-${index}`, eventId: `p8-genuine-${index}`, event: "chain" as const,
      phase: "main" as const, ...(index === 0 ? { sourceUID: f.target.uid } : {}),
    })) });
    const context = { matchId: chain.matchId, dataVersion: chain.dataVersion, catalogDigest: chain.catalogDigest,
      turn: chain.frame.turnNumber, taskId: `duel-v4:${chain.matchId}:turn-${chain.frame.turnNumber}:printed-unit:${f.target.uid}:${chain.stateVersion}`,
      phase: "main" as const, event: "chain" as const,
      clock: { stateVersion: chain.stateVersion, eventSeq: chain.eventSeq } };
    f.journal.bindContext(context, "p8-genuine-1");
    const request = { match: chain, matchId: chain.matchId, stateVersion: chain.stateVersion, eventSeq: chain.eventSeq,
      actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
      sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch,
      baseLocationId: chain.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
      programId: f.services.program({ match: chain, matchId: chain.matchId, dataVersion: chain.dataVersion,
        catalogDigest: chain.catalogDigest, actor: "alice", uid: f.target.uid, cardId: f.target.cardId,
        sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch }).programFingerprint };
    expect(f.services.inspectClosure(request, context).status).toBe("ready");
    const handles = f.services.closure(request, context);
    const inspected = inspectDuelPhaseSourceClosureV2(chain, context, handles.registry, handles.journal);
    expect([inspected.status, inspected.activeSources.length, inspected.handlers.length,
      inspected.runtimeSources.length]).toEqual(["ready", 0, 0, 0]);
    expect(inspected.candidates.filter(candidate => candidate.carrier !== "object" ||
      candidate.cardId === null || candidate.zoneEpoch === null)).toEqual([]);
    expect(f.services.entry(request).sourceCensus).toBe("complete");
    const answered = answerDuelPrintedUnitPhysicalChainV4(begun.session, "alice", {
      commandId: "p8-genuine-pay", expectedVersion: chain.stateVersion,
      command: { choiceId: begun.outcome.prompt.choiceId, optionId: begun.outcome.prompt.payOptionId },
    });
    expect(answered.outcome.status).toBe("pending");
    expect(answered.session.commandSession.requiredTasks).toHaveLength(1);
  });
});
