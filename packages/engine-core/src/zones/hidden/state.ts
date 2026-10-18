import type { Ability } from '@riftbound/card-dsl';
import type { ObjectRef, ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import { restrictions } from '../../layers/rules/query.js';
import type { ContinuousEffectRegistry } from '../../layers/duration.js';
import type {
  FacedownZone,
  HiddenCard,
  HiddenCardKind,
  HiddenOriginZone,
  HiddenState,
  HiddenTransitionReason,
  HiddenZoneTransition,
  PlayedFromHidden,
} from './types.js';

export type HiddenZoneErrorCode =
  | 'invalid-state'
  | 'invalid-turn'
  | 'unknown-battlefield'
  | 'unknown-card'
  | 'stale-reference'
  | 'not-hidden-card'
  | 'judge-required'
  | 'invalid-origin'
  | 'not-controller'
  | 'closed-state'
  | 'occupied'
  | 'capacity-choice-required'
  | 'capacity-invalid'
  | 'not-unlocked'
  | 'invalid-destination'
  | 'invalid-target'
  | 'already-played';

/** Fail-closed errors for Hidden legality and state transitions. */
export class HiddenZoneError extends Error {
  constructor(readonly code: HiddenZoneErrorCode, message: string) {
    super(message);
    this.name = 'HiddenZoneError';
  }
}

export interface HiddenBattlefieldInput {
  readonly battlefieldId: string;
  readonly controller?: PlayerId | null;
  readonly capacity?: number;
}

export interface HiddenCapacityRuleSource {
  readonly registry?: ContinuousEffectRegistry;
  readonly battlefield: ObjectSnapshot;
}

export interface HiddenCapacityRuleRegistration {
  readonly id: string;
  readonly battlefield: ObjectSnapshot;
  readonly amount: number;
}

export interface HideCardInput {
  readonly card: ObjectSnapshot;
  /** Expanded production abilities used as authoritative Hide permission. */
  readonly abilities?: readonly Ability[];
  /** Optional trusted current-source lookup. */
  readonly source?: ObjectSnapshot | null;
  readonly player: PlayerId;
  readonly battlefieldId: string;
  readonly turn?: number;
  readonly openState?: boolean;
  readonly capacityRuleSource?: HiddenCapacityRuleSource;
}

export interface HideCardResult {
  readonly state: HiddenState;
  readonly card: HiddenCard;
  readonly transition: HiddenZoneTransition;
}

export interface CapacityChangeResult {
  readonly state: HiddenState;
  readonly discarded: readonly HiddenCard[];
  readonly transitions: readonly HiddenZoneTransition[];
}

export interface ControlChangeResult { readonly state: HiddenState; }

const EMPTY: readonly never[] = Object.freeze([]);

function fail(code: HiddenZoneErrorCode, message: string): never {
  throw new HiddenZoneError(code, message);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('invalid-state', `${label} must be a non-empty string`);
  return value;
}

function player(value: unknown, label: string): string { return text(value, label); }

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('invalid-state', `${label} must be a non-negative safe integer`);
  return value as number;
}

function capacity(value: unknown, label: string): number {
  return safeInteger(value, label);
}

function cloneRef(ref: ObjectRef): ObjectRef { return { id: ref.id, zoneEntryId: ref.zoneEntryId }; }
export function hiddenRefKey(ref: ObjectRef): string { return `${ref.id}:${ref.zoneEntryId}`; }

function cloneCard(card: HiddenCard): HiddenCard { return { ...card, ref: cloneRef(card.ref) }; }
function cloneZone(zone: FacedownZone): FacedownZone {
  return { ...zone, cards: zone.cards.map(cloneCard) };
}

function cloneState(state: HiddenState): HiddenState {
  return {
    turn: state.turn,
    zones: Object.fromEntries(Object.entries(state.zones).map(([id, zone]) => [id, cloneZone(zone)])),
    pendingControlLoss: [...state.pendingControlLoss],
    playedFromHidden: Object.fromEntries(Object.entries(state.playedFromHidden).map(([key, value]) => [key, {
      ...value,
      ref: cloneRef(value.ref)
    }]))
  };
}

function assertCard(card: HiddenCard, label: string): void {
  if (!card || typeof card !== 'object' || Array.isArray(card) || !card.ref || typeof card.ref !== 'object') {
    fail('invalid-state', `${label} must be a Hidden card object`);
  }
  text(card.ref.id, `${label}.ref.id`);
  safeInteger(card.ref.zoneEntryId, `${label}.ref.zoneEntryId`);
  player(card.owner, `${label}.owner`);
  player(card.controller, `${label}.controller`);
  if (!['spell', 'unit', 'gear'].includes(card.kind)) fail('invalid-state', `${label}.kind is not a Hidden card kind`);
  if (!['hand', 'champion-zone'].includes(card.originZone)) fail('invalid-state', `${label}.originZone is invalid`);
  text(card.battlefieldId, `${label}.battlefieldId`);
  safeInteger(card.hiddenTurn, `${label}.hiddenTurn`);
}

/** Validate a Hidden sidecar without trusting a caller-supplied object graph. */
export function assertHiddenState(state: HiddenState): void {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) fail('invalid-state', 'Hidden state must be an object');
  safeInteger(state.turn, 'state.turn');
  if (state.zones === null || typeof state.zones !== 'object' || Array.isArray(state.zones)) fail('invalid-state', 'state.zones must be a record');
  if (!Array.isArray(state.pendingControlLoss) || !Array.isArray(Object.keys(state.zones))) fail('invalid-state', 'Hidden state collections are invalid');
  if (new Set(state.pendingControlLoss).size !== state.pendingControlLoss.length) fail('invalid-state', 'duplicate pending control loss');
  for (const battlefieldId of state.pendingControlLoss) {
    text(battlefieldId, 'pendingControlLoss id');
    if (!Object.hasOwn(state.zones, battlefieldId)) fail('invalid-state', `pending control loss names unknown Battlefield ${battlefieldId}`);
  }
  const refs = new Set<string>();
  for (const [id, zone] of Object.entries(state.zones)) {
    text(id, 'zone id');
    if (zone === null || typeof zone !== 'object' || Array.isArray(zone)) fail('invalid-state', `zone ${id} must be an object`);
    if (zone.battlefieldId !== id) fail('invalid-state', `zone ${id} has a mismatched battlefield id`);
    if (zone.controller !== null) player(zone.controller, `zone ${id}.controller`);
    capacity(zone.capacity, `zone ${id}.capacity`);
    if (!Array.isArray(zone.cards)) fail('invalid-state', `zone ${id}.cards must be an array`);
    for (const [index, card] of zone.cards.entries()) {
      assertCard(card, `zone ${id}.cards[${index}]`);
      if (card.battlefieldId !== id) fail('invalid-state', `card ${card.ref.id} is in the wrong Facedown Zone`);
      const key = hiddenRefKey(card.ref);
      if (refs.has(key)) fail('invalid-state', `duplicate Hidden card reference ${key}`);
      refs.add(key);
    }
  }
  if (state.playedFromHidden === null || typeof state.playedFromHidden !== 'object' || Array.isArray(state.playedFromHidden)) fail('invalid-state', 'state.playedFromHidden must be a record');
  for (const [key, card] of Object.entries(state.playedFromHidden)) {
    if (!card || typeof card !== 'object' || Array.isArray(card) || !card.ref || typeof card.ref !== 'object') {
      fail('invalid-state', `playedFromHidden.${key} must be a played Hidden card object`);
    }
    if (key !== hiddenRefKey(card.ref)) fail('invalid-state', `played Hidden key ${key} does not match its reference`);
    assertCard({ ...card, originZone: 'hand' }, `playedFromHidden.${key}`);
    safeInteger(card.playedTurn, `playedFromHidden.${key}.playedTurn`);
    if (card.playedTurn < card.hiddenTurn) fail('invalid-state', `played Hidden card ${key} was played before it was hidden`);
    if (refs.has(key)) fail('invalid-state', `Hidden card ${key} is both facedown and played`);
  }
}

export function createHiddenState(
  battlefields: readonly HiddenBattlefieldInput[] = [],
  turn = 0
): HiddenState {
  safeInteger(turn, 'turn');
  if (!Array.isArray(battlefields)) fail('invalid-state', 'battlefields must be an array');
  const zones: Record<string, FacedownZone> = {};
  for (const [index, input] of battlefields.entries()) {
    const battlefieldId = text(input.battlefieldId, `battlefields[${index}].battlefieldId`);
    if (zones[battlefieldId]) fail('invalid-state', `duplicate Battlefield ${battlefieldId}`);
    const max = capacity(input.capacity ?? 1, `battlefields[${index}].capacity`);
    zones[battlefieldId] = { battlefieldId, controller: input.controller ?? null, capacity: max, cards: [] };
  }
  const state: HiddenState = { turn, zones, pendingControlLoss: [], playedFromHidden: {} };
  assertHiddenState(state);
  return cloneState(state);
}

/** CR 107.3.b.1: resolve the named battlefield-scoped occupancy adjustments. */
export function hiddenCapacityFor(
  zone: FacedownZone,
  source: HiddenCapacityRuleSource
): number {
  if (!source || typeof source !== 'object' || Array.isArray(source) || !source.battlefield) {
    throw new HiddenZoneError('invalid-state', 'Hidden capacity requires an authoritative Battlefield snapshot');
  }
  if (source.battlefield.ref.id !== zone.battlefieldId || source.battlefield.zone !== 'board' ||
      !source.battlefield.types.some(type => type.toLowerCase() === 'battlefield')) {
    throw new HiddenZoneError('invalid-state', 'Facedown Zone does not match its Battlefield');
  }
  if (source.registry === undefined) return zone.capacity;
  let capacityValue = zone.capacity;
  for (const rule of restrictions(source.registry, 'hide', source.battlefield.ref, source.battlefield, source.battlefield.controller)) {
    if (rule.name !== 'facedown-zone-maximum-occupancy') continue;
    if (!Number.isSafeInteger(rule.amount)) throw new HiddenZoneError('judge-required', 'Facedown capacity adjustment requires a resolved integer');
    capacityValue += rule.amount!;
    if (!Number.isSafeInteger(capacityValue) || capacityValue < 0) {
      throw new HiddenZoneError('invalid-state', 'Facedown capacity is outside the supported range');
    }
  }
  return capacityValue;
}

/** Translate the production static restriction into the Hide rule query. */
export function registerHiddenCapacityRule(
  registry: ContinuousEffectRegistry,
  input: HiddenCapacityRuleRegistration
): { readonly unbind: () => void } {
  if (!registry || typeof registry.register !== 'function') throw new HiddenZoneError('invalid-state', 'A ContinuousEffectRegistry is required');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HiddenZoneError('invalid-state', 'Capacity rule input is required');
  text(input.id, 'capacity rule id');
  if (!input.battlefield || typeof input.battlefield !== 'object' || input.battlefield.zone !== 'board' ||
      !input.battlefield.types.some(type => type.toLowerCase() === 'battlefield')) {
    throw new HiddenZoneError('invalid-state', 'Capacity rule requires a Board Battlefield');
  }
  if (!Number.isSafeInteger(input.amount)) throw new HiddenZoneError('judge-required', 'Capacity rule amount must be a resolved integer');
  const effect = {
    id: input.id,
    layer: 'ability' as const,
    source: input.battlefield.ref,
    filter: { objectId: input.battlefield.ref.id, zoneEntryId: input.battlefield.ref.zoneEntryId },
    effect: {
      kind: 'restriction',
      restriction: 'facedown-zone-maximum-occupancy',
      amount: input.amount,
      actions: ['hide']
    }
  };
  registry.register(effect, { type: 'permanent' });
  return { unbind: () => { registry.remove(input.id); } };
}

/** Adopt persisted sidecar data after applying the same strict shape checks. */
export function restoreHiddenState(state: HiddenState): HiddenState {
  assertHiddenState(state);
  return cloneState(state);
}

export function getFacedownZone(state: HiddenState, battlefieldId: string): FacedownZone {
  assertHiddenState(state);
  const id = text(battlefieldId, 'battlefieldId');
  const zone = state.zones[id];
  if (!zone) fail('unknown-battlefield', `Unknown Battlefield ${id}`);
  return cloneZone(zone);
}

export function setTurn(state: HiddenState, turn: number): HiddenState {
  assertHiddenState(state);
  safeInteger(turn, 'turn');
  if (turn < state.turn) fail('invalid-turn', `Turn cannot move backwards from ${state.turn} to ${turn}`);
  return cloneState({ ...state, turn });
}

export function setBattlefieldController(
  state: HiddenState,
  battlefieldId: string,
  controller: PlayerId | null
): ControlChangeResult {
  assertHiddenState(state);
  const zone = getFacedownZone(state, battlefieldId);
  if (controller !== null) player(controller, 'controller');
  const pending = new Set(state.pendingControlLoss);
  if (zone.controller !== null && zone.controller !== controller && zone.cards.length > 0) pending.add(zone.battlefieldId);
  const nextZones = { ...state.zones, [zone.battlefieldId]: { ...zone, controller } };
  const next: HiddenState = { ...state, zones: nextZones, pendingControlLoss: [...pending] };
  assertHiddenState(next);
  return { state: cloneState(next) };
}

export function setFacedownCapacity(
  state: HiddenState,
  battlefieldId: string,
  nextCapacity: number,
  chooseOverflow?: (cards: readonly HiddenCard[], count: number) => readonly ObjectRef[]
): CapacityChangeResult {
  assertHiddenState(state);
  const zone = getFacedownZone(state, battlefieldId);
  const max = capacity(nextCapacity, 'capacity');
  if (max >= zone.cards.length) {
    const next = { ...state, zones: { ...state.zones, [zone.battlefieldId]: { ...zone, capacity: max } } };
    assertHiddenState(next);
    return { state: cloneState(next), discarded: [], transitions: [] };
  }
  const count = zone.cards.length - max;
  const chosen = chooseOverflow === undefined ? undefined : chooseOverflow(zone.cards.map(cloneCard), count);
  if (chosen !== undefined && (!Array.isArray(chosen) || chosen.some(ref => !ref || typeof ref !== 'object' || Array.isArray(ref)))) {
    fail('capacity-invalid', 'Capacity overflow selection must contain ObjectRefs');
  }
  const selected = chosen === undefined
    ? count === 1 ? [zone.cards[zone.cards.length - 1]!.ref] : fail('capacity-choice-required', `Reducing ${zone.battlefieldId} capacity requires choosing ${count} cards`)
    : chosen;
  if (selected.some(ref => { text(ref?.id, 'overflow ref.id'); safeInteger(ref?.zoneEntryId, 'overflow ref.zoneEntryId'); return false; })) {
    fail('capacity-invalid', 'Capacity overflow selection contains a malformed reference');
  }
  if (selected.length !== count || new Set(selected.map(hiddenRefKey)).size !== count) fail('capacity-invalid', 'Capacity overflow selection must be an exact set');
  const selectedKeys = new Set(selected.map(hiddenRefKey));
  const discarded = zone.cards.filter(card => selectedKeys.has(hiddenRefKey(card.ref)));
  if (discarded.length !== count) fail('capacity-invalid', 'Capacity overflow selection contains an unknown card');
  const remaining = zone.cards.filter(card => !selectedKeys.has(hiddenRefKey(card.ref)));
  const next = { ...state, zones: { ...state.zones, [zone.battlefieldId]: { ...zone, capacity: max, cards: remaining } } };
  assertHiddenState(next);
  const transitions = discarded.map(card => transition('capacity-decrease', card, 'facedown', 'trash', zone.battlefieldId, zone.controller ?? card.controller, false, true));
  return { state: cloneState(next), discarded: discarded.map(cloneCard), transitions };
}

function kindOf(snapshot: ObjectSnapshot): HiddenCardKind {
  const kinds = new Set(snapshot.types.map(type => type.toLowerCase()));
  if (kinds.has('spell')) return 'spell';
  if (kinds.has('unit')) return 'unit';
  if (kinds.has('gear')) return 'gear';
  fail('not-hidden-card', `Object ${snapshot.ref.id} is not a Spell, Unit, or Gear`);
}

function hiddenPermission(snapshot: ObjectSnapshot, abilities: readonly Ability[] | undefined): 'present' | 'absent' | 'judge-required' {
  if (snapshot.faceDown) return 'absent';
  if (snapshot.keywords.some(keyword => keyword.id.toLowerCase().replace(/[\s_-]+/g, '') === 'hidden')) return 'present';
  const staticHidden = abilities?.flatMap(ability =>
    ability.kind === 'static' && ability.effect.kind === 'cost.hidden' ? [ability] : []
  ) ?? [];
  if (staticHidden.some(ability => ability.condition === undefined)) return 'present';
  return staticHidden.length > 0 ? 'judge-required' : 'absent';
}

function originZone(snapshot: ObjectSnapshot): HiddenOriginZone {
  const zone = (snapshot as unknown as { readonly zone: string }).zone;
  if (zone === 'hand') return 'hand';
  // Champion Zone is intentionally not in the legacy ZoneId union.  Read it
  // structurally so old profiles remain valid while the additive contract can
  // carry the new zone name.
  if (zone === 'champion-zone' || zone === 'champion') return 'champion-zone';
  fail('invalid-origin', `Hidden can only begin in Hand or Champion Zone (got ${zone})`);
}

function transition(
  reason: HiddenTransitionReason,
  card: HiddenCard,
  from: HiddenZoneTransition['from'],
  to: HiddenZoneTransition['to'],
  battlefieldId: string,
  playerId: PlayerId,
  opensChain: boolean,
  revealsToAll: boolean
): HiddenZoneTransition {
  return { reason, object: cloneRef(card.ref), from, to, battlefieldId, player: playerId, opensChain, revealsToAll };
}

/** Apply the 811.1.b Hide action to the Hidden sidecar. */
export function hideCard(state: HiddenState, input: HideCardInput): HideCardResult {
  assertHiddenState(state);
  const card = input.source === undefined ? input.card : input.source;
  if (input.source !== undefined && input.source !== null &&
      (input.source.ref.id !== input.card.ref.id || input.source.ref.zoneEntryId !== input.card.ref.zoneEntryId)) {
    fail('stale-reference', 'The Hide source no longer matches the selected card identity');
  }
  if (input.source === null) fail('stale-reference', 'The Hide source is no longer current');
  if (!card || typeof card !== 'object' || Array.isArray(card)) fail('invalid-state', 'card must be an ObjectSnapshot');
  text(card.ref?.id, 'card.ref.id');
  safeInteger(card.ref?.zoneEntryId, 'card.ref.zoneEntryId');
  if (!Array.isArray(card.types) || !Array.isArray(card.keywords)) fail('invalid-state', 'card characteristics must be arrays');
  const zone = getFacedownZone(state, input.battlefieldId);
  const turn = input.turn ?? state.turn;
  safeInteger(turn, 'hide turn');
  if (turn !== state.turn) fail('invalid-turn', `Hide must use current turn ${state.turn}`);
  if (input.openState !== true) fail('closed-state', 'Hide requires an authoritative Open State');
  const origin = originZone(card);
  const permission = hiddenPermission(card, input.abilities);
  if (permission === 'judge-required') fail('judge-required', 'Conditional Hidden permission requires authoritative condition evaluation');
  if (permission === 'absent') fail('not-hidden-card', `Object ${card.ref.id} does not have Hidden while face-up`);
  if (card.controller !== input.player) fail('not-controller', 'Only the card controller may Hide it');
  if (zone.controller !== input.player) fail('not-controller', 'The player must control the destination Battlefield');
  const maximum = input.capacityRuleSource === undefined ? zone.capacity : hiddenCapacityFor(zone, input.capacityRuleSource);
  if (zone.cards.length >= maximum) fail('occupied', `Facedown Zone ${zone.battlefieldId} is full`);
  const key = hiddenRefKey(card.ref);
  if (Object.hasOwn(state.playedFromHidden, key) || Object.values(state.zones).some(candidate => candidate.cards.some(item => hiddenRefKey(item.ref) === key))) {
    fail('already-played', `Object ${key} already has Hidden state`);
  }
  const hidden: HiddenCard = {
    ref: cloneRef(card.ref), owner: card.owner, controller: card.controller,
    kind: kindOf(card), originZone: origin, battlefieldId: zone.battlefieldId, hiddenTurn: turn
  };
  const next: HiddenState = {
    ...state,
    zones: { ...state.zones, [zone.battlefieldId]: { ...zone, cards: [...zone.cards, hidden] } }
  };
  assertHiddenState(next);
  return {
    state: cloneState(next),
    card: cloneCard(hidden),
    transition: transition('hide', hidden, origin, 'facedown', zone.battlefieldId, input.player, false, false)
  };
}

/** Return the exact Hidden card for a current reference, if it is facedown. */
export function findHiddenCard(state: HiddenState, ref: ObjectRef): HiddenCard | null {
  assertHiddenState(state);
  text(ref?.id, 'ref.id');
  safeInteger(ref?.zoneEntryId, 'ref.zoneEntryId');
  const key = hiddenRefKey(ref);
  for (const zone of Object.values(state.zones)) {
    const card = zone.cards.find(candidate => hiddenRefKey(candidate.ref) === key);
    if (card) return cloneCard(card);
  }
  return null;
}

export function findPlayedFromHidden(state: HiddenState, ref: ObjectRef): PlayedFromHidden | null {
  assertHiddenState(state);
  text(ref?.id, 'ref.id');
  safeInteger(ref?.zoneEntryId, 'ref.zoneEntryId');
  const card = state.playedFromHidden[hiddenRefKey(ref)];
  return card ? { ...card, ref: cloneRef(card.ref) } : null;
}

/** Mark a battlefield's Hidden cards for 107.3.d next-Cleanup recovery. */
export function markControlLoss(state: HiddenState, battlefieldId: string): HiddenState {
  assertHiddenState(state);
  const zone = getFacedownZone(state, battlefieldId);
  if (zone.cards.length === 0) return cloneState(state);
  if (state.pendingControlLoss.includes(zone.battlefieldId)) return cloneState(state);
  return cloneState({ ...state, pendingControlLoss: [...state.pendingControlLoss, zone.battlefieldId] });
}

export function emptyTransitions(): readonly HiddenZoneTransition[] { return EMPTY as readonly HiddenZoneTransition[]; }

