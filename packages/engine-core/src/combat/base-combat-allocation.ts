// CR v1.5 rules 467.2.a-c.9: the narrow combat-damage assignment kernel.
//
// This module only builds and validates a basic assignment plan.  It does not
// deal damage, perform Showdown/Kill/Recall, score, or run Cleanup.  The state
// boundary is deliberately formal: board.units is the sole source of current
// controller/location, while unitMeta.damageMarks is the source of actual
// marked damage.  A client never supplies Might or a source-effect proof.

export interface DuelBaseCombatBoardUnit {
  readonly objectId: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
}

export interface DuelBaseCombatBattlefield {
  readonly locationId: string;
  readonly controllerPlayerId: string | null;
  readonly contested: boolean;
  readonly contestingPlayerId: string | null;
  readonly showdown: 'none' | 'staged' | 'active';
  readonly combat: 'none' | 'staged' | 'active';
  readonly occupancy: readonly string[];
}

/** Structural formal board subset; a DuelBoard from engine-core satisfies it. */
export interface DuelBaseCombatBoard {
  readonly playerIds: readonly string[];
  readonly battlefields: readonly DuelBaseCombatBattlefield[];
  readonly units: readonly DuelBaseCombatBoardUnit[];
}

export interface DuelBaseCombatDamageMark {
  readonly amount: number;
}

/** Structural formal metadata subset; location/controller are intentionally absent. */
export interface DuelBaseCombatUnitMeta {
  readonly damageMarks: readonly DuelBaseCombatDamageMark[];
}

/** A DuelUnitLifecycleState satisfies this structural input without copying private zones. */
export interface DuelBaseCombatState {
  readonly stateVersion: number;
  readonly board: DuelBaseCombatBoard;
  readonly unitMeta: Readonly<Record<string, DuelBaseCombatUnitMeta>>;
}

export interface DuelBaseCombatMightInput {
  readonly uid: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
  readonly fieldId: string;
  readonly existingDamage: number;
  /** Current designation is part of the layer query, never caller-supplied. */
  readonly combatRole?: 'attacker' | 'defender';
}

export interface DuelBaseCombatSourceEffectProof {
  /** The service actually validated each requested current Might. */
  readonly currentMight: 'validated';
  /** No assignment modifier was found and that absence was proven. */
  readonly assignmentModifier: 'proven-none';
  /** No prevention/replacement applies to this assignment and that absence was proven. */
  readonly preventionReplacement: 'proven-none';
  /** The assignment-priority query was evaluated, including the no-keyword case. */
  readonly keywordPriority: 'proven-none' | 'validated';
  /** Optional source-qualified result for the assignment-priority query. */
  readonly assignmentRules?: DuelBaseCombatAssignmentRules;
}

/** A source-qualified combat-damage assignment fact for one live Unit. */
export interface DuelBaseCombatAssignmentRule {
  readonly uid: string;
  /** 467.2.c.10: a Unit that cannot be dealt damage is exempt from mandatory assignment. */
  readonly canReceiveDamage?: boolean;
  /** 815.1.b / 826.3, as read from the current ability layer. */
  readonly tank?: boolean;
  readonly backline?: boolean;
  /** Total damage that must be assigned for lethal, after applicable replacements. */
  readonly lethalDamage?: number;
  /** Explicit per-target assignment bounds, when a sourced effect supplies them. */
  readonly minAssignable?: number;
  readonly maxAssignable?: number;
}

export interface DuelBaseCombatAssignmentRules {
  readonly status: 'validated' | 'proven-none';
  readonly units?: readonly DuelBaseCombatAssignmentRule[];
}

export interface DuelBaseCombatSourceEffectService {
  /** A source/effect service must prove the narrow basic path, not merely omit data. */
  readonly proveBasicCombat: (request: {
    readonly stateVersion: number;
    readonly fieldId: string;
    readonly unitUIDs: readonly string[];
  }) => DuelBaseCombatSourceEffectProof | null | undefined;
  /** Reads the current layer's combat-assignment effects.  This is optional for
   * the historical proven-none path, but mandatory when keywordPriority is
   * validated.  The callback is host authority; it is never wire input. */
  readonly assignmentRules?: (request: {
    readonly stateVersion: number;
    readonly fieldId: string;
    readonly unitUIDs: readonly string[];
  }) => DuelBaseCombatAssignmentRules | null | undefined;
  /** Alias accepted by early production adapters during the contract handoff. */
  readonly combatPriority?: DuelBaseCombatSourceEffectService['assignmentRules'];
  /** Evaluates current Might from authoritative context supplied by this module. */
  readonly currentMight: (unit: DuelBaseCombatMightInput) => number;
}

/**
 * Opaque trusted seam.  The WeakSet brand prevents a JSON/client-shaped object
 * containing a claimed Might map from being accepted as trusted facts.
 */
export interface TrustedDuelBaseCombatFacts {
  readonly basedOnStateVersion: number;
  readonly fieldId: string;
  readonly evaluateCurrentMight: (unit: DuelBaseCombatMightInput) => number;
  readonly proveBasicCombat: DuelBaseCombatSourceEffectService['proveBasicCombat'];
  readonly readAssignmentRules?: NonNullable<DuelBaseCombatSourceEffectService['assignmentRules']>;
  readonly _trustedBaseCombatFacts: true;
}

export type DuelBaseCombatBlockCode =
  | 'missing-trusted-facts'
  | 'untrusted-facts'
  | 'stale-trusted-facts'
  | 'source-effect-proof-missing'
  | 'source-effect-proof-incomplete'
  | 'current-might-invalid'
  | 'numeric-overflow'
  | 'cleanup-required'
  | 'invalid-active-field'
  | 'invalid-combat-participants'
  | 'invalid-unit-metadata'
  | 'invalid-plan'
  | 'plan-already-used'
  | 'actor-not-participant'
  | 'stale-plan'
  | 'invalid-allocation';

/** All blocked paths are explicit TypeErrors so callers cannot silently continue. */
export class DuelBaseCombatBlockedError extends TypeError {
  readonly code: DuelBaseCombatBlockCode;

  constructor(code: DuelBaseCombatBlockCode, message: string) {
    super(`Duel base combat allocation blocked [${code}]: ${message}`);
    this.name = 'DuelBaseCombatBlockedError';
    this.code = code;
  }
}

const trustedFacts = new WeakSet<object>();
const trustedPlans = new WeakSet<object>();
const trustedResults = new WeakSet<object>();
const resultPlans = new WeakMap<object, DuelBaseCombatPlan>();
// A plan is the one-shot authority, not its (repeatable) allocation results.
// Keep this in the kernel so all choice modules and direct callers share it.
const completedPlans = new WeakSet<object>();
const completionPlans = new WeakMap<object, DuelBaseCombatPlan>();

function blocked(code: DuelBaseCombatBlockCode, message: string): never {
  throw new DuelBaseCombatBlockedError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    blocked('invalid-active-field', `${label} must be a nonblank string`);
  }
  return value;
}

function safeCount(value: unknown, label: string, code: DuelBaseCombatBlockCode = 'invalid-active-field'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    blocked(code, `${label} must be a nonnegative safe integer`);
  }
  return value;
}

function positiveSafe(value: unknown, label: string): number {
  const count = safeCount(value, label, 'invalid-allocation');
  if (count === 0) blocked('invalid-allocation', `${label} must be positive`);
  return count;
}

function safeAdd(a: number, b: number, label: string): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) blocked('numeric-overflow', `${label} exceeds safe integer range`);
  return result;
}

function denseArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    blocked('invalid-active-field', `${label} must be a plain array`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.some(key => key !== 'length' &&
      (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
    blocked('invalid-active-field', `${label} must be dense without extra keys`);
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      blocked('invalid-active-field', `${label} contains a hole or accessor`);
    }
  }
  return value;
}

function immutable<T extends object>(value: T): T {
  return Object.freeze(value);
}

function immutableList<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function proofIsComplete(value: unknown): value is DuelBaseCombatSourceEffectProof {
  if (!isRecord(value)) return false;
  return value.currentMight === 'validated' &&
    value.assignmentModifier === 'proven-none' &&
    value.preventionReplacement === 'proven-none' &&
    (value.keywordPriority === 'proven-none' || value.keywordPriority === 'validated');
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    blocked('source-effect-proof-incomplete', `${label} must be a nonnegative safe integer`);
  }
  return value;
}

function booleanOrDefault(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') blocked('source-effect-proof-incomplete', `${label} must be boolean`);
  return value;
}

interface NormalizedAssignmentRules {
  readonly status: 'validated' | 'proven-none';
  readonly byUID: ReadonlyMap<string, DuelBaseCombatAssignmentRule>;
}

function normalizeAssignmentRules(
  value: unknown,
  unitUIDs: readonly string[],
): NormalizedAssignmentRules {
  if (!isRecord(value) || (value.status !== 'validated' && value.status !== 'proven-none')) {
    blocked('source-effect-proof-incomplete', 'assignment rules must have a validated status');
  }
  const rawUnits = value.units === undefined ? [] : denseArray(value.units, 'assignmentRules.units');
  const expected = new Set(unitUIDs);
  const byUID = new Map<string, DuelBaseCombatAssignmentRule>();
  for (let index = 0; index < rawUnits.length; index++) {
    const raw = rawUnits[index];
    if (!isRecord(raw)) blocked('source-effect-proof-incomplete', `assignmentRules.units[${index}] must be a record`);
    const uid = text(raw.uid, `assignmentRules.units[${index}].uid`);
    if (!expected.has(uid) || byUID.has(uid)) {
      blocked('source-effect-proof-incomplete', `assignmentRules has an unknown or duplicate Unit ${uid}`);
    }
    const tank = booleanOrDefault(raw.tank, false, `assignmentRules.units[${index}].tank`);
    const backline = booleanOrDefault(raw.backline, false, `assignmentRules.units[${index}].backline`);
    const canReceiveDamage = booleanOrDefault(raw.canReceiveDamage, true,
      `assignmentRules.units[${index}].canReceiveDamage`);
    const lethalDamage = raw.lethalDamage === undefined ? undefined :
      nonnegativeInteger(raw.lethalDamage, `assignmentRules.units[${index}].lethalDamage`);
    const minAssignable = raw.minAssignable === undefined ? undefined :
      nonnegativeInteger(raw.minAssignable, `assignmentRules.units[${index}].minAssignable`);
    const maxAssignable = raw.maxAssignable === undefined ? undefined :
      nonnegativeInteger(raw.maxAssignable, `assignmentRules.units[${index}].maxAssignable`);
    if (minAssignable !== undefined && maxAssignable !== undefined && minAssignable > maxAssignable) {
      blocked('source-effect-proof-incomplete', `assignmentRules.units[${index}] has inverted bounds`);
    }
    byUID.set(uid, Object.freeze({ uid, tank, backline, canReceiveDamage,
      ...(lethalDamage === undefined ? {} : { lethalDamage }),
      ...(minAssignable === undefined ? {} : { minAssignable }),
      ...(maxAssignable === undefined ? {} : { maxAssignable }) }));
  }
  if (value.status === 'proven-none' && byUID.size > 0) {
    blocked('source-effect-proof-incomplete', 'proven-none assignment rules cannot contain keyword facts');
  }
  if (value.status === 'validated' && byUID.size !== unitUIDs.length) {
    blocked('source-effect-proof-incomplete', 'validated assignment rules must cover every Combat Unit');
  }
  return { status: value.status, byUID };
}

function readAssignmentRules(
  facts: TrustedDuelBaseCombatFacts,
  proof: DuelBaseCombatSourceEffectProof,
  context: ParsedCombatContext,
): NormalizedAssignmentRules {
  const unitUIDs = immutableList([
    ...context.attackers.map(unit => unit.uid),
    ...context.defenders.map(unit => unit.uid),
  ]);
  const supplied = proof.assignmentRules ?? (() => {
    if (facts.readAssignmentRules === undefined) return undefined;
    try {
      return facts.readAssignmentRules({ stateVersion: context.stateVersion,
        fieldId: context.fieldId, unitUIDs });
    } catch (error) {
      blocked('source-effect-proof-missing', `assignment-priority proof failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
  if (proof.keywordPriority === 'proven-none') {
    if (supplied !== undefined) {
      const normalized = normalizeAssignmentRules(supplied, unitUIDs);
      if (normalized.status !== 'proven-none' || normalized.byUID.size !== 0) {
        blocked('source-effect-proof-incomplete', 'assignment priority was claimed proven-none but rules were supplied');
      }
    }
    return { status: 'proven-none', byUID: new Map() };
  }
  if (supplied === undefined || supplied === null) {
    blocked('source-effect-proof-missing', 'validated keyword priority requires assignment rules');
  }
  const normalized = normalizeAssignmentRules(supplied, unitUIDs);
  if (normalized.status !== 'validated') {
    blocked('source-effect-proof-incomplete',
      'validated keyword priority requires validated assignment rules');
  }
  return normalized;
}

/**
 * Compile the existing `continuous.combat` IR into the source-qualified
 * assignment facts consumed by this module.  The compiler intentionally knows
 * only the closed Tank/Backline shapes from 815/826; an unfamiliar combat
 * effect remains unavailable instead of becoming a guessed priority.
 */
export function deriveDuelCombatAssignmentRulesFromIR(
  effects: readonly unknown[],
  unitUIDs: readonly string[],
): DuelBaseCombatAssignmentRules {
  if (!Array.isArray(unitUIDs) || unitUIDs.length === 0 ||
      unitUIDs.some(uid => typeof uid !== 'string' || uid.trim().length === 0) ||
      new Set(unitUIDs).size !== unitUIDs.length) {
    blocked('source-effect-proof-incomplete', 'combat assignment rules require unique live Unit IDs');
  }
  const expected = new Set(unitUIDs);
  const entries = new Map<string, { uid: string; tank: boolean; backline: boolean }>();
  for (let index = 0; index < effects.length; index++) {
    const raw = effects[index];
    if (!isRecord(raw)) blocked('source-effect-proof-incomplete', `combat effect ${index} must be a record`);
    const effect = isRecord(raw.effect) ? raw.effect : raw;
    // The assignment reader may receive the complete current ability layer.
    // Unrelated continuous effects are inert here; every combat-assignment
    // effect must still match one of the two sourced shapes below.
    if (effect.kind !== 'continuous.combat') continue;
    const filter = isRecord(raw.filter) ? raw.filter : undefined;
    if (effect.mode !== 'damage-assignment' ||
        effect.damage !== 'lethal' || effect.controllerScope !== 'same-controller') {
      blocked('source-effect-proof-incomplete', `unsupported continuous.combat assignment effect at ${index}`);
    }
    const uid = filter?.objectId ?? raw.uid ?? effect.uid;
    if (typeof uid !== 'string' || !expected.has(uid)) {
      blocked('source-effect-proof-incomplete', `combat effect ${index} is not bound to a live Unit`);
    }
    const current = entries.get(uid) ?? { uid, tank: false, backline: false };
    if (effect.priority === 'first' && effect.excludesKeyword === 'Tank') current.tank = true;
    else if (effect.priority === 'last' && effect.excludesKeyword === 'Backline') current.backline = true;
    else blocked('source-effect-proof-incomplete', `unsupported Tank/Backline effect at ${index}`);
    entries.set(uid, current);
  }
  const units = unitUIDs.map(uid => entries.get(uid) ?? { uid, tank: false, backline: false });
  return Object.freeze({ status: 'validated' as const, units: immutableList(units) });
}

export const compileDuelCombatPriorityRules = deriveDuelCombatAssignmentRulesFromIR;

/**
 * Bind a source/effect service at the trusted seam.  The service must explicitly
 * prove the absence of assignment modifiers, prevention/replacement, and
 * keyword priority; missing/unknown proof is blocked later by the planner.
 */
export function createTrustedDuelBaseCombatFacts(
  basedOnStateVersion: number,
  fieldId: string,
  service: DuelBaseCombatSourceEffectService,
): TrustedDuelBaseCombatFacts {
  safeCount(basedOnStateVersion, 'trusted facts stateVersion');
  text(fieldId, 'trusted facts fieldId');
  if (!isRecord(service) || typeof service.currentMight !== 'function' ||
      typeof service.proveBasicCombat !== 'function') {
    blocked('missing-trusted-facts', 'source/effect service must provide Might and basic-combat proof');
  }
  const readAssignmentRules = service.assignmentRules ?? service.combatPriority;
  if (readAssignmentRules !== undefined && typeof readAssignmentRules !== 'function') {
    blocked('missing-trusted-facts', 'assignment-priority service must be callable');
  }
  const result = immutable({
    basedOnStateVersion,
    fieldId,
    evaluateCurrentMight: service.currentMight,
    proveBasicCombat: service.proveBasicCombat,
    ...(readAssignmentRules === undefined ? {} : { readAssignmentRules }),
    _trustedBaseCombatFacts: true as const,
  });
  trustedFacts.add(result);
  return result;
}

interface ParsedCombatUnit {
  readonly uid: string;
  readonly controllerPlayerId: string;
  readonly locationId: string;
  readonly existingDamage: number;
}

interface ParsedCombatContext {
  readonly stateVersion: number;
  readonly fieldId: string;
  readonly attackerPlayerId: string;
  readonly defenderPlayerId: string;
  readonly attackers: readonly ParsedCombatUnit[];
  readonly defenders: readonly ParsedCombatUnit[];
}

function parseState(state: DuelBaseCombatState, fieldId: string): ParsedCombatContext {
  if (!isRecord(state)) blocked('invalid-active-field', 'state must be a formal state record');
  const stateVersion = safeCount(state.stateVersion, 'state.stateVersion');
  if (!isRecord(state.board)) blocked('invalid-active-field', 'state.board is missing');
  const board = state.board;
  const players = denseArray(board.playerIds, 'board.playerIds').map((value, index) =>
    text(value, `board.playerIds[${index}]`));
  if (players.length !== 2 || new Set(players).size !== 2) {
    blocked('invalid-combat-participants', 'basic combat requires exactly two board players');
  }
  const requestedFieldId = text(fieldId, 'fieldId');
  const fields = denseArray(board.battlefields, 'board.battlefields');
  if (fields.filter(value => isRecord(value) && value.locationId === requestedFieldId).length !== 1 ||
      fields.some(value => !isRecord(value) || (value.locationId !== requestedFieldId &&
        (value.combat === 'active' || value.showdown === 'active')))) {
    blocked('invalid-active-field', 'battlefield identity is ambiguous or another engagement is active');
  }
  const field = fields.find(value => isRecord(value) && value.locationId === requestedFieldId);
  if (!isRecord(field)) blocked('invalid-active-field', `unknown battlefield ${requestedFieldId}`);
  if (field.showdown !== 'active' || field.combat !== 'active') {
    blocked('invalid-active-field', 'field is not an actually active Combat');
  }
  if (field.contested !== true || typeof field.contestingPlayerId !== 'string') {
    blocked('invalid-active-field', 'active Combat lacks a valid Contested/contesting player');
  }
  const attackerPlayerId = field.contestingPlayerId;
  if (!players.includes(attackerPlayerId)) {
    blocked('invalid-combat-participants', 'contesting player is not a board player');
  }
  const fieldController = field.controllerPlayerId;
  if (fieldController !== null && typeof fieldController !== 'string') {
    blocked('invalid-combat-participants', 'field controller is not a player ID or null');
  }
  if (fieldController !== null &&
      (!players.includes(fieldController) || fieldController === attackerPlayerId)) {
    blocked('invalid-combat-participants', 'field controller conflicts with the contesting attacker');
  }

  const rawUnits = denseArray(board.units, 'board.units');
  const units: ParsedCombatUnit[] = [];
  const allUIDs = new Set<string>();
  for (let index = 0; index < rawUnits.length; index++) {
    const raw = rawUnits[index];
    if (!isRecord(raw)) blocked('invalid-active-field', `board.units[${index}] is not a record`);
    const uid = text(raw.objectId, `board.units[${index}].objectId`);
    if (allUIDs.has(uid)) blocked('invalid-active-field', `duplicate board unit ${uid}`);
    allUIDs.add(uid);
    const controllerPlayerId = text(raw.controllerPlayerId, `board.units[${index}].controllerPlayerId`);
    const locationId = text(raw.locationId, `board.units[${index}].locationId`);
    if (!players.includes(controllerPlayerId)) {
      blocked('invalid-combat-participants', `unit ${uid} has an unknown controller`);
    }
    if (locationId !== requestedFieldId) continue;
    units.push({ uid, controllerPlayerId, locationId, existingDamage: 0 });
  }
  const fieldOccupancy = denseArray(field.occupancy, 'battlefield.occupancy').map((value, index) =>
    text(value, `battlefield.occupancy[${index}]`));
  if (new Set(fieldOccupancy).size !== fieldOccupancy.length ||
      fieldOccupancy.length !== units.length ||
      fieldOccupancy.some(uid => !units.some(unit => unit.uid === uid))) {
    blocked('invalid-active-field', 'battlefield occupancy does not match board units');
  }

  const controllers = new Set(units.map(unit => unit.controllerPlayerId));
  if (controllers.size !== 2 || !controllers.has(attackerPlayerId)) {
    blocked('invalid-combat-participants', 'active Combat must have exactly two opposing controller sides');
  }
  const defenderPlayerId = players.find(playerId => playerId !== attackerPlayerId && controllers.has(playerId));
  if (defenderPlayerId === undefined) {
    blocked('invalid-combat-participants', 'defender side is missing');
  }
  if (fieldController !== null && fieldController !== defenderPlayerId) {
    blocked('invalid-combat-participants', 'defender conflicts with the field controller');
  }
  const metadata = state.unitMeta;
  if (!isRecord(metadata)) blocked('invalid-unit-metadata', 'state.unitMeta is missing');

  const withDamage = units.map(unit => {
    const rawMeta = metadata[unit.uid];
    if (!isRecord(rawMeta) || !Array.isArray(rawMeta.damageMarks)) {
      blocked('invalid-unit-metadata', `unitMeta.damageMarks missing for ${unit.uid}`);
    }
    const marks = denseArray(rawMeta.damageMarks, `unitMeta[${unit.uid}].damageMarks`);
    let existingDamage = 0;
    for (let index = 0; index < marks.length; index++) {
      const mark = marks[index];
      if (!isRecord(mark)) blocked('invalid-unit-metadata', `damage mark ${unit.uid}[${index}] is not a record`);
      const amount = safeCount(mark.amount, `damage mark ${unit.uid}[${index}]`, 'invalid-unit-metadata');
      if (amount === 0) blocked('invalid-unit-metadata', `damage mark ${unit.uid}[${index}] must be positive`);
      existingDamage = safeAdd(existingDamage, amount, `damage total for ${unit.uid}`);
    }
    return { ...unit, existingDamage };
  });
  return {
    stateVersion,
    fieldId: requestedFieldId,
    attackerPlayerId,
    defenderPlayerId,
    attackers: immutableList(withDamage.filter(unit => unit.controllerPlayerId === attackerPlayerId)),
    defenders: immutableList(withDamage.filter(unit => unit.controllerPlayerId === defenderPlayerId)),
  };
}

function factsForPlan(
  facts: TrustedDuelBaseCombatFacts | null | undefined,
  context: ParsedCombatContext,
): { readonly facts: TrustedDuelBaseCombatFacts; readonly assignmentRules: NormalizedAssignmentRules } {
  if (facts === null || facts === undefined) {
    blocked('missing-trusted-facts', 'validated current Might and source-effect proof are required');
  }
  if (!isRecord(facts) || !trustedFacts.has(facts) || facts._trustedBaseCombatFacts !== true) {
    blocked('untrusted-facts', 'raw/client-shaped facts are not a trusted source seam');
  }
  if (facts.basedOnStateVersion !== context.stateVersion || facts.fieldId !== context.fieldId) {
    blocked('stale-trusted-facts', 'trusted facts do not bind this state version and battlefield');
  }
  let proof: DuelBaseCombatSourceEffectProof | null | undefined;
  try {
    proof = facts.proveBasicCombat({
      stateVersion: context.stateVersion,
      fieldId: context.fieldId,
      unitUIDs: immutableList([
        ...context.attackers.map(unit => unit.uid),
        ...context.defenders.map(unit => unit.uid),
      ]),
    });
  } catch (error) {
    blocked('source-effect-proof-missing', `source/effect proof failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (proof === null || proof === undefined) {
    blocked('source-effect-proof-missing', 'source/effect service did not prove the basic path');
  }
  if (!proofIsComplete(proof)) {
    blocked('source-effect-proof-incomplete',
      'assignment modifiers and prevention/replacement must be proven absent; keyword priority must be proven absent or validated');
  }
  return { facts, assignmentRules: readAssignmentRules(facts, proof, context) };
}

export interface DuelBaseCombatUnitBasis {
  readonly uid: string;
  readonly currentMight: number;
  readonly existingDamage: number;
  /** Positive damage still required to make this currently non-lethal unit lethal. */
  readonly lethalNeed: number;
  /** Total assigned damage that constitutes lethal under the current layer. */
  readonly lethalDamage: number;
  /** 467.2.c.10: false targets are omitted from mandatory assignment ordering. */
  readonly canReceiveDamage: boolean;
  /** Effective assignment priority after reading Tank/Backline. */
  readonly assignmentPriority: 'first' | 'normal' | 'last' | 'choice';
  readonly priorityOptions: readonly ('first' | 'last')[];
  readonly minAssignable: number;
  readonly maxAssignable: number | null;
}

export interface DuelBaseCombatSidePlan {
  readonly side: 'attacker' | 'defender';
  readonly playerId: string;
  readonly targetPlayerId: string;
  /** Budget is the sum of current Might on this side (465.2.a/b). */
  readonly budget: number;
  readonly targets: readonly DuelBaseCombatUnitBasis[];
}

/**
 * Immutable basic assignment basis.  It contains no board, zones, old match,
 * metadata, evaluator, or source-effect object.  It is not a damage event.
 */
export interface DuelBaseCombatPlan {
  readonly kind: 'duel-base-combat-damage-plan';
  readonly basedOnStateVersion: number;
  readonly fieldId: string;
  /** Tuple order is always Attacker then Defender (465.2.c). */
  readonly sideIDs: readonly [string, string];
  readonly attacker: DuelBaseCombatSidePlan;
  readonly defender: DuelBaseCombatSidePlan;
}

function checkedMight(
  facts: TrustedDuelBaseCombatFacts,
  unit: ParsedCombatUnit,
  context: ParsedCombatContext,
): number {
  let value: number;
  try {
    value = facts.evaluateCurrentMight({
      uid: unit.uid,
      controllerPlayerId: unit.controllerPlayerId,
      locationId: unit.locationId,
      fieldId: context.fieldId,
      existingDamage: unit.existingDamage,
      combatRole: unit.controllerPlayerId === context.attackerPlayerId ? 'attacker' : 'defender',
    });
  } catch (error) {
    blocked('current-might-invalid', `current Might evaluation failed for ${unit.uid}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    blocked('current-might-invalid', `current Might for ${unit.uid} must be a nonnegative safe integer`);
  }
  return value;
}

function basisFor(
  facts: TrustedDuelBaseCombatFacts,
  context: ParsedCombatContext,
  assignmentRules: NormalizedAssignmentRules,
  units: readonly ParsedCombatUnit[],
): readonly DuelBaseCombatUnitBasis[] {
  return immutableList(units.map(unit => {
    const currentMight = checkedMight(facts, unit, context);
    const rule = assignmentRules.byUID.get(unit.uid);
    const canReceiveDamage = rule?.canReceiveDamage ?? true;
    const lethalDamage = rule?.lethalDamage ?? currentMight;
    if (!Number.isSafeInteger(lethalDamage) || lethalDamage < 0) {
      blocked('source-effect-proof-incomplete', `lethal damage threshold for ${unit.uid} is invalid`);
    }
    const minAssignable = rule?.minAssignable ?? 1;
    const maxAssignable = rule?.maxAssignable ?? null;
    if (maxAssignable !== null && maxAssignable < minAssignable) {
      blocked('source-effect-proof-incomplete', `assignment bounds for ${unit.uid} are inverted`);
    }
    const tank = rule?.tank === true;
    const backline = rule?.backline === true;
    const assignmentPriority = tank && backline ? 'choice' : tank ? 'first' : backline ? 'last' : 'normal';
    const priorityOptions = tank && backline ? immutableList(['first', 'last'] as const) :
      assignmentPriority === 'first' ? immutableList(['first'] as const) :
      assignmentPriority === 'last' ? immutableList(['last'] as const) : immutableList([] as const);
    // Lethal damage is non-zero and at least current Might.  A zero-Might,
    // zero-damage unit therefore needs one positive point, never zero.
    const alreadyLethal = canReceiveDamage && unit.existingDamage > 0 && unit.existingDamage >= lethalDamage;
    if (alreadyLethal) {
      blocked('cleanup-required', `${unit.uid} is already lethal but remains on the board`);
    }
    const deficit = lethalDamage - unit.existingDamage;
    const lethalNeed = canReceiveDamage ? (deficit > 0 ? deficit : 1) : 0;
    return immutable({ uid: unit.uid, currentMight, existingDamage: unit.existingDamage,
      lethalDamage, lethalNeed, canReceiveDamage, assignmentPriority, priorityOptions,
      minAssignable, maxAssignable });
  }));
}

function makeSide(
  side: 'attacker' | 'defender',
  playerId: string,
  targetPlayerId: string,
  ownUnits: readonly DuelBaseCombatUnitBasis[],
  opposingUnits: readonly DuelBaseCombatUnitBasis[],
): DuelBaseCombatSidePlan {
  let budget = 0;
  for (const unit of ownUnits) budget = safeAdd(budget, unit.currentMight, `${side} Might budget`);
  return immutable({ side, playerId, targetPlayerId, budget, targets: opposingUnits });
}

/**
 * CR 465.2.a-c4 basic path.  This computes budgets and a frozen immutable
 * basis only; no damage is assigned or dealt here.
 */
export function planDuelBaseCombatDamage(
  state: DuelBaseCombatState,
  fieldId: string,
  trustedFacts: TrustedDuelBaseCombatFacts,
): DuelBaseCombatPlan {
  const context = parseState(state, fieldId);
  const bound = factsForPlan(trustedFacts, context);
  const attackers = basisFor(bound.facts, context, bound.assignmentRules, context.attackers);
  const defenders = basisFor(bound.facts, context, bound.assignmentRules, context.defenders);
  const plan = immutable({
    kind: 'duel-base-combat-damage-plan' as const,
    basedOnStateVersion: context.stateVersion,
    fieldId: context.fieldId,
    sideIDs: immutableList([context.attackerPlayerId, context.defenderPlayerId]) as readonly [string, string],
    attacker: makeSide('attacker', context.attackerPlayerId, context.defenderPlayerId, attackers, defenders),
    defender: makeSide('defender', context.defenderPlayerId, context.attackerPlayerId, defenders, attackers),
  });
  trustedPlans.add(plan);
  return plan;
}

export interface DuelBaseCombatOrderedUIDAmount {
  readonly uid: string;
  readonly amount: number;
}

export interface DuelBaseCombatAssignment {
  readonly uid: string;
  readonly amount: number;
}

export interface DuelBaseCombatAllocationResult {
  readonly kind: 'duel-base-combat-allocation-result';
  readonly basedOnStateVersion: number;
  readonly fieldId: string;
  readonly side: 'attacker' | 'defender';
  readonly actorPlayerId: string;
  readonly targetPlayerId: string;
  readonly budget: number;
  readonly assignments: readonly DuelBaseCombatAssignment[];
  readonly assignedTotal: number;
  /** A single side is never executable; pair it with the other side first. */
  readonly readyForSimultaneousDeal: false;
}

function checkedPlan(plan: DuelBaseCombatPlan): DuelBaseCombatPlan {
  if (!isRecord(plan) || !trustedPlans.has(plan) || plan.kind !== 'duel-base-combat-damage-plan') {
    blocked('invalid-plan', 'plan is not an immutable trusted plan from the current process');
  }
  return plan;
}

function checkedCurrentVersion(currentStateVersion: number | undefined, plan: DuelBaseCombatPlan): void {
  if (currentStateVersion === undefined) return;
  safeCount(currentStateVersion, 'currentStateVersion', 'stale-plan');
  if (currentStateVersion !== plan.basedOnStateVersion) {
    blocked('stale-plan', 'allocation plan is not based on the current state version');
  }
}

/**
 * Read-only, process-local plan attestation for consumers that require a current
 * authoritative clock. Unlike allocation validation, the version is mandatory;
 * neither a shape-equivalent plan nor an omitted/undefined clock is accepted.
 */
export function assertDuelBaseCombatPlan(plan: DuelBaseCombatPlan, currentStateVersion: number): void {
  const checked = checkedPlan(plan);
  safeCount(currentStateVersion, 'currentStateVersion', 'stale-plan');
  checkedCurrentVersion(currentStateVersion, checked);
}

function sideForActor(plan: DuelBaseCombatPlan, actor: string): DuelBaseCombatSidePlan {
  if (actor === plan.sideIDs[0]) return plan.attacker;
  if (actor === plan.sideIDs[1]) return plan.defender;
  blocked('actor-not-participant', `${actor} is not an active Combat participant`);
}

interface RawOrderedUIDAmountSnapshot {
  readonly uid: unknown;
  readonly amount: unknown;
}

/**
 * Copy the complete caller-controlled order before applying any allocation rule.
 * Descriptors, not index/property getters, supply the values: accessors and holes
 * cannot run midway through the lethal-order calculation. Recheck the observed
 * shape/values before using the copy to reject detectable Proxy timing changes.
 * A Proxy that consistently presents a valid array is harmless: only this plain
 * local copy (including its fixed length) is ever used by the rules below.
 */
function snapshotOrderedUIDAmounts(
  raw: readonly DuelBaseCombatOrderedUIDAmount[],
): readonly RawOrderedUIDAmountSnapshot[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) {
    blocked('invalid-allocation', 'orderedUIDAmounts must be a plain array');
  }
  const length = raw.length;
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== length + 1 || !keys.includes('length') ||
      keys.some(key => key !== 'length' && (typeof key !== 'string' ||
        !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))) {
    blocked('invalid-allocation', 'orderedUIDAmounts must be dense without extra keys');
  }
  const snapshots: RawOrderedUIDAmountSnapshot[] = [];
  const items: object[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      blocked('invalid-allocation', 'orderedUIDAmounts contains a hole or accessor');
    }
    const item: unknown = descriptor.value;
    if (!isRecord(item) || (Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null)) {
      blocked('invalid-allocation', `orderedUIDAmounts[${index}] must be a plain record`);
    }
    const itemKeys = Reflect.ownKeys(item);
    const uid = Object.getOwnPropertyDescriptor(item, 'uid');
    const amount = Object.getOwnPropertyDescriptor(item, 'amount');
    if (itemKeys.length !== 2 || !itemKeys.includes('uid') || !itemKeys.includes('amount') ||
        itemKeys.some(key => key !== 'uid' && key !== 'amount') ||
        uid === undefined || !('value' in uid) ||
        amount === undefined || !('value' in amount)) {
      blocked('invalid-allocation', `orderedUIDAmounts[${index}] must contain data uid and amount only`);
    }
    snapshots.push({ uid: uid.value, amount: amount.value });
    items.push(item);
  }
  const finalKeys = Reflect.ownKeys(raw);
  if (raw.length !== length || finalKeys.length !== keys.length ||
      finalKeys.some(key => !keys.includes(key))) {
    blocked('invalid-allocation', 'orderedUIDAmounts changed while being read');
  }
  for (let index = 0; index < length; index++) {
    const item = items[index];
    const snapshot = snapshots[index];
    const entry = Object.getOwnPropertyDescriptor(raw, String(index));
    if (item === undefined || snapshot === undefined || entry === undefined ||
        !('value' in entry) || entry.value !== item ||
        (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) {
      blocked('invalid-allocation', 'orderedUIDAmounts changed while being read');
    }
    const itemKeys = Reflect.ownKeys(item);
    const uid = Object.getOwnPropertyDescriptor(item, 'uid');
    const amount = Object.getOwnPropertyDescriptor(item, 'amount');
    if (itemKeys.length !== 2 || !itemKeys.includes('uid') || !itemKeys.includes('amount') ||
        itemKeys.some(key => key !== 'uid' && key !== 'amount') ||
        uid === undefined || !('value' in uid) || !Object.is(uid.value, snapshot.uid) ||
        amount === undefined || !('value' in amount) || !Object.is(amount.value, snapshot.amount)) {
      blocked('invalid-allocation', 'orderedUIDAmounts changed while being read');
    }
  }
  return snapshots;
}

function validateOrder(
  side: DuelBaseCombatSidePlan,
  rawOrderedUIDAmounts: readonly DuelBaseCombatOrderedUIDAmount[],
): readonly DuelBaseCombatAssignment[] {
  let snapshot: readonly RawOrderedUIDAmountSnapshot[];
  try {
    snapshot = snapshotOrderedUIDAmounts(rawOrderedUIDAmounts);
  } catch {
    // A Proxy trap may throw an arbitrary private string or an error claiming a
    // kernel code. Never let caller-owned read failures escape as kernel authority.
    blocked('invalid-allocation', 'orderedUIDAmounts cannot be snapshotted');
  }
  const byUID = new Map(side.targets.map(target => [target.uid, target]));
  const seen = new Set<string>();
  let assignedTotal = 0;
  const result: DuelBaseCombatAssignment[] = [];
  let normalStarted = false;
  let lastStarted = false;
  for (let index = 0; index < snapshot.length; index++) {
    const item = snapshot[index];
    if (item === undefined) blocked('invalid-allocation', 'orderedUIDAmounts snapshot is incomplete');
    const uid = text(item.uid, `orderedUIDAmounts[${index}].uid`);
    const amount = positiveSafe(item.amount, `orderedUIDAmounts[${index}].amount`);
    const target = byUID.get(uid);
    if (target === undefined) blocked('invalid-allocation', `${uid} is not an opposing unit in this plan`);
    if (!target.canReceiveDamage) blocked('invalid-allocation', `${uid} cannot be dealt damage in this Combat`);
    if (seen.has(uid)) blocked('invalid-allocation', `${uid} is assigned more than once`);

    // A Unit with both Tank and Backline resolves one exclusionary requirement
    // through the actual assignment order (467.2.c.8/.9). The order is already
    // the client choice, so it remains the only wire input.
    let mode: 'first' | 'normal' | 'last';
    if (target.assignmentPriority === 'choice') {
      mode = normalStarted || lastStarted ? 'last' : 'first';
    } else {
      mode = target.assignmentPriority;
    }
    const pendingFixedFirst = side.targets.some(candidate => !seen.has(candidate.uid) &&
      candidate.uid !== uid && candidate.canReceiveDamage && candidate.assignmentPriority === 'first');
    const pendingFixedNormal = side.targets.some(candidate => !seen.has(candidate.uid) &&
      candidate.uid !== uid && candidate.canReceiveDamage && candidate.assignmentPriority === 'normal');
    if (mode === 'first' && (normalStarted || lastStarted)) {
      blocked('invalid-allocation', `${uid} cannot be assigned as Tank after a later-priority Unit`);
    }
    if (mode === 'normal' && (lastStarted || pendingFixedFirst)) {
      blocked('invalid-allocation', `${uid} is not currently a legal damage-assignment priority`);
    }
    if (mode === 'last' && (pendingFixedFirst || pendingFixedNormal)) {
      blocked('invalid-allocation', `${uid} cannot be assigned Backline damage before other Units are lethal`);
    }
    if (mode === 'normal') normalStarted = true;
    if (mode === 'last') lastStarted = true;

    if (amount < target.minAssignable) {
      blocked('invalid-allocation', `${uid} must receive at least ${target.minAssignable} assigned damage`);
    }
    if (target.maxAssignable !== null && amount > target.maxAssignable) {
      blocked('invalid-allocation', `${uid} cannot receive more than ${target.maxAssignable} assigned damage`);
    }
    seen.add(uid);

    const unitsRemainingAfterThis = side.targets.filter(candidate =>
      candidate.canReceiveDamage && !seen.has(candidate.uid)).length;
    if (amount < target.lethalNeed && index < snapshot.length - 1) {
      blocked('invalid-allocation',
        `${uid} must receive lethal damage (${target.lethalNeed}) before another unit receives damage`);
    }
    if (amount > target.lethalNeed && unitsRemainingAfterThis > 0) {
      blocked('invalid-allocation',
        `${uid} cannot receive overkill while another opposing unit remains unassigned`);
    }
    assignedTotal = safeAdd(assignedTotal, amount, 'assigned damage total');
    result.push(immutable({ uid, amount }));
  }
  if (assignedTotal !== side.budget) {
    blocked('invalid-allocation',
      `assigned total ${assignedTotal} must equal the ${side.side} Might budget ${side.budget}`);
  }
  return immutableList(result);
}

/**
 * Validates only UI choice data (order/UID/amount).  It never accepts claimed
 * Might, controller, location, or keyword fields and it never mutates state.
 * Pass currentStateVersion at the authoritative boundary to reject stale plans.
 */
export function validateDuelBaseCombatAllocation(
  plan: DuelBaseCombatPlan,
  actor: string,
  orderedUIDAmounts: readonly DuelBaseCombatOrderedUIDAmount[],
  currentStateVersion?: number,
): DuelBaseCombatAllocationResult {
  const checked = checkedPlan(plan);
  checkedCurrentVersion(currentStateVersion, checked);
  const actorId = text(actor, 'actor');
  const side = sideForActor(checked, actorId);
  const assignments = validateOrder(side, orderedUIDAmounts);
  let assignedTotal = 0;
  for (const assignment of assignments) assignedTotal = safeAdd(assignedTotal, assignment.amount, 'assigned damage total');
  const result = immutable({
    kind: 'duel-base-combat-allocation-result' as const,
    basedOnStateVersion: checked.basedOnStateVersion,
    fieldId: checked.fieldId,
    side: side.side,
    actorPlayerId: side.playerId,
    targetPlayerId: side.targetPlayerId,
    budget: side.budget,
    assignments,
    assignedTotal,
    readyForSimultaneousDeal: false as const,
  });
  trustedResults.add(result);
  resultPlans.set(result, checked);
  return result;
}

export interface DuelBaseCombatCompleteAllocation {
  readonly kind: 'duel-base-combat-complete-allocation';
  readonly basedOnStateVersion: number;
  readonly fieldId: string;
  readonly sideIDs: readonly [string, string];
  readonly attacker: DuelBaseCombatAllocationResult;
  readonly defender: DuelBaseCombatAllocationResult;
  readonly readyForSimultaneousDeal: true;
}

/**
 * Pair attacker then defender results.  This still only returns an allocation
 * plan; a later trusted executor must compare state version and deal damage
 * simultaneously.  No combat side effect occurs here.
 */
export function completeDuelBaseCombatAllocation(
  attacker: DuelBaseCombatAllocationResult,
  defender: DuelBaseCombatAllocationResult,
  currentStateVersion: number,
): DuelBaseCombatCompleteAllocation {
  if (!isRecord(attacker) || !trustedResults.has(attacker) || attacker.side !== 'attacker' ||
      !isRecord(defender) || !trustedResults.has(defender) || defender.side !== 'defender') {
    blocked('invalid-allocation', 'complete allocation requires trusted Attacker then Defender results');
  }
  const planA = resultPlans.get(attacker);
  const planD = resultPlans.get(defender);
  if (planA === undefined || planD === undefined || planA !== planD) {
    blocked('invalid-allocation', 'both allocation results must derive from one plan');
  }
  // Completion always needs the authoritative clock, unlike optional-version
  // standalone validation; undefined must never bypass this final boundary.
  assertDuelBaseCombatPlan(planA, currentStateVersion);
  if (attacker.basedOnStateVersion !== defender.basedOnStateVersion ||
      attacker.fieldId !== defender.fieldId ||
      attacker.actorPlayerId !== planA.sideIDs[0] || defender.actorPlayerId !== planA.sideIDs[1]) {
    blocked('invalid-allocation', 'Attacker/Defender results do not match plan sides');
  }
  if (completedPlans.has(planA)) blocked('plan-already-used', 'combat plan has already been completed');
  // No caller-controlled reads or callbacks remain between consuming the plan
  // and returning the frozen deal receipt. Failed checks above leave it retryable.
  const complete = immutable({
    kind: 'duel-base-combat-complete-allocation' as const,
    basedOnStateVersion: planA.basedOnStateVersion,
    fieldId: planA.fieldId,
    sideIDs: planA.sideIDs,
    attacker,
    defender,
    readyForSimultaneousDeal: true as const,
  });
  completedPlans.add(planA);
  completionPlans.set(complete, planA);
  return complete;
}

/** Read the genuine kernel receipt and its plan without consuming either one.
 * The caller must supply its authoritative clock and separately bind the plan to
 * its current combat/branch. This process-local identity is not a durable proof. */
export function inspectDuelBaseCombatCompletion(
  candidate: unknown,
  currentStateVersion: number,
): { readonly completion: DuelBaseCombatCompleteAllocation; readonly plan: DuelBaseCombatPlan } {
  const plan = candidate !== null && typeof candidate === 'object'
    ? completionPlans.get(candidate) : undefined;
  if (plan === undefined) blocked('invalid-allocation', 'genuine completed allocation required');
  assertDuelBaseCombatPlan(plan, currentStateVersion);
  return immutable({ completion: candidate as DuelBaseCombatCompleteAllocation, plan });
}
