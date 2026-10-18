import type { GameAction, ObjectRef, ZoneId } from '../contract.js';

/** Runtime declarations supplied by the program owner, never inferred from card names. */
export interface LinkedAbilityBinding {
  readonly cardId: string;
  readonly setId: string;
  /** Instruction identities belonging to this printed or granted set (CR 396). */
  readonly members: readonly string[];
  readonly grantedBy?: { readonly source: ObjectRef; readonly grantId: string };
  readonly captures: readonly {
    readonly path: readonly string[];
    readonly key: string;
    readonly action: GameAction['type'];
    readonly zone: ZoneId;
  }[];
  /** Explicit aliases for the existing ObjectSelector { linked: key }. */
  readonly reads: readonly { readonly key: string; readonly member: string }[];
}

export interface LinkedAbilityClock {
  readonly turn: number;
  readonly combat: number;
}

/** One actual transition, rather than an increment guessed from an old reference. */
export interface LinkedZoneReceipt {
  readonly sequence: number;
  readonly action: GameAction['type'];
  readonly from: ObjectRef;
  readonly to: ObjectRef | null;
  readonly fromZone: ZoneId;
  readonly toZone: ZoneId | null;
}

export interface LinkedDamageRecord extends LinkedAbilityClock {
  readonly sequence: number;
  readonly actionId?: string;
  readonly batchId?: string;
  readonly source: ObjectRef;
  readonly target: ObjectRef;
  readonly amount: number;
  readonly combatDamage: boolean;
}

export interface LinkedDamageQuery {
  /** Entity = the physical card id across zones; incarnation = one exact entry. */
  readonly identity: 'entity' | 'incarnation';
  readonly source?: ObjectRef;
  readonly target?: ObjectRef;
  readonly turn?: number;
  readonly combat?: number;
  readonly combatDamage?: boolean;
}

/** A delayed source window is explicit; ordinary pending abilities retain their origin. */
export type LinkedAbilityWindow =
  | { readonly kind: 'affected-objects' }
  | { readonly kind: 'source'; readonly zone: ZoneId };

export class LinkedAbilityError extends Error {
  readonly status = 'blocked';
  constructor(message: string) {
    super(`Linked ability: ${message}`);
    this.name = 'LinkedAbilityError';
  }
}
