import type { ObjectRef, ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import type { PipelineHost } from '../../events/pipeline-types.js';
import type { ChainEngine } from '../../chain/engine.js';
import { matchesObjectFilter } from '../../layers/filter.js';
import {
  createTrustedDuelBaseCombatFacts,
  planDuelBaseCombatDamage,
  type DuelBaseCombatAssignmentRule,
  type DuelBaseCombatAssignmentRules,
  type DuelBaseCombatBoard,
  type DuelBaseCombatPlan,
  type DuelBaseCombatSourceEffectProof,
} from '../base-combat-allocation.js';

export interface CombatDamageFieldFact {
  readonly id: string;
  readonly controller: PlayerId | null;
  readonly contestedBy: PlayerId | null;
  readonly staged: 'none' | 'showdown' | 'combat';
  readonly active: boolean;
}

export interface CombatDamageUnitFact {
  readonly object: ObjectSnapshot;
  readonly combatRole: 'attacker' | 'defender' | null;
}

export interface CombatDamageRuntime {
  readonly stateVersion: number;
  readonly fieldId: string;
  readonly attackerPlayerId: PlayerId;
  readonly defenderPlayerId: PlayerId;
  readonly players: readonly PlayerId[];
  readonly fields: readonly CombatDamageFieldFact[];
  readonly units: readonly CombatDamageUnitFact[];
  readonly layers: ChainEngine['layers'];
  readonly pipeline: ChainEngine['pipeline'];
  readonly host: PipelineHost;
  /** Every live assignment-prevention replacement must be proven absent. */
  readonly replacementCount: number;
  /** Damage the controller cannot apply because the Unit is Stunned (424.1.b). */
  readonly zeroDamageSourceIds: readonly string[];
  /** Stunned Units still need their full current Might assigned as lethal damage (424.1.c). */
  readonly fullMightLethalTargetIds: readonly string[];
}

const ASSIGNMENT_MODIFIER_KINDS = new Set([
  'continuous.bonus-damage',
  'continuous.lethal-threshold',
  'continuous.modify-might-reduction',
]);

function objectKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

/**
 * Compile the live layer registry into the narrow assignment facts accepted by
 * the combat kernel. Unknown combat modifiers fail closed instead of becoming a
 * guessed damage rule.
 */
function assignmentRules(runtime: CombatDamageRuntime): DuelBaseCombatAssignmentRules | null {
  const units = runtime.units.filter(unit => unit.object.zone === 'board' &&
    unit.object.types.includes('unit') && unit.object.location?.type === 'battlefield' &&
    unit.object.location.id === runtime.fieldId);
  const byUID = new Map<string, { uid: string; tank: boolean; backline: boolean; lethalDamage?: number }>();
  for (const unit of units) byUID.set(unit.object.ref.id, {
    uid: unit.object.ref.id,
    tank: false,
    backline: false,
  });

  for (const entry of runtime.layers.registry.list()) {
    const effect = entry.effect.effect as Record<string, unknown>;
    const kind = String(effect.kind ?? '').toLowerCase();
    if (ASSIGNMENT_MODIFIER_KINDS.has(kind)) return null;
    if (kind !== 'continuous.combat') continue;
    if (effect.mode !== 'damage-assignment' || effect.damage !== 'lethal' ||
        effect.controllerScope !== 'same-controller') return null;
    const source = entry.effect.source === undefined ? undefined :
      runtime.host.objects().find(object => objectKey(object.ref) === objectKey(entry.effect.source!));
    const descriptor = Object.getOwnPropertyDescriptor(entry.effect.filter, 'objectId');
    const objectIds = descriptor === undefined ? undefined :
      descriptor.get === undefined ? descriptor.value : descriptor.get.call(entry.effect.filter);
    const filter = Object.fromEntries(Object.entries(entry.effect.filter)
      .filter(([key]) => key !== 'objectId')) as Record<string, unknown>;
    const matched = units.filter(unit =>
      (objectIds === undefined || (Array.isArray(objectIds) ? objectIds.includes(unit.object.ref.id) :
        objectIds === unit.object.ref.id)) && matchesObjectFilter(filter, unit.object as never, {
      controller: source?.controller,
      anchor: source,
    }));
    if (matched.length === 0) continue;
    for (const unit of matched) {
      const current = byUID.get(unit.object.ref.id);
      if (current === undefined) return null;
      if (effect.priority === 'first' && effect.excludesKeyword === 'Tank') current.tank = true;
      else if (effect.priority === 'last' && effect.excludesKeyword === 'Backline') current.backline = true;
      else return null;
    }
  }

  const lethalMight = new Map<string, number>();
  for (const unit of units) {
    if (!runtime.fullMightLethalTargetIds.includes(unit.object.ref.id)) continue;
    runtime.layers.setObjects(runtime.units.map(candidate => candidate.object));
    const snapshot = runtime.layers.evaluate(unit.object.ref);
    if (snapshot === null || snapshot.might === null || !Number.isSafeInteger(snapshot.might) || snapshot.might < 0) {
      throw new TypeError(`Stunned Combat Unit ${unit.object.ref.id} has no authoritative Might`);
    }
    lethalMight.set(unit.object.ref.id, snapshot.might);
  }
  const rules: DuelBaseCombatAssignmentRule[] = [...byUID.values()].map(unit => {
    const lethalDamage = lethalMight.get(unit.uid);
    return Object.freeze({
      uid: unit.uid,
      ...(unit.tank ? { tank: true } : {}),
      ...(unit.backline ? { backline: true } : {}),
      ...(lethalDamage === undefined ? {} : { lethalDamage }),
    });
  });
  return Object.freeze({ status: 'validated' as const, units: Object.freeze(rules) });
}

export function createCombatDamagePlan(runtime: CombatDamageRuntime): DuelBaseCombatPlan {
  const board: DuelBaseCombatBoard = Object.freeze({
    playerIds: Object.freeze([...runtime.players]),
    battlefields: Object.freeze(runtime.fields.map(field => Object.freeze({
      locationId: field.id,
      controllerPlayerId: field.controller,
      contested: field.contestedBy !== null,
      contestingPlayerId: field.contestedBy,
      showdown: field.active ? 'active' as const :
        field.staged === 'showdown' || field.staged === 'combat' ? 'staged' as const : 'none' as const,
      combat: field.active ? 'active' as const :
        field.staged === 'combat' ? 'staged' as const : 'none' as const,
      occupancy: Object.freeze(runtime.units.filter(unit => unit.object.zone === 'board' &&
        unit.object.types.includes('unit') && unit.object.location?.type === 'battlefield' &&
        unit.object.location.id === field.id).map(unit => unit.object.ref.id)),
    }))),
    units: Object.freeze(runtime.units.filter(unit => unit.object.zone === 'board' &&
      unit.object.types.includes('unit') && unit.object.location?.type === 'battlefield')
      .map(unit => Object.freeze({
        objectId: unit.object.ref.id,
        controllerPlayerId: unit.object.controller,
        locationId: (unit.object.location as { id: string }).id,
      }))),
  });
  const unitMeta = Object.fromEntries(runtime.units.filter(unit => unit.object.zone === 'board')
    .map(unit => [unit.object.ref.id, Object.freeze({
      damageMarks: Object.freeze(unit.object.damage > 0
        ? [Object.freeze({ amount: unit.object.damage })]
        : []),
    })]));

  const rules = assignmentRules(runtime);
  if (rules === null) {
    throw new TypeError('Combat damage assignment contains an unsupported modifier');
  }
  const replacements = runtime.replacementCount;
  const service = {
    currentMight: (input: Parameters<ReturnType<typeof createTrustedDuelBaseCombatFacts>['evaluateCurrentMight']>[0]) => {
      const unit = runtime.units.find(candidate => candidate.object.ref.id === input.uid);
      if (unit === undefined) throw new TypeError(`Unknown combat Unit ${input.uid}`);
      if (runtime.zeroDamageSourceIds.includes(input.uid)) return 0;
      runtime.layers.setObjects(runtime.units.map(candidate => candidate.object));
      const snapshot = runtime.layers.evaluate(unit.object.ref);
      if (snapshot === null || snapshot.might === null || !Number.isSafeInteger(snapshot.might) || snapshot.might < 0) {
        throw new TypeError(`Combat Unit ${input.uid} has no authoritative Might`);
      }
      return snapshot.might;
    },
    proveBasicCombat: (): DuelBaseCombatSourceEffectProof | null => {
      if (replacements !== 0) return null;
      return Object.freeze({
        currentMight: 'validated' as const,
        assignmentModifier: 'proven-none' as const,
        preventionReplacement: 'proven-none' as const,
        keywordPriority: 'validated' as const,
        assignmentRules: rules,
      });
    },
    assignmentRules: () => rules,
  };
  const facts = createTrustedDuelBaseCombatFacts(runtime.stateVersion, runtime.fieldId, service);
  return planDuelBaseCombatDamage({ stateVersion: runtime.stateVersion, board, unitMeta }, runtime.fieldId, facts);
}

export function combatDamageEventDetails(plan: DuelBaseCombatPlan, combatId: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    combatId,
    battlefieldId: plan.fieldId,
    attackerId: plan.sideIDs[0],
    defenderId: plan.sideIDs[1],
    attackerMight: plan.attacker.budget,
    defenderMight: plan.defender.budget,
  });
}
