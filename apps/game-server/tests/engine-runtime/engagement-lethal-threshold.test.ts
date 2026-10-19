import { describe, expect, it } from "vitest";
import {
  advanceDuelEngagementV2,
  applyDuelResourceCommandV2,
  applyOpenDuelCleanup,
  commitDuelCommandMutationV2,
  commitDuelPlayingMutationV2,
  createDuelCommandSessionV2,
  createDuelPhaseSourceRegistryV2,
  inspectDuelNativeCommitPathV2,
  ContinuousEffectRegistry,
  inspectDuelPhaseSourcesV2,
  moveDuelUnitV2,
  placeDuelUnit,
  runDuelStartOfTurnV2,
  startDuelEngagementV2,
  type DuelCanonicalPlayingStateV2,
  type DuelCatalogCardTypeV2,
  type DuelCommandSessionV2,
  type DuelPhaseProgramEvidenceV2,
  type DuelPhaseRegistryV2,
} from "@riftbound/engine-core/duel";
import { createDuelEngagementServicesV2 } from "../../src/duel/engagement-services-v2.js";
import type { DuelProductionSourceServicesV2 } from "../../src/duel/production-source-services-v2.js";

const printings = ["unit", "champ", "legend", "rune", "field-0", "field-1", "field-2"];
const seats = ["a", "b"].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, index) => ({ uid: `${playerId}-unit-${index}`, cardId: "unit" })),
  champion: { uid: `${playerId}-champion`, cardId: "champ" },
  legend: { uid: `${playerId}-legend`, cardId: "legend" },
  runeDeck: Array.from({ length: 6 }, (_, index) => ({ uid: `${playerId}-rune-${index}`,
    cardId: "rune", domain: "Fury" as const })),
  battlefields: Array.from({ length: 3 }, (_, index) => ({ instanceId: `${playerId}-field-${index}`,
    cardId: `field-${index}` })),
}));
const metadata = {
  matchId: "server-engagement-threshold",
  dataVersion: "server-engagement-fixture-1",
  catalogDigest: "sha256:server-engagement-fixture-1",
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) as
    [{ playerId: string; displayName: string }, { playerId: string; displayName: string }],
};

const cardType = (cardId: string): DuelCatalogCardTypeV2 =>
  cardId === "champ" ? "Champion" : cardId === "legend" ? "Legend" :
    cardId === "rune" ? "Rune" : cardId.startsWith("field-") ? "Battlefield" : "Unit";

function evidence(request: Parameters<Parameters<typeof createDuelPhaseSourceRegistryV2>[1]>[0]): DuelPhaseProgramEvidenceV2 {
  return {
    status: "complete", matchId: request.matchId, dataVersion: request.dataVersion,
    catalogDigest: request.catalogDigest, turn: request.turn, taskId: request.taskId,
    uid: request.source.uid, zoneEpoch: request.source.zoneEpoch,
    controllerPlayerId: request.source.controllerPlayerId, cardId: request.source.cardId,
    programReference: `fixture:${request.source.cardId}`, event: request.event,
    eventSupported: true, scope: "known-no-handler", replacementsCovered: true,
    staticCovered: true, continuousCovered: true, triggersCovered: true,
  };
}

function phaseRegistry(): DuelPhaseRegistryV2 {
  return createDuelPhaseSourceRegistryV2({ matchId: metadata.matchId,
    dataVersion: metadata.dataVersion, catalogDigest: metadata.catalogDigest,
    printings: printings.map(cardId => ({ cardId, programReference: `fixture:${cardId}` })) }, evidence);
}

interface Position {
  readonly session: DuelCommandSessionV2;
  readonly fieldId: string;
  readonly attacker: "a" | "b";
  readonly defender: "a" | "b";
  readonly units: Readonly<Record<"a" | "b", string>>;
}

function mainPosition(): Position {
  let session = createDuelCommandSessionV2(seats, metadata, () => 0, cardType);
  for (const actor of ["a", "b"]) {
    const result = applyDuelResourceCommandV2(session, actor, { commandId: `mulligan-${actor}`,
      expectedVersion: session.match.stateVersion, command: { type: "mulligan", selectedUIDs: [] } });
    expect(result.outcome.status).toBe("applied");
    session = result.session;
  }
  let head = session.match;
  const started = runDuelStartOfTurnV2(session, { sources: phaseRegistry(), fepr: () => ({ status: "none" }),
    observeCheckpoint: checkpoint => {
      inspectDuelNativeCommitPathV2(head, checkpoint.match);
      head = checkpoint.match;
      return true;
    } });
  expect(started.status).toBe("main");
  session = started.session;
  const units = Object.fromEntries(session.match.players.map(player =>
    [player.playerId, player.hand[0]!.uid])) as Record<"a" | "b", string>;

  let placedMatch = head;
  let placedSession = session;
  const allPlacement = commitDuelCommandMutationV2(placedSession, draft => {
    let board = draft.board;
    const unitMeta = { ...draft.unitMeta };
    const players = draft.players.map(player => ({ ...player,
      hand: player.hand.filter(card => !Object.values(units).includes(card.uid)) }));
    const transitions: { uid: string; from: { kind: "hand"; zonePlayerId: string };
      to: { kind: "board-base"; locationId: string } }[] = [];
    for (const actor of ["a", "b"] as const) {
      const uid = units[actor];
      const base = board.bases.find(item => item.ownerPlayerId === actor)!;
      board = placeDuelUnit(board, { objectId: uid, controllerPlayerId: actor, locationId: base.locationId });
      unitMeta[uid] = { ownerPlayerId: actor, readied: false, damageMarks: [],
        trait: { kind: "card", cardId: "unit" } };
      transitions.push({ uid, from: { kind: "hand", zonePlayerId: actor },
        to: { kind: "board-base", locationId: base.locationId } });
    }
    return { match: { ...draft, board, unitMeta,
      players: players as unknown as DuelCanonicalPlayingStateV2["players"] }, transitions };
  });
  inspectDuelNativeCommitPathV2(placedMatch, allPlacement.session.match);
  placedSession = allPlacement.session;
  placedMatch = allPlacement.session.match;
  const placed = placedSession;
  const fieldId = placed.match.board.battlefields[0]!.locationId;
  let headAfterPlacement = placed.match;
  const movedA = moveDuelUnitV2(headAfterPlacement, units.a, fieldId);
  inspectDuelNativeCommitPathV2(headAfterPlacement, movedA);
  headAfterPlacement = movedA;
  const movedB = moveDuelUnitV2(headAfterPlacement, units.b, fieldId);
  inspectDuelNativeCommitPathV2(headAfterPlacement, movedB);
  headAfterPlacement = movedB;
  const finalMatch = commitDuelPlayingMutationV2(headAfterPlacement, draft => ({
    match: { ...draft, board: applyOpenDuelCleanup(draft.board) }, transitions: [] }));
  inspectDuelNativeCommitPathV2(headAfterPlacement, finalMatch);
  const stagedSession = { ...placedSession, match: finalMatch };
  expect(finalMatch.board.battlefields[0]!.showdown).toBe("staged");
  expect(finalMatch.board.battlefields[0]!.combat).toBe("staged");
  const attacker = finalMatch.board.battlefields[0]!.contestingPlayerId as "a" | "b";
  const defender = attacker === "a" ? "b" : "a";
  return { session: stagedSession, fieldId, attacker, defender, units };
}

function sources(head: () => DuelCanonicalPlayingStateV2, registry: DuelPhaseRegistryV2,
  currentMight: (uid: string) => number): DuelProductionSourceServicesV2 {
  return {
    phaseRegistry: registry,
    inspect: context => {
      const inspected = inspectDuelPhaseSourcesV2(head(), context.event, context.turn,
        context.taskId, registry);
      const sourceUIDs = head().board.units.filter(unit => unit.locationId ===
        head().board.battlefields.find(field => field.combat === "active")?.locationId)
        .map(unit => unit.objectId).sort();
      return { ...inspected, candidates: inspected.sources, eventSources: [], activeSources: [],
        sources: inspected.sources.filter(source => sourceUIDs.includes(source.uid)),
        runtimeSources: [] };
    },
    derivedMight: (uid, context) => {
      const current = head();
      if (current.matchId !== context.matchId || current.stateVersion !== context.clock.stateVersion ||
          current.eventSeq !== context.clock.eventSeq) return { status: "blocked", uid, reason: "stale-head" };
      return { status: "complete", uid, currentMight: currentMight(uid) };
    },
    entry: () => { throw new Error("unit entry is not used by this engagement fixture"); },
    costBinding: () => { throw new Error("cost binding is not used by this engagement fixture"); },
    spellCostBinding: () => { throw new Error("spell cost binding is not used by this engagement fixture"); },
  } as DuelProductionSourceServicesV2;
}

function runCombat(thresholdOwner: "attacker" | "defender" | null = null) {
  const position = mainPosition();
  const might = {
    attacker: 1,
    defender: 4,
  } as const;
  let head = position.session.match;
  const effects = new ContinuousEffectRegistry();
  const thresholdController = thresholdOwner === null ? null : position[thresholdOwner];
  if (thresholdController) effects.register({
    id: `threshold-${thresholdController}`,
    layer: "ability",
    source: { id: `threshold-source-${thresholdController}`, zoneEntryId: 1 },
    filter: {},
    effect: { kind: "continuous.lethal-threshold", amount: 1,
      appliesTo: { damageController: "controller", target: "enemy-units" },
      sourcePlayer: thresholdController },
  }, { type: "end-of-combat" });
  const registry = phaseRegistry();
  const services = createDuelEngagementServicesV2({ currentHead: () => head,
    sources: sources(() => head, registry, uid => uid === position.units[position.attacker]
      ? might.attacker : might.defender), randomIndex: () => 0, effects });
  const phases: string[] = [];
  let step = startDuelEngagementV2(head, position.fieldId, services);
  expect(step.status).toBe("active");
  if (!("cursor" in step)) throw new Error("engagement did not start");
  if (step.match !== head) inspectDuelNativeCommitPathV2(head, step.match);
  head = step.match;
  phases.push(step.cursor.phase);
  const advance = (command: Parameters<typeof advanceDuelEngagementV2>[1]) => {
    const before = head;
    step = advanceDuelEngagementV2(step.cursor, command);
    if (step.match !== before) inspectDuelNativeCommitPathV2(before, step.match);
    if (step.match !== before) head = step.match;
    if ("cursor" in step) phases.push(step.cursor.phase);
  };
  const firstFocus = step.cursor.expectedActorPlayerId as "a" | "b";
  const secondFocus = firstFocus === "a" ? "b" : "a";
  advance({ kind: "pass-focus", actorPlayerId: firstFocus, expectedStateVersion: step.match.stateVersion });
  advance({ kind: "pass-focus", actorPlayerId: secondFocus, expectedStateVersion: step.match.stateVersion });
  expect(step.cursor.expectedActorPlayerId).toBe(position.attacker);
  expect(step.match.board.battlefields[0]).toMatchObject({ showdown: "active", combat: "active",
    contested: true, contestingPlayerId: position.attacker });
  expect(services.combat.proveBasicCombat({ stateVersion: step.match.stateVersion,
    fieldId: position.fieldId, unitUIDs: [position.units.a, position.units.b] })).toMatchObject({
    currentMight: "validated", assignmentModifier: "proven-none",
    preventionReplacement: "proven-none", keywordPriority: "proven-none",
  });
  expect(services.combat.currentMight({ uid: position.units[position.attacker],
    controllerPlayerId: position.attacker, locationId: position.fieldId,
    fieldId: position.fieldId, existingDamage: 0, combatRole: "attacker" })).toBe(might.attacker);
  expect(services.combat.currentMight({ uid: position.units[position.defender],
    controllerPlayerId: position.defender, locationId: position.fieldId,
    fieldId: position.fieldId, existingDamage: 0, combatRole: "defender" })).toBe(might.defender);
  const firstActor = step.cursor.expectedActorPlayerId as "a" | "b";
  const secondActor = firstActor === "a" ? "b" : "a";
  const firstDamage = firstActor === position.attacker ? might.attacker : might.defender;
  const secondDamage = secondActor === position.attacker ? might.attacker : might.defender;
  const firstChoice = { actorPlayerId: firstActor,
    orderedUIDAmounts: [{ uid: position.units[secondActor], amount: firstDamage }], expectedStateVersion: step.match.stateVersion };
  step = advanceDuelEngagementV2(step.cursor, { kind: "assign-damage", choice: firstChoice });
  expect(step.reason, JSON.stringify({ status: step.status, phase: "cursor" in step ? step.cursor.phase : "complete" })).toBeUndefined();
  expect(step.cursor.expectedActorPlayerId).toBe(secondActor);
  const secondChoice = { actorPlayerId: secondActor,
    orderedUIDAmounts: [{ uid: position.units[firstActor], amount: secondDamage }], expectedStateVersion: step.match.stateVersion };
  const beforeDeal = head;
  step = advanceDuelEngagementV2(step.cursor, { kind: "assign-damage", choice: secondChoice });
  inspectDuelNativeCommitPathV2(beforeDeal, step.match);
  head = step.match;
  expect(step.cursor.phase).toBe("lethal");
  expect(step.match.unitMeta[position.units[secondActor]]!.damageMarks).toEqual([
    expect.objectContaining({ amount: firstDamage, responsiblePlayerId: firstActor }),
  ]);
  // The attacker's mark exists only after the defender submits the second
  // allocation; assert it here, before any subsequent cleanup may remove it.
  expect(step.match.unitMeta[position.units[firstActor]]!.damageMarks).toEqual([
    expect.objectContaining({ amount: secondDamage, responsiblePlayerId: secondActor }),
  ]);
  expect(phases).toEqual(expect.arrayContaining(["damage"]));
  // The end-of-combat threshold must survive the Lethal Damage check. Advance
  // the real engagement through every cleanup boundary so expiry is exercised
  // by the executor's combat-result/combat-end gate rather than a helper call.
  advance({ kind: "continue", expectedStateVersion: step.match.stateVersion });
  expect(step.reason, JSON.stringify({ status: step.status, phase: step.cursor.phase })).toBeUndefined();
  expect(step.cursor.phase).toBe("heal");
  if (thresholdOwner !== null) expect(effects.list()).toHaveLength(1);
  advance({ kind: "continue", expectedStateVersion: step.match.stateVersion });
  expect(step.cursor.phase).toBe("recall");
  advance({ kind: "continue", expectedStateVersion: step.match.stateVersion });
  expect(step.cursor.phase).toBe("fepr");
  advance({ kind: "continue", expectedStateVersion: step.match.stateVersion });
  expect(step.cursor.phase).toBe("result");
  advance({ kind: "continue", expectedStateVersion: step.match.stateVersion });
  expect(step.reason, JSON.stringify({ status: step.status, phase: step.cursor.phase })).toBeUndefined();
  expect(step.cursor.phase).toBe("after-result");
  expect(effects.list()).toEqual([]);
  advance({ kind: "continue", expectedStateVersion: step.match.stateVersion });
  expect(step.status).toBe("complete");
  expect(effects.list()).toEqual([]);
  return { final: step.match, attackerUnit: position.units[position.attacker],
    defenderUnit: position.units[position.defender], effects };
}

describe("server engagement lethal threshold", () => {
  it("uses the damage controller's CR 142.4.c threshold through the real engagement lifecycle", () => {
    const result = runCombat("attacker");
    expect(result.final.board.units.some(unit => unit.objectId === result.defenderUnit)).toBe(false);
    expect(result.final.players.find(player => player.playerId === "b")?.trash)
      .toContainEqual(expect.objectContaining({ uid: result.defenderUnit }));
    expect(result.effects.list()).toEqual([]);
  });

  it("keeps CR 142.4.b current Might as the default and does not apply another controller's threshold", () => {
    const defaultResult = runCombat(null);
    expect(defaultResult.final.board.units).toContainEqual(expect.objectContaining({
      objectId: defaultResult.defenderUnit,
      locationId: defaultResult.final.board.battlefields[0]!.locationId,
    }));
    expect(defaultResult.final.unitMeta[defaultResult.defenderUnit]!.damageMarks).toEqual([]);
  });
});
