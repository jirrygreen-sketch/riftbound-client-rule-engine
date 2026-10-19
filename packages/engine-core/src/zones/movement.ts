// CR v1.4: 143.4 (units enter the Board exhausted), 144.1–144.4 (Standard Move: Main Phase, Open
// State, no ongoing Showdown/Combat, exhausting is the cost, simultaneous multi-unit group move,
// destination restrictions), 312 (Priority gates whose Discretionary Action this is), 420.3 (the
// Standard Move IS a Discretionary Action — unlike a Move Effect, which 420.2 makes a Limited
// Action), 447 (Origin/Destination), 810 + 144.4.c (Ganking adds the Battlefield→Battlefield
// option to the Standard Move).
//
// Internal duel kernel. It re-implements no board rule and introduces no public command or IR
// vocabulary: the accepted `DuelBoard` is the ONLY authority for locations, control
// and contested, and the trusted readiness records only describe per-unit state / already-derived
// keywords (they carry no location and no controller at all).
//
// Boundary of this helper (do not over-claim): it validates and performs exactly ONE Standard Move
// group action. It resolves no triggered ability, runs no cleanup, and establishes no Conquer,
// Showdown, Combat or Recall. The caller must queue Move triggers and then run one Open cleanup.
import type { ObjectRef, ObjectSnapshot } from '../effects/contract.js';
import { movement as queryMovement, restrictions as queryRestrictions } from '../layers/rules/query.js';
import type { ContinuousEffectRegistry } from '../layers/duration.js';
import { assertDuelBoard, relocateDuelUnit, restoreDuelBoard, type DuelBoard, type DuelUnit } from '../duel/battlefields.js';

/** Per-unit state, derived from canonical state / IR by the executor. Never a wire field. */
export interface DuelReadinessRecord {
  readonly objectId: string;
  /** 144.2: an exhausted unit cannot pay the exhaustion cost of another Standard Move. */
  readonly readied: boolean;
  /** 810.1.b: Ganking is a passive characteristic; its resolution belongs to the canonical engine. */
  readonly hasGanking: boolean;
}
/**
 * Dense array with exactly one record per `board.units` entry (no unknown UID, no missing UID, no
 * extra record). This deliberately stores no controller and no location, so position/control
 * authority cannot be duplicated outside `DuelBoard`.
 */
export type DuelReadiness = readonly DuelReadinessRecord[];

/** Trusted context derived by the canonical executor, NEVER accepted from a client or wire payload. */
export interface DuelStandardMoveTiming {
  /** 144.1.a: only the acting player's Main Phase may perform a Standard Move. */
  readonly phase: 'main' | 'other';
  /** 144.1.b: the action cannot be performed during a Closed State. */
  readonly stateOpen: boolean;
  /** 304: the player taking the current turn; their Main Phase is when 312.2.a grants them Priority. */
  readonly turnPlayerId: string;
  /**
   * 312.1: Priority is the singular exclusive right to take Discretionary Actions (420.3 makes the
   * Standard Move one of them), and 312.2.a grants it to the turn player in a Neutral Open Main
   * Phase. `null` means 312.1.b: nobody holds Priority, so nobody may take this action.
   */
  readonly priorityPlayerId: string | null;
}
export interface DuelStandardMoveRequest {
  readonly actor: string;
  /** 144.3.b: origins need not be the same, but the group may not repeat a unit. */
  readonly unitUIDs: readonly string[];
  /** 144.3.a: one shared destination for the whole group. */
  readonly destinationLocationId: string;
  readonly timing: DuelStandardMoveTiming;
}
/** Optional rules-layer bridge. Board state remains authoritative for identity and location. */
export interface DuelMovementRuleContext {
  readonly registry: ContinuousEffectRegistry;
  /** Resolve the current object identity for a board unit when its zone epoch is not 1. */
  readonly refForUnit?: (unit: DuelUnit) => ObjectRef;
  /** Supply the layered snapshot when a movement effect uses rich object filters. */
  readonly objectForUnit?: (unit: DuelUnit) => ObjectSnapshot | null;
}
/** Trusted current-state readers for the transactional second validation pass. */
export interface DuelStandardMoveRecheckContext {
  readonly unit: (unitId: string) => {
    readonly controllerPlayerId: string;
    readonly locationId: string;
    readonly readied: boolean;
    readonly hasGanking: boolean;
  };
  readonly validate: (unitId: string) => void;
}
/** One Move event per moved unit; the array as a whole expresses the single group action 144.3. */
export interface DuelMoveEvent {
  readonly objectId: string;
  readonly actor: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
}
export interface DuelStandardMoveGroup {
  readonly kind: 'standard-move';
  readonly actor: string;
  readonly destinationLocationId: string;
  readonly objectIds: readonly string[];
  readonly exhaustedCount: number;
  readonly events: readonly DuelMoveEvent[];
  /** Executor obligation: queue the Move triggers now (nothing is resolved here). */
  readonly requiresMoveTriggers: true;
  /** Executor obligation: run the outer Open cleanup once, after the triggers. */
  readonly requiresOpenCleanup: true;
}
export interface DuelStandardMoveResult {
  readonly board: DuelBoard;
  readonly readiness: DuelReadiness;
  readonly group: DuelStandardMoveGroup;
}
/** Detached, internal order for one already validated Standard Move group. */
export interface DuelStandardMovePlan {
  readonly actor: string;
  readonly unitIds: readonly string[];
  readonly destinationLocationId: string;
  readonly origins: readonly { readonly objectId: string; readonly locationId: string }[];
}

const READINESS_FIELDS = ['objectId', 'readied', 'hasGanking'] as const;
const REQUEST_FIELDS = ['actor', 'unitUIDs', 'destinationLocationId', 'timing'] as const;
const TIMING_FIELDS = ['phase', 'stateOpen', 'turnPlayerId', 'priorityPlayerId'] as const;

type RecordValue = Record<string, unknown>;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid duel standard move: ${message}`);
}
function record(value: unknown, fields: readonly string[], label: string): RecordValue {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), label);
  const keys = Reflect.ownKeys(value);
  check(keys.length === fields.length && fields.every(key => keys.includes(key)), `${label} keys`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor && 'value' in descriptor, `${label} must not contain accessors`);
  }
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null, `${label} must be a plain object`);
  return value as RecordValue;
}
function list(value: unknown, count: number | null, label: string): unknown[] {
  check(Array.isArray(value) && (count === null || value.length === count), label);
  check(Reflect.ownKeys(value).length === value.length + 1, `${label} extra keys or sparse entries`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    check(descriptor && 'value' in descriptor, `${label} sparse or accessor entry`);
  }
  return value;
}
function text(value: unknown, label: string): string {
  check(typeof value === 'string' && value.trim().length > 0, label);
  return value;
}
function player(value: unknown, board: DuelBoard, label: string): string {
  const valueId = text(value, label);
  check(board.playerIds.includes(valueId), `${label} unknown player`);
  return valueId;
}
function unique(values: readonly string[], label: string): void {
  check(new Set(values).size === values.length, `${label} duplicate`);
}
function boolean(value: unknown, label: string): boolean {
  check(typeof value === 'boolean', `${label} must be boolean`);
  return value;
}

function routeKinds(from: string, destination: string, bases: ReadonlyMap<string, unknown>): 'base-to-battlefield' | 'battlefield-to-base' | 'battlefield-to-battlefield' | null {
  const fromBase = bases.has(from);
  const toBase = bases.has(destination);
  if (fromBase && !toBase) return 'base-to-battlefield';
  if (!fromBase && toBase) return 'battlefield-to-base';
  if (!fromBase && !toBase) return 'battlefield-to-battlefield';
  return null;
}

function routeBlocked(restrictions: readonly string[], route: ReturnType<typeof routeKinds>): boolean {
  const names = new Set(restrictions.map(value => value.toLowerCase()));
  if (names.has('cannot-move') || names.has('move') || names.has('all-movement')) return true;
  if (route === null) return false;
  if (route === 'battlefield-to-battlefield') {
    return names.has('battlefield-to-battlefield') || names.has('move-battlefield-to-battlefield');
  }
  if (route === 'battlefield-to-base') {
    return names.has('battlefield-to-base') || names.has('move-to-base') || names.has('move-from-here-to-base');
  }
  return names.has('base-to-battlefield') || names.has('move-from-base') || names.has('move-to-battlefield');
}

/**
 * KeywordDefs predate the normalized movement-permission record and still
 * publish Ganking as a string. The production static binder registers that
 * shape verbatim, so normalize this one closed permission at the movement
 * consumer. Other permission spellings remain on the typed query path.
 */
function hasRawGankingPermission(
  registry: ContinuousEffectRegistry,
  ref: ObjectRef,
  object: ObjectSnapshot | null | undefined,
  actor: string,
): boolean {
  if (object === null || object === undefined) return false;
  return registry.list().some(entry => {
    const effect = entry.effect.effect as Record<string, unknown>;
    const kind = String(effect.kind ?? '').toLowerCase();
    if (kind !== 'movement' && kind !== 'continuous.movement') return false;
    if (effect.permission !== 'battlefield-to-battlefield') return false;
    const filter = entry.effect.filter as Record<string, unknown>;
    const zone = filter.zone;
    if (zone !== undefined && zone !== object.zone) return false;
    const objectId = filter.objectId ?? filter.id;
    if (objectId !== undefined && objectId !== ref.id) return false;
    const zoneEntryId = filter.zoneEntryId;
    if (zoneEntryId !== undefined && zoneEntryId !== ref.zoneEntryId) return false;
    const controller = filter.controller;
    if (controller !== undefined && controller !== 'any' && controller !== actor &&
      !(typeof controller === 'object' && controller !== null && (controller as { playerId?: unknown }).playerId === actor)) return false;
    const condition = effect.condition;
    if (typeof condition === 'function') {
      try { return Boolean((condition as (target: ObjectSnapshot) => unknown)(object)); }
      catch { return false; }
    }
    return condition === undefined || condition === true;
  }) && ref.id === object.ref.id;
}

/** Exact correspondence with `board.units`; returns detached, validated records in input order. */
function checkedReadiness(board: DuelBoard, input: unknown): DuelReadinessRecord[] {
  const raw = list(input, null, 'readiness').map((value, i) => {
    const item = record(value, READINESS_FIELDS, `readiness[${i}]`);
    return {
      objectId: text(item.objectId, `readiness[${i}].objectId`),
      readied: boolean(item.readied, `readiness[${i}].readied`),
      hasGanking: boolean(item.hasGanking, `readiness[${i}].hasGanking`),
    };
  });
  unique(raw.map(entry => entry.objectId), 'readiness objectId');
  const boardIds = new Set(board.units.map(unit => unit.objectId));
  for (const entry of raw) check(boardIds.has(entry.objectId), `readiness unknown unit ${entry.objectId}`);
  check(raw.length === boardIds.size, 'readiness must hold exactly one record per board unit');
  return raw;
}
function checkedRequest(board: DuelBoard, input: unknown): {
  actor: string; unitUIDs: string[]; destinationLocationId: string; timing: DuelStandardMoveTiming;
} {
  const value = record(input, REQUEST_FIELDS, 'request');
  const actor = player(value.actor, board, 'request.actor');
  const unitUIDs = list(value.unitUIDs, null, 'request.unitUIDs')
    .map((raw, i) => text(raw, `request.unitUIDs[${i}]`));
  check(unitUIDs.length > 0, 'request.unitUIDs must not be empty');
  unique(unitUIDs, 'request.unitUIDs');
  const boardIds = new Set(board.units.map(unit => unit.objectId));
  for (const unitId of unitUIDs) check(boardIds.has(unitId), `request.unitUIDs unknown unit ${unitId}`);
  const destinationLocationId = text(value.destinationLocationId, 'request.destinationLocationId');
  const timingValue = record(value.timing, TIMING_FIELDS, 'request.timing');
  const phase = timingValue.phase;
  check(phase === 'main' || phase === 'other', 'request.timing.phase');
  const stateOpen = boolean(timingValue.stateOpen, 'request.timing.stateOpen');
  const turnPlayerId = player(timingValue.turnPlayerId, board, 'request.timing.turnPlayerId');
  const priorityPlayerId = timingValue.priorityPlayerId === null
    ? null : player(timingValue.priorityPlayerId, board, 'request.timing.priorityPlayerId');
  return { actor, unitUIDs, destinationLocationId, timing: { phase, stateOpen, turnPlayerId, priorityPlayerId } };
}

/** Validates a readiness snapshot against the board without copying it. */
export function assertDuelReadiness(board: DuelBoard, input: unknown): asserts input is DuelReadiness {
  assertDuelBoard(board);
  checkedReadiness(board, input);
}
/** Validates and returns a detached readiness copy with the same record order. */
export function restoreDuelReadiness(board: DuelBoard, snapshot: unknown): DuelReadiness {
  assertDuelBoard(board);
  return checkedReadiness(board, snapshot).map(entry => ({ ...entry }));
}

/**
 * 144: performs one simultaneous Standard Move group action.
 *
 * Every selected unit is validated up front (exists, controlled by the actor, readied, no duplicate
 * UID, origin ≠ destination, a legal origin/destination pair, and Ganking for Battlefield→
 * Battlefield). Ownership is never consulted: a unit always moves with its controller, so a unit
 * owned by another player still moves between its controller's base and the shared battlefields.
 * Only after the whole group validates are the board and readiness copied; the selected units are
 * exhausted together and then relocated, and no cleanup runs in between.
 *
 * Out of scope here (outer engine): Move triggers, cleanup/Recall, Conquer/Showdown/Combat,
 * multi-player or team destination restrictions (144.4.a.1 / 447.2) and any occupancy cap.
 */
export function moveDuelUnitsStandard(
  board: DuelBoard, readiness: unknown, request: unknown,
  rules?: DuelMovementRuleContext,
): DuelStandardMoveResult {
  const { board: checked, records, plan } = checkedStandardMove(board, readiness, request, rules);
  const { actor, unitIds, destinationLocationId } = plan;
  const checkedUnitIds = new Set(checked.units.map(unit => unit.objectId));
  check(unitIds.every(unitId => checkedUnitIds.has(unitId)), 'selected unit is missing from the Board');
  // 144.2/144.3.c: the exhaustion cost is paid simultaneously for the whole group.
  const selected = new Set(unitIds);
  const nextReadiness: DuelReadiness = records.map(entry => ({
    objectId: entry.objectId,
    readied: selected.has(entry.objectId) ? false : entry.readied,
    hasGanking: entry.hasGanking,
  }));
  const origins = new Map(plan.origins.map(entry => [entry.objectId, entry.locationId]));
  let nextBoard = restoreDuelBoard(checked);
  const events: DuelMoveEvent[] = [];
  for (const unitId of unitIds) {
    nextBoard = relocateDuelUnit(nextBoard, unitId, destinationLocationId);
    events.push({
      objectId: unitId, actor,
      fromLocationId: origins.get(unitId)!, toLocationId: destinationLocationId,
    });
  }
  // Post-conditions: the board is valid and readiness still matches it exactly.
  assertDuelBoard(nextBoard);
  checkedReadiness(nextBoard, nextReadiness);
  return {
    board: nextBoard,
    readiness: nextReadiness,
    group: {
      kind: 'standard-move',
      actor,
      destinationLocationId,
      objectIds: [...unitIds],
      exhaustedCount: unitIds.length,
      events,
      requiresMoveTriggers: true,
      requiresOpenCleanup: true,
    },
  };
}

function checkedStandardMove(
  board: DuelBoard, readiness: unknown, request: unknown, rules?: DuelMovementRuleContext,
) {
  assertDuelBoard(board);
  const records = checkedReadiness(board, readiness);
  const { actor, unitUIDs: unitIds, destinationLocationId, timing } = checkedRequest(board, request);
  // 144.1.a/144.1.b: only an Open Main Phase may hold this action.
  check(timing.phase === 'main', 'timing phase must be main');
  check(timing.stateOpen, 'timing state must be Open');
  // 420.3 + 312.1: the Standard Move is a Discretionary Action, so only the player with Priority may
  // take it; 312.2.a gives Priority to the turn player in a Neutral Open Main Phase, so the actor
  // must be both the turn player and the Priority holder.
  check(timing.turnPlayerId === actor, 'the actor is not the turn player of this discretionary move');
  check(timing.priorityPlayerId === actor, 'the actor does not hold Priority for this discretionary move');
  // 144.1.c: no ongoing Showdown or Combat anywhere on the board.
  check(board.battlefields.every(field => field.showdown !== 'active' && field.combat !== 'active'),
    'an active Showdown or Combat is ongoing');

  const unitsById = new Map(board.units.map(unit => [unit.objectId, unit]));
  const readinessById = new Map(records.map(entry => [entry.objectId, entry]));
  const basesById = new Map(board.bases.map(base => [base.locationId, base]));
  const fieldsById = new Map(board.battlefields.map(field => [field.locationId, field]));
  const destinationBase = basesById.get(destinationLocationId);
  const destinationField = fieldsById.get(destinationLocationId);
  check(destinationBase !== undefined || destinationField !== undefined,
    `unknown destination ${destinationLocationId}`);
  // 144.4.a/144.4.b: a base destination is only ever the actor's own base.
  if (destinationBase) check(destinationBase.ownerPlayerId === actor, 'destination is another player’s base');

  for (const unitId of unitIds) {
    const unit = unitsById.get(unitId)!;
    check(unit.controllerPlayerId === actor, `unit ${unitId} is not controlled by the actor`);
    check(readinessById.get(unitId)!.readied, `unit ${unitId} is not readied to move`);
    check(unit.locationId !== destinationLocationId, `unit ${unitId} is already at the destination`);
    const unitRef = rules?.refForUnit?.(unit) ?? { id: unit.objectId, zoneEntryId: 1 };
    const unitObject = rules?.objectForUnit?.(unit);
    const ruleView = rules === undefined ? null : queryMovement(rules.registry, unitRef, unitObject, actor);
    const actionRestrictions = rules === undefined ? [] : queryRestrictions(
      rules.registry, 'move', unitRef, unitObject, actor,
    ).flatMap(entry => entry.name === undefined ? [] : [entry.name]);
    check(ruleView === null || (ruleView.canMove && !routeBlocked(
      [...ruleView.restrictions, ...actionRestrictions],
      routeKinds(unit.locationId, destinationLocationId, basesById))),
    `unit ${unitId} is prohibited from moving`);
    if (basesById.has(unit.locationId)) {
      // 144.4.a: base → battlefield. The battlefield is shared, so no ownership check applies.
      check(destinationField !== undefined, `unit ${unitId} may only leave a base for a battlefield`);
    } else {
      // 144.4.b/144.4.c: battlefield → own base, or battlefield → battlefield with Ganking.
      check(destinationBase !== undefined || readinessById.get(unitId)!.hasGanking ||
        ruleView?.canGank === true ||
        (rules !== undefined && hasRawGankingPermission(rules.registry, unitRef, unitObject, actor)),
        `unit ${unitId} needs Ganking to move battlefield to battlefield`);
    }
  }
  const plan: DuelStandardMovePlan = Object.freeze({
    actor,
    unitIds: Object.freeze([...unitIds]),
    destinationLocationId,
    origins: Object.freeze(unitIds.map(objectId => Object.freeze({
      objectId, locationId: unitsById.get(objectId)!.locationId,
    }))),
  });
  return { board, records, plan };
}

/** Validate a complete group before a caller-owned transaction pays any cost. */
export function inspectDuelStandardMove(
  board: DuelBoard, readiness: unknown, request: unknown, rules?: DuelMovementRuleContext,
): DuelStandardMovePlan {
  return checkedStandardMove(board, readiness, request, rules).plan;
}

/** Re-read the live unit state immediately before one Exhaust + Move pair. */
export function assertDuelStandardMoveUnitStillLegal(
  board: DuelBoard, plan: DuelStandardMovePlan, unitId: string,
  recheck: DuelStandardMoveRecheckContext,
  rules?: DuelMovementRuleContext,
  stage: 'before-exhaust' | 'after-exhaust' = 'before-exhaust',
): void {
  assertDuelBoard(board);
  check(plan.unitIds.includes(unitId), `unit ${unitId} is not part of this Standard Move`);
  const unit = board.units.find(candidate => candidate.objectId === unitId);
  check(unit !== undefined, `request.unitUIDs unknown unit ${unitId}`);
  const live = recheck.unit(unitId);
  check(live.controllerPlayerId === plan.actor, `unit ${unitId} is not controlled by the actor`);
  if (stage === 'before-exhaust') check(live.readied, `unit ${unitId} is not readied to move`);
  const origin = plan.origins.find(entry => entry.objectId === unitId)?.locationId;
  check(origin !== undefined, `unit ${unitId} has no planned origin`);
  check(live.locationId === origin, `unit ${unitId} left its planned origin`);
  check(origin !== plan.destinationLocationId, `unit ${unitId} is already at the destination`);
  const bases = new Set(board.bases.map(base => base.locationId));
  const fields = new Set(board.battlefields.map(field => field.locationId));
  const destinationIsBase = bases.has(plan.destinationLocationId);
  const destinationIsField = fields.has(plan.destinationLocationId);
  check(destinationIsBase || destinationIsField, `unknown destination ${plan.destinationLocationId}`);
  if (destinationIsBase) check(board.bases.some(base => base.locationId === plan.destinationLocationId &&
    base.ownerPlayerId === plan.actor), 'destination is another player’s base');
  const unitRef = rules?.refForUnit?.(unit) ?? { id: unit.objectId, zoneEntryId: 1 };
  const unitObject = rules?.objectForUnit?.(unit);
  const ruleView = rules === undefined ? null : queryMovement(rules.registry, unitRef, unitObject, plan.actor);
  const actionRestrictions = rules === undefined ? [] : queryRestrictions(
    rules.registry, 'move', unitRef, unitObject, plan.actor,
  ).flatMap(entry => entry.name === undefined ? [] : [entry.name]);
  const route = bases.has(origin) ? 'base-to-battlefield' :
    destinationIsBase ? 'battlefield-to-base' : 'battlefield-to-battlefield';
  check(ruleView === null || (ruleView.canMove && !routeBlocked(
    [...ruleView.restrictions, ...actionRestrictions], route,
  )), `unit ${unitId} is prohibited from moving`);
  if (bases.has(origin)) check(destinationIsField, `unit ${unitId} may only leave a base for a battlefield`);
  else check(destinationIsBase || live.hasGanking || ruleView?.canGank === true ||
    (rules !== undefined && hasRawGankingPermission(rules.registry, unitRef, unitObject, plan.actor)),
    `unit ${unitId} needs Ganking to move battlefield to battlefield`);
  recheck.validate(unitId);
}

