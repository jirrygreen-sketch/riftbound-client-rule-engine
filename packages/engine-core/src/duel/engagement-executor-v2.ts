// INTERNAL narrow engagement path. Source services are trusted host capabilities, never wire input.
import { applyOpenDuelCleanup, beginDuelCombat, beginDuelShowdown,
  endDuelCombat, endDuelNonCombatShowdown, relocateDuelUnit } from './battlefields.js';
import { createDuelCombatDamageAuthorityV2, submitDuelCombatDamageChoiceV2,
  type DuelCombatDamageAuthorityV2, type DuelCombatDamageChoiceV2 } from './combat-damage-executor-v2.js';
import { assertAdmittedDuelMatchV2, commitDuelPlayingMutationV2, enumerateDuelObjectsV2,
  inspectDuelNativeCommitPathV2, type DuelCanonicalPlayingStateV2 } from './core-v2.js';
import type { DuelCommandSessionV2 } from './canonical-session-v2.js';
import { assertDuelSpellShowdownClosureV2, createDuelSpellCardPlaySessionV2,
  type DuelSpellCardPlayServicesV2, type DuelSpellCardPlaySessionV2 } from './cardplay-spell-v2.js';
import { startDuelDraw, resumeDuelDraw, type DuelBurnoutIntervention,
  type DuelBurnoutTask, type DuelDrawCursor, type DuelDrawStepResult,
  type DuelFirstBurnoutResolution } from './draw-burnout.js';
import { inspectDuelPhaseSourcesV2, type DuelPhaseRegistryV2 } from './phase-source-authority-v2.js';
import { gainDuelPoints, getDuelWinnerAtCleanup, scoreDuelBattlefield,
  type DuelScoreOutcome, type DuelScoringState } from './scoring.js';
import { commitApprovedDuelUnitKills, healAllDuelUnitDamage, planDuelUnitKills,
  queryLethalDuelUnitCandidates, type DuelKillPlan, type PublicDuelUnitObject } from './unit-lifecycle.js';
import type { DuelBaseCombatSourceEffectService } from './base-combat-allocation.js';
import type { DuelPhysicalZoneTransition } from './permanent-state.js';

type Boundary = 'showdown-open' | 'showdown-close' | 'combat-deal' | 'combat-cleanup' |
  'combat-result' | 'conquer' | 'combat-end' | 'deathknell' | 'fepr';
type Phase = 'open' | 'focus' | 'damage' | 'lethal' | 'heal' | 'recall' | 'fepr' |
  'result' | 'after-result' | 'draw-required';

export interface DuelEngagementEffectsRequestV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly boundary: Boundary;
  readonly taskId: string;
  readonly sourceUIDs: readonly string[];
}
export interface DuelEngagementDrawRequestV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly fieldId: string;
  readonly score: DuelScoreOutcome;
  readonly taskId: string;
  readonly draw: DuelDrawCursor | null;
  readonly task: DuelBurnoutTask | null;
  readonly intervention: DuelBurnoutIntervention | null;
}
export interface DuelEngagementDrawProofV2 {
  readonly status: 'ready';
  readonly matchId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly fieldId: string;
  readonly taskId: string;
  readonly scorePlayerId: string;
}
export interface DuelEngagementServicesV2 {
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  readonly sources: DuelPhaseRegistryV2;
  /** A whole-program, catalog-bound service must inspect the named event for every live source. */
  readonly inspectEffects: (request: DuelEngagementEffectsRequestV2) =>
    { readonly status: 'pending' } | { readonly status: 'none'; readonly matchId: string;
      readonly stateVersion: number; readonly eventSeq: number; readonly boundary: Boundary;
      readonly taskId: string; readonly sourceUIDs: readonly string[] };
  readonly combat: DuelBaseCombatSourceEffectService;
  readonly lethalEvaluators: { readonly currentMight: (unit: PublicDuelUnitObject) => number;
    readonly lethalDamageThreshold: (unit: PublicDuelUnitObject, might: number) => number };
  /** Must register pre-exit Deathknell and replacement work before approving any Kill. */
  readonly approveLethal: (plan: DuelKillPlan, match: DuelCanonicalPlayingStateV2) =>
    { readonly status: 'pending' } | { readonly status: 'approved';
      readonly approvedUnitUIDs: readonly string[]; readonly preExitSettled: true;
      readonly deathknellSettled: true };
  readonly fepr: (match: DuelCanonicalPlayingStateV2, taskId: string) =>
    { readonly status: 'pending' | 'none' | 'processed' };
  /** Actual source, replacement, Score-trigger and cleanup closure belongs to the host. */
  readonly sourceDraw?: (request: DuelEngagementDrawRequestV2) =>
    { readonly status: 'pending' } | DuelEngagementDrawProofV2;
  readonly firstBurnout?: (request: DuelEngagementDrawRequestV2) =>
    { readonly status: 'pending' } | (DuelEngagementDrawProofV2 & {
      readonly firstBurnoutResolution: DuelFirstBurnoutResolution });
  readonly intervention?: (request: DuelEngagementDrawRequestV2) =>
    { readonly status: 'pending' } | DuelEngagementDrawProofV2;
  readonly randomIndex?: (exclusiveUpperBound: number) => number;
}

export interface DuelEngagementCursorV2 {
  readonly kind: 'duel-engagement-v2';
  readonly matchId: string;
  readonly fieldId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly phase: Phase;
  readonly expectedActorPlayerId: string | null;
}
export interface DuelEngagementSpellSuspensionV2 {
  readonly kind: 'duel-engagement-spell-suspension-v2';
  readonly matchId: string;
  readonly fieldId: string;
}
export interface DuelEngagementSpellStartV2 {
  readonly suspension: DuelEngagementSpellSuspensionV2;
  readonly spell: DuelSpellCardPlaySessionV2;
}
export type DuelEngagementCommandV2 =
  | { readonly kind: 'pass-focus'; readonly actorPlayerId: string;
      readonly expectedStateVersion: number }
  | { readonly kind: 'assign-damage'; readonly choice: DuelCombatDamageChoiceV2 }
  | { readonly kind: 'continue'; readonly expectedStateVersion: number };
export type DuelEngagementStepV2 =
  | { readonly status: 'active' | 'pending'; readonly match: DuelCanonicalPlayingStateV2;
      readonly cursor: DuelEngagementCursorV2; readonly reason?: string;
      readonly score?: DuelScoreOutcome }
  | { readonly status: 'complete'; readonly match: DuelCanonicalPlayingStateV2;
      readonly winnerPlayerId: string | null; readonly score?: DuelScoreOutcome;
      readonly combatResult?: 'no-result' | { readonly winnerPlayerId: string } };

export type DuelEngagementBlockCodeV2 = 'invalid-authority' | 'stale-head' | 'wrong-actor' |
  'wrong-command' | 'consumed' | 'reentrant' | 'invalid-field';
export class DuelEngagementBlockedErrorV2 extends TypeError {
  constructor(readonly code: DuelEngagementBlockCodeV2) {
    super(`Duel engagement blocked [${code}]`);
    this.name = 'DuelEngagementBlockedErrorV2';
  }
}
interface Entry {
  readonly services: DuelEngagementServicesV2;
  readonly match: DuelCanonicalPlayingStateV2;
  readonly fieldId: string;
  readonly attacker: string;
  readonly defender: string;
  readonly combat: boolean;
  readonly phase: Phase;
  readonly focus: string | null;
  readonly passes: number;
  readonly damage: DuelCombatDamageAuthorityV2 | null;
  readonly recalled: boolean;
  readonly score?: DuelScoreOutcome;
  readonly combatResult?: 'no-result' | { readonly winnerPlayerId: string };
  readonly draw: DuelDrawCursor | null;
  readonly drawStarted: boolean;
  used: boolean;
  busy: boolean;
}
const entries = new WeakMap<object, Entry>();
const opened = new WeakMap<object, Set<string>>();
const reserved = new WeakMap<object, Set<string>>();
const spellSuspensions = new WeakMap<object, { readonly entry: Entry;
  readonly initial: DuelSpellCardPlaySessionV2; used: boolean; busy: boolean }>();
function blocked(code: DuelEngagementBlockCodeV2): never { throw new DuelEngagementBlockedErrorV2(code); }
function fieldOf(m: DuelCanonicalPlayingStateV2, fieldId: string) {
  return m.board.battlefields.find(field => field.locationId === fieldId);
}
function head(e: Entry): void {
  let current: DuelCanonicalPlayingStateV2;
  try { current = e.services.readHead(); assertAdmittedDuelMatchV2(current); }
  catch { blocked('stale-head'); }
  if (current !== e.match) blocked('stale-head');
}
function successor(before: DuelCanonicalPlayingStateV2, after: DuelCanonicalPlayingStateV2): void {
  const path = inspectDuelNativeCommitPathV2(before, after);
  if (path.length !== 1 || path[0]!.before !== before || path[0]!.after !== after) blocked('stale-head');
}
function commit(e: Entry, mutate: Parameters<typeof commitDuelPlayingMutationV2>[1]): DuelCanonicalPlayingStateV2 {
  head(e);
  const after = commitDuelPlayingMutationV2(e.match, mutate);
  successor(e.match, after);
  return after;
}
function ticket(e: Entry, match: DuelCanonicalPlayingStateV2 = e.match): string {
  return `turn-${match.frame.turnNumber}:engagement:${e.fieldId}:${e.phase}:${match.eventSeq}`;
}
function gate(e: Entry, boundary: Boundary): string | null {
  const event = boundary === 'deathknell' ? 'lethal-kill' : boundary === 'fepr' ? 'fepr' : 'required-cleanup';
  const id = ticket(e);
  const inspected = inspectDuelPhaseSourcesV2(e.match, event, e.match.frame.turnNumber, id,
    e.services.sources);
  if (inspected.status !== 'ready') return inspected.reason ?? 'source-evidence-pending';
  if (inspected.handlers.length) return 'source-handlers-pending';
  const sourceUIDs = Object.freeze(inspected.sources.map(source => source.uid));
  let answer: ReturnType<DuelEngagementServicesV2['inspectEffects']>;
  try { answer = e.services.inspectEffects(Object.freeze({ match: e.match, boundary,
    taskId: id, sourceUIDs })); } catch { return 'effect-service-pending'; }
  if (answer?.status !== 'none' || answer.matchId !== e.match.matchId ||
      answer.stateVersion !== e.match.stateVersion || answer.eventSeq !== e.match.eventSeq ||
      answer.boundary !== boundary || answer.taskId !== id ||
      !Array.isArray(answer.sourceUIDs) || answer.sourceUIDs.length !== sourceUIDs.length ||
      !sourceUIDs.every((uid, index) => answer.sourceUIDs[index] === uid)) return 'effect-evidence-pending';
  head(e);
  return null;
}
function unsupported(e: Entry): string | null {
  if (e.match.frame.pendingPayment !== null ||
      ((e.phase === 'open' || e.phase === 'focus') && !e.match.frame.stateOpen))
    return 'closed-or-payment-pending';
  if (e.match.gears.length) return 'gear-cleanup-pending';
  if (e.match.board.units.some(unit => e.match.unitMeta[unit.objectId]?.trait.kind === 'token'))
    return 'token-cleanup-pending';
  if (enumerateDuelObjectsV2(e.match).some(object => object.zone.kind === 'board-battlefield' &&
      object.kind !== 'battlefield' && object.kind !== 'unit')) return 'board-object-cleanup-pending';
  return null;
}
function cursor(e: Entry): DuelEngagementCursorV2 {
  const value = Object.freeze({ kind: 'duel-engagement-v2' as const, matchId: e.match.matchId,
    fieldId: e.fieldId, stateVersion: e.match.stateVersion, eventSeq: e.match.eventSeq,
    phase: e.phase, expectedActorPlayerId: e.phase === 'focus' ? e.focus :
      e.phase === 'damage' ? e.passes === 0 ? e.attacker : e.defender : null });
  entries.set(value, e);
  return value;
}
function active(e: Entry, reason?: string): DuelEngagementStepV2 {
  e.used = true;
  const fresh: Entry = { ...e, used: false, busy: false };
  return { status: reason ? 'pending' : 'active', match: fresh.match, cursor: cursor(fresh),
    ...(reason ? { reason } : {}), ...(e.score ? { score: e.score } : {}) };
}
function next(e: Entry, changes: Partial<Entry>): Entry {
  e.used = true;
  return { ...e, ...changes, used: false, busy: false };
}
function completed(e: Entry, match: DuelCanonicalPlayingStateV2,
  combatResult?: 'no-result' | { readonly winnerPlayerId: string }): DuelEngagementStepV2 {
  e.used = true;
  const winnerPlayerId = getDuelWinnerAtCleanup(match.scoring, match.board);
  const terminal = winnerPlayerId !== null && match.frame.phase !== 'ended'
    ? commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft,
      frame: { ...draft.frame, phase: 'ended', stateOpen: false, priorityPlayerId: null,
        focusPlayerId: null, pendingPayment: null } }, transitions: [] })) : match;
  return { status: 'complete', match: terminal, winnerPlayerId,
    ...(e.score ? { score: e.score } : {}),
    ...(combatResult ?? e.combatResult ? { combatResult: (combatResult ?? e.combatResult)! } : {}) };
}

/** Temporarily give the current Showdown Focus window to one native Spell
 * Chain. The caller supplies the exact admitted command session at this head. */
export function suspendDuelEngagementForSpellV2(handle: DuelEngagementCursorV2,
  commandSession: DuelCommandSessionV2, services: DuelSpellCardPlayServicesV2): DuelEngagementSpellStartV2 {
  const e = handle && typeof handle === 'object' ? entries.get(handle) : undefined;
  if (!e) blocked('invalid-authority');
  if (e.used) blocked('consumed');
  if (e.busy) blocked('reentrant');
  e.busy = true;
  try {
    head(e);
    if (e.phase !== 'focus' || e.focus === null ||
        e.match.frame.focusPlayerId !== e.focus || e.match.frame.priorityPlayerId !== e.focus ||
        commandSession?.match !== e.match || services?.cardPlayOrder !== 'showdown-focus-chain-first-v3' ||
        services.showdownFocus?.fieldId !== e.fieldId ||
        services.showdownFocus.returnFocusPlayerId !== e.focus || unsupported(e))
      blocked('wrong-command');
    const spell = createDuelSpellCardPlaySessionV2(commandSession, services);
    const suspension = Object.freeze({ kind: 'duel-engagement-spell-suspension-v2' as const,
      matchId: e.match.matchId, fieldId: e.fieldId });
    spellSuspensions.set(suspension, { entry: e, initial: spell, used: false, busy: false });
    e.used = true;
    return Object.freeze({ suspension, spell });
  } finally { e.busy = false; }
}

/** Rejoin only after the last real Chain item committed. CR 346/347 pass Focus
 * to the next player; an action resets the consecutive Focus-pass sequence. */
export function resumeDuelEngagementAfterSpellV2(handle: DuelEngagementSpellSuspensionV2,
  spell: DuelSpellCardPlaySessionV2): DuelEngagementStepV2 {
  const saved = handle && typeof handle === 'object' ? spellSuspensions.get(handle) : undefined;
  if (!saved) blocked('invalid-authority');
  if (saved.used) blocked('consumed');
  if (saved.busy) blocked('reentrant');
  saved.busy = true;
  try {
    const e = saved.entry;
    let latest: DuelCanonicalPlayingStateV2;
    try { latest = assertDuelSpellShowdownClosureV2(saved.initial, spell, e.focus!); }
    catch { blocked('wrong-command'); }
    let current: DuelCanonicalPlayingStateV2;
    try { current = e.services.readHead(); assertAdmittedDuelMatchV2(current); }
    catch { blocked('stale-head'); }
    if (current !== latest) blocked('stale-head');
    let path: ReturnType<typeof inspectDuelNativeCommitPathV2>;
    try { path = inspectDuelNativeCommitPathV2(e.match, latest); }
    catch { blocked('stale-head'); }
    if (!path.length || path[0]?.before !== e.match || path.at(-1)?.after !== latest ||
        path.some((edge, index) => index > 0 && path[index - 1]?.after !== edge.before))
      blocked('stale-head');
    const field = fieldOf(latest, e.fieldId);
    if (!field || field.showdown !== 'active' ||
        (e.combat ? field.combat !== 'active' : field.combat !== 'none'))
      blocked('invalid-field');
    const other = e.focus === e.attacker ? e.defender : e.attacker;
    const resumed = { ...e, match: latest, used: false, busy: false };
    const after = commit(resumed, draft => ({ match: { ...draft,
      frame: { ...draft.frame, focusPlayerId: other, priorityPlayerId: other } }, transitions: [] }));
    saved.used = true;
    return active(next(resumed, { match: after, focus: other, passes: 0 }));
  } finally { saved.busy = false; }
}

/** Enter only from a staged battlefield on an actual admitted playing head. */
export function startDuelEngagementV2(match: DuelCanonicalPlayingStateV2, fieldId: string,
  services: DuelEngagementServicesV2): DuelEngagementStepV2 {
  assertAdmittedDuelMatchV2(match);
  if (match.stage !== 'playing' || match.frame.phase !== 'main' ||
      typeof fieldId !== 'string' || !fieldId.trim()) blocked('invalid-field');
  const field = fieldOf(match, fieldId);
  if (!field || reserved.get(match)?.has(fieldId) || field.showdown !== 'staged' ||
      (field.combat !== 'staged' && field.combat !== 'none') || !field.contestingPlayerId ||
      match.board.battlefields.some(other => other.showdown === 'active' || other.combat === 'active'))
    blocked('invalid-field');
  const attacker = field.contestingPlayerId;
  const defender = match.board.playerIds.find(player => player !== attacker);
  if (!defender) blocked('invalid-field');
  const e: Entry = { services, match, fieldId, attacker, defender, combat: field.combat === 'staged',
    phase: 'open', focus: attacker, passes: 0, damage: null, recalled: false,
    draw: null, drawStarted: false,
    used: false, busy: true };
  let claims = reserved.get(match);
  if (!claims) { claims = new Set(); reserved.set(match, claims); }
  claims.add(fieldId);
  try {
    head(e);
    const reason = unsupported(e) ?? gate(e, 'showdown-open');
    if (reason) { e.busy = false; return active(e, reason); }
    const after = commit(e, draft => ({ match: { ...draft,
      board: e.combat ? beginDuelCombat(draft.board, fieldId) : beginDuelShowdown(draft.board, fieldId),
      frame: { ...draft.frame, focusPlayerId: attacker, priorityPlayerId: attacker } }, transitions: [] }));
    let fields = opened.get(match);
    if (!fields) { fields = new Set(); opened.set(match, fields); }
    fields.add(fieldId);
    e.busy = false;
    return active(next(e, { match: after, phase: 'focus' }));
  } catch (error) {
    claims.delete(fieldId);
    throw error;
  }
}

/** One scalar command or one cleanup boundary per call. The host must publish each returned head. */
export function advanceDuelEngagementV2(handle: DuelEngagementCursorV2,
  command: DuelEngagementCommandV2): DuelEngagementStepV2 {
  const e = handle && typeof handle === 'object' ? entries.get(handle) : undefined;
  if (!e) blocked('invalid-authority');
  if (e.used) blocked('consumed');
  if (e.busy) blocked('reentrant');
  e.busy = true;
  try {
    head(e);
    if (!command || typeof command !== 'object' ||
        (command.kind !== 'assign-damage' && command.expectedStateVersion !== e.match.stateVersion))
      blocked('wrong-command');
    const unsupportedReason = unsupported(e);
    if (unsupportedReason) return active(e, unsupportedReason);
    if (e.phase === 'open') {
      if (command.kind !== 'continue') blocked('wrong-command');
      const reason = gate(e, 'showdown-open');
      if (reason) return active(e, reason);
      if (opened.get(e.match)?.has(e.fieldId)) blocked('consumed');
      const after = commit(e, draft => ({ match: { ...draft,
        board: e.combat ? beginDuelCombat(draft.board, e.fieldId) :
          beginDuelShowdown(draft.board, e.fieldId),
        frame: { ...draft.frame, focusPlayerId: e.attacker,
          priorityPlayerId: e.attacker } }, transitions: [] }));
      let fields = opened.get(e.match);
      if (!fields) { fields = new Set(); opened.set(e.match, fields); }
      fields.add(e.fieldId);
      return active(next(e, { match: after, phase: 'focus' }));
    }
    if (e.phase === 'focus') {
      if (command.kind !== 'pass-focus') blocked('wrong-command');
      if (command.actorPlayerId !== e.focus) blocked('wrong-actor');
      const reason = gate(e, 'showdown-close');
      if (reason) return active(e, reason);
      if (e.passes === 0) {
        const other = e.focus === e.attacker ? e.defender : e.attacker;
        const after = commit(e, draft => ({ match: { ...draft,
          frame: { ...draft.frame, focusPlayerId: other, priorityPlayerId: other } }, transitions: [] }));
        return active(next(e, { match: after, focus: other, passes: 1 }));
      }
      if (!e.combat) return settleNonCombat(e);
      const field = fieldOf(e.match, e.fieldId);
      if (field?.combat !== 'active') return active(e, 'combat-state-pending');
      const after = commit(e, draft => ({ match: { ...draft,
        frame: { ...draft.frame, stateOpen: false, focusPlayerId: null,
          priorityPlayerId: null } }, transitions: [] }));
      return active(next(e, { match: after, phase: 'damage', focus: null, passes: 0 }));
    }
    if (e.phase === 'damage') {
      if (command.kind !== 'assign-damage') blocked('wrong-command');
      const reason = gate(e, 'combat-deal');
      if (reason) return active(e, reason);
      let damage = e.damage;
      if (!damage) {
        try { damage = createDuelCombatDamageAuthorityV2(e.match, e.fieldId,
          e.services.combat, e.services.readHead); }
        catch { head(e); return active(e, 'combat-source-pending'); }
      }
      const result = submitDuelCombatDamageChoiceV2(damage, command.choice);
      if (result.kind === 'awaiting-defender') return active(next(e, { passes: 1, damage }));
      successor(e.match, result.state);
      return active(next(e, { match: result.state, phase: 'lethal', damage: null }));
    }
    if (command.kind !== 'continue') blocked('wrong-command');
    if (e.phase === 'draw-required') return settleFinalPointDraw(e);
    if (e.phase === 'lethal') return settleLethal(e);
    if (e.phase === 'heal') return settleHeal(e);
    if (e.phase === 'recall') return settleRecall(e);
    if (e.phase === 'fepr' || e.phase === 'after-result') return settleFepr(e);
    if (e.phase === 'result') return settleCombatResult(e);
    blocked('wrong-command');
  } finally { e.busy = false; }
}

function drawRequest(e: Entry, task: DuelBurnoutTask | null = null,
  intervention: DuelBurnoutIntervention | null = null): DuelEngagementDrawRequestV2 {
  return Object.freeze({ match: e.match, fieldId: e.fieldId, score: e.score!,
    taskId: ticket(e), draw: e.draw, task, intervention });
}
function drawProof(e: Entry, answer: { readonly status: string } | undefined,
  request: DuelEngagementDrawRequestV2): answer is DuelEngagementDrawProofV2 {
  return answer?.status === 'ready' &&
    (answer as DuelEngagementDrawProofV2).matchId === e.match.matchId &&
    (answer as DuelEngagementDrawProofV2).stateVersion === e.match.stateVersion &&
    (answer as DuelEngagementDrawProofV2).eventSeq === e.match.eventSeq &&
    (answer as DuelEngagementDrawProofV2).fieldId === e.fieldId &&
    (answer as DuelEngagementDrawProofV2).taskId === request.taskId &&
    (answer as DuelEngagementDrawProofV2).scorePlayerId === e.score?.playerId;
}
function drawZones(e: Entry) {
  const player = e.match.players.find(value => value.playerId === e.score!.playerId)!;
  return { hand: player.hand.map(card => ({ uid: card.uid, cardId: card.cardId })),
    mainDeck: player.remainingMainDeck.map(card => ({ uid: card.uid, cardId: card.cardId })),
    trash: player.trash.map(card => ({ uid: card.uid, cardId: card.cardId })) };
}
function sameCards(a: readonly { readonly uid: string; readonly cardId: string }[],
  b: readonly { readonly uid: string; readonly cardId: string }[]): boolean {
  return a.length === b.length && a.every((card, index) =>
    card.uid === b[index]?.uid && card.cardId === b[index]?.cardId);
}
function sameScoring(a: DuelScoringState, b: DuelScoringState): boolean {
  return a.turnNumber === b.turnNumber && a.victoryScore === b.victoryScore &&
    a.players.length === b.players.length && a.players.every((player, index) =>
      player.playerId === b.players[index]?.playerId && player.points === b.players[index]?.points &&
      player.scoredBattlefieldLocationIds.length === b.players[index]?.scoredBattlefieldLocationIds.length &&
      player.scoredBattlefieldLocationIds.every((id, i) =>
        id === b.players[index]?.scoredBattlefieldLocationIds[i]));
}
function installDraw(e: Entry, result: DuelDrawStepResult): DuelCanonicalPlayingStateV2 {
  const before = drawZones(e), after = result.zones, actor = e.score!.playerId;
  if (sameCards(before.hand, after.hand) && sameCards(before.mainDeck, after.mainDeck) &&
      sameCards(before.trash, after.trash) && sameScoring(e.match.scoring, result.scoring) &&
      result.status !== 'winner') return e.match;
  const oldDeck = new Set(before.mainDeck.map(card => card.uid));
  const drawn = after.hand.slice(before.hand.length);
  const transitions: DuelPhysicalZoneTransition[] = [
    ...drawn.filter(card => oldDeck.has(card.uid)).map(card => ({ uid: card.uid,
      from: { kind: 'main-deck' as const, zonePlayerId: actor },
      to: { kind: 'hand' as const, zonePlayerId: actor } })),
    ...(result.recycledCount ? before.trash.map(card => ({ uid: card.uid,
      from: { kind: 'trash' as const, zonePlayerId: actor },
      to: { kind: 'main-deck' as const, zonePlayerId: actor } })) : []),
    ...drawn.filter(card => !oldDeck.has(card.uid)).map(card => ({ uid: card.uid,
      from: { kind: 'main-deck' as const, zonePlayerId: actor },
      to: { kind: 'hand' as const, zonePlayerId: actor } })),
  ];
  return commit(e, draft => ({ match: { ...draft,
    players: draft.players.map(player => player.playerId !== actor ? player : { ...player,
      hand: after.hand.map(card => ({ ...card })),
      remainingMainDeck: after.mainDeck.map(card => ({ ...card })),
      trash: after.trash.map(card => ({ ...card })) }) as unknown as DuelCanonicalPlayingStateV2['players'],
    scoring: result.scoring,
    frame: result.status === 'winner' ? { ...draft.frame, phase: 'ended', stateOpen: false,
      focusPlayerId: null, priorityPlayerId: null, pendingPayment: null } : draft.frame },
    transitions }));
}
function drawStep(e: Entry, result: DuelDrawStepResult): DuelEngagementStepV2 {
  head(e);
  const after = installDraw(e, result);
  if (result.status === 'winner') return completed(e, after);
  const pending = result.cursor !== null;
  return active(next(e, { match: after, draw: result.cursor,
    drawStarted: true, phase: pending ? 'draw-required' : 'after-result' }),
    pending ? result.status === 'awaiting-first-resolution' ? 'first-burnout-pending' :
      'burnout-intervention-pending' : undefined);
}
function settleFinalPointDraw(e: Entry): DuelEngagementStepV2 {
  const score = e.score;
  const field = fieldOf(e.match, e.fieldId);
  if (score?.drawRequired !== 1 || score.pointsGained !== 0 || score.method !== 'conquer' ||
      score.locationId !== e.fieldId || score.playerId !== field?.controllerPlayerId ||
      !e.match.scoring.players.find(player => player.playerId === score.playerId)
        ?.scoredBattlefieldLocationIds.includes(e.fieldId)) blocked('invalid-authority');
  if (!e.drawStarted) {
    if (!e.services.sourceDraw) return active(e, 'final-point-source-pending');
    const request = drawRequest(e);
    let proof: ReturnType<NonNullable<DuelEngagementServicesV2['sourceDraw']>>;
    try { proof = e.services.sourceDraw(request); }
    catch { head(e); return active(e, 'final-point-source-pending'); }
    head(e);
    if (!drawProof(e, proof, request)) return active(e, 'final-point-source-pending');
    let result: DuelDrawStepResult;
    try { result = startDuelDraw(drawZones(e), e.match.board, e.match.scoring,
      score.playerId, 1, e.services.randomIndex); }
    catch { head(e); return active(e, 'draw-kernel-pending'); }
    return drawStep(e, result);
  }
  if (!e.draw) blocked('invalid-authority');
  if (e.draw.step === 'awaiting-first-resolution') {
    if (!e.services.firstBurnout) return active(e, 'first-burnout-pending');
    const opponent = e.match.board.playerIds.find(player => player !== score.playerId)!;
    const task: DuelBurnoutTask = { kind: 'burnout-point', actor: score.playerId,
      opponentPlayerId: opponent, burnoutIndex: e.draw.burnoutIndex,
      remainingCount: e.draw.remainingCount, canPreventOrReplace: true };
    const request = drawRequest(e, task);
    let answer: ReturnType<NonNullable<DuelEngagementServicesV2['firstBurnout']>>;
    try { answer = e.services.firstBurnout(request); }
    catch { head(e); return active(e, 'first-burnout-pending'); }
    head(e);
    if (!drawProof(e, answer, request) || !('firstBurnoutResolution' in answer))
      return active(e, 'first-burnout-pending');
    const resolution = answer.firstBurnoutResolution;
    if (resolution.kind === 'scored' && !sameScoring(resolution.scoring,
      gainDuelPoints(e.match.scoring, e.match.board, opponent, 1).state))
      return active(e, 'first-burnout-pending');
    if (resolution.kind === 'prevented' && !sameScoring(resolution.scoring, e.match.scoring))
      return active(e, 'first-burnout-pending');
    let result: DuelDrawStepResult;
    try { result = resumeDuelDraw(drawZones(e), e.match.board, e.match.scoring, e.draw,
      { firstBurnoutResolution: resolution }, e.services.randomIndex); }
    catch { head(e); return active(e, 'first-burnout-pending'); }
    return drawStep(e, result);
  }
  if (!e.services.intervention) return active(e, 'burnout-intervention-pending');
  const intervention: DuelBurnoutIntervention = { kind: 'burnout-intervention',
    actor: score.playerId, burnoutIndex: e.draw.burnoutIndex,
    remainingCount: e.draw.remainingCount };
  const request = drawRequest(e, null, intervention);
  let proof: ReturnType<NonNullable<DuelEngagementServicesV2['intervention']>>;
  try { proof = e.services.intervention(request); }
  catch { head(e); return active(e, 'burnout-intervention-pending'); }
  head(e);
  if (!drawProof(e, proof, request)) return active(e, 'burnout-intervention-pending');
  let result: DuelDrawStepResult;
  try { result = resumeDuelDraw(drawZones(e), e.match.board, e.match.scoring, e.draw,
    { interventionComplete: true }, e.services.randomIndex); }
  catch { head(e); return active(e, 'draw-kernel-pending'); }
  return drawStep(e, result);
}

function scoreIfNew(e: Entry, board: DuelCanonicalPlayingStateV2['board']):
  { readonly scoring: DuelCanonicalPlayingStateV2['scoring']; readonly outcome?: DuelScoreOutcome } {
  const prior = fieldOf(e.match, e.fieldId)!;
  const current = board.battlefields.find(field => field.locationId === e.fieldId)!;
  const owner = current.controllerPlayerId;
  if (!owner || prior.controllerPlayerId === owner ||
      e.match.scoring.players.find(player => player.playerId === owner)!
        .scoredBattlefieldLocationIds.includes(e.fieldId)) return { scoring: e.match.scoring };
  const scored = scoreDuelBattlefield(e.match.scoring, board, owner, e.fieldId, 'conquer', {
    phase: 'other', turnPlayerId: e.match.frame.turnPlayerId,
    controlEstablishedForPlayerId: owner, controlEstablishedLocationId: e.fieldId });
  return { scoring: scored.state, outcome: scored.outcome };
}
function settleNonCombat(e: Entry): DuelEngagementStepV2 {
  const reason = gate(e, 'conquer');
  if (reason) return active(e, reason);
  const board = endDuelNonCombatShowdown(e.match.board, e.fieldId);
  const scored = scoreIfNew(e, board);
  const after = commit(e, draft => ({ match: { ...draft, board, scoring: scored.scoring,
    frame: { ...draft.frame, stateOpen: false, focusPlayerId: null,
      priorityPlayerId: null } }, transitions: [] }));
  return active(next(e, { match: after, phase: scored.outcome?.drawRequired ? 'draw-required' : 'after-result',
    score: scored.outcome }));
}
function settleLethal(e: Entry): DuelEngagementStepV2 {
  const reason = gate(e, 'deathknell');
  if (reason) return active(e, reason);
  let lethal: readonly PublicDuelUnitObject[];
  try { lethal = queryLethalDuelUnitCandidates(e.match, {
    currentMight: unit => e.services.lethalEvaluators.currentMight(structuredClone(unit)),
    lethalDamageThreshold: (unit, might) =>
      e.services.lethalEvaluators.lethalDamageThreshold(structuredClone(unit), might) }); }
  catch { return active(e, 'derived-might-pending'); }
  head(e);
  if (!lethal.length) return active(next(e, { phase: 'heal' }));
  if (lethal.some(unit => e.match.gears.some(gear => gear.attachedToUID === unit.objectId) ||
      e.match.unitMeta[unit.objectId]?.trait.kind === 'token')) return active(e, 'pre-exit-gear-or-token-pending');
  const plan = planDuelUnitKills(e.match, lethal.map(unit => unit.objectId), 'passive');
  let answer: ReturnType<DuelEngagementServicesV2['approveLethal']>;
  try { answer = e.services.approveLethal(structuredClone(plan), e.match); }
  catch { return active(e, 'kill-approval-pending'); }
  if (answer?.status !== 'approved' || answer.preExitSettled !== true ||
      answer.deathknellSettled !== true || !Array.isArray(answer.approvedUnitUIDs) ||
      new Set(answer.approvedUnitUIDs).size !== answer.approvedUnitUIDs.length ||
      !answer.approvedUnitUIDs.every(uid => lethal.some(unit => unit.objectId === uid)))
    return active(e, 'kill-approval-pending');
  if (!answer.approvedUnitUIDs.length) return active(e, 'unresolved-lethal-pending');
  const transitions: DuelPhysicalZoneTransition[] = answer.approvedUnitUIDs.map(uid => {
    const unit = e.match.board.units.find(value => value.objectId === uid)!;
    return { uid, from: e.match.board.bases.some(base => base.locationId === unit.locationId)
      ? { kind: 'board-base', locationId: unit.locationId }
      : { kind: 'board-battlefield', locationId: unit.locationId },
    to: { kind: 'trash', zonePlayerId: e.match.unitMeta[uid]!.ownerPlayerId } };
  });
  const after = commit(e, draft => ({ match: commitApprovedDuelUnitKills(draft,
    { plan, approvedUnitUIDs: answer.approvedUnitUIDs }).state, transitions }));
  return active(next(e, { match: after, phase: 'heal' }));
}
function settleHeal(e: Entry): DuelEngagementStepV2 {
  const reason = gate(e, 'combat-cleanup');
  if (reason) return active(e, reason);
  const damaged = e.match.board.units.filter(unit => e.match.unitMeta[unit.objectId]!.damageMarks.length)
    .map(unit => unit.objectId);
  if (!damaged.length) return active(next(e, { phase: 'recall' }));
  const after = commit(e, draft => ({ match: healAllDuelUnitDamage(draft, damaged).state,
    transitions: [] }));
  return active(next(e, { match: after, phase: 'recall' }));
}
function settleRecall(e: Entry): DuelEngagementStepV2 {
  const reason = gate(e, 'combat-cleanup');
  if (reason) return active(e, reason);
  const present = e.match.board.units.filter(unit => unit.locationId === e.fieldId);
  const attackers = present.filter(unit => unit.controllerPlayerId === e.attacker);
  if (!present.some(unit => unit.controllerPlayerId === e.defender) || !attackers.length)
    return active(next(e, { phase: 'fepr' }));
  const base = e.match.board.bases.find(value => value.ownerPlayerId === e.attacker);
  if (!base) return active(e, 'recall-base-pending');
  const transitions: DuelPhysicalZoneTransition[] = attackers.map(unit => ({ uid: unit.objectId,
    from: { kind: 'board-battlefield', locationId: e.fieldId },
    to: { kind: 'board-base', locationId: base.locationId } }));
  const after = commit(e, draft => {
    let board = draft.board;
    for (const unit of attackers) board = relocateDuelUnit(board, unit.objectId, base.locationId);
    return { match: { ...draft, board }, transitions };
  });
  return active(next(e, { match: after, phase: 'fepr', recalled: true }));
}
function settleFepr(e: Entry): DuelEngagementStepV2 {
  const reason = gate(e, 'fepr');
  if (reason) return active(e, reason);
  let answer: ReturnType<DuelEngagementServicesV2['fepr']>;
  try { answer = e.services.fepr(e.match, ticket(e)); }
  catch { return active(e, 'fepr-pending'); }
  head(e);
  if (answer?.status !== 'none') return active(e, 'fepr-pending');
  if (e.phase === 'fepr') return active(next(e, { phase: 'result' }));
  const after = commit(e, draft => ({ match: { ...draft,
    board: applyOpenDuelCleanup(draft.board),
    frame: { ...draft.frame, stateOpen: true, focusPlayerId: null,
      priorityPlayerId: draft.frame.turnPlayerId } }, transitions: [] }));
  return completed(e, after);
}
function settleCombatResult(e: Entry): DuelEngagementStepV2 {
  const reason = gate(e, 'combat-result') ?? gate(e, 'conquer') ?? gate(e, 'combat-end');
  if (reason) return active(e, reason);
  const resolved = endDuelCombat(e.match.board, e.fieldId,
    { recalledAttackersDuringCleanup: e.recalled });
  const scored = scoreIfNew(e, resolved.board);
  const after = commit(e, draft => ({ match: { ...draft, board: resolved.board,
    scoring: scored.scoring, frame: { ...draft.frame, focusPlayerId: null,
      priorityPlayerId: null } }, transitions: [] }));
  return active(next(e, { match: after,
    phase: scored.outcome?.drawRequired ? 'draw-required' : 'after-result',
    score: scored.outcome, combatResult: resolved.result }));
}
