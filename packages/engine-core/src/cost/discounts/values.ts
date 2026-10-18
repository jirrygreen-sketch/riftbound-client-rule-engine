import type { ObjectRef, ObjectSnapshot, ResolveContext, Value } from '../../effects/contract.js';
import { arithmetic, asValue, compareValues, equalValues } from '../../effects/interpreter/values.js';
import { CostPlanError } from '../plan-types.js';

export function blocked(message: string): never {
  throw new CostPlanError('judge-required', message);
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) blocked('Expected a cost modification record');
  return value as Record<string, unknown>;
}

export function literal(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const item = record(value);
    if (item.kind === 'constant' || item.kind === 'literal') return literal(item.value);
  }
  return value;
}

export function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

/** Snapshots must be captured at successful card Finalize, including countered cards (420.4.b). */
export interface FinalizedCardPlay {
  readonly object: ObjectSnapshot;
  readonly player: string;
}

export interface CostEnvironment {
  readonly ctx: ResolveContext;
  readonly source: ObjectSnapshot;
  /** Authoritative, transactionally recorded card finalizations in the current turn. */
  readonly finalizedPlaysThisTurn?: readonly FinalizedCardPlay[];
}

const list = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [value];

function playerMatches(expected: unknown, actual: string, source: ObjectSnapshot): boolean {
  if (['self', 'source', 'controller', 'you', 'caster'].includes(String(expected))) return actual === source.controller;
  if (['opponent', 'their', 'caster-opponent'].includes(String(expected))) return actual !== source.controller;
  return expected === 'any' || expected === actual;
}

/** Strict matching: a descriptive/unknown filter must never become an unconditional discount. */
export function matchesCostFilter(filter: unknown, object: ObjectSnapshot, env: CostEnvironment): boolean {
  const checks = Object.entries(record(literal(filter))).map(([key, raw]) => {
    const value = literal(raw);
    switch (key) {
      case 'objectId': case 'id': return value === object.ref.id;
      case 'zoneEntryId': return value === object.ref.zoneEntryId;
      case 'objectRefs': {
        if (!Array.isArray(value) || value.some(ref => {
          const item = record(ref);
          return typeof item.id !== 'string' || !Number.isSafeInteger(item.zoneEntryId);
        })) blocked('Invalid cost target reference list');
        return value.some(ref => sameRef(ref as ObjectRef, object.ref));
      }
      case 'cardId': case 'canonicalCardId': return value === object.cardId;
      case 'controller': case 'owner': return playerMatches(value, object[key], env.source);
      case 'type': case 'types': return list(value).some(type => object.types.includes(String(type)));
      case 'tag': case 'tags': return list(value).every(tag => object.tags.includes(String(tag)));
      case 'keywords': return list(value).every(keyword => object.keywords.some(item => item.id.toLowerCase() === String(keyword).toLowerCase()));
      case 'zone': return list(value).includes(object.zone);
      case 'isToken': case 'exhausted': case 'stunned': case 'faceDown': return value === object[key];
      case 'location':
        if (value === 'base' || value === 'battlefield') return object.location?.type === value;
        return equalValues(asValue(value), asValue(object.location));
      case 'object': case 'self': case 'source': case 'exclude': case 'sameLocationAs': {
        if (value !== 'self' && value !== 'source' && !(key === 'self' && value === true)) blocked(`Unsupported cost filter anchor ${key}`);
        if (key === 'exclude') return !sameRef(object.ref, env.source.ref);
        if (key === 'sameLocationAs') {
          if (env.source.location === null) blocked('Cost location anchor has no location; play destination binding is required');
          return object.location !== null && equalValues(asValue(object.location), asValue(env.source.location));
        }
        return sameRef(object.ref, env.source.ref);
      }
      case 'state': case 'states': return list(value).every(state => {
        if (state === 'ready') return !object.exhausted;
        if (state === 'exhausted') return object.exhausted;
        if (state === 'stunned') return object.stunned;
        if (state === 'attached') return object.attachedTo !== null;
        if (state === 'face-down') return object.faceDown;
        return blocked(`Unsupported cost filter state ${String(state)}`);
      });
      case 'characteristics': return Object.entries(record(value)).every(([property, expected]) => {
        if (!Object.hasOwn(object, property)) blocked(`Unavailable cost characteristic ${property}`);
        return equalValues(asValue((object as unknown as Record<string, unknown>)[property]), asValue(expected));
      });
      default: return blocked(`Unsupported cost filter field ${key}`);
    }
  });
  return checks.every(Boolean);
}

export function turnPlays(env: CostEnvironment): readonly FinalizedCardPlay[] {
  if (env.finalizedPlaysThisTurn === undefined) blocked('Cost history requires authoritative card Finalize records for the current turn (420.4.b)');
  return env.finalizedPlaysThisTurn;
}

export function evaluateCostValue(value: unknown, env: CostEnvironment): Value {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return asValue(value);
  const expr = record(value);
  switch (expr.kind) {
    case 'constant': case 'literal': return asValue(expr.value);
    case 'arithmetic': {
      if (!Array.isArray(expr.operands)) blocked('Cost arithmetic requires operands');
      return arithmetic(expr.operator, expr.operands.map(operand => evaluateCostValue(operand, env)));
    }
    case 'count': {
      if (expr.subject === 'cards-played-this-turn') {
        const filter = record(expr.filter ?? {});
        if (Object.keys(filter).some(key => key !== 'player')) blocked('Unsupported finalized-card history filter');
        return turnPlays(env).filter(play => playerMatches(filter.player ?? 'controller', play.player, env.source)).length;
      }
      const subjectTypes: Record<string, string | null> = { objects: null, cards: null, units: 'unit', gear: 'gear', gears: 'gear', runes: 'rune' };
      if (typeof expr.subject !== 'string' || !Object.hasOwn(subjectTypes, expr.subject)) blocked(`Unsupported cost count subject ${String(expr.subject)}`);
      const filter = record(literal(expr.filter ?? {}));
      // CR 356.4 conditions that count live permanents inspect the current
      // board by default. An explicit zone remains authoritative (for
      // example, Rhasa's cards in your trash).
      const scopedFilter = (expr.subject === 'units' || expr.subject === 'gear' || expr.subject === 'gears') &&
        !Object.hasOwn(filter, 'zone') ? { ...filter, zone: 'board' } : filter;
      return env.ctx.query({}).filter(object =>
        (subjectTypes[expr.subject as string] === null || object.types.includes(subjectTypes[expr.subject as string]!)) &&
        (expr.subject !== 'cards' || !object.isToken) && matchesCostFilter(scopedFilter, object, env)
      ).length;
    }
    case 'object-property': case 'object-attribute': {
      if (expr.object !== 'self' && expr.object !== 'source') blocked('Cost characteristic requires a source selector');
      const property = String(expr.property ?? expr.attribute);
      if (!Object.hasOwn(env.source, property)) blocked(`Unavailable cost characteristic ${property}`);
      return asValue((env.source as unknown as Record<string, unknown>)[property]);
    }
    default: return blocked(`Unsupported cost expression ${String(expr.kind)}`);
  }
}

export function testCostCondition(value: unknown, env: CostEnvironment): boolean {
  const condition = record(value);
  switch (condition.kind) {
    case 'always': return true;
    case 'never': return false;
    case 'expression': {
      const result = evaluateCostValue(condition.value, env);
      if (typeof result !== 'boolean') blocked('Descriptive cost predicates require an authoritative condition adapter');
      return result;
    }
    case 'compare': return compareValues(evaluateCostValue(condition.left, env), condition.operator, evaluateCostValue(condition.right, env));
    case 'not': return !testCostCondition(condition.condition, env);
    case 'all': case 'any': {
      if (!Array.isArray(condition.conditions)) blocked('Cost condition requires clauses');
      const results = condition.conditions.map(clause => testCostCondition(clause, env));
      return condition.kind === 'all' ? results.every(Boolean) : results.some(Boolean);
    }
    default: return blocked(`Unsupported cost condition ${String(condition.kind)}`);
  }
}

export function costInteger(value: unknown, env: CostEnvironment, signed = false): number {
  const amount = evaluateCostValue(value, env);
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || (!signed && amount < 0)) blocked('Cost modification requires a safe integer amount');
  return amount;
}

export const costLiteral = (value: number) => ({ kind: 'constant' as const, value });
