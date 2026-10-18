import type { ObjectSnapshot } from '../effects/contract.js';
import type { EventPattern, ObjectFilter, PlayerSelector } from './trigger-spec.js';
import type { PipelineEvent } from './pipeline-types.js';

const list = <T>(value: T | readonly T[]): readonly T[] => Array.isArray(value) ? value as readonly T[] : [value as T];
const EVENT_NAMES: Readonly<Record<string, string>> = {
  'zone-entered': 'object-entered-zone', 'zone-left': 'object-left-zone', 'object-targeted': 'became-target',
  'showdown-opened': 'showdown-open', 'showdown-closed': 'showdown-close', 'combat-ended': 'combat-end',
  'chain-item-finalized': 'chain-item-finalize', 'chain-item-resolved': 'chain-item-resolve',
  conquered: 'conquer', held: 'hold', scored: 'score'
};
function playerMatches(selector: PlayerSelector | undefined, player: string | undefined, controller: string): boolean {
  if (selector === undefined || selector === 'any') return true;
  if (player === undefined) return false;
  return typeof selector === 'object' ? selector.playerId === player : selector === 'self' ? player === controller : player !== controller;
}
export function matchesTriggerObject(filter: ObjectFilter, object: ObjectSnapshot | undefined, controller: string): boolean {
  if (!object) return Object.keys(filter).length === 0;
  if (filter.objectId !== undefined && object.ref.id !== filter.objectId) return false;
  if ((filter.cardId ?? filter.canonicalCardId) !== undefined && object.cardId !== (filter.cardId ?? filter.canonicalCardId)) return false;
  if (filter.type !== undefined && !list(filter.type).some(type => type === 'object' || (type === 'card' && object.cardId !== null) || (type === 'token' && object.isToken) || object.types.includes(type))) return false;
  if (!playerMatches(filter.controller, object.controller, controller) || !playerMatches(filter.owner, object.owner, controller)) return false;
  if (filter.zone !== undefined && !list(filter.zone).some(zone => zone === object.zone || (zone === 'base' && object.location?.type === 'base') || (zone === 'battlefield' && object.location?.type === 'battlefield') || (zone === 'discard' && object.zone === 'trash') || (zone === 'banish' && object.zone === 'banishment'))) return false;
  if (filter.location !== undefined && filter.location !== (object.location?.type === 'battlefield' ? object.location.id : object.location?.type)) return false;
  if (filter.states !== undefined && !list(filter.states).every(state => state === 'ready' ? !object.exhausted : state === 'exhausted' ? object.exhausted : state === 'stunned' ? object.stunned : state === 'attached' ? object.attachedTo !== null : object.faceDown)) return false;
  if (filter.tags && !filter.tags.every(tag => object.tags.includes(tag))) return false;
  if (filter.characteristics && !Object.entries(filter.characteristics).every(([key, value]) => (object as unknown as Record<string, unknown>)[key] === value)) return false;
  return true;
}
export function matchesTriggerEvent(filter: ObjectFilter | EventPattern, event: PipelineEvent, controller: string): boolean {
  // `it` is part of the card IR contract and is preserved on the runtime event
  // even before the shared trigger-spec declaration exposes its typed field.
  const pattern = filter as EventPattern & { readonly it?: ObjectFilter };
  const isPattern = ['event', 'kind', 'object', 'source', 'target', 'it', 'player', 'fromZone', 'toZone', 'amount', 'details'].some(key => key in filter) || typeof pattern.type === 'string' && pattern.type.includes('-');
  if (!isPattern) return matchesTriggerObject(filter as ObjectFilter, event.object ?? event.target, controller);
  const kind = pattern.event ?? pattern.type ?? pattern.kind;
  const actual = event.kind ?? event.timingPoint;
  if (kind !== undefined && (EVENT_NAMES[kind] ?? kind) !== (EVENT_NAMES[actual] ?? actual)) return false;
  for (const key of ['object', 'source', 'target'] as const) if (pattern[key] && !matchesTriggerObject(pattern[key], event[key], controller)) return false;
  if (pattern.it && (!event.it || !matchesTriggerObject(pattern.it, event.it, controller))) return false;
  if (!playerMatches(pattern.player, event.player, controller)) return false;
  if (pattern.fromZone !== undefined && pattern.fromZone !== event.fromZone || pattern.toZone !== undefined && pattern.toZone !== event.toZone) return false;
  if (pattern.amount !== undefined) {
    if (event.amount === undefined) return false;
    const matcher = pattern.amount;
    if (typeof matcher === 'number') { if (event.amount !== matcher) return false; }
    else {
      const a = event.amount, b = matcher.value;
      if (!(matcher.operator === 'eq' ? a === b : matcher.operator === 'neq' ? a !== b : matcher.operator === 'gt' ? a > b : matcher.operator === 'gte' ? a >= b : matcher.operator === 'lt' ? a < b : a <= b)) return false;
    }
  }
  return !pattern.details || Object.entries(pattern.details).every(([key, expected]) => Array.isArray(expected) ? expected.includes(event.details?.[key] as never) : event.details?.[key] === expected);
}
