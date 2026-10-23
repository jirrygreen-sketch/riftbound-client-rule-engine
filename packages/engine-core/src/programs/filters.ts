import type { EventPattern, ObjectFilter, TargetSpec } from '@riftbound/card-dsl';
import type { ObjectFilter as EngineObjectFilter, ObjectSnapshot } from '../effects/contract.js';
import { EVENT_PATTERN_TYPES, canonicalEventPatternType, validateEventPattern } from '../events/trigger-spec.js';
import { ProgramBindingError } from './errors.js';

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProgramBindingError('invalid-program', 'Expected a filter object');
  return value as Record<string, unknown>;
};

function normalizePlayer(value: unknown): unknown {
  if (value === 'controller' || value === 'you') return 'self';
  if (value === 'their') return 'opponent';
  return value;
}

const anchors = new Set(['object', 'source', 'target', 'it', 'host', 'attachedTo', 'sameLocationAs', 'differentLocationFrom', 'exclude', 'other']);
// Only fields actually consumed by the unified predicate/query implementation.
// Unrecognized card-text predicates must never become unrestricted queries.
const scalarFields = new Set([
  'objectId', 'zoneEntryId', 'cardId', 'canonicalCardId', 'type', 'controller', 'owner', 'zone',
  'location', 'locationType', 'states', 'tags', 'characteristics', 'relation',
  'keyword', 'keywords', 'hasKeyword', 'damaged', 'buffed', 'empowered',
  'mightLt', 'mightLessThan', 'mightLessThanTarget', 'mightLte', 'mightAtMost',
  'mightGte', 'mightAtLeast', 'mightGt', 'mightGreaterThan', 'mightEq',
  'energyMax', 'printedEnergyMax', 'energyAtMost',
  'powerMax', 'printedPowerMax', 'powerAtMost',
  'printedCostNoMoreThanKilledUnit', 'killedUnit', 'killed', 'costReference'
]);
const relations = new Set(['same-location', 'different-location', 'same-controller', 'different-controller', 'same-owner', 'different-owner', 'another', 'other']);
const symbolicId = /^[a-z][a-z0-9._:-]*$/;

/**
 * Resolve the Battlefield Location occupied by an object. A Battlefield on the
 * Board is both a Location and the Game Object at that Location, even when its
 * runtime Location field is null (CR v1.5 199.1). Units and other Board objects
 * continue to use their explicit Location.
 */
export function battlefieldLocationOf(
  object: Pick<ObjectSnapshot, 'ref' | 'location' | 'zone' | 'types'> | undefined,
): string | null {
  if (object?.location?.type === 'battlefield') return object.location.id;
  if (object?.zone === 'board' && object.types.some(type => type.toLowerCase() === 'battlefield')) {
    return object.ref.id;
  }
  return null;
}

function selector(value: unknown): unknown {
  if (value === 'self' || value === 'source') return value;
  const input = record(value);
  const keys = Object.keys(input);
  if (keys.length !== 1 || !['target', 'pick', 'linked'].includes(keys[0]!) || typeof input[keys[0]!] !== 'string' || input[keys[0]!] === '') {
    throw new ProgramBindingError('invalid-program', 'Expected a symbolic ObjectSelector, not a runtime object reference');
  }
  return { ...input };
}

function selectedUnitSelector(value: unknown): { readonly target: string } {
  const input = record(value);
  if (Object.keys(input).length !== 1 || typeof input.target !== 'string' ||
      !symbolicId.test(input.target)) {
    throw new ProgramBindingError(
      'invalid-program',
      'locationRelation different-from-selected-unit requires one symbolic target selector'
    );
  }
  return { target: input.target };
}

function put(output: Record<string, unknown>, key: string, value: unknown): void {
  if (key in output && JSON.stringify(output[key]) !== JSON.stringify(value)) {
    throw new ProgramBindingError('invalid-program', `Conflicting filter field ${key}`);
  }
  output[key] = value;
}

function append(output: Record<string, unknown>, key: string, value: unknown): void {
  const values = Array.isArray(value) ? value : [value];
  output[key] = [...new Set([...(output[key] as unknown[] | undefined ?? []), ...values])];
}

/** Normalize static IR; keep anchors symbolic until the runtime query. Self is
 * the current host, while source may use source LKI. Neither selects a target. */
export function translateObjectFilter(input: ObjectFilter | Record<string, unknown>): EngineObjectFilter {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record(input))) {
    if (key === 'self' || key === 'other' && typeof value === 'boolean' || key === 'here') {
      if (value !== true) throw new ProgramBindingError('judge-required', `Unsupported filter ${key}: ${String(value)}`);
      put(output, key === 'self' ? 'object' : key === 'other' ? 'exclude' : 'sameLocationAs', 'self');
    } else if (key === 'role') {
      if (value === 'self') put(output, 'object', 'self');
      else if (value === 'other-friendly') {
        put(output, 'controller', 'self');
        put(output, 'exclude', 'self');
      } else throw new ProgramBindingError('judge-required', `Unsupported filter role ${String(value)}`);
    } else if (key === 'object.id' || key === 'id' || key === 'objectId') {
      if (value === 'self' || value === 'source') put(output, 'object', value);
      else put(output, 'objectId', value);
    } else if (anchors.has(key)) put(output, key, selector(value));
    else if (key === 'types') put(output, 'type', value);
    else if (key === 'tag' || key === 'tags') append(output, 'tags', value);
    else if (key === 'state' || key === 'states') append(output, 'states', value);
    else if (key === 'costEnergyLte') {
      if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new ProgramBindingError('invalid-program', 'Invalid costEnergyLte filter');
      }
      put(output, key, value);
    }
    else if (key === 'equipped') {
      if (value !== true) throw new ProgramBindingError('judge-required', `Unsupported filter equipped: ${String(value)}`);
      put(output, key, true);
    }
    else if (key === 'controller' || key === 'owner') put(output, key, normalizePlayer(value));
    else if (key === 'zoneEntryId') {
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ProgramBindingError('invalid-program', 'Invalid zoneEntryId filter');
      put(output, key, value);
    } else if (key === 'location') {
      if (value === 'here' || value === 'source-location') put(output, 'sameLocationAs', value === 'here' ? 'self' : 'source');
      else if (typeof value === 'string') put(output, key, ['base', 'battlefield'].includes(value) ? value : { type: 'battlefield', id: value });
      else if (value === null) put(output, key, value);
      else {
        const location = record(value);
        const fields = location.type === 'base' ? ['type', 'player'] : location.type === 'battlefield' ? ['type', 'id'] : [];
        if (!fields.length || Object.keys(location).some(field => !fields.includes(field)) ||
            location.player !== undefined && (typeof location.player !== 'string' || ['self', 'controller', 'you', 'opponent', 'their'].includes(location.player)) ||
            location.id !== undefined && typeof location.id !== 'string') {
          throw new ProgramBindingError('judge-required', 'Unsupported structured location filter');
        }
        put(output, key, { ...location });
      }
    } else if (key === 'locationType') {
      if (value !== 'base' && value !== 'battlefield') throw new ProgramBindingError('judge-required', `Unsupported location type ${String(value)}`);
      put(output, key, value);
    } else if (key === 'relation') {
      const relation = record(value);
      if (!relations.has(String(relation.relation)) || Object.keys(relation).some(field => !['relation', 'object', 'other'].includes(field)) ||
          relation.object === undefined && relation.other === undefined) throw new ProgramBindingError('judge-required', 'Unsupported object relation filter');
      put(output, key, { ...relation, ...(relation.object === undefined ? {} : { object: selector(relation.object) }), ...(relation.other === undefined ? {} : { other: selector(relation.other) }) });
    } else if (key === 'locationRelation') {
      if (value !== 'different-from-selected-unit') {
        throw new ProgramBindingError('judge-required', `Unsupported location relation ${String(value)}`);
      }
      const reference = selectedUnitSelector(input.exclude);
      // Keep both existing consumers aligned. queryObjects can evaluate the
      // anchor directly; the structured relation also fails closed when a
      // TargetPlan query has no bound prior-target context.
      put(output, 'differentLocationFrom', reference);
      put(output, 'relation', { relation: 'different-location', object: reference });
    } else if (scalarFields.has(key)) put(output, key, value);
    else throw new ProgramBindingError('judge-required', `Unsupported filter field ${key}`);
  }
  return output as EngineObjectFilter;
}

const eventFields = new Set(['event', 'kind', 'filter', 'here', 'object', 'source', 'target', 'it', 'relations', 'player', 'fromZone', 'toZone', 'amount', 'details']);
const isEventType = (value: unknown): value is typeof EVENT_PATTERN_TYPES[number] => typeof value === 'string' && (EVENT_PATTERN_TYPES as readonly string[]).includes(value);
const isSelector = (value: unknown): boolean => value === 'self' || value === 'source' || typeof value === 'object' && value !== null && Object.keys(value).length === 1 && ['target', 'pick', 'linked'].some(key => key in value);

/** The legacy event matcher can bind an id, but cannot evaluate a symbolic
 * relation. Keep this boundary closed until its owner connects the unified
 * matcher, the registration source and immutable event/LKI snapshots. */
function triggerObject(input: Record<string, unknown>, sourceRefId: string): Record<string, unknown> {
  const { here, ...ordinary } = input;
  if (here !== undefined && here !== true) {
    throw new ProgramBindingError('judge-required', `Unsupported filter here: ${String(here)}`);
  }
  const output = { ...translateObjectFilter(ordinary) } as Record<string, unknown>;
  if (here === true) output.here = true;
  for (const key of ['object', 'source', 'target', 'it', 'host']) {
    if (!(key in output)) continue;
    if (output[key] !== 'self' && output[key] !== 'source') throw new ProgramBindingError('judge-required', `Trigger filter ${key} requires runtime object binding`);
    put(output, 'objectId', sourceRefId);
    delete output[key];
  }
  if (output.location && typeof output.location === 'object') {
    const location = record(output.location);
    if (location.type === 'battlefield' && typeof location.id === 'string') output.location = location.id;
    else if (location.type === 'base' && location.player === undefined) output.location = 'base';
    else throw new ProgramBindingError('judge-required', 'Trigger location requires runtime location binding');
  }
  if (output.locationType !== undefined) {
    if (output.locationType !== 'base') throw new ProgramBindingError('judge-required', 'Trigger locationType requires runtime location binding');
    put(output, 'location', 'base');
    delete output.locationType;
  }
  for (const key of ['controller', 'owner']) {
    const player = output[key];
    if (typeof player === 'string' && !['self', 'opponent', 'any'].includes(player)) output[key] = { playerId: player };
  }
  const result = validateEventPattern({ event: 'card-played', object: output });
  if (!result.ok) throw new ProgramBindingError('judge-required', 'Trigger filter requires the unified event matcher', result.issues);
  return output;
}

function normalizeMightyTransition(output: Record<string, unknown>, becomesMighty: unknown): void {
  const object = output.object;
  const normalizedKind = output.event ?? output.type ?? output.kind;
  if (normalizedKind === undefined || canonicalEventPatternType(normalizedKind as typeof EVENT_PATTERN_TYPES[number]) !== 'might-changed' ||
      typeof object !== 'object' || object === null || Array.isArray(object) ||
      becomesMighty !== true) {
    throw new ProgramBindingError('judge-required', 'becomesMighty is supported only as true on might-changed Unit events');
  }
  const candidate = object as Record<string, unknown>;
  const type = candidate.type;
  if (type !== 'unit' && !(Array.isArray(type) && type.includes('unit'))) {
    throw new ProgramBindingError('judge-required', 'becomesMighty requires a Unit object predicate');
  }
  if (output.details !== undefined && output.details !== null && typeof output.details === 'object' &&
      Object.hasOwn(output.details, 'becomesMighty') &&
      (output.details as Record<string, unknown>).becomesMighty !== true) {
    throw new ProgramBindingError('invalid-program', 'Conflicting becomesMighty predicates');
  }
  output.details = { ...(record(output.details ?? {})), becomesMighty: true };
}

export function translateTriggerFilter(input: ObjectFilter | EventPattern | Record<string, unknown>, sourceRefId: string, defaultEvent = 'object-entered-zone'): ObjectFilter | EventPattern {
  const raw = record(input);
  if (raw.here !== undefined && raw.event === undefined && raw.kind === undefined && !isEventType(raw.type)) {
    throw new ProgramBindingError('judge-required', 'Unsupported filter field here');
  }
  if (Object.hasOwn(raw, 'becomesMighty')) {
    throw new ProgramBindingError('judge-required', 'becomesMighty must be inside a typed might-changed event pattern');
  }
  const rawBattlefieldWas = raw.battlefieldWas;
  if (rawBattlefieldWas !== undefined && rawBattlefieldWas !== 'uncontrolled') {
    throw new ProgramBindingError('judge-required', `Unsupported battlefieldWas ${String(rawBattlefieldWas)}`);
  }
  const hasEventType = isEventType(raw.type);
  const hasMightyPredicate = raw.object !== null && typeof raw.object === 'object' && Object.hasOwn(raw.object, 'becomesMighty');
  const hasDetailsMightyPredicate = raw.details !== null && typeof raw.details === 'object' && !Array.isArray(raw.details) && Object.hasOwn(raw.details, 'becomesMighty');
  const pattern = raw.event !== undefined || raw.kind !== undefined || hasEventType || raw.filter !== undefined ||
    ['player', 'fromZone', 'toZone', 'amount', 'details', 'relations', 'battlefieldWas', 'here'].some(key => key in raw) ||
    ['object', 'source', 'target', 'it'].some(key => raw[key] !== undefined && !isSelector(raw[key])) ||
    hasMightyPredicate || hasDetailsMightyPredicate;
  if (!pattern) return triggerObject(raw, sourceRefId) as ObjectFilter;

  const output: Record<string, unknown> = {};
  const object: Record<string, unknown> = {};
  const battlefieldWas = rawBattlefieldWas === 'uncontrolled' ? 'uncontrolled' : undefined;
  let becomesMighty: unknown;
  const mergeObject = (filter: Record<string, unknown>) => {
    if (Object.hasOwn(filter, 'becomesMighty')) {
      if (becomesMighty !== undefined && !Object.is(becomesMighty, filter.becomesMighty)) {
        throw new ProgramBindingError('invalid-program', 'Conflicting becomesMighty predicates');
      }
      becomesMighty = filter.becomesMighty;
    }
    const ordinary = Object.fromEntries(Object.entries(filter).filter(([key]) => key !== 'becomesMighty'));
    for (const [key, value] of Object.entries(triggerObject(ordinary, sourceRefId))) {
      if (key === 'tags' || key === 'states') append(object, key, value);
      else put(object, key, value);
    }
  };
  if (raw.filter !== undefined) {
    const nested = { ...record(raw.filter) };
    if (nested.here !== undefined) {
      throw new ProgramBindingError('judge-required', 'Unsupported nested filter field here');
    }
    // This legacy spelling nests the acting player next to object predicates.
    // It still constrains the event, rather than the object's controller.
    if (nested.player !== undefined) {
      const player = normalizePlayer(nested.player);
      output.player = typeof player === 'string' && !['self', 'opponent', 'any'].includes(player) ? { playerId: player } : player;
      delete nested.player;
    }
    mergeObject(nested);
  }
  if (raw.object !== undefined && !isSelector(raw.object)) mergeObject(record(raw.object));
  if (hasDetailsMightyPredicate) {
    const detailMatcher = (raw.details as Record<string, unknown>).becomesMighty;
    if (becomesMighty !== undefined && !Object.is(becomesMighty, detailMatcher)) {
      throw new ProgramBindingError('invalid-program', 'Conflicting becomesMighty predicates');
    }
    becomesMighty = detailMatcher;
  }
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (['object', 'source', 'target', 'it'].includes(key)) {
      if (isSelector(value)) flat[key] = value;
      else if (key !== 'object') output[key] = triggerObject(record(value), sourceRefId);
    } else if (key === 'event' || key === 'kind' || key === 'type' && hasEventType) output[key] = value;
    else if (key === 'here') {
      if (value !== true) throw new ProgramBindingError('judge-required', `Unsupported event here anchor ${String(value)}`);
      output.here = true;
    }
    else if (key === 'player') {
      const player = normalizePlayer(value);
      put(output, key, typeof player === 'string' && !['self', 'opponent', 'any'].includes(player) ? { playerId: player } : player);
    } else if (key === 'battlefieldWas') {
      // Captured above before ordinary object-filter normalization.
    } else if (key !== 'filter') {
      if (eventFields.has(key)) output[key] = value;
      else flat[key] = value;
    }
  }
  if (Object.keys(flat).length) mergeObject(flat);
  if (Object.keys(object).length || raw.object !== undefined) output.object = object;
  if (!['event', 'type', 'kind'].some(key => key in output)) output.event = defaultEvent;
  if (becomesMighty !== undefined) normalizeMightyTransition(output, becomesMighty);
  if (battlefieldWas !== undefined) {
    const actual = output.event ?? output.type ?? output.kind;
    if (canonicalEventPatternType(actual as typeof EVENT_PATTERN_TYPES[number]) !== 'conquer') {
      throw new ProgramBindingError('judge-required', 'battlefieldWas is supported only for conquer events');
    }
    output.details = { ...(record(output.details ?? {})), battlefieldControllerBefore: null };
  }
  const discriminants = ['event', 'type', 'kind'].filter(key => key in output);
  if (discriminants.every(key => isEventType(output[key])) && new Set(discriminants.map(key => canonicalEventPatternType(output[key] as typeof EVENT_PATTERN_TYPES[number]))).size > 1) {
    throw new ProgramBindingError('invalid-program', 'Conflicting event filter discriminants');
  }
  const result = validateEventPattern(output);
  if (!result.ok) throw new ProgramBindingError('judge-required', 'Unsupported event filter; runtime event binding is required', result.issues);
  return output as EventPattern;
}

function instructionBody(value: unknown): value is readonly any[] {
  return Array.isArray(value) && value.every(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.op === 'string' && item.args && typeof item.args === 'object');
}

function translateExpression(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(translateExpression);
  if (value.kind === 'constant' || value.kind === 'literal') {
    if (instructionBody(value.value)) return { ...value, value: translateInstructionTargets(value.value) };
    if (value.value && typeof value.value === 'object' && !Array.isArray(value.value) && instructionBody(value.value.body)) {
      return { ...value, value: { ...value.value, body: translateInstructionTargets(value.value.body) } };
    }
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    key === 'filter' && value.kind === 'count' ? translateObjectFilter(record(child)) : translateExpression(child)
  ]));
}

export function translateInstructionTargets(body: readonly any[]): any[] {
  return body.map(instruction => {
    const next: any = { ...instruction };
    if (instruction.targets) next.targets = instruction.targets.map((target: TargetSpec) => ({ ...target, filter: translateObjectFilter(target.filter) }));
    // Picks remain picks; translating predicates never manufactures targets.
    if (instruction.picks) next.picks = instruction.picks.map((pick: any) => ({ ...pick, ...(pick.filter ? { filter: translateObjectFilter(pick.filter) } : {}) }));
    if (instruction.condition) next.condition = translateExpression(instruction.condition);
    if (instruction.args) next.args = Object.fromEntries(Object.entries(instruction.args).map(([key, expression]) => {
      const expr = expression as any;
      if (key === 'modes' && ['constant', 'literal'].includes(expr?.kind) && Array.isArray(expr.value)) {
        return [key, { ...expr, value: expr.value.map((mode: any) => ({ ...mode, body: translateInstructionTargets(mode.body) })) }];
      }
      return [key, translateExpression(expression)];
    }));
    return next;
  });
}
