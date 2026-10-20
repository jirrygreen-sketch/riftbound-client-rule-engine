import type { PlayerId } from '../effects/contract.js';

export interface QueuedTurn {
  readonly player: PlayerId;
  readonly additional: boolean;
  readonly sourceInstructionId?: string;
}

export interface TurnQueueState {
  /** Additional Turns in creation order, followed by the normal repeating queue. */
  readonly additional: readonly QueuedTurn[];
  readonly normalCursor: number;
}

/**
 * CR 734-738. Additional Turns are inserted after the current turn in the
 * order that created them; each is then removed and the old turn order resumes.
 */
export class TurnQueue {
  private additional: QueuedTurn[] = [];
  private normalCursor = 0;

  constructor(readonly turnOrder: readonly PlayerId[]) {
    if (turnOrder.length !== 2 || new Set(turnOrder).size !== 2) throw new TypeError('Turn queue supports a two-player turn order');
  }

  snapshot(): TurnQueueState {
    return { additional: this.additional.map(turn => ({ ...turn })), normalCursor: this.normalCursor };
  }
  restore(state: TurnQueueState): void {
    this.additional = state.additional.map(turn => ({ ...turn }));
    this.normalCursor = state.normalCursor;
  }
  enqueueAdditional(player: PlayerId, sourceInstructionId: string): void {
    if (!this.turnOrder.includes(player)) throw new TypeError('Additional Turn owner is not in the turn order');
    if (!sourceInstructionId) throw new TypeError('Additional Turn requires a source instruction id');
    this.additional.push({ player, additional: true, sourceInstructionId });
  }
  /** Returns the current turn, which must be consumed before asking for the next. */
  current(): QueuedTurn {
    return { player: this.turnOrder[this.normalCursor % this.turnOrder.length]!, additional: false };
  }
  /** CR 737: consume one queued Additional Turn, then resume the normal loop. */
  next(): QueuedTurn {
    this.normalCursor = (this.normalCursor + 1) % this.turnOrder.length;
    return this.additional.shift() ?? this.current();
  }
}
