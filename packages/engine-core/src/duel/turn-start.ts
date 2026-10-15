// CR v1.4 315.1–315.2 only: trusted, resumable Awaken + Beginning-step kernel.
//
// This artifact intentionally does not extend the formal match schema. `turnProgress` is a
// private session sidecar: it contains only a cursor and task identities. The canonical match
// remains the sole authority for board, resources, units, score, zones and frame clocks.
import {
  beginDuelScoreTurn,
  type DuelScoringState,
} from './scoring.js';
import {
  restoreDuelResources,
  type DuelBaseRune,
  type DuelGoldToken,
  type DuelResources,
} from './resources.js';
import {
  readyDuelUnits,
  type DuelUnitLifecycleState,
} from './unit-lifecycle.js';
import { commitDuelPlayingMutation, detachedDuelPlaying } from './canonical-transaction.js';
import type {
  DuelCanonicalMatchState,
  DuelCanonicalPlayingState,
  DuelCommandSession,
} from './canonical-session.js';

export type DuelTurnStartStep = 'awaken' | 'beginning' | 'scoring';
export type DuelTurnStartTaskKind = 'readiness' | 'other-permanents' | 'beginning-effects';

/** Private JSON-compatible cursor. It never contains card, board, resource or zone payload. */
export interface DuelTurnProgress {
  readonly kind: 'start';
  readonly turn: number;
  readonly rootTaskID: string;
  readonly step: DuelTurnStartStep;
  readonly pendingTaskID: string | null;
  readonly consumedIDs: readonly string[];
}

/** The current command session remains authoritative; this is only its private cursor sidecar. */
export type DuelAwakenBeginningSession = DuelCommandSession & {
  readonly turnProgress?: DuelTurnProgress;
};

export interface DuelTurnStartContext {
  readonly match: DuelCanonicalPlayingState;
  readonly turnPlayerId: string;
  readonly turnNumber: number;
  readonly rootTaskID: string;
  readonly taskID: string;
  readonly step: DuelTurnStartStep;
  readonly kind: DuelTurnStartTaskKind;
}

/** Explicit result from the trusted readiness service. Empty UID lists are an explicit no-op. */
export interface DuelReadinessResolution {
  readonly status: 'ready';
  readonly unitUIDs: readonly string[];
  readonly runeUIDs: readonly string[];
  readonly goldUIDs: readonly string[];
}

/** A trusted provider may defer; omission of a required provider is also pending, never a no-op. */
export interface DuelPendingResolution {
  readonly status: 'pending';
  readonly detail?: string;
}

export type DuelReadinessProviderResult = DuelReadinessResolution | DuelPendingResolution;

/** Explicit proof that unsupported permanent classes were considered by a trusted service. */
export type DuelOtherPermanentResolution =
  | { readonly status: 'verified-no-effect' }
  | { readonly status: 'applied'; readonly match: DuelCanonicalPlayingState };
export type DuelBeginningEffectsResolution = DuelOtherPermanentResolution;
export type DuelRequiredHookResult =
  | DuelOtherPermanentResolution
  | DuelPendingResolution;

/**
 * All three hooks are required boundaries. The readiness hook covers formal Unit/Rune/Gold
 * sources; otherPermanents covers Legend/Battlefield/Gear readiness. Fixtures can return
 * explicit `verified-no-effect`/empty UID lists, but a missing hook is pending.
 */
export interface DuelAwakenBeginningServices {
  readonly readiness?: (context: DuelTurnStartContext) => DuelReadinessProviderResult;
  readonly otherPermanents?: (context: DuelTurnStartContext) => DuelRequiredHookResult;
  readonly beginningEffects?: (context: DuelTurnStartContext) => DuelRequiredHookResult;
  /** Descriptive aliases accepted for integrations that name the required boundaries explicitly. */
  readonly awakenReadiness?: (context: DuelTurnStartContext) => DuelReadinessProviderResult;
  readonly otherPermanentReadiness?: (context: DuelTurnStartContext) => DuelRequiredHookResult;
  readonly beginning?: (context: DuelTurnStartContext) => DuelRequiredHookResult;
}

export interface DuelPendingTurnTask {
  readonly taskId: string;
  readonly rootTaskID: string;
  readonly turn: number;
  readonly step: DuelTurnStartStep;
  readonly kind: DuelTurnStartTaskKind;
}

export type DuelTurnStartStatus = 'pending' | 'scoring' | 'duplicate' | 'rejected';
export type DuelTurnStartRejection =
  | 'invalid-session'
  | 'invalid-stage'
  | 'invalid-phase'
  | 'wrong-task'
  | 'stale-task'
  | 'task-conflict'
  | 'invalid-resolution'
  | 'invalid-readiness-target'
  | 'provider-error'
  | 'transaction-rejected';

export interface DuelTurnStartResult {
  readonly session: DuelAwakenBeginningSession;
  readonly match: DuelCanonicalMatchState;
  readonly status: DuelTurnStartStatus;
  readonly pending?: DuelPendingTurnTask;
  readonly duplicate: boolean;
  /** Persist the complete session, including sidecar metadata, before acknowledging. */
  readonly persistRequired: boolean;
  readonly reason?: DuelTurnStartRejection;
}

interface TaskSpec {
  readonly id: string;
  readonly step: DuelTurnStartStep;
  readonly kind: DuelTurnStartTaskKind;
}

interface ParsedProgress {
  readonly progress: DuelTurnProgress | undefined;
  readonly error?: DuelTurnStartRejection;
}

interface ParsedReadiness {
  readonly resolution: DuelReadinessResolution;
  readonly error?: DuelTurnStartRejection;
}

const START_STEPS: readonly DuelTurnStartStep[] = ['awaken', 'beginning', 'scoring'];
const PROGRESS_KEYS = ['kind', 'turn', 'rootTaskID', 'step', 'pendingTaskID', 'consumedIDs'] as const;
const READINESS_KEYS = ['status', 'unitUIDs', 'runeUIDs', 'goldUIDs'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key))) &&
    required.every(key => Object.hasOwn(value, key)) &&
    keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && 'value' in descriptor;
    });
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function denseStrings(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor) || !nonBlank(descriptor.value)) return false;
  }
  return true;
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function taskIDs(rootTaskID: string): readonly TaskSpec[] {
  return [
    { id: `${rootTaskID}:awaken:readiness`, step: 'awaken', kind: 'readiness' },
    { id: `${rootTaskID}:awaken:other-permanents`, step: 'awaken', kind: 'other-permanents' },
    { id: `${rootTaskID}:beginning:effects`, step: 'beginning', kind: 'beginning-effects' },
  ];
}

function rootTaskID(match: DuelCanonicalPlayingState): string {
  return `duel-turn-start:${match.matchId}:turn-${match.frame.turnNumber}`;
}

function parsedProgress(session: DuelAwakenBeginningSession): ParsedProgress {
  if (!Object.hasOwn(session, 'turnProgress') || session.turnProgress === undefined) return { progress: undefined };
  const raw = session.turnProgress;
  if (!isRecord(raw) || !exactKeys(raw, PROGRESS_KEYS)) return { progress: undefined, error: 'invalid-session' };
  if (raw.kind !== 'start' || !safeCounter(raw.turn) || raw.turn < 1 ||
      !nonBlank(raw.rootTaskID) || !START_STEPS.includes(raw.step as DuelTurnStartStep) ||
      (raw.pendingTaskID !== null && !nonBlank(raw.pendingTaskID)) ||
      !denseStrings(raw.consumedIDs) || !uniqueStrings(raw.consumedIDs)) {
    return { progress: undefined, error: 'invalid-session' };
  }
  const progress: DuelTurnProgress = {
    kind: 'start', turn: raw.turn, rootTaskID: raw.rootTaskID,
    step: raw.step as DuelTurnStartStep, pendingTaskID: raw.pendingTaskID,
    consumedIDs: [...raw.consumedIDs],
  };
  const expected = taskIDs(progress.rootTaskID).map(task => task.id);
  if (progress.consumedIDs.some(id => !expected.includes(id))) return { progress: undefined, error: 'invalid-session' };
  if (progress.pendingTaskID !== null && !expected.includes(progress.pendingTaskID))
    return { progress: undefined, error: 'invalid-session' };
  if (progress.pendingTaskID !== null && progress.consumedIDs.includes(progress.pendingTaskID))
    return { progress: undefined, error: 'invalid-session' };
  return { progress };
}

function cursorMatchesMatch(progress: DuelTurnProgress, match: DuelCanonicalPlayingState): boolean {
  if (progress.turn !== match.frame.turnNumber || progress.rootTaskID !== rootTaskID(match)) return false;
  const specs = taskIDs(progress.rootTaskID);
  const readinessID = specs[0]?.id;
  const otherID = specs[1]?.id;
  const beginningID = specs[2]?.id;
  const consumed = progress.consumedIDs;
  if (progress.pendingTaskID === readinessID) {
    return progress.step === 'awaken' && match.frame.phase === 'awaken' && consumed.length === 0;
  }
  if (progress.pendingTaskID === otherID) {
    return progress.step === 'awaken' && match.frame.phase === 'awaken' &&
      consumed.length === 1 && consumed[0] === readinessID;
  }
  if (progress.pendingTaskID === beginningID) {
    return progress.step === 'beginning' && match.frame.phase === 'beginning' &&
      consumed.length === 2 && consumed[0] === readinessID && consumed[1] === otherID;
  }
  return progress.pendingTaskID === null && progress.step === 'scoring' &&
    match.frame.phase === 'scoring' && consumed.length === 3 &&
    consumed[0] === readinessID && consumed[1] === otherID && consumed[2] === beginningID;
}

function result(
  session: DuelAwakenBeginningSession,
  status: DuelTurnStartStatus,
  duplicate: boolean,
  persistRequired: boolean,
  pending?: DuelPendingTurnTask,
  reason?: DuelTurnStartRejection,
): DuelTurnStartResult {
  return { session, match: session.match, status, duplicate, persistRequired,
    ...(pending ? { pending } : {}), ...(reason ? { reason } : {}) };
}

function rejected(session: DuelAwakenBeginningSession, reason: DuelTurnStartRejection): DuelTurnStartResult {
  return result(session, 'rejected', false, false, undefined, reason);
}

function taskFor(progress: DuelTurnProgress, taskID: string): TaskSpec | undefined {
  return taskIDs(progress.rootTaskID).find(task => task.id === taskID);
}

function pendingTask(progress: DuelTurnProgress): DuelPendingTurnTask | undefined {
  if (progress.pendingTaskID === null) return undefined;
  const task = taskFor(progress, progress.pendingTaskID);
  if (task === undefined) return undefined;
  return { taskId: task.id, rootTaskID: progress.rootTaskID, turn: progress.turn, step: task.step, kind: task.kind };
}

function sidecar(session: DuelAwakenBeginningSession, progress: DuelTurnProgress): DuelAwakenBeginningSession {
  return { ...session, turnProgress: {
    kind: progress.kind, turn: progress.turn, rootTaskID: progress.rootTaskID, step: progress.step,
    pendingTaskID: progress.pendingTaskID, consumedIDs: [...progress.consumedIDs],
  } };
}

function withProgress(
  session: DuelAwakenBeginningSession,
  progress: DuelTurnProgress,
  pendingID: string | null,
  step: DuelTurnStartStep,
  consumedID?: string,
): DuelAwakenBeginningSession {
  const consumed = consumedID === undefined || progress.consumedIDs.includes(consumedID)
    ? [...progress.consumedIDs]
    : [...progress.consumedIDs, consumedID];
  return sidecar(session, { ...progress, step, pendingTaskID: pendingID, consumedIDs: consumed });
}

function playing(session: DuelAwakenBeginningSession): DuelCanonicalPlayingState | undefined {
  return session.match.stage === 'playing' ? session.match : undefined;
}

function validInitialSession(session: DuelAwakenBeginningSession): DuelTurnStartResult | undefined {
  const match = playing(session);
  if (match === undefined) return rejected(session, 'invalid-stage');
  if (match.frame.phase !== 'awaiting-turn-start' || match.frame.priorityPlayerId !== null ||
      match.frame.pendingPayment !== null) return rejected(session, 'invalid-phase');
  const progress = parsedProgress(session);
  if (progress.error !== undefined) return rejected(session, progress.error);
  if (progress.progress !== undefined) return rejected(session, 'task-conflict');
  if (match.frame.turnNumber < 1 || !nonBlank(match.frame.turnPlayerId) ||
      !match.roster.some(seat => seat.playerId === match.frame.turnPlayerId))
    return rejected(session, 'invalid-session');
  return undefined;
}

function context(match: DuelCanonicalPlayingState, root: string, spec: TaskSpec): DuelTurnStartContext {
  return { match: detachedDuelPlaying(match), turnPlayerId: match.frame.turnPlayerId, turnNumber: match.frame.turnNumber,
    rootTaskID: root, taskID: spec.id, step: spec.step, kind: spec.kind };
}

function readService(services: DuelAwakenBeginningServices):
  ((context: DuelTurnStartContext) => DuelReadinessProviderResult) | undefined {
  return services.readiness ?? services.awakenReadiness;
}
function otherService(services: DuelAwakenBeginningServices):
  ((context: DuelTurnStartContext) => DuelRequiredHookResult) | undefined {
  return services.otherPermanents ?? services.otherPermanentReadiness;
}
function beginningService(services: DuelAwakenBeginningServices):
  ((context: DuelTurnStartContext) => DuelRequiredHookResult) | undefined {
  return services.beginningEffects ?? services.beginning;
}

function parseReadiness(raw: unknown): ParsedReadiness {
  if (!isRecord(raw) || !exactKeys(raw, READINESS_KEYS) || raw.status !== 'ready' ||
      !denseStrings(raw.unitUIDs) || !denseStrings(raw.runeUIDs) || !denseStrings(raw.goldUIDs))
    return { resolution: { status: 'ready', unitUIDs: [], runeUIDs: [], goldUIDs: [] }, error: 'invalid-resolution' };
  const unitUIDs = [...raw.unitUIDs], runeUIDs = [...raw.runeUIDs], goldUIDs = [...raw.goldUIDs];
  if (!uniqueStrings(unitUIDs) || !uniqueStrings(runeUIDs) || !uniqueStrings(goldUIDs) ||
      !uniqueStrings([...unitUIDs, ...runeUIDs, ...goldUIDs]))
    return { resolution: { status: 'ready', unitUIDs, runeUIDs, goldUIDs }, error: 'invalid-resolution' };
  return { resolution: { status: 'ready', unitUIDs, runeUIDs, goldUIDs } };
}

function isPending(raw: unknown): raw is DuelPendingResolution {
  return isRecord(raw) && exactKeys(raw, ['status'], ['detail']) && raw.status === 'pending';
}

function hookSucceeded(raw: unknown): raw is DuelOtherPermanentResolution {
  return isRecord(raw) && ((exactKeys(raw, ['status']) && raw.status === 'verified-no-effect') ||
    (exactKeys(raw, ['status', 'match']) && raw.status === 'applied'));
}

/** An applied hook is a proposed detached aggregate, not a boolean claim or a second clock. */
function applyHook(session: DuelAwakenBeginningSession, hook: DuelOtherPermanentResolution):
  DuelAwakenBeginningSession {
  if (hook.status === 'verified-no-effect') return session;
  const before = playing(session);
  if (before === undefined) throw new TypeError('hook requires a playing match');
  const proposal = detachedDuelPlaying(hook.match);
  if (proposal.frame.phase !== before.frame.phase ||
      proposal.frame.turnNumber !== before.frame.turnNumber ||
      proposal.frame.turnPlayerId !== before.frame.turnPlayerId ||
      proposal.frame.priorityPlayerId !== before.frame.priorityPlayerId ||
      proposal.frame.focusPlayerId !== before.frame.focusPlayerId ||
      proposal.frame.stateOpen !== before.frame.stateOpen ||
      proposal.frame.pendingPayment !== null ||
      proposal.scoring.turnNumber !== before.scoring.turnNumber ||
      proposal.stateVersion !== before.stateVersion || proposal.eventSeq !== before.eventSeq)
    throw new TypeError('hook cannot grant priority, change phase/turn, or allocate clocks');
  const next = commitDuelPlayingMutation(before, () => proposal);
  if (next === before) throw new TypeError('applied hook must actually change the aggregate');
  return { ...session, match: next };
}

function resolutionForTask(raw: unknown, task: TaskSpec):
  | { kind: 'readiness'; readiness: DuelReadinessResolution }
  | { kind: 'hook'; hook: DuelOtherPermanentResolution }
  | undefined {
  if (task.kind === 'readiness') {
    const candidate = isRecord(raw) && raw.kind === 'readiness' && Object.hasOwn(raw, 'resolution') ? raw.resolution : raw;
    const parsed = parseReadiness(candidate);
    return parsed.error === undefined ? { kind: 'readiness', readiness: parsed.resolution } : undefined;
  }
  const candidate = isRecord(raw) && (raw.kind === 'other-permanents' || raw.kind === 'beginning-effects') &&
    Object.hasOwn(raw, 'resolution') ? raw.resolution : raw;
  return hookSucceeded(candidate) ? { kind: 'hook', hook: candidate } : undefined;
}

function resourceLocationIDs(match: DuelCanonicalPlayingState): readonly { playerId: string; locationId: string }[] {
  return match.board.bases.map(base => ({ playerId: base.ownerPlayerId, locationId: base.locationId }));
}

function checkReadinessTargets(
  match: DuelCanonicalPlayingState,
  resolution: DuelReadinessResolution,
): DuelTurnStartRejection | undefined {
  const turnPlayer = match.frame.turnPlayerId;
  const unitIDs = new Set(match.board.units.map(unit => unit.objectId));
  for (const uid of resolution.unitUIDs) {
    const unit = match.board.units.find(entry => entry.objectId === uid);
    if (!unitIDs.has(uid) || unit === undefined || unit.controllerPlayerId !== turnPlayer)
      return 'invalid-readiness-target';
  }
  const runes = match.resources.bases.flatMap(base => base.baseRunes);
  for (const uid of resolution.runeUIDs) {
    const rune = runes.find(entry => entry.uid === uid);
    if (rune === undefined || rune.controllerPlayerId !== turnPlayer) return 'invalid-readiness-target';
  }
  const gold = match.resources.bases.flatMap(base => base.goldTokens);
  for (const uid of resolution.goldUIDs) {
    const token = gold.find(entry => entry.uid === uid);
    if (token === undefined || token.controllerPlayerId !== turnPlayer) return 'invalid-readiness-target';
  }
  return undefined;
}

function readyResources(resources: DuelResources, match: DuelCanonicalPlayingState,
  runeUIDs: readonly string[], goldUIDs: readonly string[]): DuelResources {
  if (runeUIDs.length === 0 && goldUIDs.length === 0) return resources;
  const runes = new Set(runeUIDs), gold = new Set(goldUIDs);
  const raw = {
    playerIds: [...resources.playerIds] as [string, string],
    players: resources.players.map(player => ({ playerId: player.playerId,
      runeDeck: player.runeDeck.map(rune => ({ ...rune })),
      runePool: { energy: player.runePool.energy, power: { ...player.runePool.power } },
    })) as unknown as [DuelResources['players'][0], DuelResources['players'][1]],
    bases: resources.bases.map(base => ({
      playerId: base.playerId, locationId: base.locationId,
      baseRunes: base.baseRunes.map((rune: DuelBaseRune) => ({ ...rune, readied: rune.readied || runes.has(rune.uid) })),
      goldTokens: base.goldTokens.map((token: DuelGoldToken) => ({ ...token, readied: token.readied || gold.has(token.uid) })),
    })) as unknown as [DuelResources['bases'][0], DuelResources['bases'][1]],
    retiredGoldUids: [...resources.retiredGoldUids],
  };
  return restoreDuelResources(raw, resourceLocationIDs(match));
}

function commitMatch(session: DuelAwakenBeginningSession,
  mutate: (draft: DuelCanonicalPlayingState) => DuelCanonicalPlayingState): DuelAwakenBeginningSession {
  const match = playing(session);
  if (match === undefined) throw new TypeError('not playing');
  const next = commitDuelPlayingMutation(match, mutate);
  return next === match ? session : { ...session, match: next };
}

function phaseMutation(match: DuelCanonicalPlayingState, phase: 'awaken' | 'beginning' | 'scoring',
  scoring?: DuelScoringState): DuelCanonicalPlayingState {
  const nextFrame = { ...match.frame, phase, priorityPlayerId: null, focusPlayerId: null,
    stateOpen: true, pendingPayment: null };
  return { ...match, frame: nextFrame, ...(scoring ? { scoring } : {}) };
}

function commitAwakenPhase(session: DuelAwakenBeginningSession): DuelAwakenBeginningSession {
  return commitMatch(session, match => phaseMutation(match, 'awaken',
    beginDuelScoreTurn(match.scoring, match.board, match.frame.turnNumber)));
}

function commitReadiness(session: DuelAwakenBeginningSession, resolution: DuelReadinessResolution): DuelAwakenBeginningSession {
  return commitMatch(session, match => {
    // `readyDuelUnits` intentionally rejects an empty action list; an explicit empty provider
    // result is nevertheless a valid verified no-op for this phase.
    const unitState = resolution.unitUIDs.length === 0
      ? match
      : readyDuelUnits(match as unknown as DuelUnitLifecycleState, resolution.unitUIDs).state as
        unknown as DuelCanonicalPlayingState;
    const resources = readyResources(unitState.resources, match, resolution.runeUIDs, resolution.goldUIDs);
    // Awaken remains the canonical phase until all required Awaken boundaries complete. The
    // single beginning-phase transition is committed only after the other-permanent hook.
    return phaseMutation({ ...unitState, resources }, 'awaken');
  });
}

function commitBeginning(session: DuelAwakenBeginningSession): DuelAwakenBeginningSession {
  return commitMatch(session, match => phaseMutation(match, 'scoring'));
}

function pendingResult(session: DuelAwakenBeginningSession, progress: DuelTurnProgress): DuelTurnStartResult {
  const task = pendingTask(progress);
  if (task === undefined) return rejected(session, 'invalid-session');
  return result(session, 'pending', false, true, task);
}

function runOther(
  session: DuelAwakenBeginningSession,
  progress: DuelTurnProgress,
  services: DuelAwakenBeginningServices,
): DuelTurnStartResult {
  const match = playing(session);
  if (match === undefined) return rejected(session, 'invalid-stage');
  const spec = taskIDs(progress.rootTaskID)[1];
  if (spec === undefined) return rejected(session, 'invalid-session');
  const provider = otherService(services);
  if (provider === undefined) {
    const next = withProgress(session, progress, spec.id, 'awaken');
    return pendingResult(next, next.turnProgress!);
  }
  let raw: unknown;
  try { raw = provider(context(match, progress.rootTaskID, spec)); }
  catch { return rejected(session, 'provider-error'); }
  if (isPending(raw)) {
    const next = withProgress(session, progress, spec.id, 'awaken');
    return pendingResult(next, next.turnProgress!);
  }
  if (!hookSucceeded(raw)) return rejected(session, 'invalid-resolution');
  let applied: DuelAwakenBeginningSession;
  try { applied = applyHook(session, raw); }
  catch { return rejected(session, 'invalid-resolution'); }
  const nextProgress = withProgress(applied, progress, null, 'awaken', spec.id);
  return enterBeginning(nextProgress, services);
}

function enterBeginning(session: DuelAwakenBeginningSession, services: DuelAwakenBeginningServices): DuelTurnStartResult {
  const progress = parsedProgress(session).progress;
  const match = playing(session);
  if (progress === undefined || match === undefined) return rejected(session, 'invalid-session');
  const beginSpec = taskIDs(progress.rootTaskID)[2];
  if (beginSpec === undefined) return rejected(session, 'invalid-session');
  const beginningProgress = withProgress(session, progress, beginSpec.id, 'beginning');
  let next: DuelAwakenBeginningSession;
  try {
    next = commitMatch(beginningProgress, current => phaseMutation(current, 'beginning'));
  } catch {
    return rejected(session, 'transaction-rejected');
  }
  const pendingBeginning = withProgress(next, progress, beginSpec.id, 'beginning');
  const provider = beginningService(services);
  if (provider === undefined) return pendingResult(pendingBeginning, pendingBeginning.turnProgress!);
  let raw: unknown;
  try { raw = provider(context(playing(pendingBeginning)!, progress.rootTaskID, beginSpec)); }
  catch { return rejected(pendingBeginning, 'provider-error'); }
  if (isPending(raw)) return pendingResult(pendingBeginning, pendingBeginning.turnProgress!);
  if (!hookSucceeded(raw)) return rejected(pendingBeginning, 'invalid-resolution');
  let applied: DuelAwakenBeginningSession;
  try { applied = applyHook(pendingBeginning, raw); }
  catch { return rejected(pendingBeginning, 'invalid-resolution'); }
  return finishBeginning(applied, beginSpec);
}

function finishBeginning(session: DuelAwakenBeginningSession, spec: TaskSpec): DuelTurnStartResult {
  const parsed = parsedProgress(session).progress;
  if (parsed === undefined) return rejected(session, 'invalid-session');
  let next: DuelAwakenBeginningSession;
  try { next = commitBeginning(session); }
  catch { return rejected(session, 'transaction-rejected'); }
  const complete = withProgress(next, parsed, null, 'scoring', spec.id);
  return result(complete, 'scoring', false, true);
}

function processReadiness(
  session: DuelAwakenBeginningSession,
  progress: DuelTurnProgress,
  resolution: DuelReadinessResolution,
  services: DuelAwakenBeginningServices,
): DuelTurnStartResult {
  const match = playing(session);
  const readinessSpec = taskIDs(progress.rootTaskID)[0];
  if (match === undefined || readinessSpec === undefined) return rejected(session, 'invalid-session');
  const targetError = checkReadinessTargets(match, resolution);
  if (targetError !== undefined) return rejected(session, targetError);
  let next: DuelAwakenBeginningSession;
  try {
    next = commitReadiness(session, resolution);
  } catch {
    return rejected(session, 'transaction-rejected');
  }
  const consumed = withProgress(next, progress, null, 'beginning', readinessSpec.id);
  return runOther(consumed, consumed.turnProgress!, services);
}

/** Start CR 315.1. Missing or pending required providers remain resumable tasks. */
export function beginAwaken(
  session: DuelAwakenBeginningSession,
  services: DuelAwakenBeginningServices,
): DuelTurnStartResult {
  const initialError = validInitialSession(session);
  if (initialError !== undefined) return initialError;
  const match = playing(session)!;
  const root = rootTaskID(match);
  const specs = taskIDs(root);
  const readinessSpec = specs[0]!;
  // Enter Awaken before asking the trusted provider, but keep the candidate private until its
  // response is structurally valid. A malformed/wrong-target response therefore leaves the
  // caller's original awaiting-turn-start session untouched.
  let awakened: DuelAwakenBeginningSession;
  try { awakened = commitAwakenPhase(session); }
  catch { return rejected(session, 'transaction-rejected'); }
  const readiness = readService(services);
  let raw: unknown;
  if (readiness === undefined) raw = undefined;
  else {
    try { raw = readiness(context(playing(awakened)!, root, readinessSpec)); }
    catch { return rejected(session, 'provider-error'); }
  }
  const progress: DuelTurnProgress = { kind: 'start', turn: match.frame.turnNumber, rootTaskID: root,
    step: 'awaken', pendingTaskID: null, consumedIDs: [] };
  if (raw === undefined || isPending(raw)) {
    const pendingProgress = { ...progress, pendingTaskID: readinessSpec.id };
    return pendingResult(sidecar(awakened, pendingProgress), pendingProgress);
  }
  const parsed = parseReadiness(raw);
  if (parsed.error !== undefined) return rejected(session, parsed.error);
  const targetError = checkReadinessTargets(playing(awakened)!, parsed.resolution);
  if (targetError !== undefined) return rejected(session, targetError);
  return processReadiness(awakened, progress, parsed.resolution, services);
}

/** Resume exactly one pending trusted task; duplicate/old task IDs never re-run readiness or effects. */
export function resumeAwakenBeginning(
  session: DuelAwakenBeginningSession,
  taskId: string,
  trustedResolution: unknown,
  services: DuelAwakenBeginningServices,
): DuelTurnStartResult {
  if (!nonBlank(taskId)) return rejected(session, 'wrong-task');
  const parsed = parsedProgress(session);
  if (parsed.error !== undefined || parsed.progress === undefined) return rejected(session, parsed.error ?? 'stale-task');
  const progress = parsed.progress;
  const match = playing(session);
  if (match === undefined) return rejected(session, 'invalid-stage');
  if (!cursorMatchesMatch(progress, match)) return rejected(session, 'stale-task');
  if (progress.consumedIDs.includes(taskId)) return result(session, 'duplicate', true, false);
  if (progress.pendingTaskID !== taskId) return rejected(session, 'wrong-task');
  const spec = taskFor(progress, taskId);
  if (spec === undefined) return rejected(session, 'stale-task');
  const resolved = resolutionForTask(trustedResolution, spec);
  if (resolved === undefined) return rejected(session, 'invalid-resolution');
  if (resolved.kind === 'readiness') return processReadiness(session, progress, resolved.readiness, services);
  let applied: DuelAwakenBeginningSession;
  try { applied = applyHook(session, resolved.hook); }
  catch { return rejected(session, 'invalid-resolution'); }
  if (spec.kind === 'other-permanents') {
    const next = withProgress(applied, progress, null, 'awaken', spec.id);
    return enterBeginning(next, services);
  }
  return finishBeginning(applied, spec);
}

// Keep these imports/types visible to declaration consumers that compile this artifact in isolation.
export type { DuelScoringState, DuelBaseRune, DuelGoldToken, DuelResources, DuelUnitLifecycleState };
