import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  adoptAdmittedDuelPlayingSessionV2, applyDuelResourceCommandV2,
  applyDuelSpellResourceCommandV2, channelDuelRunesV2, commitDuelPlayingMutationV2,
  createDuelCommandSessionV2, createDuelCostResolverAuthorityV2,
  createDuelUnitPlaySessionV2, fingerprintDuelCostCoverageV2,
  finalizeDuelSpellCardPlayV2, inspectDuelNativeCommitPathV2, inspectDuelSpellPrivateStateV2,
  moveDuelUnitV2, playDuelNoAbilityUnitToBaseV2, playDuelSpellCardV2,
  passDuelSpellPriorityV2, resolveDuelSpellCardPlayV2,
  type DuelCanonicalPlayingStateV2, type DuelMatchStateV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import { createCardProgramAuthority, createDuelPointDamageCardProgramAuthorityV1,
  getCardProgramRegistryForRuntime } from "../../src/duel/card-program-authority.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import { createP4PointDamageSpellServicesV1 } from "../../src/duel/point-spell-production-services-v1.js";

const official = JSON.parse(readFileSync(new URL(
  "../../../../packages/card-data/data/deck-catalog.json", import.meta.url), "utf8"));

describe("P4 Point Spell production composition", () => {
  it("requires an explicit Point damage and cleanup closure", async () => {
    const catalog = await loadCardCatalogRuntime();
    const programs = createCardProgramAuthority(catalog);
    const options = {
      catalog, programs,
      getOperationHead: () => null as never,
      setOperationHead: () => undefined,
      currentJournal: () => ({}) as never,
      observeNativePath: () => ({}) as never,
      dispatcher: {} as never,
      sourceAttestor: (() => ({})) as never,
      closure: {},
      uidFactory: () => "point-test-identity",
      dispatcherSnapshot: () => ({}),
    };
    expect(() => createP4PointDamageSpellServicesV1(options)).toThrow(/damage\/cleanup closure/);
  });

  it("fixture unit entry: native Point Chain cost keeps missing damage proof pending", async () => {
    const ids = ["ogs-003-024", "ogn-219-298", "ogn-049-298", "unl-187-219",
      "ogn-007-298", "ogn-275-298", "ogn-278-298", "ogn-280-298"];
    const catalog = { publicCatalog: { ...official,
      cards: official.cards.filter((card: { id: string }) => ids.includes(card.id)) } } as CardCatalogRuntime;
    const programs = createDuelPointDamageCardProgramAuthorityV1(catalog);
    const registry = getCardProgramRegistryForRuntime(programs);
    const seats = ["alice", "bob"].map(playerId => ({ playerId,
      mainDeck: Array.from({ length: 8 }, (_, index) => ({ uid: `${playerId}:main:${index}`,
        cardId: index === 1 ? "ogs-003-024" : "ogn-219-298" })),
      champion: { uid: `${playerId}:champion`, cardId: "ogn-049-298" },
      legend: { uid: `${playerId}:legend`, cardId: "unl-187-219" },
      runeDeck: Array.from({ length: 6 }, (_, index) => ({ uid: `${playerId}:rune:${index}`,
        cardId: "ogn-007-298", domain: "Fury" as const })),
      battlefields: ["ogn-275-298", "ogn-278-298", "ogn-280-298"].map((cardId, index) =>
        ({ instanceId: `${playerId}:field:${index}`, cardId })),
    }));
    const metadata = { matchId: "point-service-fixture", dataVersion: official.dataVersion,
      catalogDigest: official.digest, roster: ["alice", "bob"].map(playerId =>
        ({ playerId, displayName: playerId })) as [
          { playerId: string; displayName: string }, { playerId: string; displayName: string }] };
    const typeOf = (id: string) => id === "ogn-049-298" ? "Champion" as const :
      id === "unl-187-219" ? "Legend" as const : id === "ogn-007-298" ? "Rune" as const :
      ["ogn-275-298", "ogn-278-298", "ogn-280-298"].includes(id) ? "Battlefield" as const :
      id === "ogs-003-024" ? "Other" as const : "Unit" as const;
    let command = createDuelCommandSessionV2(seats, metadata, () => 0, typeOf);
    let head: DuelMatchStateV2 = command.match;
    const journal = createDuelNativeOperationJournalV2({ genesis: head,
      currentHead: () => head, programs });
    let serial = 0;
    const observe = (next: DuelMatchStateV2, event: "mulligan" | "channel" | "main") => {
      const ancestor = head;
      const commits = inspectDuelNativeCommitPathV2(ancestor, next);
      journal.observe({ ancestor, descendant: next, commits: commits.map(() => ({
        operationId: `point-fixture:${++serial}`, eventId: `point-fixture:${serial}`, event })) });
      head = next;
    };
    for (const actor of ["alice", "bob"]) {
      const applied = applyDuelResourceCommandV2(command, actor, { commandId: `mulligan:${actor}`,
        expectedVersion: command.match.stateVersion,
        command: { type: "mulligan", selectedUIDs: [] } });
      expect(applied.outcome.status).toBe("applied");
      observe(applied.session.match, "mulligan");
      command = applied.session;
    }
    const channel = channelDuelRunesV2(head as DuelCanonicalPlayingStateV2, "alice", 2);
    observe(channel, "channel");
    const main = commitDuelPlayingMutationV2(channel, draft => ({ match: { ...draft,
      legendStates: Object.fromEntries(Object.entries(draft.legendStates).map(([uid, value]) =>
        [uid, { ...value, readiness: "ready" }])),
      frame: { ...draft.frame, phase: "main", stateOpen: true,
        priorityPlayerId: "alice", turnPlayerId: "alice" } }, transitions: [] }));
    observe(main, "main");
    command = adoptAdmittedDuelPlayingSessionV2(main);
    const targetUID = main.players[0]!.hand.find(card => card.cardId === "ogn-219-298")!.uid;
    const targetEpoch = main.physicalCardsByUID[targetUID]!.zoneEpoch;
    const zero = { energy: 0, power: [] };
    const costFacts = { registryRevision: "fixture-only", catalogRevision: official.digest,
      nonResourceCosts: "none" as const,
      base: { cost: zero, sourceUid: targetUID, sourceEpoch: targetEpoch },
      candidates: [], orderedModifiers: [] };
    const unitCost = createDuelCostResolverAuthorityV2(request => ({ request,
      base: { ...costFacts.base, request, status: "complete" as const, proofId: "fixture-unit-base",
        registryRevision: costFacts.registryRevision, catalogRevision: costFacts.catalogRevision },
      coverage: { request, status: "complete" as const, proofId: "fixture-unit-coverage",
        allModifierSourcesCovered: true, choicesResolved: true, nonResourceCosts: "none" as const,
        registryRevision: costFacts.registryRevision, catalogRevision: costFacts.catalogRevision,
        ...fingerprintDuelCostCoverageV2(costFacts) }, proofs: [], modifiers: [] }), () => costFacts);
    const unit = createDuelUnitPlaySessionV2(command, { programs: registry, cost: unitCost,
      costBinding: request => ({ ...request, status: "complete" }),
      entry: request => { const { match: ignored, ...facts } = request; void ignored;
        return { ...facts, sourceCensus: "complete", sources: [],
          scopes: { play: "clear", replacement: "clear", static: "clear",
            trigger: "clear", pendingTasks: "clear", chain: "clear" } }; } });
    const placed = playDuelNoAbilityUnitToBaseV2(unit, "alice", { commandId: "fixture-unit",
      expectedVersion: command.match.stateVersion, command: { cardUID: targetUID } });
    expect(placed.outcome.status).toBe("applied");
    observe(placed.session.commandSession.match, "main");
    const battlefieldId = (head as DuelCanonicalPlayingStateV2).board.battlefields
      .find(field => field.ownerPlayerId === "alice")!.locationId;
    observe(moveDuelUnitV2(head as DuelCanonicalPlayingStateV2, targetUID, battlefieldId), "main");
    expect((head as DuelCanonicalPlayingStateV2).board.units.some(unit =>
      unit.objectId === targetUID && unit.locationId === battlefieldId)).toBe(true);

    const claims = new Map<string, unknown>();
    const spell = createP4PointDamageSpellServicesV1({ catalog, programs,
      getOperationHead: () => head as DuelCanonicalPlayingStateV2,
      setOperationHead: value => { head = value; }, currentJournal: () => journal,
      observeNativePath: ({ ancestor, descendant, commits }) => ({ ancestor, descendant,
        commits: commits.map(() => ({ operationId: `point-fixture:${++serial}`,
          eventId: `point-fixture:${serial}`, event: "main" as const })) }),
      dispatcher: { claim: request => { const claim = { request }; claims.set(request.commandId, claim);
        return { status: "new", claim }; }, finish: () => {}, readCommitted: () => null,
        commitEffect: () => {}, notifyCommitted: () => {} },
      sourceAttestor: request => ({ matchId: request.match.matchId, actor: request.actor,
        taskId: request.taskId, paymentId: request.paymentId,
        continuationId: request.continuationId, sourceReference: request.sourceReference,
        sourceProofId: "fixture-source", mode: "current",
        sourceZoneEpoch: request.match.physicalCardsByUID[request.sourceReference.sourceUID]!.zoneEpoch }),
      closure: { pointDamage: {} }, uidFactory: (() => { let id = 0; return () => `point-id:${++id}`; })(),
      dispatcherSnapshot: () => ({ claimCount: claims.size }) });
    const sourceUID = (head as DuelCanonicalPlayingStateV2).players[0]!.hand
      .find(card => card.cardId === "ogs-003-024")!.uid;
    const action = spell.createSession(adoptAdmittedDuelPlayingSessionV2(head as DuelCanonicalPlayingStateV2));
    const result = playDuelSpellCardV2(action, "alice", { commandId: "point-cast",
      expectedVersion: action.commandSession.match.stateVersion,
      command: { cardUID: sourceUID, targetUIDs: [targetUID] } });
    expect(result.outcome).toMatchObject({ status: "pending", step: "payment" });
    expect(result.outcome.status === "pending" ? result.outcome.reason : undefined).toBeUndefined();
    expect(journal.readCostCensus()!.sources.filter(source =>
      !source.uid || source.sourceEpoch === null || source.programReference === null ||
      source.controllerPlayerId === null && source.zone.kind !== "board-battlefield" &&
        !["hand", "main-deck", "trash", "rune-deck", "champion-zone", "legend-zone"].includes(source.zone.kind) ||
      source.ownerPlayerId === null && source.carrier !== "runtime-effect" &&
        source.zone.kind !== "board-battlefield").map(source => ({
      carrier: source.carrier, zone: source.zone.kind, uid: source.uid,
      epoch: source.sourceEpoch, owner: source.ownerPlayerId, controller: source.controllerPlayerId,
      program: source.programReference !== null }))).toEqual([]);
    expect(result.outcome).toMatchObject({ taskId: expect.any(String), paymentId: expect.any(String) });
    spell.handoff(result);
    expect(journal.readCostCensus()!.sources.some(source => source.carrier === "runtime-effect" &&
      source.ledger === "chain" && source.sourceUID === sourceUID && source.status === "pending")).toBe(true);
    expect(inspectDuelSpellPrivateStateV2(result.session).pendingCost?.cost)
      .toEqual({ energy: 2, power: [] });
    expect(result.session.commandSession.match.resources.players[0]!.runePool.energy).toBe(0);
    const rune = result.session.commandSession.match.resources.bases[0]!.baseRunes.find(item => item.readied)!;
    const funded = applyDuelSpellResourceCommandV2(result.session, "alice", {
      commandId: "point-fund", expectedVersion: result.session.commandSession.match.stateVersion,
      command: { type: "rune-energy", uid: rune.uid } });
    expect(funded.outcome).toMatchObject({ status: "pending" });
    spell.handoff(funded);
    const paymentId = result.outcome.status === "pending" ? result.outcome.paymentId! : "";
    const underfunded = applyDuelSpellResourceCommandV2(funded.session, "alice", {
      commandId: "point-underfunded", expectedVersion: funded.session.commandSession.match.stateVersion,
      command: { type: "pay-pending", paymentId } });
    expect(underfunded.outcome.status).toBe("rejected");
    expect(inspectDuelSpellPrivateStateV2(underfunded.session).pendingCost?.paymentId).toBe(paymentId);
    expect(underfunded.session.commandSession.match.resources.players[0]!.runePool.energy).toBe(1);
    spell.handoff(underfunded);
    const secondRune = underfunded.session.commandSession.match.resources.bases[0]!.baseRunes
      .find(item => item.readied)!;
    const fundedAgain = applyDuelSpellResourceCommandV2(underfunded.session, "alice", {
      commandId: "point-fund-two", expectedVersion: underfunded.session.commandSession.match.stateVersion,
      command: { type: "rune-energy", uid: secondRune.uid } });
    expect(fundedAgain.session.commandSession.match.resources.players[0]!.runePool.energy).toBe(2);
    spell.handoff(fundedAgain);
    const paid = applyDuelSpellResourceCommandV2(fundedAgain.session, "alice", {
      commandId: "point-pay", expectedVersion: fundedAgain.session.commandSession.match.stateVersion,
      command: { type: "pay-pending", paymentId } });
    expect(paid.outcome).toMatchObject({ status: "pending", step: "priority" });
    expect(paid.session.commandSession.match.resources.players[0]!.runePool.energy).toBe(0);
    spell.handoff(paid);
    const finalized = finalizeDuelSpellCardPlayV2(paid.session, "alice");
    spell.handoff(finalized);
    const firstPass = passDuelSpellPriorityV2(finalized.session, "alice");
    spell.handoff(firstPass);
    const secondPass = passDuelSpellPriorityV2(firstPass.session, "bob");
    spell.handoff(secondPass);
    const unresolved = resolveDuelSpellCardPlayV2(secondPass.session, "alice");
    expect(unresolved.outcome).toMatchObject({ status: "pending", step: "effect" });
    spell.handoff(unresolved);
    expect((head as DuelCanonicalPlayingStateV2).board.units.find(unit => unit.objectId === targetUID))
      .toBeDefined();
    expect((head as DuelCanonicalPlayingStateV2).players[0]!.trash.some(card => card.uid === sourceUID))
      .toBe(false);
  });
});
