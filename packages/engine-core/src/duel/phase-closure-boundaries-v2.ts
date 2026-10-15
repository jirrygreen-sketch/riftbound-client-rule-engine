import type { DuelPhysicalZone, DuelPhysicalZoneTransition } from './permanent-state.js';
import type {
  DuelPhaseSourceClosureEventV2,
  DuelPhaseSourceClosurePhaseV2,
} from './phase-source-closure-v2.js';

/** Executor cursor steps, not closure events. */
export type DuelPhaseClosureStepV2 =
  | 'awaken'
  | 'begin'
  | 'hold'
  | 'hold-effects'
  | 'channel'
  | 'channel-effects'
  | 'draw'
  | 'draw-effects'
  | 'burnout-first'
  | 'burnout-intervention'
  | 'main'
  | 'main-effects'
  | 'ending'
  | 'special-designations'
  | 'special-lethal'
  | 'special-expiration'
  | 'special-remaining'
  | 'special-fepr'
  | 'ordinary-designations'
  | 'ordinary-lethal'
  | 'ordinary-remaining'
  | 'ordinary-fepr'
  | 'awaiting-turn-start'
  | 'ended';

export type DuelPhaseClosureBoundaryOrdinalV2 = 'pre' | 'post';

/**
 * A dispatch record, not a proof. Append `taskSuffix` to the complete, current
 * executor task ID (including its hold/burnout/cleanup iteration); never use the
 * suffix alone as a task ID. Inspect every returned record at the indicated
 * clock and do not advance past a pending inspection.
 */
export interface DuelPhaseClosureBoundaryV2 {
  readonly ordinal: DuelPhaseClosureBoundaryOrdinalV2;
  readonly event: DuelPhaseSourceClosureEventV2;
  readonly phase: DuelPhaseSourceClosurePhaseV2;
  readonly taskSuffix: string;
}

/**
 * Call with `at: 'pre'` before the intrinsic step, then with `at: 'post'`
 * immediately after each successful physical draw/channel/kill commit (using
 * that SAME step name, including partial Draws preceding Burn Out). Never defer
 * a partial Draw's check until `draw-effects`: the drawn card could move before
 * then, or the game could end during Burn Out.
 *
 * `committedTransitions` is the actual scoped physical trace from the trusted,
 * successfully committed operation, not a proposal, client flag, snapshot guess,
 * or empty stand-in for missing provenance. An empty trace is legal ONLY when
 * the operation did commit zero transfers. The mapper validates shape/direction
 * and selects events; the bridge and closure journal must bind the trace,
 * subjects, and pre-exit sources to the authoritative match/clock.
 *
 * FEPR's post is ledger reconciliation, not a physical transfer: pass `none`
 * for a trustworthy no-change result, and `processed` ONLY after its actual
 * mutation has committed. Never treat a client-supplied status as proof.
 */
export type DuelPhaseClosureBoundaryContextV2 =
  | { readonly at: 'pre' }
  | { readonly at: 'post'; readonly committedTransitions: readonly DuelPhysicalZoneTransition[] }
  | { readonly at: 'post'; readonly outcome: 'processed' | 'none' };

/** Every closure event, including events that have no executor step of their own. */
export const DUEL_PHASE_CLOSURE_EVENTS_V2: readonly DuelPhaseSourceClosureEventV2[] = Object.freeze([
  'awaken', 'begin', 'hold', 'channel', 'draw', 'main', 'ending',
  'expiration', 'fepr', 'required-cleanup', 'lethal-kill', 'burnout',
  'pre-exit', 'zone-transition', 'draw-subject', 'continuous', 'chain',
  'effect-queue', 'fepr-outstanding',
]);

/** The non-phase events are explicit so a bridge cannot treat them as phases. */
export const DUEL_PHASE_CLOSURE_NON_PHASE_EVENTS_V2: readonly Exclude<
  DuelPhaseSourceClosureEventV2,
  DuelPhaseSourceClosurePhaseV2
>[] = Object.freeze([
  'pre-exit', 'zone-transition', 'draw-subject', 'continuous', 'chain',
  'effect-queue', 'fepr-outstanding',
]);

const STEP_NAMES: readonly DuelPhaseClosureStepV2[] = Object.freeze([
  'awaken', 'begin', 'hold', 'hold-effects', 'channel', 'channel-effects',
  'draw', 'draw-effects', 'burnout-first', 'burnout-intervention', 'main',
  'main-effects', 'ending', 'special-designations', 'special-lethal',
  'special-expiration', 'special-remaining', 'special-fepr',
  'ordinary-designations', 'ordinary-lethal', 'ordinary-remaining',
  'ordinary-fepr', 'awaiting-turn-start', 'ended',
]);

function boundary(
  step: DuelPhaseClosureStepV2,
  ordinal: DuelPhaseClosureBoundaryOrdinalV2,
  event: DuelPhaseSourceClosureEventV2,
  phase: DuelPhaseSourceClosurePhaseV2,
): DuelPhaseClosureBoundaryV2 {
  return Object.freeze({
    ordinal, event, phase,
    taskSuffix: `phase-closure:${step}:${ordinal}:${event}`,
  });
}
function pre(step: DuelPhaseClosureStepV2, event: DuelPhaseSourceClosurePhaseV2): DuelPhaseClosureBoundaryV2 {
  return boundary(step, 'pre', event, event);
}
function post(
  step: DuelPhaseClosureStepV2,
  event: DuelPhaseSourceClosureEventV2,
  phase: DuelPhaseSourceClosurePhaseV2,
): DuelPhaseClosureBoundaryV2 {
  return boundary(step, 'post', event, phase);
}
const NO_BOUNDARIES: readonly DuelPhaseClosureBoundaryV2[] = Object.freeze([]);
function boundaries(...items: DuelPhaseClosureBoundaryV2[]): readonly DuelPhaseClosureBoundaryV2[] {
  return Object.freeze(items);
}

function exactRecord(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) ||
      (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null))
    throw new TypeError(`${label} must be a plain record`);
  const actual = Reflect.ownKeys(raw);
  if (actual.length !== keys.length ||
      actual.some(key => typeof key !== 'string' || !keys.includes(key) ||
        !('value' in Object.getOwnPropertyDescriptor(raw, key)!)) ||
      keys.some(key => !Object.hasOwn(raw, key)))
    throw new TypeError(`${label} has missing/extra/accessor keys`);
  return raw as Record<string, unknown>;
}
function text(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw new TypeError(`${label} must be text`);
  return raw;
}
function zone(raw: unknown): DuelPhysicalZone {
  const kind = raw !== null && typeof raw === 'object' && !Array.isArray(raw) &&
    Object.hasOwn(raw, 'kind') ? Object.getOwnPropertyDescriptor(raw, 'kind')?.value : undefined;
  if (kind === 'board-base' || kind === 'board-battlefield') {
    const value = exactRecord(raw, ['kind', 'locationId'], 'transition zone');
    text(value.locationId, 'transition locationId');
    return value as unknown as DuelPhysicalZone;
  }
  if (kind === 'legend-zone' || kind === 'champion-zone' || kind === 'hand' ||
      kind === 'main-deck' || kind === 'trash' || kind === 'rune-deck') {
    const value = exactRecord(raw, ['kind', 'zonePlayerId'], 'transition zone');
    text(value.zonePlayerId, 'transition zonePlayerId');
    return value as unknown as DuelPhysicalZone;
  }
  throw new TypeError('unknown transition zone');
}
function transition(raw: unknown): DuelPhysicalZoneTransition {
  const value = exactRecord(raw, ['uid', 'from', 'to'], 'committed transition');
  text(value.uid, 'transition uid');
  const from = zone(value.from), to = zone(value.to);
  if (from.kind === to.kind && ('locationId' in from
    ? 'locationId' in to && from.locationId === to.locationId
    : 'zonePlayerId' in to && from.zonePlayerId === to.zonePlayerId))
    throw new TypeError('unchanged transition');
  return value as unknown as DuelPhysicalZoneTransition;
}
function committedTransitions(raw: unknown): readonly DuelPhysicalZoneTransition[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype ||
      Reflect.ownKeys(raw).length !== raw.length + 1)
    throw new TypeError('committedTransitions must be a dense plain array');
  return Array.from({ length: raw.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!descriptor || !('value' in descriptor)) throw new TypeError('committedTransitions has a hole/accessor');
    return transition(descriptor.value);
  });
}
function matches(step: DuelPhaseClosureStepV2, item: DuelPhysicalZoneTransition): boolean {
  if (step === 'channel' || step === 'channel-effects')
    return item.from.kind === 'rune-deck' && item.to.kind === 'board-base';
  if (step === 'special-lethal' || step === 'ordinary-lethal')
    return (item.from.kind === 'board-base' || item.from.kind === 'board-battlefield') && item.to.kind === 'trash';
  // Recycle can accompany a draw attempt; it is NOT a draw subject. Include it
  // in the committed batch but enable draw/draw-subject only for deck -> hand.
  return (item.from.kind === 'main-deck' && item.to.kind === 'hand' &&
      item.from.zonePlayerId === item.to.zonePlayerId) ||
    (item.from.kind === 'trash' && item.to.kind === 'main-deck' &&
      item.from.zonePlayerId === item.to.zonePlayerId);
}

function preRecords(step: DuelPhaseClosureStepV2): readonly DuelPhaseClosureBoundaryV2[] {
  switch (step) {
    case 'awaken': case 'begin': case 'hold': case 'channel': case 'main': case 'ending':
      return boundaries(pre(step, step));
    case 'hold-effects': return boundaries(pre(step, 'hold'));
    case 'main-effects': return boundaries(pre(step, 'main'));
    case 'draw': return boundaries(boundary(step, 'pre', 'continuous', 'draw'));
    case 'burnout-first': return boundaries(pre(step, 'burnout'));
    case 'special-designations': case 'special-remaining':
    case 'ordinary-designations': case 'ordinary-remaining':
      return boundaries(pre(step, 'required-cleanup'));
    case 'special-expiration': return boundaries(pre(step, 'expiration'));
    case 'special-lethal': case 'ordinary-lethal': return boundaries(pre(step, 'lethal-kill'));
    case 'special-fepr': case 'ordinary-fepr': return boundaries(pre(step, 'fepr'));
    case 'awaiting-turn-start': case 'ended': return NO_BOUNDARIES;
    case 'channel-effects': case 'draw-effects': case 'burnout-intervention':
      throw new TypeError(`${step} has only a post boundary`);
  }
}
function postRecords(step: DuelPhaseClosureStepV2, raw: unknown): readonly DuelPhaseClosureBoundaryV2[] {
  if (step === 'special-fepr' || step === 'ordinary-fepr') {
    const context = exactRecord(raw, ['at', 'outcome'], 'FEPR post context');
    if (context.outcome === 'none') return NO_BOUNDARIES;
    if (context.outcome === 'processed') return boundaries(post(step, 'fepr-outstanding', 'fepr'));
    throw new TypeError('FEPR post outcome must be none or processed');
  }
  if (step !== 'channel' && step !== 'channel-effects' && step !== 'draw' && step !== 'draw-effects' &&
      step !== 'burnout-intervention' && step !== 'special-lethal' && step !== 'ordinary-lethal')
    throw new TypeError(`${step} has no post boundary`);
  const context = exactRecord(raw, ['at', 'committedTransitions'], 'post context');
  const transfers = committedTransitions(context.committedTransitions);
  if (transfers.some(item => !matches(step, item))) throw new TypeError(`${step} has foreign committed transition`);
  if (step === 'channel' || step === 'channel-effects')
    return transfers.length ? boundaries(post(step, 'zone-transition', 'channel')) : NO_BOUNDARIES;
  if (step === 'special-lethal' || step === 'ordinary-lethal')
    return transfers.length ? boundaries(post(step, 'pre-exit', 'lethal-kill'),
      post(step, 'zone-transition', 'lethal-kill')) : NO_BOUNDARIES;
  const drew = transfers.some(item => item.from.kind === 'main-deck' && item.to.kind === 'hand');
  if (!drew) return NO_BOUNDARIES;
  // The draw phase event is NOT covered by continuous or draw-subject. Check
  // both after the real main-deck -> hand commit; each inspection requires its
  // own clock-bound journal, including a nonempty draw-subject for this draw.
  return boundaries(post(step, 'draw', 'draw'),
    post(step, 'draw-subject', step === 'burnout-intervention' ? 'burnout' : 'draw'));
}

/**
 * Select boundaries from a trusted operation outcome. Unknown steps, invalid
 * context shapes, wrong pre/post timing and unaccounted transition directions
 * THROW rather than returning the same empty list as legitimate zero-transfer
 * outcomes and terminal cursor states. These errors must reject the execution;
 * a bridge must not catch them and interpret them as ready/empty coverage.
 */
export function duelPhaseClosureBoundariesForStepV2(
  step: string,
  rawContext: DuelPhaseClosureBoundaryContextV2,
): readonly DuelPhaseClosureBoundaryV2[] {
  if (typeof step !== 'string' || !(STEP_NAMES as readonly string[]).includes(step))
    throw new RangeError('unknown Duel V2 phase-closure step');
  const context = exactRecord(rawContext,
    rawContext !== null && typeof rawContext === 'object' && !Array.isArray(rawContext) &&
    Object.getOwnPropertyDescriptor(rawContext, 'at')?.value === 'post'
      ? Object.hasOwn(rawContext, 'outcome') ? ['at', 'outcome'] : ['at', 'committedTransitions']
      : ['at'], 'boundary context');
  if (context.at === 'pre') return preRecords(step as DuelPhaseClosureStepV2);
  if (context.at === 'post') return postRecords(step as DuelPhaseClosureStepV2, rawContext);
  throw new TypeError('boundary context.at must be pre or post');
}

/** Stable aliases for callers that prefer a mapper/getter spelling. */
export const mapDuelPhaseClosureBoundariesV2 = duelPhaseClosureBoundariesForStepV2;
export const getDuelPhaseClosureBoundariesV2 = duelPhaseClosureBoundariesForStepV2;

/** The complete accepted executor step vocabulary; no prefix-based fallback. */
export const DUEL_PHASE_CLOSURE_STEPS_V2: readonly DuelPhaseClosureStepV2[] = STEP_NAMES;
