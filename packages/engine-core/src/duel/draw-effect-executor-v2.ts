// INTERNAL V2 Draw effect executor. A card-dsl program describes an effect, but
// only this Core-bound capability may execute it. Draw/Burn Out itself remains
// in draw-burnout.ts; this adapter owns the admitted match and physical trace.
import {
  assertAdmittedDuelMatchV2,
  inspectDuelNativeOriginV2,
  assertCurrentDuelPhysicalReferenceV2,
  enumerateDuelObjectsV2,
  commitDuelPlayingMutationV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import type { DuelPhysicalZoneTransition } from './permanent-state.js';
import {
  getDuelWinnerAtCleanup,
  type DuelScoringState,
} from './scoring.js';
import {
  startDuelDraw,
  resumeDuelDraw,
  type DuelDrawCursor,
  type DuelDrawStepResult,
  type DuelDrawResumeOptions,
} from './draw-burnout.js';
import type {
  DuelDrawCardsEffect,
  DuelOfficialProgram,
  DuelOfficialProgramReference,
  DuelOfficialProgramRegistry,
} from '@riftbound/card-dsl/duel';
import { queryDuelSourceProgramPhaseScope } from '@riftbound/card-dsl/duel';

export type DuelDrawEffectPhaseV2 = 'spell-resolution' | 'hold';

/** Source and clock binding supplied by the trusted effect scheduler. */
export interface DuelDrawEffectSourceV2 {
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly controllerPlayerId: string;
  readonly cardId: string;
  readonly programId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly effectId: string;
  readonly phase: DuelDrawEffectPhaseV2;
}

/** A detached scalar cursor is safe to persist, but has no execution authority by itself. */
export interface DuelDrawEffectCursorV2 {
  readonly kind: 'duel-draw-effect-v2';
  readonly effectId: string;
  readonly matchId: string;
  readonly beforeStateVersion: number;
  readonly stateVersion: number;
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly controllerPlayerId: string;
  readonly draw: DuelDrawCursor;
}

export interface DuelDrawEffectPendingV2 {
  readonly status: 'pending';
  readonly state: DuelCanonicalPlayingStateV2;
  readonly cursor: DuelDrawEffectCursorV2;
  readonly task: DuelDrawStepResult['task'];
  readonly intervention: DuelDrawStepResult['intervention'];
}

export interface DuelDrawEffectCompleteV2 {
  readonly status: 'complete' | 'ended';
  readonly state: DuelCanonicalPlayingStateV2;
  readonly effectId: string;
  readonly drawnCount: number;
  readonly recycledCount: number;
  readonly winner: string | null;
}

export type DuelDrawEffectResultV2 = DuelDrawEffectPendingV2 | DuelDrawEffectCompleteV2;

export interface DuelDrawEffectResolverContextV2 {
  readonly state: DuelCanonicalPlayingStateV2;
  readonly source: DuelDrawEffectSourceV2;
  readonly cursor: DuelDrawEffectCursorV2;
  readonly task: DuelDrawStepResult['task'];
  readonly intervention: DuelDrawStepResult['intervention'];
}

export type DuelDrawFirstResolverV2 = (context: DuelDrawEffectResolverContextV2) =>
  | DuelDrawResumeOptions
  | { readonly status: 'pending' };
export type DuelDrawInterventionResolverV2 = (context: DuelDrawEffectResolverContextV2) =>
  | { readonly interventionComplete: true }
  | { readonly status: 'pending' };

export interface DuelDrawEffectAuthorityOptionsV2 {
  readonly state: DuelCanonicalPlayingStateV2;
  readonly source: DuelDrawEffectSourceV2;
  readonly registry: DuelOfficialProgramRegistry;
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  readonly randomIndex?: (exclusiveUpperBound: number) => number;
  readonly resolveFirstBurnout?: DuelDrawFirstResolverV2;
  readonly resolveIntervention?: DuelDrawInterventionResolverV2;
}

export interface DuelDrawEffectAuthorityV2 {
  readonly kind: 'duel-draw-effect-authority-v2';
}

interface Bond {
  readonly authority: DuelDrawEffectAuthorityV2;
  readonly source: DuelDrawEffectSourceV2;
  readonly registry: DuelOfficialProgramRegistry;
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  readonly randomIndex?: (exclusiveUpperBound: number) => number;
  readonly resolveFirstBurnout?: DuelDrawFirstResolverV2;
  readonly resolveIntervention?: DuelDrawInterventionResolverV2;
  readonly effect: DuelDrawCardsEffect;
  readonly cursor: DuelDrawEffectCursorV2;
  readonly inputState: DuelCanonicalPlayingStateV2;
  busy: boolean;
  consumed: boolean;
}

const bonds = new WeakMap<object, Bond>();
const cursors = new WeakMap<object, Bond>();
const effects = new WeakMap<object, Set<string>>();

export class DuelDrawEffectBlockedErrorV2 extends TypeError {
  constructor(readonly code: string) {
    super(`Duel Draw effect blocked [${code}]`);
    this.name = 'DuelDrawEffectBlockedErrorV2';
  }
}

function block(code: string): never { throw new DuelDrawEffectBlockedErrorV2(code); }
function check(ok: unknown, code: string): asserts ok { if (!ok) block(code); }
function id(value: unknown, label: string): string {
  check(typeof value === 'string' && value.trim().length > 0, label);
  return value;
}
function epoch(value: unknown): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'invalid-source-epoch');
  return value;
}
function immutableSource(value: DuelDrawEffectSourceV2): DuelDrawEffectSourceV2 {
  const source = {
    sourceUID: id(value?.sourceUID, 'invalid-source-uid'),
    sourceZoneEpoch: epoch(value?.sourceZoneEpoch),
    controllerPlayerId: id(value?.controllerPlayerId, 'invalid-controller'),
    cardId: id(value?.cardId, 'invalid-source-card'),
    programId: id(value?.programId, 'invalid-program-id'),
    dataVersion: id(value?.dataVersion, 'invalid-data-version'),
    catalogDigest: id(value?.catalogDigest, 'invalid-catalog-digest'),
    effectId: id(value?.effectId, 'invalid-effect-id'),
    phase: value?.phase,
  } as DuelDrawEffectSourceV2;
  check(source.phase === 'spell-resolution' || source.phase === 'hold', 'invalid-draw-phase');
  return Object.freeze(source);
}
function sameReference(a: DuelOfficialProgramReference, source: DuelDrawEffectSourceV2): boolean {
  return a.cardId === source.cardId && a.programId === source.programId &&
    a.dataVersion === source.dataVersion && a.sourceCatalogDigest === source.catalogDigest;
}
function drawEffect(program: DuelOfficialProgram, phase: DuelDrawEffectPhaseV2): DuelDrawCardsEffect {
  const semantics = program.semantics;
  if (phase === 'spell-resolution') {
    check(semantics.kind === 'spell-resolution' && semantics.effects.length === 1,
      'program-not-draw-spell');
  } else {
    check(semantics.kind === 'trigger' && semantics.event === 'hold' && semantics.effects.length === 1,
      'program-not-draw-hold');
  }
  const candidate = semantics.effects[0];
  check(candidate.kind === 'draw-cards' && candidate.recipient === 'effect-controller' &&
    Number.isSafeInteger(candidate.amount) && candidate.amount > 0, 'invalid-draw-program');
  return Object.freeze({ kind: 'draw-cards', amount: candidate.amount, recipient: 'effect-controller' });
}
function resolveBoundProgram(registry: DuelOfficialProgramRegistry,
  source: DuelDrawEffectSourceV2): DuelDrawCardsEffect {
  check(registry !== null && typeof registry === 'object', 'missing-program-registry');
  // Only the facade has the private registry index. A bare program or binding has
  // no reference() capability and can never authorize execution.
  check(typeof registry.reference === 'function' && typeof registry.resolve === 'function' &&
    typeof registry.sourceProgramPhaseScope === 'function', 'untrusted-program-registry');
  const reference = registry.reference(source.cardId);
  check(reference !== undefined && sameReference(reference, source) && reference.programId === source.programId,
    'source-program-reference-mismatch');
  const scope = queryDuelSourceProgramPhaseScope(registry, source.cardId,
    { phase: source.phase === 'hold' ? 'hold' : 'main', mode: 'runtime-subevents' }, reference);
  check(scope.sourceProgramComplete === true && scope.reference !== null &&
    sameReference(scope.reference, source), 'source-program-not-complete');
  const resolved = registry.resolve(reference);
  check(resolved.status === 'resolved' && resolved.program !== null &&
    resolved.program.programId === source.programId &&
    resolved.program.source.cardId === source.cardId &&
    resolved.program.source.dataVersion === source.dataVersion &&
    resolved.program.source.sourceCatalogDigest === source.catalogDigest,
  'source-program-resolution-mismatch');
  return drawEffect(resolved.program, source.phase);
}
function sourceCard(state: DuelCanonicalPlayingStateV2, source: DuelDrawEffectSourceV2): void {
  check(state.dataVersion === source.dataVersion && state.catalogDigest === source.catalogDigest,
    'source-catalog-mismatch');
  const original = state.physicalCardsByUID[source.sourceUID];
  check(original !== undefined && original.cardId === source.cardId, 'source-physical-card-mismatch');
  check(state.roster.some(player => player.playerId === source.controllerPlayerId), 'unknown-controller');
  const live = enumerateDuelObjectsV2(state).find(item => item.uid === source.sourceUID);
  check(live !== undefined, 'source-object-missing');
  if (live.kind === 'battlefield' || live.kind === 'gear' || live.kind === 'unit' || live.kind === 'gold') {
    check(live.controllerPlayerId === source.controllerPlayerId, 'source-controller-mismatch');
  } else {
    check(original.ownerPlayerId === source.controllerPlayerId, 'source-owner-mismatch');
  }
  assertCurrentDuelPhysicalReferenceV2(state, {
    uid: source.sourceUID, zoneEpoch: source.sourceZoneEpoch,
  });
}
function exactHead(bond: Bond, state: DuelCanonicalPlayingStateV2): void {
  check(bond.readHead() === state && state === bond.inputState &&
    state.stateVersion === bond.inputState.stateVersion && state.eventSeq === bond.inputState.eventSeq,
  'stale-head');
  sourceCard(state, bond.source);
}
function current(bond: Bond, state: DuelCanonicalPlayingStateV2): void {
  check(!bond.consumed && !bond.busy, 'effect-already-consumed');
  exactHead(bond, state);
}
function playerZones(state: DuelCanonicalPlayingStateV2, actor: string) {
  const player = state.players.find(item => item.playerId === actor);
  check(player !== undefined, 'unknown-controller');
  return {
    hand: player.hand.map(card => ({ uid: card.uid, cardId: card.cardId })),
    mainDeck: player.remainingMainDeck.map(card => ({ uid: card.uid, cardId: card.cardId })),
    trash: player.trash.map(card => ({ uid: card.uid, cardId: card.cardId })),
  };
}
function cardMap(state: DuelCanonicalPlayingStateV2, actor: string) {
  const player = state.players.find(item => item.playerId === actor)!;
  return new Map([...player.hand, ...player.remainingMainDeck, ...player.trash].map(card => [card.uid, card]));
}
function sameCards(a: readonly { uid: string; cardId: string }[], b: readonly { uid: string; cardId: string }[]): boolean {
  return a.length === b.length && a.every((card, index) => card.uid === b[index]?.uid && card.cardId === b[index]?.cardId);
}
function transitionsFor(state: DuelCanonicalPlayingStateV2, actor: string,
  result: DuelDrawStepResult): readonly DuelPhysicalZoneTransition[] {
  const before = playerZones(state, actor);
  const after = result.zones;
  const cards = cardMap(state, actor);
  check(after.hand.length >= before.hand.length &&
    sameCards(before.hand, after.hand.slice(0, before.hand.length)), 'draw-hand-order');
  const drawn = after.hand.slice(before.hand.length);
  const oldDeck = [...before.mainDeck];
  const oldTrash = [...before.trash];
  const oldDeckSet = new Set(oldDeck.map(card => card.uid));
  const oldTrashSet = new Set(oldTrash.map(card => card.uid));
  const drawnOld = drawn.filter(card => oldDeckSet.has(card.uid));
  const drawnRecycled = drawn.filter(card => !oldDeckSet.has(card.uid));
  check(drawn.every(card => cards.has(card.uid)), 'draw-created-card');
  check(drawnOld.every((card, i) => card.uid === oldDeck[i]?.uid), 'draw-deck-order');
  check(after.trash.length === oldTrash.length - (result.recycledCount > 0 ? oldTrash.length : 0), 'trash-transition-count');
  if (result.recycledCount === 0) check(sameCards(before.trash, after.trash), 'trash-changed-without-recycle');
  check(result.recycledCount === 0 || result.recycledCount === oldTrash.length, 'partial-recycle');
  check(result.recycledCount === 0 || drawnRecycled.length + after.mainDeck.length === oldTrash.length,
    'recycle-card-count');
  const steps: DuelPhysicalZoneTransition[] = [];
  for (const card of drawnOld) steps.push({ uid: card.uid,
    from: { kind: 'main-deck', zonePlayerId: actor }, to: { kind: 'hand', zonePlayerId: actor } });
  if (result.recycledCount > 0) {
    for (const card of oldTrash) {
      check(oldTrashSet.has(card.uid), 'recycle-unknown-card');
      steps.push({ uid: card.uid, from: { kind: 'trash', zonePlayerId: actor },
        to: { kind: 'main-deck', zonePlayerId: actor } });
    }
    for (const card of drawnRecycled) steps.push({ uid: card.uid,
      from: { kind: 'main-deck', zonePlayerId: actor }, to: { kind: 'hand', zonePlayerId: actor } });
  }
  check(after.mainDeck.every(card => cards.has(card.uid)) && after.trash.every(card => cards.has(card.uid)),
    'draw-zone-unknown-card');
  return steps;
}
function install(state: DuelCanonicalPlayingStateV2, actor: string, result: DuelDrawStepResult,
  source: DuelDrawEffectSourceV2): DuelCanonicalPlayingStateV2 {
  const transitions = transitionsFor(state, actor, result);
  return commitDuelPlayingMutationV2(state, draft => {
    const players = draft.players.map(player => player.playerId !== actor ? player : {
      ...player,
      hand: result.zones.hand.map(card => ({ ...card })),
      remainingMainDeck: result.zones.mainDeck.map(card => ({ ...card })),
      trash: result.zones.trash.map(card => ({ ...card })),
    }) as unknown as DuelCanonicalPlayingStateV2['players'];
    let frame = draft.frame;
    const winner = result.winner ?? getDuelWinnerAtCleanup(result.scoring, draft.board);
    if (winner !== null) frame = { ...frame, phase: 'ended', priorityPlayerId: null,
      focusPlayerId: null, stateOpen: false, pendingPayment: null };
    return { match: { ...draft, players, scoring: result.scoring, frame }, transitions };
  });
}
function cursorFor(state: DuelCanonicalPlayingStateV2, source: DuelDrawEffectSourceV2,
  draw: DuelDrawCursor): DuelDrawEffectCursorV2 {
  return Object.freeze({ kind: 'duel-draw-effect-v2', effectId: source.effectId,
    matchId: state.matchId, beforeStateVersion: state.stateVersion, stateVersion: state.stateVersion,
    sourceUID: source.sourceUID, sourceZoneEpoch: source.sourceZoneEpoch,
    controllerPlayerId: source.controllerPlayerId, draw: Object.freeze({ ...draw }) });
}
function resultFor(bond: Bond, state: DuelCanonicalPlayingStateV2,
  result: DuelDrawStepResult, beforeVersion: number): DuelDrawEffectResultV2 {
  if (result.cursor !== null) {
    const cursor = cursorFor(state, bond.source, result.cursor);
    const pending: DuelDrawEffectPendingV2 = Object.freeze({ status: 'pending', state, cursor,
      task: result.task, intervention: result.intervention });
    cursors.set(cursor as object, { ...bond, cursor, inputState: state, busy: false, consumed: false });
    // Transfer the continuation to the new cursor once. The original authority or
    // previous cursor may not fork a second Draw if publication of the head is delayed.
    bond.consumed = true;
    return pending;
  }
  bond.consumed = true;
  return Object.freeze({ status: result.status === 'winner' ? 'ended' : 'complete', state,
    effectId: bond.source.effectId, drawnCount: result.drawnCount, recycledCount: result.recycledCount,
    winner: result.winner });
}
function execute(bond: Bond, state: DuelCanonicalPlayingStateV2,
  result: DuelDrawStepResult, beforeVersion: number): DuelDrawEffectResultV2 {
  exactHead(bond, state);
  const next = install(state, bond.source.controllerPlayerId, result, bond.source);
  return resultFor(bond, next, result, beforeVersion);
}

/** Issue one opaque authority for a real Draw printing and admitted Core head. */
export function createDuelDrawEffectAuthorityV2(options: DuelDrawEffectAuthorityOptionsV2): DuelDrawEffectAuthorityV2 {
  const state = options.state;
  assertAdmittedDuelMatchV2(state);
  check(state.stage === 'playing' && typeof options.readHead === 'function', 'invalid-authority');
  const source = immutableSource(options.source);
  check(options.readHead() === state, 'stale-head');
  sourceCard(state, source);
  const effect = resolveBoundProgram(options.registry, source);
  check(effect.amount > 0, 'invalid-draw-amount');
  const origin = inspectDuelNativeOriginV2(state);
  let set = effects.get(origin);
  if (!set) { set = new Set(); effects.set(origin, set); }
  check(!set.has(source.effectId), 'duplicate-effect-id');
  set.add(source.effectId);
  const authority = Object.freeze({ kind: 'duel-draw-effect-authority-v2' as const });
  const bond: Bond = { authority, source, registry: options.registry, readHead: options.readHead,
    randomIndex: options.randomIndex, resolveFirstBurnout: options.resolveFirstBurnout,
    resolveIntervention: options.resolveIntervention, effect, cursor: null as unknown as DuelDrawEffectCursorV2,
    inputState: state, busy: false, consumed: false };
  bonds.set(authority, bond);
  return authority;
}

export function beginDuelDrawEffectV2(authority: DuelDrawEffectAuthorityV2): DuelDrawEffectResultV2 {
  const bond = authority && typeof authority === 'object' ? bonds.get(authority) : undefined;
  check(bond !== undefined, 'invalid-authority');
  check(!bond.busy && !bond.consumed, 'effect-already-consumed');
  current(bond, bond.inputState);
  bond.busy = true;
  try {
    const result = startDuelDraw(playerZones(bond.inputState, bond.source.controllerPlayerId),
      bond.inputState.board, bond.inputState.scoring, bond.source.controllerPlayerId,
      bond.effect.amount, bond.randomIndex);
    return execute(bond, bond.inputState, result, bond.inputState.stateVersion);
  } finally { bond.busy = false; }
}

function pendingBond(cursor: DuelDrawEffectCursorV2): Bond {
  check(cursor !== null && typeof cursor === 'object', 'invalid-cursor');
  const bond = cursors.get(cursor as object);
  check(bond !== undefined && bond.cursor === cursor && !bond.consumed, 'unbound-or-consumed-cursor');
  return bond;
}

/** Resume only through the original opaque bond. Missing trusted resolvers leave Burn Out pending. */
export function resumeDuelDrawEffectV2(cursor: DuelDrawEffectCursorV2,
  state: DuelCanonicalPlayingStateV2): DuelDrawEffectResultV2 {
  const bond = pendingBond(cursor);
  check(!bond.busy, 'reentry');
  check(cursor.matchId === state.matchId && cursor.stateVersion === state.stateVersion &&
    cursor.sourceUID === bond.source.sourceUID && cursor.sourceZoneEpoch === bond.source.sourceZoneEpoch,
  'stale-head');
  current(bond, state);
  bond.busy = true;
  try {
    const context = Object.freeze({ state, source: bond.source, cursor,
      task: null, intervention: null });
    let options: DuelDrawResumeOptions | { readonly status: 'pending' };
    if (cursor.draw.step === 'awaiting-first-resolution') {
      if (!bond.resolveFirstBurnout) return Object.freeze({ status: 'pending', state, cursor,
        task: null, intervention: null });
      options = bond.resolveFirstBurnout(context);
      exactHead(bond, state);
      if ('status' in options) return Object.freeze({ status: 'pending', state, cursor,
        task: null, intervention: null });
    } else {
      if (!bond.resolveIntervention) return Object.freeze({ status: 'pending', state, cursor,
        task: null, intervention: null });
      const answer = bond.resolveIntervention(context);
      exactHead(bond, state);
      if ('status' in answer) return Object.freeze({ status: 'pending', state, cursor,
        task: null, intervention: null });
      options = answer;
    }
    const result = resumeDuelDraw(playerZones(state, bond.source.controllerPlayerId), state.board,
      state.scoring, cursor.draw, options, bond.randomIndex);
    const next = execute(bond, state, result, state.stateVersion);
    cursors.delete(cursor as object);
    return next;
  } finally { bond.busy = false; }
}

export const createDuelDrawAuthorityV2 = createDuelDrawEffectAuthorityV2;
export const beginDuelDrawV2 = beginDuelDrawEffectV2;
export const resumeDuelDrawV2 = resumeDuelDrawEffectV2;
