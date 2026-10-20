import type { GameAction, GameEvent, ObjectRef, PlayerId, ResolveContext } from '../effects/contract.js';

export interface BurnOutParticipant {
  readonly id: PlayerId;
  readonly deckCount: number;
  readonly trashCount: number;
}

export interface BurnOutState {
  readonly player: PlayerId;
  readonly continuation: 'draw' | 'mill';
  readonly amount: number;
  /** Number of already processed Burn Outs in this continuation chain. */
  readonly sequence: number;
}

export interface BurnOutServices {
  readonly perform: (action: GameAction) => ReturnType<ResolveContext['perform']>;
  readonly trash: (player: PlayerId) => readonly ObjectRef[];
}

export interface BurnOutResult {
  readonly status: 'done' | 'rejected';
  readonly sequence: number;
  readonly beneficiary?: PlayerId;
  readonly events: readonly GameEvent[];
  readonly reason?: string;
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * One Burn Out replacement step (CR 432.2). The caller owns the surrounding
 * repetition loop and runs cleanup victory checks between steps.
 */
export function performBurnOutStep(
  state: BurnOutState,
  participants: readonly BurnOutParticipant[],
  services: BurnOutServices,
): BurnOutResult {
  const player = participants.find(entry => entry.id === state.player);
  if (!player || participants.length !== 2 || !validCount(state.amount) || !Number.isSafeInteger(state.sequence) || state.sequence < 0) {
    return { status: 'rejected', sequence: state.sequence, events: [], reason: 'invalid-burn-out-state' };
  }
  const opponents = participants.filter(entry => entry.id !== state.player).map(entry => entry.id);
  if (opponents.length !== 1) return { status: 'rejected', sequence: state.sequence, events: [], reason: 'opponent-choice-unavailable' };
  const beneficiary = opponents[0]!;
  const events: GameEvent[] = [];

  // CR 432.2.b: recycle the Trash before point gain. Trash order is randomized
  // by the state owner; this task only submits the movement actions.
  for (const object of services.trash(state.player)) {
    const outcome = services.perform({ type: 'recycle', object });
    events.push(...outcome.events);
    if (outcome.status !== 'done') return { status: 'rejected', sequence: state.sequence, events, reason: 'recycle-failed' };
  }
  const shuffle = services.perform({ type: 'shuffle', player: state.player, zone: 'deck' });
  if (shuffle.status !== 'done') return { status: 'rejected', sequence: state.sequence, events, reason: 'shuffle-failed' };

  // CR 432.2.c: choose an opponent to gain one point. In a Duel the choice is
  // deterministic; the callback remains explicit so the shared runner can
  // substitute a real choice without changing state semantics.
  const points = services.perform({ type: 'score', player: beneficiary, amount: 1 });
  events.push(...points.events);
  if (points.status !== 'done') return { status: 'rejected', sequence: state.sequence, beneficiary, events, reason: 'point-gain-failed' };

  return {
    status: 'done',
    sequence: state.sequence,
    beneficiary,
    events,
  };
}
