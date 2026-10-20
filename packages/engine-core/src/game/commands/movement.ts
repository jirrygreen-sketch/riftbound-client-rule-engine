import type { V2MoveDestination } from '../../../../protocol/dist/v2/commands.js';
import type { DuelBoard } from '../../duel/battlefields.js';
import type { LocationRef, ObjectRef, ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import type { StandardMoveBatchResult } from '../../turn/movement.js';
import { moveDuelUnitsStandard } from '../../zones/movement.js';
import { TurnCombatBlockedError } from '../../turn/flow.js';
import type { Match } from '../lifecycle.js';

export class GameCommandError extends Error {
  readonly name = 'GameCommandError';
  constructor(readonly code: string, message: string) { super(message); }
}

/** Authenticated state, never supplied by the wire command. */
export interface GameCommandContext {
  readonly match: Match;
  readonly stateVersion: number;
}

export function requireActor(context: GameCommandContext, actor: PlayerId): void {
  if (!context.match.turnOrder.includes(actor)) throw new GameCommandError('unknown-player', 'Unknown player');
  if (context.match.result().winner) throw new GameCommandError('game-over', 'Game is over');
}

export function currentObjects(match: Match): readonly ObjectSnapshot[] {
  match.flow.layers.setObjects(match.flow.options.host.objects());
  return match.flow.layers.evaluateAll();
}

export function controlledObject(objects: readonly ObjectSnapshot[], actor: PlayerId, id: string): ObjectSnapshot {
  const object = objects.find(candidate => candidate.ref.id === id);
  // Ownership does not grant control. Keep all unavailable-object errors identical.
  if (!object || object.controller !== actor || object.faceDown) {
    throw new GameCommandError('unavailable-object', 'Object is unavailable');
  }
  return object;
}

const baseId = (player: string) => JSON.stringify(['duel-base', player]);
const fieldId = (id: string) => JSON.stringify(['duel-battlefield', id]);
const locationId = (location: LocationRef) => location.type === 'base' ? baseId(location.player) : fieldId(location.id);

/** A detached read view for the existing movement validator, never a second state store. */
function movementBoard(match: Match, objects: readonly ObjectSnapshot[]): DuelBoard {
  const units = objects.filter(object => object.zone === 'board' && object.types.includes('unit'));
  if (units.some(unit => !unit.location)) {
    throw new TurnCombatBlockedError('unit-location', 'A board Unit has no authoritative location');
  }
  const boardUnits = units.map(unit => ({
    objectId: unit.ref.id, controllerPlayerId: unit.controller, locationId: locationId(unit.location!),
  }));
  const occupancy = (id: string) => boardUnits.filter(unit => unit.locationId === id).map(unit => unit.objectId);
  return {
    playerIds: [...match.turnOrder],
    bases: match.turnOrder.map(player => ({ locationId: baseId(player), ownerPlayerId: player, occupancy: occupancy(baseId(player)) })),
    battlefields: match.flow.battlefields.map((field, index) => {
      const combat = match.flow.combat.current;
      return {
        instanceId: field.id,
        locationId: fieldId(field.id),
        cardId: match.setup.battlefields.find(value => value.id === field.id)?.cardId ?? field.id,
        // Selected battlefields are reported in seat order, regardless of turn order.
        ownerPlayerId: index === 0 ? 'A' : 'B',
        controllerPlayerId: field.controller,
        contested: field.contestedBy !== null,
        contestingPlayerId: field.contestedBy,
        showdown: combat?.field === field.id && combat.step === 'showdown' ? 'active' : field.staged === 'none' ? 'none' : 'staged',
        combat: field.staged === 'combat' ? 'staged' : 'none',
        occupancy: occupancy(fieldId(field.id)),
      };
    }),
    units: boardUnits,
  };
}

export interface StandardMoveInspection {
  readonly objects: readonly ObjectRef[];
  readonly to: LocationRef;
  /** The whole formation passed preflight and may enter the atomic Move task. */
  readonly execution: 'available';
  readonly code: 'standard-move-atomic';
}

export interface StandardMoveExecution extends StandardMoveInspection {
  readonly receipt: StandardMoveBatchResult['receipt'];
  readonly eventSeq: number;
}

interface PreparedStandardMove {
  readonly board: DuelBoard;
  readonly readiness: readonly {
    readonly objectId: string;
    readonly readied: boolean;
    readonly hasGanking: boolean;
  }[];
  readonly objects: readonly ObjectRef[];
  readonly to: LocationRef;
}

/** CR v1.5 144 / 810: validate the entire formation before paying any cost. */
function prepareStandardMove(
  context: GameCommandContext, actor: PlayerId, objectIds: readonly string[], to: V2MoveDestination,
): PreparedStandardMove {
  requireActor(context, actor);
  const { match } = context;
  if (to.zone !== 'base' && to.zone !== 'battlefield') {
    throw new GameCommandError('illegal-destination', 'Standard Move requires a Base or Battlefield');
  }
  let destination: LocationRef;
  if (to.zone === 'base') {
    if (to.locationId !== undefined || to.playerId !== undefined && to.playerId !== actor) {
      throw new GameCommandError('illegal-destination', 'Standard Move requires your own Base');
    }
    destination = { type: 'base', player: actor };
  } else {
    if (to.playerId !== undefined || !to.locationId || !match.flow.battlefields.some(field => field.id === to.locationId)) {
      throw new GameCommandError('illegal-destination', 'Unknown Battlefield');
    }
    destination = { type: 'battlefield', id: to.locationId };
  }
  const objects = currentObjects(match);
  const selected = objectIds.map(id => controlledObject(objects, actor, id));
  if (selected.some(object => object.zone !== 'board' || !object.types.includes('unit'))) {
    throw new GameCommandError('illegal-unit', 'Standard Move requires board Units');
  }
  const board = movementBoard(match, objects);
  const readiness = board.units.map(unit => {
    const object = objects.find(candidate => candidate.ref.id === unit.objectId)!;
    return {
      objectId: unit.objectId,
      readied: !object.exhausted,
      hasGanking: object.keywords.some(keyword => keyword.id.toLowerCase() === 'ganking'),
    };
  });
  try {
    moveDuelUnitsStandard(board, readiness, {
      actor, unitUIDs: [...objectIds], destinationLocationId: locationId(destination),
      timing: {
        phase: match.flow.phase === 'main' ? 'main' : 'other',
        stateOpen: match.flow.chain.turnState === 'neutral-open' && match.flow.chain.canAct(actor, 'normal') && !match.flow.combat.active,
        turnPlayerId: match.flow.turnPlayer, priorityPlayerId: match.flow.chain.priority,
      },
    }, {
      registry: match.flow.layers.registry,
      refForUnit: unit => objects.find(object => object.ref.id === unit.objectId)!.ref,
      objectForUnit: unit => objects.find(object => object.ref.id === unit.objectId)!,
    });
  } catch (error) {
    // The leaf validator includes IDs in diagnostics; do not expose them over the command boundary.
    if (error instanceof TypeError) throw new GameCommandError('illegal-move', 'Illegal Standard Move');
    throw error;
  }
  return { board, readiness, objects: selected.map(object => ({ ...object.ref })), to: destination };
}

/** Validate a complete formation without paying Exhaust or changing any authority state. */
export function inspectStandardMove(
  context: GameCommandContext, actor: PlayerId, objectIds: readonly string[], to: V2MoveDestination,
): StandardMoveInspection {
  const prepared = prepareStandardMove(context, actor, objectIds, to);
  return {
    objects: prepared.objects, to: prepared.to,
    execution: 'available', code: 'standard-move-atomic',
  };
}

/** Internal formation API. Protocol v2 currently carries only one objectId. */
export function moveUnits(
  context: GameCommandContext, actor: PlayerId, objectIds: readonly string[], to: V2MoveDestination,
): StandardMoveExecution {
  const prepared = prepareStandardMove(context, actor, objectIds, to);
  const result = context.match.flow.moveFormation({
    board: prepared.board,
    unitIds: [...objectIds],
    actor,
    destination: prepared.to,
    readiness: prepared.readiness,
    rules: {
      registry: context.match.flow.layers.registry,
      refForUnit: unit => {
        const object = context.match.flow.options.host.objects()
          .find(candidate => candidate.ref.id === unit.objectId);
        if (object === undefined) throw new TypeError('Standard Move unit is absent');
        return object.ref;
      },
      objectForUnit: unit => currentObjects(context.match).find(object => object.ref.id === unit.objectId)!,
    },
  });
  return {
    objects: prepared.objects,
    to: prepared.to,
    execution: 'available',
    code: 'standard-move-atomic',
    receipt: result.receipt,
    eventSeq: context.match.events().length,
  };
}
