/**
 * Serializable identities for structural turn work.
 *
 * A task record is deliberately data. TurnFlow appends the executable closure
 * only after a checkpoint so a restored queue cannot contain stale callbacks.
 */
export type TurnTaskRecord =
  | { readonly type: 'ready'; readonly object: import('../../effects/contract.js').ObjectRef }
  | { readonly type: 'clear-stun'; readonly object: import('../../effects/contract.js').ObjectRef }
  | { readonly type: 'clear-rune-pool'; readonly player: import('../../effects/contract.js').PlayerId }
  | { readonly type: 'destroy-temporary'; readonly object: import('../../effects/contract.js').ObjectRef }
  | { readonly type: 'recall'; readonly object: import('../../effects/contract.js').ObjectRef }
  | { readonly type: 'hidden-cleanup'; readonly battlefieldId: string }
  | {
      readonly type: 'score';
      readonly player: import('../../effects/contract.js').PlayerId;
      readonly battlefieldId: string;
      readonly method: 'hold' | 'conquer';
      /** Identity of the Unit whose Conquer/Hold ability corresponds to this Score. */
      readonly object?: import('../../effects/contract.js').ObjectRef;
    }
  | {
      readonly type: 'burn-out';
      readonly player: import('../../effects/contract.js').PlayerId;
      /** The action whose shortfall caused this Burn Out. */
      readonly continuation: 'draw' | 'mill';
      readonly amount: number;
      /** Points from all Burn Outs after the first cannot be replaced (432.3.b). */
      readonly sequence: number;
    }
  | {
      readonly type: 'additional-turn';
      readonly player: import('../../effects/contract.js').PlayerId;
      readonly sourceInstructionId: string;
    };

export interface TurnTaskState {
  readonly records: readonly TurnTaskRecord[];
}

export interface TurnTaskExecution {
  readonly record: TurnTaskRecord;
  readonly status: 'done' | 'rejected';
  readonly reason?: string;
}
