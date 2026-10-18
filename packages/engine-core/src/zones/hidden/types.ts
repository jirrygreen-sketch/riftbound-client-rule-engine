import type { ObjectRef, PlayerId } from '../../effects/contract.js';

/** Zones from which CR 811.1.b permits a card to be Hidden. */
export type HiddenOriginZone = 'hand' | 'champion-zone';

/** The three card kinds on which the Hidden keyword may appear. */
export type HiddenCardKind = 'spell' | 'unit' | 'gear';

/** A card stored in a Battlefield's Facedown Zone.
 *
 * Facedown Zones are sub-zones of a Battlefield, not Locations (CR 107.3.e).
 * `battlefieldId` is therefore provenance, rather than a replacement for an
 * ObjectSnapshot location.  It remains attached to the card after it enters
 * the Chain so 811.1.d.3.a can resolve the original battlefield later.
 */
export interface HiddenCard {
  readonly ref: ObjectRef;
  readonly owner: PlayerId;
  readonly controller: PlayerId;
  readonly kind: HiddenCardKind;
  readonly originZone: HiddenOriginZone;
  readonly battlefieldId: string;
  readonly hiddenTurn: number;
}

/** One logical Facedown Zone associated with one Battlefield (CR 107.3.a). */
export interface FacedownZone {
  readonly battlefieldId: string;
  readonly controller: PlayerId | null;
  readonly capacity: number;
  readonly cards: readonly HiddenCard[];
}

/** A retained source record for a card that left Hidden and entered the Chain.
 *
 * The record is deliberately separate from the live card snapshot.  The card
 * is public once it is on the Chain, but its original Hidden battlefield still
 * governs target legality until the play effect has finished (CR 811.1.d.3.a).
 */
export interface PlayedFromHidden {
  readonly ref: ObjectRef;
  readonly owner: PlayerId;
  readonly controller: PlayerId;
  readonly kind: HiddenCardKind;
  readonly battlefieldId: string;
  readonly hiddenTurn: number;
  readonly playedTurn: number;
  readonly reactionUnlocked: boolean;
  /** Proven card-text exception to 811.1.d.2/.3, when one was established. */
  readonly bypassedByExplicitRestriction?: boolean;
  /** Per-target card-text exceptions required by 811.1.d.4. */
  readonly explicitTargetExceptions?: readonly ObjectRef[];
}

/**
 * Hidden state is an additive sidecar.  It does not duplicate the engine's
 * object or zone authority; callers apply the returned transitions to their
 * canonical store and keep this record for Hidden-specific legality/provenance.
 */
export interface HiddenState {
  readonly turn: number;
  readonly zones: Readonly<Record<string, FacedownZone>>;
  readonly pendingControlLoss: readonly string[];
  readonly playedFromHidden: Readonly<Record<string, PlayedFromHidden>>;
}

export type HiddenTransitionReason =
  | 'hide'
  | 'play-from-hidden'
  | 'capacity-decrease'
  | 'control-loss-cleanup';

export interface HiddenZoneTransition {
  readonly reason: HiddenTransitionReason;
  readonly object: ObjectRef;
  readonly from: HiddenOriginZone | 'facedown';
  readonly to: 'facedown' | 'chain' | 'trash';
  readonly battlefieldId: string;
  readonly player: PlayerId;
  readonly opensChain: boolean;
  readonly revealsToAll: boolean;
}

export interface HiddenTargetScope {
  readonly battlefieldId: string;
  /** `false` means this target is governed by 811.1.d.2/.3. */
  readonly bypassedByExplicitRestriction: boolean;
  /** Targets whose printed restriction overrides the battlefield scope. */
  readonly explicitTargetExceptions: readonly ObjectRef[];
}

export interface HiddenPlayProvenance {
  readonly object: ObjectRef;
  readonly battlefieldId: string;
  readonly playedTurn: number;
  readonly reactionUnlocked: boolean;
  readonly targetScope: HiddenTargetScope;
}
