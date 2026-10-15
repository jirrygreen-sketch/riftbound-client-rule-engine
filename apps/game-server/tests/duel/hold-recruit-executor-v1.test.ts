import { describe, expect, it } from "vitest";
import {
  commitDuelPlayingMutationV2, createDuelMatchV2, enumerateDuelPhaseSourceClosureCandidatesV2,
  resolveDuelMulliganV2, type DuelCanonicalPlayingStateV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { buildDuelSetupSeats } from "../../src/duel/setup-seats.js";
import { createCatalogCardTypeResolverV2 } from "../../src/duel/catalog-card-type-v2.js";
import { createDuelFuryOptionalRosterCardProgramAuthorityV1 } from "../../src/duel/card-program-authority.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import { createDuelProductionSourceServicesV2 } from "../../src/duel/production-source-services-v2.js";
import { createDuelHoldRecruitExecutorV1 } from "../../src/duel/hold-recruit-executor-v1.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

describe("native Hold Recruit capability V1", () => {
  it("binds the actual 56-card decks and keeps Recruit pending without full entry proof", async () => {
    const catalog = await loadCardCatalogRuntime();
    for (const deck of Object.values(fury77RealDecks)) {
      expect(validateCatalogDeck(catalog, deck)).toMatchObject({ valid: true, issues: [] });
    }
    let uid = 0;
    const setup = buildDuelSetupSeats(catalog, {
      matchId: "hold-recruit-native-v1-real",
      seats: [
        { playerId: "alice", displayName: "Alice", deck: fury77RealDecks.a },
        { playerId: "bob", displayName: "Bob", deck: fury77RealDecks.b },
      ],
    }, () => `hold-recruit-native-${++uid}`);
    if (!setup.ok) throw new TypeError(`setup failed: ${setup.code}`);
    const types = createCatalogCardTypeResolverV2(catalog);
    const genesis = createDuelMatchV2(setup.seats, setup.metadata, () => 0, types.forMatch(setup.metadata));
    let head: DuelCanonicalPlayingStateV2 | typeof genesis = genesis;
    const programs = createDuelFuryOptionalRosterCardProgramAuthorityV1(catalog);
    const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => head, programs });
    for (const actor of ["alice", "bob"] as const) {
      const before = head;
      head = resolveDuelMulliganV2(head, actor, []);
      journal.observe({ ancestor: before, descendant: head,
        commits: [{ operationId: `mulligan-${actor}`, eventId: `mulligan-${actor}`, event: "mulligan" }] });
    }
    if (head.stage !== "playing") throw new TypeError("playing head required");
    const beforeMain = head;
    head = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, state]) =>
        [uid, { ...state, readiness: "ready" }])),
      frame: { ...draft.frame, phase: "main", stateOpen: true, priorityPlayerId: "alice",
        turnPlayerId: "alice" } }, transitions: [] }));
    journal.observe({ ancestor: beforeMain, descendant: head,
      commits: [{ operationId: "main", eventId: "main", event: "main" }] });
    const field = head.board.battlefields.find(item => item.cardId === "ogn-275-298" && item.ownerPlayerId === "alice");
    if (!field) throw new TypeError("held Recruit source field missing");
    const beforeHold = head;
    head = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
      board: { ...draft.board, battlefields: draft.board.battlefields.map(item => item.locationId === field.locationId
        ? { ...item, controllerPlayerId: "alice", contested: false, contestingPlayerId: null,
          combat: "none", showdown: "none" } : item) } }, transitions: [] }));
    const holdSource = enumerateDuelPhaseSourceClosureCandidatesV2(head)
      .find(source => source.cardId === field.cardId && source.zone.kind === "board-battlefield" &&
        source.controllerPlayerId === "alice")!;
    journal.observe({ ancestor: beforeHold, descendant: head,
      commits: [{ operationId: "hold", eventId: "hold", event: "hold", phase: "hold", taskId:
        `duel-v2:${head.matchId}:turn-${head.frame.turnNumber}:hold:0` }] });
    const sourceServices = createDuelProductionSourceServicesV2({ catalog, matchId: head.matchId,
      currentHead: () => head as DuelCanonicalPlayingStateV2, programs, globalJournal: journal });
    const executor = createDuelHoldRecruitExecutorV1({ catalog,
      genuineCardProgramAuthority: programs, currentHead: () => head as DuelCanonicalPlayingStateV2,
      currentJournal: () => journal, sourceServices, uidFactory: () => `recruit-${++uid}` });
    expect(() => createDuelHoldRecruitExecutorV1({ catalog,
      genuineCardProgramAuthority: programs, currentHead: () => head as DuelCanonicalPlayingStateV2,
      currentJournal: () => ({ ...journal } as never), sourceServices,
      uidFactory: () => `foreign-wrapper-${++uid}` })).toThrow();
    expect(executor.resolveTokenDecision({} as never, {} as never)).toBeNull();
    const taskId = `duel-v2:${head.matchId}:turn-${head.frame.turnNumber}:hold:0`;
    const evidence = executor.phaseRegistry;
    const inspected = sourceServices.inspect({ matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: head.frame.turnNumber, taskId,
      phase: "hold", event: "hold", clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } });
    expect(inspected.status).toBe("pending");
    expect(holdSource.controllerPlayerId).toBe("alice");
    expect(holdSource.zoneEpoch).toBeGreaterThanOrEqual(0);
    const result = executor.resolveNativeHandlers({ match: head, turn: head.frame.turnNumber,
      taskId, step: "hold", sources: [holdSource as never] });
    expect(result.status).toBe("pending");
    expect(executor.audit.snapshot().every(entry => entry.status !== "settled")).toBe(true);
    expect(head.board.units).toHaveLength(0);
    void evidence;
  });

  it("accepts only the typed tokenDecision bound to the real Recruit birth and journal", async () => {
    const catalog = await loadCardCatalogRuntime();
    const decks = Object.values(fury77RealDecks);
    for (const deck of decks) {
      expect(validateCatalogDeck(catalog, deck)).toMatchObject({ valid: true, issues: [] });
    }
    let uid = 0;
    const setup = buildDuelSetupSeats(catalog, {
      matchId: "hold-recruit-native-v1-token-decision",
      seats: [
        { playerId: "alice", displayName: "Alice", deck: fury77RealDecks.a },
        { playerId: "bob", displayName: "Bob", deck: fury77RealDecks.b },
      ],
    }, () => `hold-recruit-token-decision-${++uid}`);
    if (!setup.ok) throw new TypeError(`setup failed: ${setup.code}`);
    const types = createCatalogCardTypeResolverV2(catalog);
    const genesis = createDuelMatchV2(setup.seats, setup.metadata, () => 0, types.forMatch(setup.metadata));
    let head: DuelCanonicalPlayingStateV2 | typeof genesis = genesis;
    const programs = createDuelFuryOptionalRosterCardProgramAuthorityV1(catalog);
    const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => head, programs });
    for (const actor of ["alice", "bob"] as const) {
      const before = head;
      head = resolveDuelMulliganV2(head, actor, []);
      journal.observe({ ancestor: before, descendant: head,
        commits: [{ operationId: `token-decision-mulligan-${actor}`, eventId: `token-decision-mulligan-${actor}`, event: "mulligan" }] });
    }
    if (head.stage !== "playing") throw new TypeError("playing head required");
    const beforeMain = head;
    head = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([id, state]) =>
        [id, { ...state, readiness: "ready" }])),
      frame: { ...draft.frame, phase: "main", stateOpen: true, priorityPlayerId: "alice",
        turnPlayerId: "alice" } }, transitions: [] }));
    journal.observe({ ancestor: beforeMain, descendant: head,
      commits: [{ operationId: "token-decision-main", eventId: "token-decision-main", event: "main" }] });
    const field = head.board.battlefields.find(item => item.cardId === "ogn-275-298" && item.ownerPlayerId === "alice");
    if (!field) throw new TypeError("held Recruit source field missing");
    const beforeHold = head;
    head = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
      board: { ...draft.board, battlefields: draft.board.battlefields.map(item => item.locationId === field.locationId
        ? { ...item, controllerPlayerId: "alice", contested: false, contestingPlayerId: null,
          combat: "none", showdown: "none" } : item) } }, transitions: [] }));
    const source = enumerateDuelPhaseSourceClosureCandidatesV2(head)
      .find(item => item.cardId === field.cardId && item.zone.kind === "board-battlefield" &&
        item.controllerPlayerId === "alice");
    if (!source) throw new TypeError("held Recruit source candidate missing");
    const holdIndex = head.board.battlefields.findIndex(item => item.instanceId === source.uid);
    if (holdIndex < 0) throw new TypeError("held Recruit subject index missing");
    const taskId = `duel-v2:${head.matchId}:turn-${head.frame.turnNumber}:hold:0`;
    journal.observe({ ancestor: beforeHold, descendant: head,
      commits: [{ operationId: "token-decision-hold", eventId: "token-decision-hold", event: "hold", phase: "hold", taskId }] });
    journal.bindContext({ matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: head.frame.turnNumber, taskId, phase: "hold",
      event: "hold", clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } }, "token-decision-hold");
    const sourceServices = createDuelProductionSourceServicesV2({ catalog, matchId: head.matchId,
      currentHead: () => head as DuelCanonicalPlayingStateV2, programs, globalJournal: journal });
    const tokenUID = `recruit-${++uid}`;
    const executor = createDuelHoldRecruitExecutorV1({ catalog,
      genuineCardProgramAuthority: programs, currentHead: () => head as DuelCanonicalPlayingStateV2,
      currentJournal: () => journal, sourceServices, uidFactory: () => tokenUID,
      resolveRecruitEntry: request => ({ status: "resolved", matchId: request.match.matchId,
        stateVersion: request.match.stateVersion, eventSeq: request.match.eventSeq,
        sourceUID: request.source.uid, tokenUID: request.tokenUID,
        sourceEffectId: request.sourceEffectId, eventId: request.eventId,
        controllerPlayerId: request.source.controllerPlayerId!, locationId: request.locationId,
        scope: "exact", costs: "none", replacements: "none", triggers: "none" }) });
    const phaseSource = { uid: source.uid, kind: source.kind, cardId: source.cardId,
      zoneEpoch: source.zoneEpoch, controllerPlayerId: source.controllerPlayerId, zone: source.zone };
    const applied = executor.resolveNativeHandlers({ match: head, turn: head.frame.turnNumber,
      taskId, step: "hold", holdIndex, sources: [phaseSource] });
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") throw new TypeError("Recruit birth was not applied");
    const beforeBirth = head;
    head = applied.match;
    journal.observe({ ancestor: beforeBirth, descendant: head,
      commits: [{ operationId: "token-decision-birth", eventId: "token-decision-birth", event: "hold",
        phase: "hold", taskId, sourceUID: source.uid, controllerPlayerId: "alice" }] });
    journal.bindContext({ matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: head.frame.turnNumber, taskId, phase: "hold",
      event: "hold", clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } }, "token-decision-birth");
    const birth = journal.tokenBirth(tokenUID);
    if (!birth) throw new TypeError("Recruit birth was not journaled");
    const token = enumerateDuelPhaseSourceClosureCandidatesV2(head).find(item => item.uid === tokenUID);
    if (!token) throw new TypeError("Recruit token source candidate missing");
    const expectedProgramReference = JSON.stringify({ birthEventId: birth.eventId,
      catalogDigest: head.catalogDigest, dataVersion: head.dataVersion, kind: "recruit-birth-reference",
      matchId: head.matchId, schemaVersion: 1, sourceEffectId: birth.sourceEffectId,
      sourceMode: birth.sourceMode, sourceProofId: birth.sourceProofId, sourceUID: birth.sourceUID,
      sourceZoneEpoch: birth.sourceZoneEpoch, tokenUID: birth.tokenUID });
    const request = { context: { matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: head.frame.turnNumber, taskId, phase: "hold" as const,
      event: "hold" as const, clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } },
      source: token, expectedProgramReference, referenceKind: "recruit-birth" as const };
    const decision = executor.resolveTokenDecision(request, birth);
    expect(decision).toMatchObject({ status: "resolved", scope: "exact", uid: tokenUID,
      matchId: head.matchId, stateVersion: head.stateVersion, sourceProofId: birth.sourceProofId,
      decision: "inactive" });
    expect(executor.resolveTokenDecision({ ...request,
      expectedProgramReference: `${expectedProgramReference}:foreign` }, birth)).toBeNull();
  });

  it("keeps a staged Recruit retryable when the outer native adoption is poisoned", async () => {
    const catalog = await loadCardCatalogRuntime();
    let uid = 0;
    const setup = buildDuelSetupSeats(catalog, {
      matchId: "hold-recruit-native-v1-retry",
      seats: [
        { playerId: "alice", displayName: "Alice", deck: fury77RealDecks.a },
        { playerId: "bob", displayName: "Bob", deck: fury77RealDecks.b },
      ],
    }, () => `hold-recruit-retry-${++uid}`);
    if (!setup.ok) throw new TypeError(`setup failed: ${setup.code}`);
    const types = createCatalogCardTypeResolverV2(catalog);
    const genesis = createDuelMatchV2(setup.seats, setup.metadata, () => 0, types.forMatch(setup.metadata));
    let head: DuelCanonicalPlayingStateV2 | typeof genesis = genesis;
    const programs = createDuelFuryOptionalRosterCardProgramAuthorityV1(catalog);
    const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => head, programs });
    for (const actor of ["alice", "bob"] as const) {
      const before = head;
      head = resolveDuelMulliganV2(head, actor, []);
      journal.observe({ ancestor: before, descendant: head,
        commits: [{ operationId: `retry-mulligan-${actor}`, eventId: `retry-mulligan-${actor}`, event: "mulligan" }] });
    }
    if (head.stage !== "playing") throw new TypeError("playing head required");
    const beforeMain = head;
    head = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([id, state]) =>
        [id, { ...state, readiness: "ready" }])),
      frame: { ...draft.frame, phase: "main", stateOpen: true, priorityPlayerId: "alice",
        turnPlayerId: "alice" } }, transitions: [] }));
    journal.observe({ ancestor: beforeMain, descendant: head,
      commits: [{ operationId: "retry-main", eventId: "retry-main", event: "main" }] });
    const field = head.board.battlefields.find(item => item.cardId === "ogn-275-298" && item.ownerPlayerId === "alice");
    if (!field) throw new TypeError("held Recruit source field missing");
    const beforeHold = head;
    head = commitDuelPlayingMutationV2(head, draft => ({ match: { ...draft,
      board: { ...draft.board, battlefields: draft.board.battlefields.map(item => item.locationId === field.locationId
        ? { ...item, controllerPlayerId: "alice", contested: false, contestingPlayerId: null,
          combat: "none", showdown: "none" } : item) } }, transitions: [] }));
    const source = enumerateDuelPhaseSourceClosureCandidatesV2(head)
      .find(item => item.cardId === field.cardId && item.zone.kind === "board-battlefield" &&
        item.controllerPlayerId === "alice");
    if (!source) throw new TypeError("held Recruit source candidate missing");
    const taskId = `duel-v2:${head.matchId}:turn-${head.frame.turnNumber}:hold:0`;
    journal.observe({ ancestor: beforeHold, descendant: head,
      commits: [{ operationId: "retry-hold", eventId: "retry-hold", event: "hold", phase: "hold", taskId }] });
    journal.bindContext({ matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: head.frame.turnNumber, taskId, phase: "hold",
      event: "hold", clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } }, "retry-hold");
    const sourceServices = createDuelProductionSourceServicesV2({ catalog, matchId: head.matchId,
      currentHead: () => head as DuelCanonicalPlayingStateV2, programs, globalJournal: journal });
    let uidCalls = 0;
    const executor = createDuelHoldRecruitExecutorV1({ catalog,
      genuineCardProgramAuthority: programs, currentHead: () => head as DuelCanonicalPlayingStateV2,
      currentJournal: () => journal, sourceServices, uidFactory: () => `retry-recruit-${++uidCalls}`,
      resolveRecruitEntry: request => ({ status: "resolved", matchId: request.match.matchId,
        stateVersion: request.match.stateVersion, eventSeq: request.match.eventSeq,
        sourceUID: request.source.uid, tokenUID: request.tokenUID,
        sourceEffectId: request.sourceEffectId, eventId: request.eventId,
        controllerPlayerId: request.source.controllerPlayerId!, locationId: request.locationId,
        scope: "exact", costs: "none", replacements: "none", triggers: "none" }) });
    const phaseSource = { uid: source.uid, kind: source.kind, cardId: source.cardId,
      zoneEpoch: source.zoneEpoch, controllerPlayerId: source.controllerPlayerId, zone: source.zone };
    const context = { match: head, turn: head.frame.turnNumber, taskId, step: "hold" as const,
      holdIndex: head.board.battlefields.findIndex(item => item.instanceId === source.uid),
      sources: [phaseSource] };
    const first = executor.resolveNativeHandlers(context);
    expect(first.status).toBe("applied");
    expect(executor.audit.snapshot().every(entry => entry.status !== "settled")).toBe(true);
    const retry = executor.resolveNativeHandlers(context);
    expect(retry.status).toBe("applied");
    if (first.status !== "applied" || retry.status !== "applied") throw new TypeError("staging failed");
    expect(retry.match).toBe(first.match);
    expect(uidCalls).toBe(1);
    expect(executor.audit.snapshot().every(entry => entry.status !== "settled")).toBe(true);

    const beforeBirth = head;
    head = first.match;
    journal.observe({ ancestor: beforeBirth, descendant: head,
      commits: [{ operationId: "retry-birth", eventId: "retry-birth", event: "hold",
        phase: "hold", taskId, sourceUID: source.uid, controllerPlayerId: "alice" }] });
    journal.bindContext({ matchId: head.matchId, dataVersion: head.dataVersion,
      catalogDigest: head.catalogDigest, turn: head.frame.turnNumber, taskId, phase: "hold",
      event: "hold", clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } }, "retry-birth");
    const birth = journal.tokenBirth("retry-recruit-1");
    if (!birth) throw new TypeError("staged Recruit birth was not observed");
    const token = enumerateDuelPhaseSourceClosureCandidatesV2(head)
      .find(item => item.uid === birth.tokenUID);
    if (!token) throw new TypeError("staged Recruit token source missing");
    const expectedProgramReference = JSON.stringify({ birthEventId: birth.eventId,
      catalogDigest: head.catalogDigest, dataVersion: head.dataVersion,
      kind: "recruit-birth-reference", matchId: head.matchId, schemaVersion: 1,
      sourceEffectId: birth.sourceEffectId, sourceMode: birth.sourceMode,
      sourceProofId: birth.sourceProofId, sourceUID: birth.sourceUID,
      sourceZoneEpoch: birth.sourceZoneEpoch, tokenUID: birth.tokenUID });
    const settled = executor.resolveTokenDecision({
      context: { matchId: head.matchId, dataVersion: head.dataVersion,
        catalogDigest: head.catalogDigest, turn: head.frame.turnNumber, taskId, phase: "hold",
        event: "hold", clock: { stateVersion: head.stateVersion, eventSeq: head.eventSeq } },
      source: { uid: token.uid, kind: token.kind, cardId: token.cardId, zoneEpoch: token.zoneEpoch,
        controllerPlayerId: token.controllerPlayerId, zone: token.zone, carrier: "object" },
      expectedProgramReference, referenceKind: "recruit-birth",
    }, birth);
    expect(settled).toMatchObject({ status: "resolved", uid: birth.tokenUID });
    expect(executor.audit.snapshot().some(entry => entry.status === "settled" &&
      entry.tokenUID === birth.tokenUID)).toBe(true);
  });
});

