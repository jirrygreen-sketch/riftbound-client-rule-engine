// Public V3 allowlist for an admitted V2 match. This is deliberately independent of the
// V2 projector: a V2 wire object (or a private object view) must never be cast/spread into V3.
// Only the settled, validated permanent carriers supply the new playing-only fields.
import type {
  DuelWireBase, DuelWireBaseRune, DuelWireBattlefield, DuelWireBoardV3,
  DuelWireCard, DuelWireFrame, DuelWireGearPermanent, DuelWireGoldToken,
  DuelWireLegendPermanent, DuelWireMatchV3, DuelWirePerson, DuelWirePlayingPlayerV3,
  DuelWireResourceBase, DuelWireResources, DuelWireRuneCost, DuelWireRunePool,
  DuelWireScoring, DuelWireSetup, DuelWireSetupPlayer, DuelWireUnit, DuelWireUnitTrait,
} from '@riftbound/protocol';
import { assertAdmittedDuelMatchV2, type DuelCanonicalPlayingStateV2, type DuelMatchStateV2 } from './core-v2.js';
import type { DuelMatchPrivatePlayer } from './match-state.js';
import { projectPublicDuelSetup, type PublicDuelSetup, type PublicSetupPlayer } from './setup.js';
import {
  projectPublicDuelBoard, type DuelBase as DuelPublicBase,
  type DuelBattlefield as DuelPublicBattlefield,
} from './battlefields.js';
import { projectPublicDuelUnitObjects, type PublicDuelUnitObject } from './unit-lifecycle.js';
import {
  projectPublicDuelResources,
  type DuelBaseRune, type DuelGoldToken, type DuelResourceBase, type DuelRunePool,
} from './resources.js';
import { projectPublicDuelScoring, type DuelScoringState } from './scoring.js';
import type { DuelPendingPayment } from './canonical-session.js';

function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new TypeError(`Duel V3 projection: ${label}`);
}

// Setup is identical to the public V2 allowlist apart from the fixed wire version. In
// particular, do not inspect permanent state while projecting the setup branch.
function wirePerson(person: DuelWirePerson): DuelWirePerson {
  return { playerId: person.playerId, displayName: person.displayName };
}
function wireSetupPlayer(player: PublicSetupPlayer): DuelWireSetupPlayer {
  return player.hand !== undefined
    ? { playerId: player.playerId, legend: { cardId: player.legend.cardId },
      champion: { cardId: player.champion.cardId }, handCount: player.handCount,
      mainDeckCount: player.mainDeckCount, runeDeckCount: player.runeDeckCount,
      mulliganStatus: player.mulliganStatus,
      hand: player.hand.map((card): DuelWireCard => ({ uid: card.uid, cardId: card.cardId })) }
    : { playerId: player.playerId, legend: { cardId: player.legend.cardId },
      champion: { cardId: player.champion.cardId }, handCount: player.handCount,
      mainDeckCount: player.mainDeckCount, runeDeckCount: player.runeDeckCount,
      mulliganStatus: player.mulliganStatus };
}
function wireSetup(setup: PublicDuelSetup): DuelWireSetup {
  return { stage: setup.stage, turnOrder: [setup.turnOrder[0], setup.turnOrder[1]],
    firstPlayerId: setup.firstPlayerId, currentMulliganOwner: setup.currentMulliganOwner,
    players: [wireSetupPlayer(setup.players[0]), wireSetupPlayer(setup.players[1])],
    selectedBattlefields: setup.selectedBattlefields.map(field => ({ playerId: field.playerId,
      instanceId: field.instanceId, cardId: field.cardId })) };
}

function wireLegend(player: DuelMatchPrivatePlayer,
  match: DuelCanonicalPlayingStateV2): DuelWireLegendPermanent {
  // UID is only a private lookup key. It is not a public Legend field, nor is controller
  // inferred from the owning seat, the UID prefix or a Boolean readiness approximation.
  const uid = player.legend.uid;
  check(Object.hasOwn(match.legendStates, uid), `missing Legend state ${uid}`);
  const state = match.legendStates[uid]!;
  check(match.physicalCardsByUID[uid]?.cardId === player.legend.cardId, `Legend printing alias ${uid}`);
  check(match.board.playerIds.includes(state.controllerPlayerId), `Legend controller ${uid}`);
  check(state.readiness === 'ready' || state.readiness === 'exhausted' ||
    (state.readiness === 'not-established' && match.frame.phase === 'awaiting-turn-start' &&
      match.frame.turnNumber === 1), `Legend readiness/timing ${uid}`);
  return { cardId: player.legend.cardId, controllerPlayerId: state.controllerPlayerId,
    readiness: state.readiness };
}
function wirePlayingPlayer(player: DuelMatchPrivatePlayer, viewer: string | null,
  match: DuelCanonicalPlayingStateV2): DuelWirePlayingPlayerV3 {
  const legend = wireLegend(player, match);
  const trash: readonly DuelWireCard[] = player.trash.map(card => ({ uid: card.uid, cardId: card.cardId }));
  return viewer === player.playerId
    ? { playerId: player.playerId, champion: player.champion ? { cardId: player.champion.cardId } : null,
      legend, handCount: player.hand.length, mainDeckCount: player.remainingMainDeck.length,
      hand: player.hand.map((card): DuelWireCard => ({ uid: card.uid, cardId: card.cardId })), trash }
    : { playerId: player.playerId, champion: player.champion ? { cardId: player.champion.cardId } : null,
      legend, handCount: player.hand.length, mainDeckCount: player.remainingMainDeck.length, trash };
}
function wireBase(base: DuelPublicBase): DuelWireBase {
  return { locationId: base.locationId, ownerPlayerId: base.ownerPlayerId,
    occupancy: [...base.occupancy] };
}
function wireBattlefield(field: DuelPublicBattlefield): DuelWireBattlefield {
  return { locationId: field.locationId, instanceId: field.instanceId, cardId: field.cardId,
    ownerPlayerId: field.ownerPlayerId, controllerPlayerId: field.controllerPlayerId,
    contested: field.contested, contestingPlayerId: field.contestingPlayerId,
    showdown: field.showdown, combat: field.combat, occupancy: [...field.occupancy] };
}
function wireTrait(trait: PublicDuelUnitObject['trait']): DuelWireUnitTrait {
  return trait.kind === 'card'
    ? { kind: 'card', cardId: trait.cardId }
    : { kind: 'token', name: trait.name, baseMight: trait.baseMight, tags: [...trait.tags] };
}
function wireUnit(unit: PublicDuelUnitObject): DuelWireUnit {
  return { objectId: unit.objectId, controllerPlayerId: unit.controllerPlayerId,
    locationId: unit.locationId, ownerPlayerId: unit.ownerPlayerId, readied: unit.readied,
    trait: wireTrait(unit.trait), totalDamage: unit.totalDamage,
    damageMarks: unit.damageMarks.map(mark => ({ amount: mark.amount,
      responsiblePlayerId: mark.responsiblePlayerId })) };
}
function wireGears(match: DuelCanonicalPlayingStateV2): DuelWireGearPermanent[] {
  const locations = new Set([...match.board.bases, ...match.board.battlefields].map(b => b.locationId));
  const byGear = new Map(match.gears.map(gear => [gear.uid, gear]));
  const cardUnits = new Map(match.board.units.filter(unit => match.unitMeta[unit.objectId]?.trait.kind === 'card')
    .map(unit => [unit.objectId, unit]));
  return match.gears.map(gear => {
    // All aliases, attachment edges and location/readiness values were admitted by the
    // permanent validator. Refuse to emit a partial/guessed Gear if an internal invariant
    // ever changes; never read its original owner, epoch, provenance or source ledger.
    check(byGear.size === match.gears.length && Object.hasOwn(match.physicalCardsByUID, gear.uid),
      `missing/duplicate physical Gear ${gear.uid}`);
    const cardId = match.physicalCardsByUID[gear.uid]!.cardId;
    check(typeof cardId === 'string' && cardId.trim().length > 0, `Gear printing ${gear.uid}`);
    check(match.board.playerIds.includes(gear.controllerPlayerId) && locations.has(gear.locationId) &&
      typeof gear.readied === 'boolean', `Gear location/controller/readiness ${gear.uid}`);
    const visited = new Set([gear.uid]);
    let hostUID = gear.attachedToUID;
    while (hostUID !== null) {
      check(!visited.has(hostUID), `cyclic Gear attachment ${gear.uid}`);
      visited.add(hostUID);
      const host = byGear.get(hostUID) ?? cardUnits.get(hostUID);
      check(host !== undefined && host.locationId === gear.locationId, `invalid Gear host ${gear.uid}`);
      hostUID = byGear.get(hostUID)?.attachedToUID ?? null;
    }
    const base = match.board.bases.find(value => value.locationId === gear.locationId);
    const hostController = gear.attachedToUID === null ? null :
      (byGear.get(gear.attachedToUID) ?? cardUnits.get(gear.attachedToUID))?.controllerPlayerId;
    check(!base || base.ownerPlayerId === gear.controllerPlayerId || base.ownerPlayerId === hostController,
      `Gear at uncontrolled base ${gear.uid}`);
    return { uid: gear.uid, cardId, controllerPlayerId: gear.controllerPlayerId,
      locationId: gear.locationId, readied: gear.readied, attachedToUID: gear.attachedToUID };
  });
}
function wirePool(pool: DuelRunePool): DuelWireRunePool {
  return { energy: pool.energy, power: { Fury: pool.power.Fury, Calm: pool.power.Calm,
    Mind: pool.power.Mind, Body: pool.power.Body, Chaos: pool.power.Chaos,
    Order: pool.power.Order, any: pool.power.any } };
}
function wireBaseRune(rune: DuelBaseRune): DuelWireBaseRune {
  return { uid: rune.uid, cardId: rune.cardId, domain: rune.domain, readied: rune.readied,
    ownerPlayerId: rune.ownerPlayerId, controllerPlayerId: rune.controllerPlayerId,
    locationId: rune.locationId };
}
function wireGoldToken(token: DuelGoldToken): DuelWireGoldToken {
  return { uid: token.uid, readied: token.readied, ownerPlayerId: token.ownerPlayerId,
    controllerPlayerId: token.controllerPlayerId, locationId: token.locationId };
}
function wireResourceBase(base: DuelResourceBase): DuelWireResourceBase {
  return { playerId: base.playerId, locationId: base.locationId,
    baseRunes: base.baseRunes.map(wireBaseRune), goldTokens: base.goldTokens.map(wireGoldToken) };
}
function wireResources(resources: ReturnType<typeof projectPublicDuelResources>): DuelWireResources {
  const first = resources.players[0]!, second = resources.players[1]!;
  return { players: [
    { playerId: first.playerId, runePool: wirePool(first.runePool), runeDeckCount: first.runeDeckCount },
    { playerId: second.playerId, runePool: wirePool(second.runePool), runeDeckCount: second.runeDeckCount } ],
  bases: [wireResourceBase(resources.bases[0]!), wireResourceBase(resources.bases[1]!)] };
}
function wireScoring(scoring: DuelScoringState): DuelWireScoring {
  const first = scoring.players[0]!, second = scoring.players[1]!;
  return { playerIds: [scoring.playerIds[0]!, scoring.playerIds[1]!],
    battlefieldLocationIds: [scoring.battlefieldLocationIds[0]!, scoring.battlefieldLocationIds[1]!],
    victoryScore: scoring.victoryScore, turnNumber: scoring.turnNumber,
    players: [
      { playerId: first.playerId, points: first.points,
        scoredBattlefieldLocationIds: [...first.scoredBattlefieldLocationIds] },
      { playerId: second.playerId, points: second.points,
        scoredBattlefieldLocationIds: [...second.scoredBattlefieldLocationIds] } ] };
}
function wireCost(cost: DuelPendingPayment['resolvedCost']): DuelWireRuneCost {
  return { energy: cost.energy, power: cost.power.map(requirement => ({
    allowedDomains: [...requirement.allowedDomains], amount: requirement.amount })) };
}
function wirePendingPayment(pending: DuelPendingPayment | null, viewer: string | null):
DuelWireFrame['pendingPayment'] {
  if (pending === null) return null;
  return viewer === pending.actor
    ? { active: true, paymentId: pending.paymentId, resolvedCost: wireCost(pending.resolvedCost) }
    : { active: true };
}

/** Only a live V2 authority and an authenticated seat ID (or null spectator) can project V3. */
export function projectCanonicalDuelMatchV3(
  match: DuelMatchStateV2, viewer: string | null,
): DuelWireMatchV3 {
  assertAdmittedDuelMatchV2(match); // Membership first: never read a forged state or invoke its getters.
  check(viewer === null || match.roster.some(person => person.playerId === viewer), 'unknown viewer');
  const roster: [DuelWirePerson, DuelWirePerson] = [wirePerson(match.roster[0]), wirePerson(match.roster[1])];
  const turnOrder: [string, string] = [match.turnOrder[0], match.turnOrder[1]];
  if (match.stage === 'setup') {
    return { schemaVersion: 3, rulesetId: match.rulesetId, matchId: match.matchId,
      dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
      stateVersion: match.stateVersion, eventSeq: match.eventSeq, roster, turnOrder,
      stage: 'setup', setup: wireSetup(projectPublicDuelSetup(match.setup, viewer)) };
  }
  const boardView = projectPublicDuelBoard(match.board);
  const board: DuelWireBoardV3 = { bases: [wireBase(boardView.bases[0]!), wireBase(boardView.bases[1]!)],
    battlefields: [wireBattlefield(boardView.battlefields[0]!), wireBattlefield(boardView.battlefields[1]!)],
    units: match.board.units.length ? projectPublicDuelUnitObjects(match).map(wireUnit) : [],
    gears: wireGears(match) };
  const frame: DuelWireFrame = { phase: match.frame.phase, turnNumber: match.frame.turnNumber,
    turnPlayerId: match.frame.turnPlayerId, priorityPlayerId: match.frame.priorityPlayerId,
    focusPlayerId: match.frame.focusPlayerId, stateOpen: match.frame.stateOpen,
    pendingPayment: wirePendingPayment(match.frame.pendingPayment, viewer) };
  return { schemaVersion: 3, rulesetId: match.rulesetId, matchId: match.matchId,
    dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    stateVersion: match.stateVersion, eventSeq: match.eventSeq, roster, turnOrder, stage: 'playing',
    players: [wirePlayingPlayer(match.players[0], viewer, match), wirePlayingPlayer(match.players[1], viewer, match)],
    board, resources: wireResources(projectPublicDuelResources(match.resources)),
    scoring: wireScoring(projectPublicDuelScoring(match.scoring, match.board)), frame };
}
