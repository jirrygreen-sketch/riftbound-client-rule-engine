// Explicit public allowlist projector for the V2 match. It consumes the trusted V2 match
// authority (`DuelMatchStateV2`) and emits the protocol V2 wire DTO (`DuelWireMatchV2`) with
// `schemaVersion: 2`. It never spreads V2 state, never calls a V2->V1 downgrade/validation
// adapter, never casts away the schema, and never widens a V1 guard to parse V2.
//
// The wire version is FIXED by the caller's projection schema (DUEL_PROJECTION_SCHEMA_V2); this
// file therefore does not choose a version or reduce schemaVersion to 1. The public board/unit/
// resources/scoring/setup kernels are the only allowed inputs; the private V2 provenance,
// physicalCardsByUID, legendStates, gears, retiredPhysicalUIDs, zoneEpoch and the session
// receipt/task/payment ledgers are never read here and cannot reach the output.
import {
  type DuelWireBase,
  type DuelWireBaseRune,
  type DuelWireBattlefield,
  type DuelWireBoard,
  type DuelWireCard,
  type DuelWireFrame,
  type DuelWireGoldToken,
  type DuelWireMatchV2,
  type DuelWirePerson,
  type DuelWirePlayingPlayer,
  type DuelWireResourceBase,
  type DuelWireResources,
  type DuelWireRuneCost,
  type DuelWireRunePool,
  type DuelWireScoring,
  type DuelWireSetup,
  type DuelWireSetupPlayer,
  type DuelWireUnit,
  type DuelWireUnitTrait,
} from '@riftbound/protocol';
import { assertAdmittedDuelMatchV2, type DuelMatchStateV2 } from './core-v2.js';
import type { DuelMatchPrivatePlayer } from './match-state.js';
import {
  projectPublicDuelSetup, type PublicDuelSetup, type PublicSetupPlayer,
} from './setup.js';
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
  if (!condition) throw new TypeError(`Duel V2 projection: ${label}`);
}

// ---- shared / setup -------------------------------------------------------

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

/** Setup branch: reuse the public setup kernel; only the viewer's own hand is present. */
function wireSetup(setup: PublicDuelSetup): DuelWireSetup {
  return { stage: setup.stage, turnOrder: [setup.turnOrder[0], setup.turnOrder[1]],
    firstPlayerId: setup.firstPlayerId, currentMulliganOwner: setup.currentMulliganOwner,
    players: [wireSetupPlayer(setup.players[0]), wireSetupPlayer(setup.players[1])],
    selectedBattlefields: setup.selectedBattlefields.map(field => ({ playerId: field.playerId,
      instanceId: field.instanceId, cardId: field.cardId })) };
}

// ---- playing kernels ------------------------------------------------------

function wirePlayingPlayer(player: DuelMatchPrivatePlayer, viewer: string | null): DuelWirePlayingPlayer {
  const trash: readonly DuelWireCard[] = player.trash.map(card => ({ uid: card.uid, cardId: card.cardId }));
  return viewer === player.playerId
    ? { playerId: player.playerId, champion: player.champion ? { cardId: player.champion.cardId } : null,
      legend: { cardId: player.legend.cardId }, handCount: player.hand.length,
      mainDeckCount: player.remainingMainDeck.length,
      hand: player.hand.map((card): DuelWireCard => ({ uid: card.uid, cardId: card.cardId })), trash }
    : { playerId: player.playerId, champion: player.champion ? { cardId: player.champion.cardId } : null,
      legend: { cardId: player.legend.cardId }, handCount: player.hand.length,
      mainDeckCount: player.remainingMainDeck.length, trash };
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

/** Only the payment actor sees the payment ID and resolved cost; others/spectators see `{active}`. */
function wirePendingPayment(pending: DuelPendingPayment | null, viewer: string | null):
DuelWireFrame['pendingPayment'] {
  if (pending === null) return null;
  return viewer === pending.actor
    ? { active: true, paymentId: pending.paymentId, resolvedCost: wireCost(pending.resolvedCost) }
    : { active: true };
}

// ---- entry ----------------------------------------------------------------

/** Public allowlist from the trusted V2 match; the private session ledger is never an input.
 *  `viewer` is an authenticated seat ID or null for a spectator, never a client-supplied snapshot. */
export function projectCanonicalDuelMatchV2(
  match: DuelMatchStateV2, viewer: string | null,
): DuelWireMatchV2 {
  assertAdmittedDuelMatchV2(match);
  check(viewer === null || match.roster.some(person => person.playerId === viewer), 'unknown viewer');
  const roster: [DuelWirePerson, DuelWirePerson] = [wirePerson(match.roster[0]), wirePerson(match.roster[1])];
  const turnOrder: [string, string] = [match.turnOrder[0], match.turnOrder[1]];
  if (match.stage === 'setup') {
    return { schemaVersion: 2, rulesetId: match.rulesetId, matchId: match.matchId,
      dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
      stateVersion: match.stateVersion, eventSeq: match.eventSeq, roster, turnOrder,
      stage: 'setup', setup: wireSetup(projectPublicDuelSetup(match.setup, viewer)) };
  }
  const boardView = projectPublicDuelBoard(match.board);
  const board: DuelWireBoard = { bases: [wireBase(boardView.bases[0]!), wireBase(boardView.bases[1]!)],
    battlefields: [wireBattlefield(boardView.battlefields[0]!), wireBattlefield(boardView.battlefields[1]!)],
    units: match.board.units.length ? projectPublicDuelUnitObjects(match).map(wireUnit) : [] };
  const frame: DuelWireFrame = { phase: match.frame.phase, turnNumber: match.frame.turnNumber,
    turnPlayerId: match.frame.turnPlayerId, priorityPlayerId: match.frame.priorityPlayerId,
    focusPlayerId: match.frame.focusPlayerId, stateOpen: match.frame.stateOpen,
    pendingPayment: wirePendingPayment(match.frame.pendingPayment, viewer) };
  return { schemaVersion: 2, rulesetId: match.rulesetId, matchId: match.matchId,
    dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    stateVersion: match.stateVersion, eventSeq: match.eventSeq, roster, turnOrder, stage: 'playing',
    players: [wirePlayingPlayer(match.players[0], viewer), wirePlayingPlayer(match.players[1], viewer)],
    board, resources: wireResources(projectPublicDuelResources(match.resources)),
    scoring: wireScoring(projectPublicDuelScoring(match.scoring, match.board)), frame };
}
