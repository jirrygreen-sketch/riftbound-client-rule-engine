// CR v1.4: 413 Draw, 416 Recycle, 431 Burn Out.
//
// Internal, trusted-executor kernel only. A draw instruction is deliberately resumable: this file
// performs at most one Burn Out point per call and never owns canonical board/score/zones. The outer
// transaction installs the detached values returned here and runs the event/effect boundary exposed
// by the cursor before resuming.
import type { SetupCard } from './setup.js';
import { assertDuelBoard, type DuelBoard } from './battlefields.js';
import {
  gainDuelPoints,
  getDuelWinnerAtCleanup,
  restoreDuelScoring,
  type DuelScoringState,
} from './scoring.js';

type RecordValue = Record<string, unknown>;
type RandomIndex = (exclusiveUpperBound: number) => number;
type MutableZones = { hand: SetupCard[]; mainDeck: SetupCard[]; trash: SetupCard[] };

const ZONES_FIELDS = ['hand', 'mainDeck', 'trash'] as const;
const CARD_FIELDS = ['uid', 'cardId'] as const;
const CURSOR_FIELDS = ['actor', 'remainingCount', 'burnoutIndex', 'step'] as const;
const FIRST_RESOLUTION_FIELDS = ['kind', 'scoring'] as const;
const FIRST_OPTIONS_FIELDS = ['firstBurnoutResolution'] as const;
const INTERVENTION_OPTIONS_FIELDS = ['interventionComplete'] as const;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export interface DuelDrawZones {
  /** Private ordered cards. */
  readonly hand: readonly SetupCard[];
  /** Private ordered cards, top first. */
  readonly mainDeck: readonly SetupCard[];
  /** Private cards awaiting Recycle. */
  readonly trash: readonly SetupCard[];
}

export interface DuelBurnoutTask {
  readonly kind: 'burnout-point';
  readonly actor: string;
  readonly opponentPlayerId: string;
  readonly burnoutIndex: number;
  readonly remainingCount: number;
  /** True only for the first point in this Draw instruction. */
  readonly canPreventOrReplace: boolean;
}

export type DuelDrawCursorStep = 'awaiting-first-resolution' | 'awaiting-intervention';

/** Persistable continuation metadata. It intentionally contains no private zones, score, or board. */
export interface DuelDrawCursor {
  readonly actor: string;
  readonly remainingCount: number;
  /** 1 for the first Burn Out point, then monotonically increases one point at a time. */
  readonly burnoutIndex: number;
  readonly step: DuelDrawCursorStep;
}

export type DuelFirstBurnoutResolutionKind = 'prevented' | 'replaced' | 'scored';

/** Trusted outer result for the one replaceable/preventable first point. */
export interface DuelFirstBurnoutResolution {
  readonly kind: DuelFirstBurnoutResolutionKind;
  /** Actual canonical scoring after outer prevention/replacement/scoring resolution. */
  readonly scoring: DuelScoringState;
}

export interface DuelFirstBurnoutResumeOptions {
  readonly firstBurnoutResolution: DuelFirstBurnoutResolution;
}
export interface DuelInterventionResumeOptions {
  readonly interventionComplete: true;
}
export type DuelDrawResumeOptions = DuelFirstBurnoutResumeOptions | DuelInterventionResumeOptions;

export interface DuelBurnoutIntervention {
  readonly kind: 'burnout-intervention';
  readonly actor: string;
  readonly burnoutIndex: number;
  readonly remainingCount: number;
}

export type DuelDrawStatus = 'complete' | 'awaiting-first-resolution' | 'awaiting-intervention' | 'winner';

export interface DuelDrawStepResult {
  readonly zones: DuelDrawZones;
  /** Detached canonical score value; the outer transaction remains the score authority. */
  readonly scoring: DuelScoringState;
  /** Null means this Draw instruction is complete or ended immediately with a winner. */
  readonly cursor: DuelDrawCursor | null;
  readonly status: DuelDrawStatus;
  /** A pending first point, or the fixed subsequent point just applied in this step. */
  readonly task: DuelBurnoutTask | null;
  /** Outer effect/event processing is required before the cursor may be resumed. */
  readonly intervention: DuelBurnoutIntervention | null;
  /** The immediate winner produced by a subsequent fixed point, otherwise null. */
  readonly winner: string | null;
  /** Number of cards moved into hand by this call. */
  readonly drawnCount: number;
  /** Number of cards moved from Trash into Main Deck by this call. */
  readonly recycledCount: number;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid duel Draw/Burn Out state: ${message}`);
}
function range(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(`Duel Draw/Burn Out value out of range: ${message}`);
}
function record(value: unknown, fields: readonly string[], label: string): RecordValue {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), label);
  const keys = Reflect.ownKeys(value);
  check(keys.length === fields.length && fields.every(field => keys.includes(field)), `${label} keys`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor && 'value' in descriptor, `${label} must not contain accessors`);
  }
  const prototype = Object.getPrototypeOf(value);
  check(prototype === Object.prototype || prototype === null, `${label} must be a plain object`);
  return value as RecordValue;
}
function list(value: unknown, label: string): unknown[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, label);
  check(Reflect.ownKeys(value).length === value.length + 1, `${label} extra keys or sparse entries`);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    check(descriptor && 'value' in descriptor, `${label}[${index}] accessor or hole`);
  }
  return value;
}
function text(value: unknown, label: string): string {
  check(typeof value === 'string' && value.trim().length > 0, label);
  return value;
}
function safeInteger(value: unknown, label: string): number {
  check(typeof value === 'number' && Number.isInteger(value), `${label} must be an integer`);
  range(Number.isSafeInteger(value), `${label} must be a safe integer`);
  return value;
}
function nonNegative(value: unknown, label: string): number {
  const result = safeInteger(value, label);
  range(result >= 0, `${label} must not be negative`);
  return result;
}
function unique(values: readonly string[], label: string): void {
  check(new Set(values).size === values.length, `${label} duplicate`);
}
function boolean(value: unknown, label: string): boolean {
  check(typeof value === 'boolean', `${label} must be boolean`);
  return value;
}
function card(value: unknown, label: string): SetupCard {
  const item = record(value, CARD_FIELDS, label);
  return { uid: text(item.uid, `${label}.uid`), cardId: text(item.cardId, `${label}.cardId`) };
}
function copyCard(value: SetupCard): SetupCard {
  return { uid: value.uid, cardId: value.cardId };
}

/** Parse and detach all private zones. Every UID is a single game object, never a shared alias. */
function checkedZones(input: unknown, board: DuelBoard): MutableZones {
  const value = record(input, ZONES_FIELDS, 'zones');
  const references = new Set<object>();
  const parseZone = (raw: unknown, label: string): SetupCard[] => list(raw, label).map((entry, index) => {
    check(entry !== null && typeof entry === 'object', `${label}[${index}] must be an object`);
    const reference = entry as object;
    check(!references.has(reference), `${label}[${index}] aliases another card record`);
    references.add(reference);
    return card(entry, `${label}[${index}]`);
  });
  const zones = {
    hand: parseZone(value.hand, 'zones.hand'),
    mainDeck: parseZone(value.mainDeck, 'zones.mainDeck'),
    trash: parseZone(value.trash, 'zones.trash'),
  };
  const cards = [...zones.hand, ...zones.mainDeck, ...zones.trash];
  unique(cards.map(entry => entry.uid), 'zone card UID');

  // Card UIDs are game objects. They may not silently collide with board or player identity.
  const boardIds = new Set<string>([
    ...board.playerIds,
    ...board.bases.map(base => base.locationId),
    ...board.battlefields.flatMap(field => [field.locationId, field.instanceId]),
    ...board.units.map(unit => unit.objectId),
  ]);
  check(cards.every(entry => !boardIds.has(entry.uid)), 'card UID collides with board/player identity');
  return zones;
}
function publicZones(zones: MutableZones): DuelDrawZones {
  return {
    hand: zones.hand.map(copyCard),
    mainDeck: zones.mainDeck.map(copyCard),
    trash: zones.trash.map(copyCard),
  };
}
function validateRandomIndex(randomIndex: RandomIndex | undefined): void {
  check(randomIndex === undefined || typeof randomIndex === 'function', 'randomIndex');
}
function randomIndex(random: RandomIndex, bound: number): number {
  const result: unknown = random(bound);
  check(typeof result === 'number' && Number.isSafeInteger(result) && result >= 0 && result < bound,
    `randomIndex(${bound}) result`);
  return result;
}
function shuffled(cards: readonly SetupCard[], random: RandomIndex | undefined): SetupCard[] {
  const result = cards.map(copyCard);
  if (result.length < 2) return result;
  check(typeof random === 'function', 'randomIndex is required to Recycle multiple cards');
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIndex(random, index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}
function boardScore(boardInput: unknown, scoringInput: unknown): {
  readonly board: DuelBoard;
  readonly scoring: DuelScoringState;
} {
  assertDuelBoard(boardInput);
  return { board: boardInput, scoring: restoreDuelScoring(scoringInput, boardInput) };
}
function actorAndOpponent(actorInput: unknown, board: DuelBoard, scoring: DuelScoringState): {
  readonly actor: string;
  readonly opponentPlayerId: string;
} {
  const actor = text(actorInput, 'actor');
  check(board.playerIds.includes(actor), 'actor is not a board player');
  check(scoring.playerIds.length === 2 && scoring.playerIds.every((playerId, index) => playerId === board.playerIds[index]),
    'scoring seats must match board seats');
  const opponentPlayerId = board.playerIds.find(playerId => playerId !== actor);
  check(opponentPlayerId !== undefined, 'Duel must have exactly one opponent');
  return { actor, opponentPlayerId };
}
function cursor(value: unknown, board: DuelBoard, scoring: DuelScoringState): DuelDrawCursor {
  const item = record(value, CURSOR_FIELDS, 'draw cursor');
  const actor = text(item.actor, 'cursor.actor');
  check(board.playerIds.includes(actor), 'cursor actor unknown');
  check(scoring.playerIds.includes(actor), 'cursor/score actor mismatch');
  const remainingCount = nonNegative(item.remainingCount, 'cursor.remainingCount');
  const burnoutIndex = safeInteger(item.burnoutIndex, 'cursor.burnoutIndex');
  range(burnoutIndex >= 1, 'cursor.burnoutIndex must be at least one');
  check(item.step === 'awaiting-first-resolution' || item.step === 'awaiting-intervention', 'cursor.step');
  check(remainingCount > 0, 'cursor.remainingCount must be positive while pending');
  check(item.step !== 'awaiting-first-resolution' || burnoutIndex === 1,
    'only Burn Out point one may await prevention/replacement');
  return { actor, remainingCount, burnoutIndex, step: item.step as DuelDrawCursorStep };
}
function makeCursor(
  actor: string, remainingCount: number, burnoutIndex: number, step: DuelDrawCursorStep,
): DuelDrawCursor {
  return { actor, remainingCount, burnoutIndex, step };
}
function makeTask(
  cursorValue: DuelDrawCursor, opponentPlayerId: string, canPreventOrReplace: boolean,
): DuelBurnoutTask {
  return {
    kind: 'burnout-point', actor: cursorValue.actor, opponentPlayerId,
    burnoutIndex: cursorValue.burnoutIndex, remainingCount: cursorValue.remainingCount,
    canPreventOrReplace,
  };
}
function makeIntervention(cursorValue: DuelDrawCursor): DuelBurnoutIntervention {
  return {
    kind: 'burnout-intervention', actor: cursorValue.actor,
    burnoutIndex: cursorValue.burnoutIndex, remainingCount: cursorValue.remainingCount,
  };
}
function nextBurnoutIndex(current: number): number {
  range(current < MAX_SAFE, 'burnoutIndex overflow');
  return current + 1;
}

interface DrawAttempt {
  readonly zones: MutableZones;
  readonly remainingCount: number;
  readonly drawnCount: number;
  readonly recycledCount: number;
}

/** Perform only the available portion, then Recycle before opening exactly one Burn Out point. */
function attemptDraw(zones: MutableZones, requested: number, random: RandomIndex | undefined): DrawAttempt {
  if (requested === 0) return { zones, remainingCount: 0, drawnCount: 0, recycledCount: 0 };
  const available = Math.min(requested, zones.mainDeck.length);
  const drawn = zones.mainDeck.slice(0, available).map(copyCard);
  zones.hand = [...zones.hand.map(copyCard), ...drawn];
  zones.mainDeck = zones.mainDeck.slice(available).map(copyCard);
  if (available === requested) {
    return { zones, remainingCount: 0, drawnCount: available, recycledCount: 0 };
  }

  // 431.2.a has already drawn all cards possible. 431.2.b Recycles the entire Trash into the
  // now-empty Main Deck. The point is opened before any of that newly recycled deck is drawn.
  const recycled = shuffled(zones.trash, random);
  zones.mainDeck = recycled;
  zones.trash = [];
  return {
    zones,
    remainingCount: requested - available,
    drawnCount: available,
    recycledCount: recycled.length,
  };
}
function completeResult(
  zones: MutableZones, scoring: DuelScoringState, drawnCount: number, recycledCount: number,
): DuelDrawStepResult {
  return {
    zones: publicZones(zones), scoring, cursor: null, status: 'complete', task: null,
    intervention: null, winner: null, drawnCount, recycledCount,
  };
}
function pendingFirstResult(
  zones: MutableZones, scoring: DuelScoringState, actor: string, opponentPlayerId: string,
  remainingCount: number, drawnCount: number, recycledCount: number,
): DuelDrawStepResult {
  const pending = makeCursor(actor, remainingCount, 1, 'awaiting-first-resolution');
  return {
    zones: publicZones(zones), scoring, cursor: pending, status: 'awaiting-first-resolution',
    task: makeTask(pending, opponentPlayerId, true), intervention: null, winner: null, drawnCount, recycledCount,
  };
}
function interventionResult(
  zones: MutableZones, scoring: DuelScoringState, continuation: DuelDrawCursor,
  drawnCount: number, recycledCount: number,
): DuelDrawStepResult {
  return {
    zones: publicZones(zones), scoring, cursor: continuation, status: 'awaiting-intervention',
    task: null, intervention: makeIntervention(continuation), winner: null, drawnCount, recycledCount,
  };
}
function checkedFirstResolution(value: unknown, current: DuelScoringState, board: DuelBoard): DuelScoringState {
  const item = record(value, FIRST_RESOLUTION_FIELDS, 'firstBurnoutResolution');
  check(item.kind === 'prevented' || item.kind === 'replaced' || item.kind === 'scored',
    'firstBurnoutResolution.kind');
  const resolved = restoreDuelScoring(item.scoring, board);
  // A trusted replacement may change actual point ledgers, but this one result cannot quietly replace
  // the board seats, turn, or victory threshold with a second authority.
  check(resolved.victoryScore === current.victoryScore, 'first resolution changed victoryScore');
  check(resolved.turnNumber === current.turnNumber, 'first resolution changed turnNumber');
  return resolved;
}
function checkedFirstOptions(value: unknown, current: DuelScoringState, board: DuelBoard): DuelScoringState {
  const options = record(value, FIRST_OPTIONS_FIELDS, 'first Draw resume options');
  return checkedFirstResolution(options.firstBurnoutResolution, current, board);
}
function checkedInterventionOptions(value: unknown): void {
  const options = record(value, INTERVENTION_OPTIONS_FIELDS, 'intervention resume options');
  check(boolean(options.interventionComplete, 'interventionComplete'), 'interventionComplete must be true');
}
/**
 * Start one trusted Draw instruction. The operation draws normally until either complete or the
 * first Burn Out point is opened. It never resolves that point in the same call.
 */
export function startDuelDraw(
  zonesInput: unknown, boardInput: unknown, scoringInput: unknown,
  actorInput: unknown, countInput: unknown, randomIndex?: RandomIndex,
): DuelDrawStepResult {
  validateRandomIndex(randomIndex);
  const { board, scoring } = boardScore(boardInput, scoringInput);
  const zones = checkedZones(zonesInput, board);
  const { actor, opponentPlayerId } = actorAndOpponent(actorInput, board, scoring);
  const count = nonNegative(countInput, 'count');
  const attempt = attemptDraw(zones, count, randomIndex);
  if (attempt.remainingCount === 0) return completeResult(attempt.zones, scoring, attempt.drawnCount, attempt.recycledCount);
  return pendingFirstResult(
    attempt.zones, scoring, actor, opponentPlayerId, attempt.remainingCount,
    attempt.drawnCount, attempt.recycledCount,
  );
}

/**
 * Resume one cursor step. A first point accepts exactly one trusted actual resolution. A subsequent
 * point accepts only the explicit outer intervention boundary, then performs one draw attempt and,
 * if needed, applies exactly one unpreventable point. There is intentionally no point-settling loop.
 */
export function resumeDuelDraw(
  zonesInput: unknown, boardInput: unknown, scoringInput: unknown,
  cursorInput: unknown, optionsInput: unknown, randomIndex?: RandomIndex,
): DuelDrawStepResult {
  validateRandomIndex(randomIndex);
  const { board, scoring } = boardScore(boardInput, scoringInput);
  const zones = checkedZones(zonesInput, board);
  const continuation = cursor(cursorInput, board, scoring);
  check(continuation.step === 'awaiting-first-resolution' || continuation.step === 'awaiting-intervention',
    'unsupported cursor step');

  if (continuation.step === 'awaiting-first-resolution') {
    const resolved = checkedFirstOptions(optionsInput, scoring, board);
    const next = makeCursor(
      continuation.actor, continuation.remainingCount,
      continuation.burnoutIndex, 'awaiting-intervention',
    );
    // The first point is deliberately not checked for immediate victory. Cleanup belongs outside.
    return interventionResult(zones, resolved, next, 0, 0);
  }

  checkedInterventionOptions(optionsInput);
  const attempt = attemptDraw(zones, continuation.remainingCount, randomIndex);
  if (attempt.remainingCount === 0) {
    return completeResult(attempt.zones, scoring, attempt.drawnCount, attempt.recycledCount);
  }

  const index = nextBurnoutIndex(continuation.burnoutIndex);
  const pointCursor = makeCursor(
    continuation.actor, attempt.remainingCount, index, 'awaiting-intervention',
  );
  // 431.3.b: after point one, prevention/replacement is impossible. This call applies exactly one
  // point and then returns a boundary before another draw attempt.
  const opponentPlayerId = board.playerIds.find(playerId => playerId !== continuation.actor);
  check(opponentPlayerId !== undefined, 'Duel must have exactly one opponent');
  const gained = gainDuelPoints(scoring, board, opponentPlayerId, 1);
  const winner = getDuelWinnerAtCleanup(gained.state, board) === opponentPlayerId
    ? opponentPlayerId : null;
  if (winner !== null) {
    return {
      zones: publicZones(attempt.zones), scoring: gained.state, cursor: null, status: 'winner',
      task: makeTask(pointCursor, opponentPlayerId, false), intervention: null, winner,
      drawnCount: attempt.drawnCount, recycledCount: attempt.recycledCount,
    };
  }
  return {
    zones: publicZones(attempt.zones), scoring: gained.state, cursor: pointCursor,
    status: 'awaiting-intervention', task: makeTask(pointCursor, opponentPlayerId, false),
    intervention: makeIntervention(pointCursor), winner: null,
    drawnCount: attempt.drawnCount, recycledCount: attempt.recycledCount,
  };
}

/** Descriptive alias for callers that name the instruction by its action. */
export const drawDuelCards = startDuelDraw;
/** Descriptive alias for callers that name continuation as a step. */
export const continueDuelDraw = resumeDuelDraw;
