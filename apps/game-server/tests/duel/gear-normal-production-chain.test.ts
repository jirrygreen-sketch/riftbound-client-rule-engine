import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyDuelPrintedGearPhysicalChainResourceV1,
  applyDuelResourceCommandV2,
  beginDuelPrintedGearPhysicalChainV1,
  createDuelCommandSessionV2,
  createDuelPrintedGearChainSessionV1,
  enumerateDuelPhaseSourceClosureCandidatesV2,
  inspectDuelPhaseSourceClosureV2,
  inspectDuelNativeCommitPathV2,
  inspectDuelPrintedGearPhysicalChainV1,
  resumeDuelPrintedGearPhysicalChainV1,
  runDuelStartOfTurnV2,
  type DuelPhaseSourceClosureContextV2,
  type DuelCanonicalPlayingStateV2,
  type DuelCommandSessionV2,
  type DuelMatchStateV2,
} from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import { buildDuelSetupSeats } from "../../src/duel/setup-seats.js";
import { createCatalogCardTypeResolverV2 } from "../../src/duel/catalog-card-type-v2.js";
import {
  createDuelEquipCardProgramAuthorityV1,
  getCardProgramRegistryForRuntime,
} from "../../src/duel/card-program-authority.js";
import { createDuelNativeOperationJournalV2 } from "../../src/duel/operation-journal-v2.js";
import { createDuelProductionSourceServicesV2 } from "../../src/duel/production-source-services-v2.js";
import { createDuelGearChainProductionServicesV1 } from "../../src/duel/gear-chain-production-services-v1.js";
import { fury77RealDecks } from "./fixtures/fury77-real-decks.js";

const GEAR = "sfd-009-221";

async function writeTrace(name: string, trace: unknown) {
  const directory = process.env.RIFTBOUND_GEAR_TRACE_DIRECTORY;
  if (directory) await writeFile(path.join(directory, `${name}.json`), `${JSON.stringify(trace, null, 2)}\n`);
}

function normalGearDeck(unsupportedSource = false) {
  const deck = structuredClone(fury77RealDecks.a);
  const replacements = new Map([
    ["ogn-001-298", GEAR], ["ogn-209-298", "sfd-016-221"],
    ["ogn-229-298", "sfd-030-221"], ["unl-180-219", "unl-019-219"],
    ["ogn-234-298", "ven-011-166"],
  ]);
  deck.mainDeck = deck.mainDeck.map(entry => ({
    cardId: unsupportedSource && entry.cardId === "ogn-234-298" ? entry.cardId : replacements.get(entry.cardId) ?? entry.cardId,
    quantity: entry.quantity,
  }));
  return deck;
}

function contextFor(match: DuelCanonicalPlayingStateV2, uid: string) {
  return {
    matchId: match.matchId,
    dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest,
    turn: match.frame.turnNumber,
    taskId: `duel-gear-v1:${match.matchId}:turn-${match.frame.turnNumber}:printed-gear:${uid}:${match.stateVersion}`,
    phase: "main" as const,
    event: "chain" as const,
    clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq },
  };
}

async function scene(unsupportedSource = false) {
  const catalog = await loadCardCatalogRuntime();
  const gearDeck = normalGearDeck(unsupportedSource);
  const otherDeck = normalGearDeck();
  otherDeck.battlefields.reverse();
  for (const deck of [gearDeck, otherDeck]) {
    expect(validateCatalogDeck(catalog, deck)).toMatchObject({ valid: true, issues: [] });
    expect(new Set(deck.battlefields.map(entry => entry.cardId)).size).toBe(3);
  }
  const setup = buildDuelSetupSeats(catalog, {
    matchId: "gear-normal-production-chain",
    seats: [
      { playerId: "alice", displayName: "alice", deck: gearDeck },
      { playerId: "bob", displayName: "bob", deck: otherDeck },
    ],
  }, (() => {
    let next = 0;
    return () => `gear-normal-${++next}`;
  })());
  if (!setup.ok) throw new TypeError(`normal setup failed: ${setup.code}`);
  const types = createCatalogCardTypeResolverV2(catalog);
  let command: DuelCommandSessionV2 = createDuelCommandSessionV2(
    setup.seats, setup.metadata, () => 0, types.forMatch(setup.metadata),
  );
  const genesis = command.match;
  let current: DuelMatchStateV2 = genesis;
  const programs = createDuelEquipCardProgramAuthorityV1(catalog);
  const registry = getCardProgramRegistryForRuntime(programs);
  for (const deck of [gearDeck, otherDeck]) {
    for (const entry of Object.values(deck).flat()) {
      expect(registry.getProgram(entry.cardId), entry.cardId).toBeDefined();
      expect(programs.resolvedProgramReference(entry.cardId), entry.cardId).toBeDefined();
    }
  }
  const journal = createDuelNativeOperationJournalV2({ genesis, currentHead: () => current, programs });
  let operation = 0;
  const trace: unknown[] = [];
  const observe = (before: DuelMatchStateV2, after: DuelMatchStateV2,
    event: "mulligan" | DuelPhaseSourceClosureContextV2["event"], sourceUID?: string) => {
    const path = inspectDuelNativeCommitPathV2(before, after);
    trace.push(...path.map(commit => ({ version: commit.after.stateVersion, eventSeq: commit.after.eventSeq,
      phase: commit.after.stage === "playing" ? commit.after.frame.phase : "mulligan",
      stateOpen: commit.after.stage === "playing" ? commit.after.frame.stateOpen : false,
      transitions: commit.transitions, energy: commit.after.stage === "playing"
        ? commit.after.resources.players.map(player => ({ playerId: player.playerId, energy: player.runePool.energy })) : [],
      gearUIDs: commit.after.stage === "playing" ? commit.after.gears.map(gear => gear.uid) : [] })));
    current = after;
    journal.observe({ ancestor: before, descendant: after, commits: path.map((commit, index) => ({
      operationId: `gear-normal-${++operation}`,
      eventId: `gear-normal-event-${operation}`,
      event: commit.transitions.some(step => step.from.kind === "main-deck" && step.to.kind === "hand")
        ? "draw" as const : event === "draw" ? "intrinsic-step" as const : event,
      phase: event === "mulligan" ? undefined : event === "chain" ? "main" as const : event as DuelPhaseSourceClosureContextV2["phase"],
      ...(index === 0 && sourceUID && commit.transitions.some(step => step.uid === sourceUID) ? { sourceUID } : {}),
    })) });
  };
  for (const actor of ["alice", "bob"] as const) {
    const before = command.match;
    const result = applyDuelResourceCommandV2(command, actor, {
      commandId: `gear-normal-mulligan-${actor}`,
      expectedVersion: before.stateVersion,
      command: { type: "mulligan", selectedUIDs: [] },
    });
    expect(result.outcome.status).toBe("applied");
    command = result.session;
    observe(before, command.match, "mulligan");
  }
  const turnSources = createDuelProductionSourceServicesV2({
    catalog, programs, matchId: current.matchId, currentHead: () => current.stage === "playing" ? current : null,
    globalJournal: journal,
  });
  const started = runDuelStartOfTurnV2(command, {
    sources: turnSources.phaseRegistry,
    randomIndex: () => 0,
    observeCheckpoint(checkpoint) {
      observe(current, checkpoint.match, checkpoint.event);
      journal.bindContext({ matchId: current.matchId, dataVersion: current.dataVersion,
        catalogDigest: current.catalogDigest, turn: checkpoint.turn, taskId: checkpoint.taskId,
        phase: checkpoint.event, event: checkpoint.event,
        clock: { stateVersion: current.stateVersion, eventSeq: current.eventSeq } });
      return true;
    },
  });
  expect(started.status, JSON.stringify({ status: started.status, reason: started.reason,
    cursor: started.session.turnCursorV2 })).toBe("main");
  command = started.session;
  const head = command.match as DuelCanonicalPlayingStateV2;
  const target = head.players.find(player => player.playerId === "alice")?.hand.find(card => card.cardId === GEAR);
  if (!target) throw new TypeError("normal setup did not deal the real Gear printing");
  const services = createDuelGearChainProductionServicesV1({
    catalog, programs, matchId: head.matchId,
    currentHead: () => current.stage === "playing" ? current : null,
    currentSession: () => command,
    currentJournal: () => journal,
  });
  const session = createDuelPrintedGearChainSessionV1(command, services);
  return {
    catalog, programs, journal, services, session, target, trace, decks: [gearDeck, otherDeck],
    get current() {
      if (current.stage !== "playing") throw new TypeError("playing Gear head required");
      return current;
    },
    set current(value: DuelCanonicalPlayingStateV2) { current = value; },
    get command() { return command; },
    set command(value: DuelCommandSessionV2) { command = value; },
    observe,
  };
}

function sync(f: Awaited<ReturnType<typeof scene>>, result: { readonly session: { readonly commandSession: DuelCommandSessionV2 } },
  before: DuelCanonicalPlayingStateV2) {
  const after = result.session.commandSession.match as DuelCanonicalPlayingStateV2;
  f.command = result.session.commandSession;
  f.observe(before, after, "chain", f.target.uid);
  return after;
}

describe("normal catalog Gear production Chain", () => {
  it("identifies a real Gear, separates printed and Equip costs, pays, and enters the Base", async () => {
    const f = await scene();
    const before = f.current;
    const initialProgram = f.services.program({ match: before, matchId: before.matchId,
      dataVersion: before.dataVersion, catalogDigest: before.catalogDigest, actor: "alice",
      uid: f.target.uid, cardId: GEAR, sourceEpoch: before.physicalCardsByUID[f.target.uid]!.zoneEpoch });
    expect(initialProgram.status).toBe("known");
    const registry = getCardProgramRegistryForRuntime(f.programs);
    const official = registry.getProgram(GEAR)!;
    expect(official.semantics).toMatchObject({ kind: "equip-activated-ability", event: "activate",
      cost: { kind: "base-cost", energy: 0, power: { kind: "specific-domain", domain: "Fury" } } });
    const card = f.catalog.publicCatalog.cards.find(value => value.id === GEAR)!;
    expect(card.energy).toBe(1);
    expect(card.power).toBeNull();
    expect(card.cardType).toBe("Gear");

    let result = beginDuelPrintedGearPhysicalChainV1(f.session, "alice", {
      commandId: "gear-normal-play",
      expectedVersion: before.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(result.outcome).toEqual({ status: "blocked", reason: "cost-or-payment-unproved" });
    let chain = sync(f, result, before);
    expect(chain.frame.stateOpen).toBe(false);
    expect(chain.chainCards).toContainEqual(expect.objectContaining({ uid: f.target.uid, cardId: GEAR }));
    const chainEpoch = chain.physicalCardsByUID[f.target.uid]!.zoneEpoch;
    expect(chainEpoch).toBeGreaterThan(before.physicalCardsByUID[f.target.uid]!.zoneEpoch);
    f.journal.bindContext(contextFor(chain, f.target.uid));
    const chainProgram = f.services.program({ match: chain, matchId: chain.matchId, dataVersion: chain.dataVersion,
      catalogDigest: chain.catalogDigest, actor: "alice", uid: f.target.uid, cardId: GEAR, sourceEpoch: chainEpoch });
    const entryRequest = { match: chain, matchId: chain.matchId,
      stateVersion: chain.stateVersion, eventSeq: chain.eventSeq, actor: "alice", uid: f.target.uid,
      cardId: GEAR, sourceEpoch: chainEpoch, baseLocationId: chain.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
      programId: chainProgram.programFingerprint };
    const closure = f.services.inspectClosure(entryRequest, contextFor(chain, f.target.uid));
    expect(closure.status, closure.reason).toBe("ready");
    const inspection = inspectDuelPhaseSourceClosureV2(chain, contextFor(chain, f.target.uid), closure.registry!, closure.journal!);
    expect([inspection.status, inspection.activeSources.length, inspection.handlers.length, inspection.runtimeSources.length])
      .toEqual(["ready", 0, 0, 0]);
    const battlefields = inspection.candidates.filter(source => source.kind === "battlefield");
    expect(battlefields.map(source => source.cardId).sort()).toEqual(["ogn-275-298", "ogn-280-298"]);
    for (const source of battlefields) {
      expect(source.zone.kind).toBe("board-battlefield");
      expect(registry.getProgram(source.cardId!)?.semantics).toEqual({ kind: "trigger", event: "hold",
        sourceScope: "battlefield-controller", condition: null, optional: false, costs: [],
        effects: source.cardId === "ogn-275-298" ? [{ kind: "play-recruit-token",
          token: { kind: "unit-token", cardType: "Unit", domains: [], domainless: true,
            tags: ["Recruit"], energy: null, power: null, might: 1, physicalPrintingCardId: null },
          controller: "effect-controller", owner: "effect-controller", destination: "base", resolution: "deferred-token-play" }]
          : [{ kind: "draw-cards", amount: 1, recipient: "effect-controller" }] });
    }
    expect(f.services.entry(entryRequest).resolution).toBe("complete");
    expect(f.services.entry({ ...entryRequest, programId: "forged" }).resolution).toBe("unknown");
    expect(f.services.inspectClosure(entryRequest, { ...contextFor(chain, f.target.uid), event: "hold", phase: "hold" }).status)
      .toBe("pending");

    result = beginDuelPrintedGearPhysicalChainV1(result.session, "alice", {
      commandId: "gear-normal-play",
      expectedVersion: chain.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(result.outcome.status, JSON.stringify(result.outcome)).toBe("pending");
    const pending = result.outcome;
    if (pending.status !== "pending") throw new TypeError("expected native Gear payment task");
    const paymentHead = sync(f, result, chain);
    expect(inspectDuelPrintedGearPhysicalChainV1(result.session).fixedCost).toEqual({ energy: 1, power: [] });
    expect(paymentHead.frame.pendingPayment).toMatchObject({ paymentId: pending.paymentId });
    const fixed = inspectDuelPrintedGearPhysicalChainV1(result.session);
    expect(f.services.costBinding({ matchId: chain.matchId, stateVersion: chain.stateVersion,
      actor: "alice", uid: f.target.uid, cardId: GEAR, sourceEpoch: chainEpoch,
      baseLocationId: entryRequest.baseLocationId,
      transactionId: JSON.stringify(["printed-gear-chain-v1", chain.matchId, "alice", "gear-normal-play", f.target.uid, chainEpoch]),
      baseProofId: fixed.baseProofId!, coverageProofId: fixed.coverageProofId!, decision: "none",
      programFingerprint: initialProgram.programFingerprint }).status).toBe("unknown");
    expect(result.session.commandSession.requiredTasks).toMatchObject([{ status: "active",
      finalResolvedCost: { energy: 1, power: [] }, sourceBinding: { sourceZoneEpoch: chainEpoch,
        sourceReference: { kind: "card", referenceId: GEAR, sourceUID: f.target.uid } } }]);
    const rune = paymentHead.resources.bases.find(base => base.playerId === "alice")?.baseRunes[0];
    if (!rune) throw new TypeError("normal setup did not provide a Base Rune");

    const fundedBefore = f.current;
    result = applyDuelPrintedGearPhysicalChainResourceV1(result.session, "alice", {
      commandId: "gear-normal-fund",
      expectedVersion: fundedBefore.stateVersion,
      command: { type: "rune-energy", uid: rune.uid },
    });
    expect(result.outcome.status).toBe("pending");
    const funded = sync(f, result, fundedBefore);
    expect(funded.resources.players.find(player => player.playerId === "alice")?.runePool.energy).toBe(1);
    expect(funded.resources.bases.flatMap(base => base.baseRunes).find(item => item.uid === rune.uid)?.readied).toBe(false);
    const paidBefore = funded;
    result = applyDuelPrintedGearPhysicalChainResourceV1(result.session, "alice", {
      commandId: "gear-normal-pay",
      expectedVersion: paidBefore.stateVersion,
      command: { type: "pay-pending", paymentId: pending.paymentId },
    });
    expect(result.outcome).toEqual({ status: "paid", cardUID: f.target.uid });
    const paid = sync(f, result, paidBefore);
    expect(paid.frame.pendingPayment).toBeNull();
    expect(paid.resources.players.find(player => player.playerId === "alice")?.runePool.energy).toBe(0);
    expect(Object.values(paid.resources.players.find(player => player.playerId === "alice")!.runePool.power)
      .every(amount => amount === 0)).toBe(true);
    expect(paid.resources.bases.flatMap(base => base.baseRunes).map(item => item.uid))
      .toEqual(funded.resources.bases.flatMap(base => base.baseRunes).map(item => item.uid));
    expect(result.session.commandSession.requiredTasks).toMatchObject([{ status: "completed" }]);
    expect(paid.chainCards.filter(item => item.uid === f.target.uid)).toHaveLength(1);
    expect(paid.gears).toHaveLength(0);
    expect(f.services.entry(entryRequest).resolution).toBe("unknown");
    f.journal.bindContext(contextFor(paid, f.target.uid));

    const staleFinish = resumeDuelPrintedGearPhysicalChainV1(result.session, "alice", {
      commandId: "gear-normal-stale-finish", expectedVersion: chain.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(staleFinish.outcome).toEqual({ status: "rejected", reason: "stale-version" });
    expect(staleFinish.session.commandSession.match).toBe(paid);
    const repeatedPayment = applyDuelPrintedGearPhysicalChainResourceV1(result.session, "alice", {
      commandId: "gear-normal-pay-again", expectedVersion: paid.stateVersion,
      command: { type: "pay-pending", paymentId: pending.paymentId },
    });
    expect(repeatedPayment.outcome).toEqual({ status: "blocked", reason: "wrong-task-or-session" });
    expect(repeatedPayment.session.commandSession.match).toBe(paid);

    const finishedBefore = paid;
    result = resumeDuelPrintedGearPhysicalChainV1(result.session, "alice", {
      commandId: "gear-normal-finish",
      expectedVersion: finishedBefore.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(result.outcome).toMatchObject({ status: "applied", cardUID: f.target.uid, ready: true });
    const finished = sync(f, result, finishedBefore);
    const gear = finished.gears.filter(item => item.uid === f.target.uid);
    expect(gear).toHaveLength(1);
    expect(gear[0]).toMatchObject({ uid: f.target.uid, controllerPlayerId: "alice", readied: true, attachedToUID: null });
    expect(finished.physicalCardsByUID[f.target.uid]).toMatchObject({ cardId: GEAR, ownerPlayerId: "alice" });
    expect(gear[0]!.locationId).toBe(finished.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId);
    expect(finished.chainCards.some(cardValue => cardValue.uid === f.target.uid)).toBe(false);
    expect(finished.players.flatMap(player => player.hand).some(cardValue => cardValue.uid === f.target.uid)).toBe(false);
    expect(finished.physicalCardsByUID[f.target.uid]!.zoneEpoch).toBeGreaterThan(chainEpoch);
    expect(enumerateDuelPhaseSourceClosureCandidatesV2(finished).find(source => source.uid === f.target.uid))
      .toMatchObject({ cardId: GEAR, kind: "gear", zone: { kind: "board-base", locationId: gear[0]!.locationId } });
    const duplicate = resumeDuelPrintedGearPhysicalChainV1(result.session, "alice", {
      commandId: "gear-normal-finish", expectedVersion: finishedBefore.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.persistRequired).toBe(false);
    expect(duplicate.session.commandSession.match).toBe(finished);
    expect(finished.gears.filter(item => item.uid === f.target.uid)).toHaveLength(1);
    await writeTrace("normal-production-trace", { catalogDigest: finished.catalogDigest, decks: f.decks,
      programId: initialProgram.programId, programFingerprint: initialProgram.programFingerprint,
      printedCost: inspectDuelPrintedGearPhysicalChainV1(result.session).fixedCost,
      equipCost: official.semantics.kind === "equip-activated-ability" ? official.semantics.cost : null,
      closedChain: { version: chain.stateVersion, eventSeq: chain.eventSeq, context: contextFor(chain, f.target.uid),
        source: inspection.candidates.find(source => source.uid === f.target.uid),
        sourceCensus: inspection.candidates.length, handlers: inspection.handlers, activeSources: inspection.activeSources,
        runtimeSources: inspection.runtimeSources },
      entered: { version: finished.stateVersion, eventSeq: finished.eventSeq, gear: gear[0],
        physical: finished.physicalCardsByUID[f.target.uid] },
      battlefieldPrograms: battlefields.map(source => ({ uid: source.uid, zone: source.zone,
        program: registry.getProgram(source.cardId!) })), commits: f.trace });
  }, 120_000);

  it("rejects stale Hand/Chain heads and foreign or forged program bindings", async () => {
    const f = await scene();
    const stale = f.current;
    const first = beginDuelPrintedGearPhysicalChainV1(f.session, "alice", {
      commandId: "gear-normal-stale", expectedVersion: stale.stateVersion,
      command: { cardUID: f.target.uid },
    });
    expect(first.outcome.status).toBe("blocked");
    const chain = sync(f, first, stale);
    const retry = beginDuelPrintedGearPhysicalChainV1(first.session, "alice", {
      commandId: "gear-normal-stale", expectedVersion: stale.stateVersion, command: { cardUID: f.target.uid },
    });
    expect(retry.outcome).toEqual({ status: "rejected", reason: "stale-version" });
    expect(retry.session.commandSession.match).toBe(chain);
    expect(chain.chainCards.filter(card => card.uid === f.target.uid)).toHaveLength(1);
    expect(chain.gears).toHaveLength(0);
    expect(f.services.program({ match: chain, matchId: chain.matchId, dataVersion: chain.dataVersion,
      catalogDigest: chain.catalogDigest, actor: "bob", uid: f.target.uid, cardId: GEAR,
      sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch }).status).toBe("unknown");
    expect(f.services.program({ match: stale, matchId: stale.matchId, dataVersion: stale.dataVersion,
      catalogDigest: stale.catalogDigest, actor: "alice", uid: f.target.uid, cardId: GEAR,
      sourceEpoch: stale.physicalCardsByUID[f.target.uid]!.zoneEpoch }).status).toBe("unknown");
    expect(f.services.program({ match: structuredClone(chain), matchId: chain.matchId,
      dataVersion: chain.dataVersion, catalogDigest: chain.catalogDigest, actor: "alice",
      uid: f.target.uid, cardId: GEAR, sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch }).status)
      .toBe("unknown");
    const staleEntry = f.services.entry({ match: chain, matchId: chain.matchId,
      stateVersion: chain.stateVersion, eventSeq: chain.eventSeq, actor: "alice", uid: f.target.uid,
      cardId: GEAR, sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch,
      baseLocationId: chain.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
      programId: "forged" });
    expect(staleEntry.resolution).toBe("unknown");
  }, 120_000);

  it("keeps unreviewed source opcodes pending on a legal normal-turn trajectory", async () => {
    const f = await scene(true);
    const before = f.current;
    const begun = beginDuelPrintedGearPhysicalChainV1(f.session, "alice", {
      commandId: "gear-unreviewed", expectedVersion: before.stateVersion, command: { cardUID: f.target.uid },
    });
    expect(begun.outcome).toEqual({ status: "blocked", reason: "cost-or-payment-unproved" });
    const chain = sync(f, begun, before);
    f.journal.bindContext(contextFor(chain, f.target.uid));
    const binding = f.services.program({ match: chain, matchId: chain.matchId, dataVersion: chain.dataVersion,
      catalogDigest: chain.catalogDigest, actor: "alice", uid: f.target.uid, cardId: GEAR,
      sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch });
    const request = { match: chain, matchId: chain.matchId, stateVersion: chain.stateVersion,
      eventSeq: chain.eventSeq, actor: "alice", uid: f.target.uid, cardId: GEAR,
      sourceEpoch: chain.physicalCardsByUID[f.target.uid]!.zoneEpoch,
      baseLocationId: chain.board.bases.find(base => base.ownerPlayerId === "alice")!.locationId,
      programId: binding.programFingerprint };
    expect(f.services.inspectClosure(request, contextFor(chain, f.target.uid))).toEqual({
      status: "pending", reason: "unreviewed-Gear-source:ogn-234-298:main-deck",
    });
    const retry = beginDuelPrintedGearPhysicalChainV1(begun.session, "alice", {
      commandId: "gear-unreviewed", expectedVersion: chain.stateVersion, command: { cardUID: f.target.uid },
    });
    expect(retry.outcome).toEqual({ status: "blocked", reason: "cost-or-payment-unproved" });
    expect(retry.persistRequired).toBe(false);
    expect(retry.session.commandSession.requiredTasks).toHaveLength(0);
    expect(retry.session.commandSession.match).toBe(chain);
    expect(chain.resources).toStrictEqual(before.resources);
    expect(chain.gears).toHaveLength(0);
    await writeTrace("unreviewed-source-pending-trace", { decks: f.decks,
      reason: "unreviewed-Gear-source:ogn-234-298:main-deck", commits: f.trace });
  }, 120_000);
});
