import type { ObjectSnapshot } from '../effects/contract.js';
import { canonicalEventPatternType, type EventPattern, type ObjectFilter, type PlayerSelector } from './trigger-spec.js';
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
function battlefieldId(location: ObjectSnapshot['location'] | undefined): string | null {
  return location?.type === 'battlefield' ? location.id : null;
}

function eventBattlefieldId(event: PipelineEvent): string | null {
  const id = (event.details as Readonly<Record<string, unknown>> | undefined)?.battlefieldId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function matchesTriggerObject(
  filter: ObjectFilter,
  object: ObjectSnapshot | undefined,
  controller: string,
  source?: ObjectSnapshot,
  eventField?: string | null,
): boolean {
  if (!object) return Object.keys(filter).length === 0;
  if (filter.here !== undefined) {
    const anchorField = battlefieldId(source?.location);
    if (filter.here !== true || anchorField === null || battlefieldId(object.location) !== anchorField ||
        eventField !== undefined && eventField !== anchorField) return false;
  }
  if (filter.objectId !== undefined && object.ref.id !== filter.objectId) return false;
  if (source !== undefined && filter.objectId === source.ref.id &&
      object.ref.zoneEntryId !== source.ref.zoneEntryId) return false;
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
/**
 * CR 709 / 710: "becomes Mighty" is the typed transition from below five to
 * five or greater. This is not the static predicate currentMight >= 5. Both
 * snapshots must describe the same live incarnation, and missing Might or an
 * unknown matcher value fails closed.
 */
export function matchesMightyTransition(
  matcher: unknown,
  previous: ObjectSnapshot | undefined,
  current: ObjectSnapshot | undefined,
): boolean {
  if (matcher !== true || previous === undefined || current === undefined) return false;
  if (previous.ref.id !== current.ref.id || previous.ref.zoneEntryId !== current.ref.zoneEntryId) return false;
  if (previous.zone !== 'board' || current.zone !== 'board') return false;
  if (previous.types.includes('unit') === false || current.types.includes('unit') === false) return false;
  if (previous.controller !== current.controller) return false;
  if (previous.might === null || current.might === null ||
      !Number.isFinite(previous.might) || !Number.isFinite(current.might)) return false;
  return previous.might < 5 && current.might >= 5;
}
export function matchesTriggerEvent(
  filter: ObjectFilter | EventPattern,
  event: PipelineEvent,
  controller: string,
  source?: ObjectSnapshot,
): boolean {
  // `it` is part of the card IR contract and is preserved on the runtime event
  // even before the shared trigger-spec declaration exposes its typed field.
  const pattern = filter as EventPattern & { readonly it?: ObjectFilter };
  const isPattern = ['event', 'kind', 'here', 'object', 'source', 'target', 'it', 'player', 'fromZone', 'toZone', 'amount', 'details'].some(key => key in filter) || typeof pattern.type === 'string' && pattern.type.includes('-');
  if (!isPattern) {
    if (Object.hasOwn(filter, 'becomesMighty')) return false;
    return matchesTriggerObject(filter as ObjectFilter, event.object ?? event.target, controller, source, eventBattlefieldId(event));
  }
  const kind = pattern.event ?? pattern.type ?? pattern.kind;
  const actual = event.kind ?? event.timingPoint;
  if (kind !== undefined && (EVENT_NAMES[kind] ?? kind) !== (EVENT_NAMES[actual] ?? actual)) return false;
  const field = eventBattlefieldId(event);
  if (pattern.here !== undefined) {
    if (pattern.here !== true || field === null || battlefieldId(source?.location) !== field) return false;
  }
  if ((pattern.object?.here === true || pattern.it?.here === true) &&
      (field === null || battlefieldId(source?.location) !== field)) return false;
  for (const key of ['object', 'source', 'target'] as const) {
    if (pattern[key] && !matchesTriggerObject(pattern[key], event[key], controller, source, field)) return false;
  }
  if (pattern.it && (!event.it || !matchesTriggerObject(pattern.it, event.it, controller, source, field))) return false;
  const hasDetailsMightyTransition = pattern.details !== undefined && Object.hasOwn(pattern.details, 'becomesMighty');
  const hasObjectMightyTransition = pattern.object !== undefined && Object.hasOwn(pattern.object, 'becomesMighty');
  const becomesMighty = hasDetailsMightyTransition
    ? pattern.details!.becomesMighty
    : hasObjectMightyTransition ? (pattern.object as ObjectFilter & { readonly becomesMighty?: unknown }).becomesMighty : undefined;
  if (hasDetailsMightyTransition || hasObjectMightyTransition) {
    if (kind === undefined || canonicalEventPatternType(kind) !== 'might-changed') return false;
    if (pattern.object?.type === undefined || !list(pattern.object.type).includes('unit')) return false;
    const before = (event.details as { readonly before?: ObjectSnapshot } | undefined)?.before;
    const after = (event.details as { readonly after?: ObjectSnapshot } | undefined)?.after;
    if (!matchesMightyTransition(becomesMighty, before, after)) return false;
    if (!event.object || !event.it ||
        event.object.ref.id !== after!.ref.id || event.object.ref.zoneEntryId !== after!.ref.zoneEntryId ||
        event.it.ref.id !== after!.ref.id || event.it.ref.zoneEntryId !== after!.ref.zoneEntryId) return false;
  }
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
  if (!pattern.details) return true;
  const details = event.details as Readonly<Record<string, unknown>> | undefined;
  if (Object.hasOwn(pattern.details, 'battlefieldControllerBefore')) {
    if (event.timingPoint !== 'conquer' || details === null || details === undefined || !Object.hasOwn(details, 'battlefieldControllerBefore')) return false;
    const battlefieldId = details.battlefieldId;
    const objectId = details.objectId;
    const playerId = details.playerId;
    if (typeof battlefieldId !== 'string' || battlefieldId.length === 0 ||
        typeof objectId !== 'string' || objectId.length === 0 ||
        typeof playerId !== 'string' || playerId.length === 0 ||
        typeof event.player !== 'string' || event.player.length === 0) return false;
    const object = event.object;
    if (object === undefined || object.ref.id !== objectId || object.zone !== 'board' ||
        !object.types.includes('unit') || object.location?.type !== 'battlefield' ||
        object.location.id !== battlefieldId || object.controller !== playerId) return false;
    if (event.source === undefined || event.it === undefined ||
        event.source.ref.id !== objectId || event.source.ref.zoneEntryId !== object.ref.zoneEntryId ||
        event.it.ref.id !== objectId || event.it.ref.zoneEntryId !== object.ref.zoneEntryId) return false;
    for (const capture of [event.source, event.it]) {
      if (capture.location?.type !== 'battlefield' || capture.location.id !== battlefieldId ||
          !capture.types.includes('unit') || capture.controller !== playerId) return false;
    }
    if (event.player !== playerId) return false;
    const before = details.battlefieldControllerBefore;
    if (before !== null && (typeof before !== 'string' || before.length === 0)) return false;
    if (pattern.details.battlefieldControllerBefore !== before) return false;
  }
  return Object.entries(pattern.details).every(([key, expected]) => key === 'battlefieldControllerBefore'
    ? true
    : key === 'becomesMighty'
    ? true
    : Array.isArray(expected) ? expected.includes(details?.[key] as never) : details?.[key] === expected);
}
