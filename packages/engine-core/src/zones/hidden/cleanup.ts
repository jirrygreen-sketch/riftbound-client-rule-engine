import type { PlayerId } from '../../effects/contract.js';
import {
  assertHiddenState,
  getFacedownZone,
  HiddenZoneError,
} from './state.js';
import type { FacedownZone, HiddenCard, HiddenState, HiddenZoneTransition } from './types.js';

export interface HiddenCleanupResult {
  readonly state: HiddenState;
  readonly discarded: readonly HiddenCard[];
  readonly transitions: readonly HiddenZoneTransition[];
}

function cloneRef(ref: { readonly id: string; readonly zoneEntryId: number }) {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function key(ref: { readonly id: string; readonly zoneEntryId: number }): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function transition(card: HiddenCard, player: PlayerId, reason: 'control-loss-cleanup'): HiddenZoneTransition {
  return {
    reason,
    object: cloneRef(card.ref),
    owner: card.owner,
    from: 'facedown',
    to: 'trash',
    battlefieldId: card.battlefieldId,
    player,
    opensChain: false,
    revealsToAll: true
  };
}

/**
 * Resolve the next-Cleanup part of 107.3.d.  The caller supplies the
 * battlefield control snapshot from the canonical board; this module never
 * infers control from the Hidden card owner.
 */
export function cleanupLostControl(
  state: HiddenState,
  battlefieldControllers: Readonly<Record<string, PlayerId | null>>
): HiddenCleanupResult {
  assertHiddenState(state);
  if (battlefieldControllers === null || typeof battlefieldControllers !== 'object' || Array.isArray(battlefieldControllers)) {
    throw new HiddenZoneError('invalid-state', 'battlefieldControllers must be a record');
  }
  const lost = new Set<string>();
  for (const battlefieldId of state.pendingControlLoss) {
    // The marker records that control was lost during this turn.  It remains
    // authoritative through Cleanup even if the Battlefield changes hands
    // again before Cleanup (107.3.d says the cards are removed during the
    // next Cleanup after the loss).
    const zone = getFacedownZone(state, battlefieldId);
    const currentController = battlefieldControllers[battlefieldId];
    if (currentController === undefined) {
      throw new HiddenZoneError('invalid-state', `Missing Battlefield controller for ${battlefieldId}`);
    }
    if (currentController !== null) {
      textPlayer(currentController, `battlefieldControllers.${battlefieldId}`);
    }
    // The sidecar's controller is the last canonical snapshot at the control
    // change. 107.3.d keys the recovery to that recorded loss; a later
    // controller value cannot cancel the next-Cleanup obligation.
    if (zone.cards.length > 0) {
      // A pending marker can only be created by setBattlefieldController's
      // actual control change; keep it authoritative even if the caller passes
      // the pre-change value again. The marker itself is the event record.
      lost.add(battlefieldId);
    }
  }
  if (lost.size === 0) {
    const next = { ...state, pendingControlLoss: state.pendingControlLoss.filter(id => !state.zones[id] || state.zones[id]!.cards.length === 0) };
    assertHiddenState(next);
    return { state: next, discarded: [], transitions: [] };
  }
  const discarded: HiddenCard[] = [];
  const transitions: HiddenZoneTransition[] = [];
  const zones = Object.fromEntries((Object.entries(state.zones) as readonly [string, FacedownZone][]).map(([id, zone]) => {
    if (!lost.has(id)) return [id, zone];
    for (const card of zone.cards) {
      discarded.push({ ...card, ref: cloneRef(card.ref) });
      transitions.push(transition(card, card.controller, 'control-loss-cleanup'));
    }
    return [id, { ...zone, cards: [] }];
  }));
  const next: HiddenState = {
    ...state,
    zones,
    pendingControlLoss: state.pendingControlLoss.filter(id => !lost.has(id))
  };
  assertHiddenState(next);
  return { state: next, discarded, transitions };
}

function textPlayer(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HiddenZoneError('invalid-state', `${label} must be a player id or null`);
  }
}

/**
 * Clear empty pending-control markers at Cleanup without touching cards. This
 * is useful when a control change was recorded after the Facedown Zone was
 * already emptied by a play.
 */
export function clearEmptyControlLossMarkers(state: HiddenState): HiddenState {
  assertHiddenState(state);
  const next = {
    ...state,
    pendingControlLoss: state.pendingControlLoss.filter(id => state.zones[id]?.cards.length !== 0)
  };
  assertHiddenState(next);
  return next;
}

export function hiddenZoneOccupancy(state: HiddenState, battlefieldId: string): number {
  return getFacedownZone(state, battlefieldId).cards.length;
}

export function hiddenZoneCapacity(state: HiddenState, battlefieldId: string): number {
  return getFacedownZone(state, battlefieldId).capacity;
}

