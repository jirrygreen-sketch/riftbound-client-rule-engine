import type { GameAction, GameEvent, ObjectRef, ObjectSnapshot, PlayerId, ResolveContext } from '../effects/contract.js';

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
  /** Point-gain seam; callers use it to make sequence > 0 unreplaceable. */
  readonly performPoint?: (
    action: Extract<GameAction, { readonly type: 'score' }>,
    sequence: number,
  ) => ReturnType<ResolveContext['perform']>;
}

export interface BurnOutResult {
  readonly status: 'done' | 'rejected';
  readonly sequence: number;
  readonly beneficiary?: PlayerId;
  readonly events: readonly GameEvent[];
  readonly reason?: string;
}

export interface BurnOutContinuationResult {
  /** The action result after the shortfall and every follow-up Burn Out. */
  readonly action: ReturnType<ResolveContext['perform']>;
  readonly events: readonly GameEvent[];
  readonly continuation: 'draw' | 'mill';
  readonly player: PlayerId;
  readonly requested: number;
  /** Actual cards moved by successful portions of the action. */
  readonly completed: number;
  readonly burnOuts: number;
  readonly beneficiaries: readonly PlayerId[];
  /** A supplied terminal rule stopped the continuation immediately. */
  readonly terminal: boolean;
}

/** Internal, non-wire capability supplied by the state owner to effect.mill. */
export interface BurnOutInstructionCapability {
  readonly participants: () => readonly BurnOutParticipant[];
  readonly trash: (player: PlayerId) => readonly ObjectRef[];
  /** Past the first Burn Out, points cannot be replaced or prevented (432.3.b). */
  readonly performPoint: (action: Extract<GameAction, { readonly type: 'score' }>) => ReturnType<ResolveContext['perform']>;
  /** False stops immediately at a following Burn Out's Victory Score (432.3.c). */
  readonly afterBurnOut: (sequence: number) => boolean | void;
}

const instructionCapabilities = new WeakMap<object, BurnOutInstructionCapability>();

/** Bind a process-local effect capability without changing the wire snapshot. */
export function bindBurnOutInstructionCapability(
  source: ObjectSnapshot,
  capability: BurnOutInstructionCapability,
): ObjectSnapshot {
  // ChainEngine rebuilds Resolve against the exact immutable source snapshot
  // supplied by its host. Keep the process-local capability out of that wire
  // object and out of clones so the rebuilt context resolves this identity.
  instructionCapabilities.set(source, capability);
  return source;
}

/** Read only the state-owner binding attached to this exact Resolve source. */
export function burnOutInstructionCapabilityFor(source: ObjectSnapshot): BurnOutInstructionCapability | null {
  return instructionCapabilities.get(source) ?? null;
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
  const pointAction = { type: 'score' as const, player: beneficiary, amount: 1 };
  const points = services.performPoint === undefined
    ? services.perform(pointAction)
    : services.performPoint(pointAction, state.sequence);
  events.push(...points.events);
  if (points.status !== 'done') return { status: 'rejected', sequence: state.sequence, beneficiary, events, reason: 'point-gain-failed' };

  return {
    status: 'done',
    sequence: state.sequence,
    beneficiary,
    events,
  };
}

/**
 * Complete one instructed Draw/Burn or mill after as many cards as possible
 * have already moved. CR 432.1.a-b / 432.2.a-d / 432.5 and CR 441.4 make the
 * shortfall a replacement continuation: finish the available portion, process
 * Burn Out, then perform the remainder through the same primitive. CR 432.3
 * makes an empty Deck and Trash repeat. The caller supplies participant and
 * terminal-stop seams; this runner never reads or rewrites the supplies to
 * make progress.
 */
export function completeBurnOutContinuation(
  continuation: 'draw' | 'mill',
  player: PlayerId,
  requested: number,
  initial: ReturnType<ResolveContext['perform']>,
  services: {
    readonly perform: (action: GameAction) => ReturnType<ResolveContext['perform']>;
    readonly participants: () => readonly BurnOutParticipant[];
    readonly trash: (player: PlayerId) => readonly ObjectRef[];
    readonly completed: (outcome: Extract<ReturnType<ResolveContext['perform']>, { readonly status: 'done' }>) => number;
    readonly performPoint?: BurnOutServices['performPoint'];
    /** Run for each successful Burn Out step, including the first. */
    readonly afterBurnOut?: (step: BurnOutResult, sequence: number) => boolean | void;
  },
): BurnOutContinuationResult | null {
  if (!validCount(requested) || initial.status !== 'done') return null;
  const events: GameEvent[] = [...initial.events];
  let actual: Extract<ReturnType<ResolveContext['perform']>, { readonly status: 'done' }> = initial;
  let completed = services.completed(initial);
  if (!validCount(completed) || completed > requested) return null;
  let sequence = 0;
  const beneficiaries: PlayerId[] = [];
  while (completed < requested) {
    const participants = services.participants();
    const step = performBurnOutStep({ player, continuation, amount: requested - completed, sequence }, participants, {
      perform: services.perform,
      trash: services.trash,
      ...(services.performPoint === undefined ? {} : { performPoint: services.performPoint }),
    });
    events.push(...step.events);
    if (step.status !== 'done' || step.beneficiary === undefined) return null;
    beneficiaries.push(step.beneficiary);
    if (services.afterBurnOut?.(step, sequence) === false) {
      return { action: actual, events, continuation, player, requested, completed, burnOuts: sequence + 1, beneficiaries, terminal: true };
    }
    const moved = requested - completed;
    if (moved <= 0) return { action: actual, events, continuation, player, requested, completed, burnOuts: sequence + 1, beneficiaries, terminal: false };
    const remainder = services.perform(continuation === 'draw'
      ? { type: 'draw', player, amount: moved }
      : { type: 'mill', player, amount: moved });
    events.push(...remainder.events);
    if (remainder.status !== 'done') return null;
    actual = remainder;
    const next = services.completed(remainder);
    if (!validCount(next) || next > moved) return null;
    completed += next;
    sequence++;
  }
  return { action: actual, events, continuation, player, requested, completed, burnOuts: sequence, beneficiaries, terminal: false };
}
