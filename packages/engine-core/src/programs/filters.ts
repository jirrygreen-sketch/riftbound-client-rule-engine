import type { EventPattern, ObjectFilter, TargetSpec } from '@riftbound/card-dsl';
import type { ObjectFilter as EngineObjectFilter } from '../effects/contract.js';
import { ProgramBindingError } from './errors.js';

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProgramBindingError('invalid-program', 'Expected a filter object');
  return value as Record<string, unknown>;
};

function normalizePlayer(value: unknown): unknown {
  if (value === 'controller' || value === 'you') return 'self';
  if (value === 'their' || value === 'opponent') return 'opponent';
  return value;
}

export function translateObjectFilter(input: ObjectFilter | Record<string, unknown>): EngineObjectFilter {
  const source = record(input);
  const output: Record<string, unknown> = {};
  const allowed = new Set(['objectId', 'cardId', 'canonicalCardId', 'type', 'types', 'controller', 'owner', 'zone', 'location', 'locationType', 'states', 'state', 'tags', 'tag', 'characteristics']);
  for (const [key, value] of Object.entries(source)) {
    if (!allowed.has(key)) throw new ProgramBindingError('judge-required', `Unsupported filter field ${key}`);
    if (key === 'filter' || key === 'event' || key === 'source' || key === 'role' || key === 'self') throw new ProgramBindingError('judge-required', `Unsupported object filter field ${key}`);
    if (key === 'controller' || key === 'owner') output[key] = normalizePlayer(value);
    else if (key === 'tag') output.tags = [...(Array.isArray(output.tags) ? output.tags as unknown[] : []), value];
    else if (key === 'types') output.type = value;
    else if (key === 'locationType') {
      if (value === 'base') output.location = 'base';
      else if (value === 'battlefield') throw new ProgramBindingError('judge-required', 'Battlefield location filters need a concrete battlefield identity');
      else throw new ProgramBindingError('judge-required', `Unsupported location type ${String(value)}`);
    } else if (key === 'location' && typeof value === 'object' && value !== null) {
      const location = value as Record<string, unknown>;
      if (location.type === 'base') output.location = 'base';
      else throw new ProgramBindingError('judge-required', 'Structured location filters need a concrete location identity');
    } else if (key === 'here' || key === 'other' || key === 'playedFrom' || key === 'cause' || key === 'direction' || key === 'becameMighty') {
      throw new ProgramBindingError('judge-required', `Unsupported filter field ${key}`);
    } else {
      output[key] = value;
    }
  }
  return output as EngineObjectFilter;
}

function selfObject(refId: string): EngineObjectFilter { return { objectId: refId } as EngineObjectFilter; }

export function translateTriggerFilter(input: ObjectFilter | EventPattern | Record<string, unknown>, sourceRefId: string, defaultEvent = 'object-entered-zone'): ObjectFilter | EventPattern {
  const raw = record(input);
  const eventName = typeof raw.event === 'string' ? raw.event : typeof raw.type === 'string' && raw.type.includes('-') ? raw.type : typeof raw.kind === 'string' ? raw.kind : undefined;
  const nested = raw.filter && typeof raw.filter === 'object' ? record(raw.filter) : undefined;
  const eventPattern = eventName !== undefined || nested !== undefined || raw.source !== undefined || raw.target !== undefined || raw.object !== undefined || raw.role !== undefined || raw.self !== undefined || raw.player !== undefined;
  const objectInput = nested ?? (eventPattern ? raw : raw);
  if (!eventPattern) return translateObjectFilter(objectInput);
  const pattern: Record<string, unknown> = {};
  if (eventName !== undefined) pattern.event = eventName;
  const objectFilter = nested ?? raw;
  const source = raw.source ?? objectFilter.source;
  const role = raw.role ?? objectFilter.role;
  const self = raw.self ?? objectFilter.self;
  const objectId = raw.objectId ?? objectFilter.objectId;
  if (source === 'self' || role === 'self' || self === true || objectId === 'self') pattern.object = selfObject(sourceRefId);
  else if (raw.object !== undefined) pattern.object = translateObjectFilter(raw.object as Record<string, unknown>);
  else {
    const filter = { ...objectFilter };
    delete filter.event; delete filter.type; delete filter.kind; delete filter.filter; delete filter.source; delete filter.role; delete filter.self; delete filter.object; delete filter.target; delete filter.player;
    if (Object.keys(filter).length) pattern.object = translateObjectFilter(filter);
  }
  if (raw.source && typeof raw.source === 'object') pattern.source = translateObjectFilter(raw.source as Record<string, unknown>);
  if (raw.target !== undefined) pattern.target = translateObjectFilter(raw.target as Record<string, unknown>);
  const player = raw.player ?? objectFilter.player;
  if (player !== undefined) pattern.player = normalizePlayer(player);
  for (const key of ['fromZone', 'toZone', 'amount', 'details'] as const) if (raw[key] !== undefined) pattern[key] = raw[key];
  if (!pattern.event) {
    if (defaultEvent) pattern.event = defaultEvent;
    else return {} as EventPattern;
  }
  return pattern as EventPattern;
}

export function translateInstructionTargets(body: readonly any[]): any[] {
  return body.map(instruction => {
    const next: any = { ...instruction };
    if (instruction.targets) {
      next.targets = instruction.targets.map((target: TargetSpec) => ({ ...target, filter: translateObjectFilter(target.filter as Record<string, unknown>) }));
    }
    const args = instruction.args ?? {};
    for (const [key, expression] of Object.entries(args)) {
      if (expression && typeof expression === 'object' && (expression as any).kind && ['constant', 'literal'].includes((expression as any).kind) && Array.isArray((expression as any).value)) {
        next.args = { ...(next.args ?? {}), [key]: { ...(expression as any), value: translateInstructionTargets((expression as any).value) } };
      } else if (expression && typeof expression === 'object' && (expression as any).kind && ['constant', 'literal'].includes((expression as any).kind) && Array.isArray((expression as any).value?.body)) {
        const value = (expression as any).value;
        next.args = { ...(next.args ?? {}), [key]: { ...(expression as any), value: { ...value, body: translateInstructionTargets(value.body) } } };
      }
    }
    return next;
  });
}
