import type { LocationRef, ObjectRef, ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import {
  assertHiddenState,
  findHiddenCard,
  findPlayedFromHidden,
  hiddenRefKey,
  HiddenZoneError,
} from './state.js';
import type {
  HiddenCardKind,
  FacedownZone,
  HiddenPlayProvenance,
  HiddenTargetScope,
  HiddenTransitionReason,
  HiddenZoneTransition,
  HiddenState,
  PlayedFromHidden,
} from './types.js';

export interface HiddenPlayTarget {
  readonly ref: ObjectRef;
  readonly location: LocationRef | null;
}

export interface HiddenPlayInput {
  readonly object: ObjectRef;
  /** Optional trusted current object; null rejects a source that left Hidden. */
  readonly source?: ObjectSnapshot | null;
  readonly player: PlayerId;
  readonly turn?: number;
  /** Units and Gear must name the Battlefield destination. Spells may omit it. */
  readonly destinationBattlefieldId?: string;
  readonly targets?: readonly HiddenPlayTarget[];
  /** Set when the printed spell/play effect requires at least one target. */
  readonly requiresTargets?: boolean;
  /** Targets whose printed text independently proves an 811.1.d.4 exception. */
  readonly explicitTargetExceptions?: readonly ObjectRef[];
}

export interface HiddenPlayResult {
  readonly state: HiddenState;
  readonly provenance: HiddenPlayProvenance;
  readonly transition: HiddenZoneTransition;
  readonly cardKind: HiddenCardKind;
  readonly destination: 'chain' | 'battlefield';
}

export interface HiddenPlayDestination {
  readonly kind: 'chain' | 'battlefield';
  readonly battlefieldId?: string;
}

function fail(code: ConstructorParameters<typeof HiddenZoneError>[0], message: string): never {
  throw new HiddenZoneError(code, message);
}

function safeTurn(turn: number): void {
  if (!Number.isSafeInteger(turn) || turn < 0) fail('invalid-turn', 'Hidden play turn must be a non-negative safe integer');
}

function cloneRef(ref: ObjectRef): ObjectRef { return { id: ref.id, zoneEntryId: ref.zoneEntryId }; }

function cloneTransition(transition: HiddenZoneTransition): HiddenZoneTransition {
  return { ...transition, object: cloneRef(transition.object) };
}

function transition(reason: HiddenTransitionReason, card: PlayedFromHidden): HiddenZoneTransition {
  return {
    reason,
    object: cloneRef(card.ref),
    from: 'facedown',
    // A card played from facedown always enters the public Chain first. The
    // permanent reaches the Board only after Chain resolution, so both card
    // kinds use the same transition destination here.
    to: 'chain',
    battlefieldId: card.battlefieldId,
    player: card.controller,
    opensChain: true,
    revealsToAll: true
  };
}

function copyStateWithPlayed(state: HiddenState, card: PlayedFromHidden): HiddenState {
  const key = hiddenRefKey(card.ref);
  const next: HiddenState = {
    ...state,
    zones: Object.fromEntries((Object.entries(state.zones) as readonly [string, FacedownZone][]).map(([id, zone]) => [id, {
      ...zone,
      cards: zone.cards.filter(candidate => hiddenRefKey(candidate.ref) !== key)
    }])),
    playedFromHidden: { ...state.playedFromHidden, [key]: { ...card, ref: cloneRef(card.ref) } }
  };
  assertHiddenState(next);
  return next;
}

function kindFromSnapshot(snapshot: ObjectSnapshot): HiddenCardKind {
  const kinds = new Set(snapshot.types.map(type => type.toLowerCase()));
  if (kinds.has('spell')) return 'spell';
  if (kinds.has('unit')) return 'unit';
  if (kinds.has('gear')) return 'gear';
  fail('not-hidden-card', `Object ${snapshot.ref.id} is not a Spell, Unit, or Gear`);
}

function targetScope(card: PlayedFromHidden): HiddenTargetScope {
  const explicit = (card.explicitTargetExceptions ?? []).map(cloneRef);
  return {
    battlefieldId: card.battlefieldId,
    bypassedByExplicitRestriction: explicit.length > 0,
    explicitTargetExceptions: explicit
  };
}

function targetAtBattlefield(target: HiddenPlayTarget, battlefieldId: string): boolean {
  if (!target || typeof target !== 'object' || Array.isArray(target) || !target.ref || typeof target.ref !== 'object') {
    fail('invalid-target', 'A Hidden target must contain an ObjectRef and LocationRef');
  }
  return target.location?.type === 'battlefield' && target.location.id === battlefieldId;
}

/**
 * Test the 811.1.d Battlefield restriction for a single target.  A caller
 * must pass the source provenance retained on the Chain, rather than reading
 * a mutable current location from the card after it has moved.
 */
export function isHiddenTargetLegal(
  provenance: Pick<HiddenPlayProvenance, 'targetScope'>,
  target: HiddenPlayTarget
): boolean {
  if (!target || typeof target !== 'object' || Array.isArray(target) || !target.ref || typeof target.ref !== 'object') return false;
  return targetAtBattlefield(target, provenance.targetScope.battlefieldId) ||
    provenance.targetScope.explicitTargetExceptions.some(ref =>
      ref.id === target.ref.id && ref.zoneEntryId === target.ref.zoneEntryId
    );
}

export function hiddenTargetScope(
  provenance: Pick<HiddenPlayProvenance, 'targetScope'>
): HiddenTargetScope {
  return { ...provenance.targetScope };
}

/** True when the card's Hidden Reaction permission is active for this turn. */
export function isHiddenReactionUnlocked(hiddenTurn: number, currentTurn: number): boolean {
  safeTurn(hiddenTurn);
  safeTurn(currentTurn);
  return currentTurn > hiddenTurn;
}

/** Build the chain-scoped Reaction grant without exposing the facedown card. */
export function hiddenReactionTiming(provenance: Pick<HiddenPlayProvenance, 'reactionUnlocked'>): 'reaction' | null {
  if (!provenance || typeof provenance !== 'object' || typeof provenance.reactionUnlocked !== 'boolean') {
    fail('invalid-state', 'Hidden provenance must declare whether Reaction is unlocked');
  }
  return provenance.reactionUnlocked ? 'reaction' : null;
}

export function canPlayFromHidden(state: HiddenState, input: HiddenPlayInput): boolean {
  try {
    planPlayFromHidden(state, input);
    return true;
  } catch (error) {
    if (error instanceof HiddenZoneError) return false;
    throw error;
  }
}

/**
 * Build and apply a real Hidden play transition.  The card is removed from
 * its Facedown Zone and retained in `playedFromHidden` until the caller clears
 * the Chain/play-effect provenance.  Entering the Chain is public and opens a
 * Chain item (CR 811.1.c.3); the live object movement is performed by the
 * canonical engine using the returned transition.
 */
export function playFromHidden(state: HiddenState, input: HiddenPlayInput): HiddenPlayResult {
  const plan = planPlayFromHidden(state, input);
  const next = copyStateWithPlayed(state, plan.played);
  const destination = plan.played.kind === 'spell' ? 'chain' : 'battlefield';
  const transitionResult = transition('play-from-hidden', plan.played);
  return {
    state: next,
    provenance: {
      object: cloneRef(plan.played.ref),
      battlefieldId: plan.played.battlefieldId,
      playedTurn: plan.played.playedTurn,
      reactionUnlocked: plan.played.reactionUnlocked,
      targetScope: targetScope(plan.played)
    },
    transition: cloneTransition(transitionResult),
    cardKind: plan.played.kind,
    destination
  };
}

interface PlayPlan { readonly played: PlayedFromHidden; readonly state: HiddenState; }

function planPlayFromHidden(state: HiddenState, input: HiddenPlayInput): PlayPlan {
  assertHiddenState(state);
  const hidden = findHiddenCard(state, input.object);
  if (!hidden) {
    if (findPlayedFromHidden(state, input.object)) fail('already-played', 'The card has already left its Facedown Zone');
    fail('unknown-card', `Object ${input.object.id}:${input.object.zoneEntryId} is not in a Facedown Zone`);
  }
  if (hidden.controller !== input.player) fail('not-controller', 'Only the Hidden card controller may play it');
  if (input.source === null) fail('stale-reference', 'The Hidden source is no longer current');
  if (input.source !== undefined && (input.source.ref.id !== hidden.ref.id || input.source.ref.zoneEntryId !== hidden.ref.zoneEntryId)) {
    fail('stale-reference', 'The current object no longer matches the Hidden card identity');
  }
  const turn = input.turn ?? state.turn;
  safeTurn(turn);
  if (turn !== state.turn) fail('invalid-turn', `Hidden play must use current turn ${state.turn}`);
  if (!isHiddenReactionUnlocked(hidden.hiddenTurn, turn)) fail('not-unlocked', 'A Hidden card gains Reaction beginning on the next turn');
  if (hidden.kind !== 'spell' && input.destinationBattlefieldId !== hidden.battlefieldId) {
    fail('invalid-destination', 'A Hidden permanent must be played to its hiding Battlefield');
  }
  if (input.requiresTargets === true && (input.targets === undefined || input.targets.length === 0)) {
    fail('invalid-target', 'A Hidden card with required targets has no legal target selection');
  }
  const exceptions = input.explicitTargetExceptions ?? [];
  if (exceptions.some((ref, index) => exceptions.findIndex(candidate =>
    candidate.id === ref.id && candidate.zoneEntryId === ref.zoneEntryId) !== index)) {
    fail('invalid-target', 'Each explicit Hidden target exception must be unique');
  }
  for (const ref of exceptions) {
    if (!input.targets?.some(target => target.ref.id === ref.id && target.ref.zoneEntryId === ref.zoneEntryId)) {
      fail('invalid-target', 'An explicit Hidden target exception must name a selected target');
    }
  }
  if (input.targets !== undefined && input.targets.length > 0) {
    const exceptional = new Set(exceptions.map(ref => `${ref.id}:${ref.zoneEntryId}`));
    if (!input.targets.every(target => exceptional.has(`${target.ref.id}:${target.ref.zoneEntryId}`) ||
        targetAtBattlefield(target, hidden.battlefieldId))) {
      fail('invalid-target', 'Each Hidden target needs battlefield scope or its own printed exception');
    }
  }
  // An empty target set is a legal no-target spell.  A caller that knows the
  // printed spell requires targets must reject before calling this helper when
  // no legal target exists; the sidecar cannot invent that card-specific fact.
  const played: PlayedFromHidden = {
    ref: cloneRef(hidden.ref), owner: hidden.owner, controller: hidden.controller,
    kind: hidden.kind, battlefieldId: hidden.battlefieldId, hiddenTurn: hidden.hiddenTurn,
    playedTurn: turn, reactionUnlocked: true,
    ...(exceptions.length > 0 ? {
      bypassedByExplicitRestriction: true,
      explicitTargetExceptions: exceptions.map(cloneRef)
    } : {})
  };
  return { state, played };
}

/** Remove a retained source record after its Chain item and play effects finish. */
export function clearHiddenProvenance(state: HiddenState, ref: ObjectRef): HiddenState {
  assertHiddenState(state);
  const key = hiddenRefKey(ref);
  if (!Object.hasOwn(state.playedFromHidden, key)) return state;
  const played = { ...state.playedFromHidden };
  delete played[key];
  const next = { ...state, playedFromHidden: played };
  assertHiddenState(next);
  return next;
}

/** Return the active retained provenance for a card on the Chain. */
export function playedFromHidden(state: HiddenState, ref: ObjectRef): HiddenPlayProvenance | null {
  const card = findPlayedFromHidden(state, ref);
  if (!card) return null;
  return {
    object: cloneRef(card.ref), battlefieldId: card.battlefieldId,
    playedTurn: card.playedTurn, reactionUnlocked: card.reactionUnlocked,
    targetScope: targetScope(card)
  };
}

