// INTERNAL, in-memory V2 command boundary. Not a wire DTO, archive codec, turn executor or
// Cost Resolver. Callers must persist the ENTIRE private session before acknowledging a receipt.
// V1 session/transactions deliberately never receive a V2 match (or a schema-downgraded copy).
import {
  createDuelMatchV2, resolveDuelMulliganV2, commitDuelPlayingMutationV2,
  activateDuelGoldPowerV2, assertCurrentDuelPhysicalReferenceV2,
  inspectDuelNativeCommitPathV2, assertAdmittedDuelMatchV2,
  assertDuelNativeTokenInventoryCurrentV2,
  type DuelCanonicalPlayingStateV2, type DuelMatchStateV2, type DuelTrustedCardTypeResolverV2,
} from './core-v2.js';
import { withDuelPlayingV2SemanticEventClock } from './canonical-transaction.js';
import type { DuelMatchMetadata } from './match-state.js';
import type { DuelSetupSeat } from './setup.js';
import {
  activateBasicRuneEnergy, activateBasicRunePower,
  payDuelRuneCost, DUEL_DOMAINS, type DuelRuneCost, type DuelPaymentPlan,
  type DuelResourceTiming, activateDuelGoldPower as activateDuelGoldPowerResource,
} from './resources.js';
import type { DuelCanonicalFrame, DuelPaymentSourceReference } from './canonical-session.js';
import type { DuelPhysicalZoneTransition } from './permanent-state.js';
import { inheritDuelTurnCursorBondV2 } from './turn-executor-v2.js';

export type DuelCommandV2 =
  | { readonly type: 'mulligan'; readonly selectedUIDs: readonly string[] }
  | { readonly type: 'rune-energy' | 'rune-power' | 'gold-power'; readonly uid: string }
  | { readonly type: 'pay-pending'; readonly paymentId: string; readonly plan?: DuelPaymentPlan };
export interface DuelCommandEnvelopeV2 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: DuelCommandV2;
}
export type DuelCommandRejectionV2 = 'invalid-command' | 'unknown-actor' | 'command-conflict' |
  'stale-version' | 'invalid-stage' | 'invalid-phase' | 'no-permission' |
  'mulligan-rejected' | 'resource-rejected' | 'payment-rejected' | 'version-overflow';
/** PRIVATE executor return. Never serialize this, receipts, tasks or the match directly to clients. */
export interface DuelPaymentCompletedV2 {
  readonly paymentId: string;
  readonly sourceReference: DuelPaymentSourceReference;
  readonly plan: DuelPaymentPlan;
  readonly sourceProofId: string;
  readonly requiredTask?: { readonly taskId: string; readonly continuationId: string };
}
export type DuelCommandOutcomeV2 =
  | { readonly status: 'applied'; readonly appliedVersion: number; readonly eventSeq: number;
      readonly paymentCompleted?: DuelPaymentCompletedV2 }
  | { readonly status: 'rejected'; readonly reason: DuelCommandRejectionV2 };
export interface DuelCommandReceiptV2 {
  readonly actor: string;
  readonly commandId: string;
  readonly payloadFingerprint: string;
  readonly outcome: DuelCommandOutcomeV2;
}
export interface DuelRequiredCostTaskV2 {
  readonly matchId: string;
  readonly expectedVersion: number;
  readonly taskId: string;
  readonly paymentId: string;
  readonly actor: string;
  /** Final, resolved cost supplied by a trusted Cost Resolver; NEVER printed base cost by default. */
  readonly finalResolvedCost: DuelRuneCost;
  readonly opaqueSource: DuelPaymentSourceReference;
  readonly continuationId: string;
}
/** Independent attestation of an actual source/task, never extracted from a client envelope.
 * 'pre-exit' must originate from the trusted pre-exit event journal, not from the live object.
 * The callback verifies that journal on EVERY non-duplicate payment, even if the source left.
 * A live physical-card reference instead must still match its issued zoneEpoch. */
export interface DuelSourceBindingV2 {
  readonly matchId: string;
  readonly actor: string;
  readonly paymentId: string;
  readonly sourceReference: DuelPaymentSourceReference;
  readonly sourceProofId: string;
  readonly mode: 'current' | 'pre-exit';
  readonly sourceZoneEpoch?: number;
  readonly taskId?: string;
  readonly continuationId?: string;
}
export interface DuelSourceAttestationRequestV2 {
  readonly match: DuelCanonicalPlayingStateV2;
  readonly actor: string;
  readonly paymentId: string;
  readonly sourceReference: DuelPaymentSourceReference;
  readonly finalResolvedCost: DuelRuneCost;
  readonly taskId?: string;
  readonly continuationId?: string;
  /** On verification, exact previously attested binding, not permission to invent a new one. */
  readonly previous?: DuelSourceBindingV2;
}
export type DuelSourceAttestorV2 = (request: DuelSourceAttestationRequestV2) => DuelSourceBindingV2;
export interface DuelRequiredTaskLedgerEntryV2 extends DuelRequiredCostTaskV2 {
  readonly status: 'issued' | 'active' | 'completed';
  readonly sourceBinding: DuelSourceBindingV2;
}
export interface DuelPaymentBindingEntryV2 {
  readonly paymentId: string;
  readonly actor: string;
  readonly finalResolvedCost: DuelRuneCost;
  readonly opaqueSource: DuelPaymentSourceReference;
  readonly sourceBinding: DuelSourceBindingV2;
  readonly status: 'active' | 'completed';
}
export interface DuelCommandSessionV2 {
  readonly schemaVersion: 2;
  /** Private scalar continuation; no independent game-state carrier or raw-JSON restoration. */
  readonly turnCursorV2?: import('./turn-executor-v2.js').DuelTurnCursorV2;
  readonly match: DuelMatchStateV2;
  readonly receipts: readonly DuelCommandReceiptV2[];
  readonly requiredTasks: readonly DuelRequiredTaskLedgerEntryV2[];
  readonly priorityPayments: readonly DuelPaymentBindingEntryV2[];
}
export interface DuelCommandResultV2 {
  readonly session: DuelCommandSessionV2;
  readonly match: DuelMatchStateV2;
  readonly outcome: DuelCommandOutcomeV2;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}
export interface DuelRequiredCostAuthorityV2 { readonly _requiredCostAuthorityV2: unique symbol }

function check(ok: unknown, label: string): asserts ok {
  if (!ok) throw new TypeError(`Duel V2 session: ${label}`);
}
function record(raw: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'plain record required');
  const prototype = Object.getPrototypeOf(raw);
  check(prototype === Object.prototype || prototype === null, 'plain record prototype');
  const keys = Reflect.ownKeys(raw);
  check(keys.length >= required.length && keys.length <= required.length + optional.length &&
    keys.every(key => typeof key === 'string' && [...required, ...optional].includes(key) &&
      'value' in Object.getOwnPropertyDescriptor(raw, key)!) && required.every(key => keys.includes(key)),
  'record keys/accessors');
  return raw as Record<string, unknown>;
}
function list(raw: unknown): readonly unknown[] {
  check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype, 'plain array required');
  check(Reflect.ownKeys(raw).length === raw.length + 1 &&
    Array.from({ length: raw.length }, (_, i) => Object.getOwnPropertyDescriptor(raw, String(i)))
      .every(descriptor => descriptor !== undefined && 'value' in descriptor), 'dense array required');
  return raw;
}
function id(raw: unknown): string {
  check(typeof raw === 'string' && raw.trim().length > 0, 'nonblank identifier required');
  return raw;
}
function count(raw: unknown): number {
  check(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0, 'safe nonnegative integer required');
  return raw;
}
function freeze(raw: unknown, seen = new WeakSet<object>()): void {
  if (raw === null || typeof raw !== 'object' || seen.has(raw)) return;
  seen.add(raw);
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor && 'value' in descriptor) freeze(descriptor.value, seen);
  }
  Object.freeze(raw);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const r = value as Record<string, unknown>;
    return `{${Object.keys(r).sort().map(key => `${JSON.stringify(key)}:${canonical(r[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function cost(raw: unknown): DuelRuneCost {
  const r = record(raw, ['energy', 'power']);
  const energy = count(r.energy);
  let total = energy;
  const power = list(r.power).map(rawRequirement => {
    const requirement = record(rawRequirement, ['allowedDomains', 'amount']);
    const allowedDomains = list(requirement.allowedDomains).map(domain => {
      check(typeof domain === 'string' && (DUEL_DOMAINS as readonly string[]).includes(domain), 'cost domain');
      return domain as (typeof DUEL_DOMAINS)[number];
    });
    check(allowedDomains.length > 0 && allowedDomains.length <= 6 &&
      new Set(allowedDomains).size === allowedDomains.length, 'cost domain set');
    const amount = count(requirement.amount);
    check(amount > 0, 'zero Power requirement');
    total += amount;
    check(Number.isSafeInteger(total), 'cost overflow');
    return { allowedDomains, amount };
  });
  return { energy, power };
}
function source(raw: unknown): DuelPaymentSourceReference {
  const r = record(raw, ['kind', 'referenceId'], ['sourceUID']);
  check(r.kind === 'card' || r.kind === 'effect', 'source kind');
  return { kind: r.kind, referenceId: id(r.referenceId),
    ...(Object.hasOwn(r, 'sourceUID') ? { sourceUID: id(r.sourceUID) } : {}) };
}
function command(raw: unknown): DuelCommandV2 {
  const r = record(raw, ['type'], ['selectedUIDs', 'uid', 'paymentId', 'plan']);
  switch (r.type) {
    case 'mulligan':
      record(raw, ['type', 'selectedUIDs']);
      return { type: 'mulligan', selectedUIDs: list(r.selectedUIDs).map(id) };
    case 'rune-energy':
    case 'rune-power':
    case 'gold-power':
      record(raw, ['type', 'uid']);
      return { type: r.type, uid: id(r.uid) };
    case 'pay-pending': {
      record(raw, ['type', 'paymentId'], ['plan']);
      const paymentId = id(r.paymentId);
      if (!Object.hasOwn(r, 'plan')) return { type: 'pay-pending', paymentId };
      const p = record(r.plan, ['power']);
      const power = list(p.power).map(rawEntry => {
        const e = record(rawEntry, ['requirementIndex', 'from', 'amount']);
        check(typeof e.from === 'string' && ([...DUEL_DOMAINS, 'any'] as readonly string[]).includes(e.from),
          'allocation source');
        return { requirementIndex: count(e.requirementIndex),
          from: e.from as (typeof DUEL_DOMAINS)[number] | 'any', amount: count(e.amount) };
      });
      return { type: 'pay-pending', paymentId, plan: { power } };
    }
    default: throw new TypeError('Duel V2 session: unknown command type');
  }
}
function seat(match: DuelMatchStateV2, actor: unknown): actor is string {
  return typeof actor === 'string' && match.roster.some(item => item.playerId === actor);
}
function active(frame: DuelCanonicalFrame): boolean {
  return frame.phase !== 'awaiting-turn-start' && frame.phase !== 'ended' &&
    ['awaken', 'beginning', 'scoring', 'channel', 'draw', 'main', 'ending', 'expiration'].includes(frame.phase);
}
function timing(frame: DuelCanonicalFrame): DuelResourceTiming {
  return { stateOpen: frame.stateOpen, priorityPlayerId: frame.priorityPlayerId,
    resourcePaymentPlayerId: frame.pendingPayment?.actor ?? null };
}
function task(raw: unknown): DuelRequiredCostTaskV2 {
  const r = record(raw, ['matchId', 'expectedVersion', 'taskId', 'paymentId', 'actor',
    'finalResolvedCost', 'opaqueSource', 'continuationId']);
  return { matchId: id(r.matchId), expectedVersion: count(r.expectedVersion), taskId: id(r.taskId),
    paymentId: id(r.paymentId), actor: id(r.actor), finalResolvedCost: cost(r.finalResolvedCost),
    opaqueSource: source(r.opaqueSource), continuationId: id(r.continuationId) };
}
function binding(raw: unknown, request: DuelSourceAttestationRequestV2): DuelSourceBindingV2 {
  const r = record(raw, ['matchId', 'actor', 'paymentId', 'sourceReference', 'sourceProofId', 'mode'],
    ['sourceZoneEpoch', 'taskId', 'continuationId']);
  const normalized: DuelSourceBindingV2 = { matchId: id(r.matchId), actor: id(r.actor),
    paymentId: id(r.paymentId), sourceReference: source(r.sourceReference),
    sourceProofId: id(r.sourceProofId), mode: r.mode as 'current' | 'pre-exit',
    ...(Object.hasOwn(r, 'sourceZoneEpoch') ? { sourceZoneEpoch: count(r.sourceZoneEpoch) } : {}),
    ...(Object.hasOwn(r, 'taskId') ? { taskId: id(r.taskId) } : {}),
    ...(Object.hasOwn(r, 'continuationId') ? { continuationId: id(r.continuationId) } : {}) };
  check(normalized.mode === 'current' || normalized.mode === 'pre-exit', 'source mode');
  check(normalized.sourceReference.sourceUID !== undefined,
    'independently provable physical source required (unbound effect source pending)');
  check(normalized.matchId === request.match.matchId && normalized.actor === request.actor &&
    normalized.paymentId === request.paymentId &&
    canonical(normalized.sourceReference) === canonical(request.sourceReference) &&
    normalized.taskId === request.taskId && normalized.continuationId === request.continuationId,
  'source/payment/task/continuation attestation mismatch');
  if (normalized.mode === 'current') {
    check(normalized.sourceZoneEpoch !== undefined, 'live source epoch required');
    assertCurrentDuelPhysicalReferenceV2(request.match,
      { uid: normalized.sourceReference.sourceUID!, zoneEpoch: normalized.sourceZoneEpoch });
  } else {
    // The trusted attestor, NOT current-zone comparison, must verify the independently
    // recorded pre-exit source/event; keep the issued proof identity stable across payment.
    check(normalized.sourceZoneEpoch !== undefined && normalized.sourceReference.sourceUID !== undefined,
      'pre-exit physical source and pre-exit epoch required');
  }
  if (request.previous) check(canonical(normalized) === canonical(request.previous),
    'attestation changed source/task binding');
  return normalized;
}
function attest(request: DuelSourceAttestationRequestV2, provider: DuelSourceAttestorV2): DuelSourceBindingV2 {
  check(typeof provider === 'function', 'independent source attestor required');
  // The callback may inspect immutable admitted match but may not mutate the private
  // cost/source/previous binding supplied by this session. No provider object is published.
  const argument = { ...request, sourceReference: source(request.sourceReference),
    finalResolvedCost: cost(request.finalResolvedCost),
    ...(request.previous ? { previous: { ...request.previous,
      sourceReference: source(request.previous.sourceReference) } } : {}) };
  freeze(argument);
  const checked = binding(provider(argument), request);
  freeze(checked);
  return checked;
}
const liveSessions = new WeakSet<object>();
const sessionLineage = new WeakMap<object, { readonly parent: DuelCommandSessionV2 | null;
  readonly origin: object }>();
const choiceEventClaims = new WeakMap<object, Map<string, string>>();
/** Carry an existing private Main cursor bond across canonical cost and command successors. */
function successor(before: DuelCommandSessionV2, after: DuelCommandSessionV2): DuelCommandSessionV2 {
  if (before !== after) {
    const ancestor = sessionLineage.get(before);
    check(ancestor && liveSessions.has(after), 'unadmitted command successor');
    sessionLineage.set(after, { parent: before, origin: ancestor.origin });
  }
  // This single private hook carries an already-bound Main cursor across cost issuance,
  // preparation and resource receipts. It never admits a caller-created cursor/session.
  inheritDuelTurnCursorBondV2(before, after);
  return after;
}
/** A legitimate Main successor must track the ONE outer Core transaction clock, including
 * payment preparation. Outstanding ledger entries still block turn progression until paid. */
function mainCursor(before: DuelCommandSessionV2, next: DuelMatchStateV2) {
  const c = before.turnCursorV2;
  return c && next !== before.match && c.step === 'main' &&
    next.stage === 'playing' && next.frame.phase === 'main' &&
    c.turn === next.frame.turnNumber
    ? { ...c, stateVersion: next.stateVersion, eventSeq: next.eventSeq } : c;
}
const issued = new WeakMap<object, { session: DuelCommandSessionV2; task: DuelRequiredCostTaskV2 }>();
function requireSession(session: DuelCommandSessionV2): void {
  check(session !== null && typeof session === 'object' && liveSessions.has(session) &&
    session.schemaVersion === 2 && session.match.schemaVersion === 2 && Object.isFrozen(session),
  'unadmitted V2 session; JSON is not restore');
  check(session.match.eventSeq === session.match.stateVersion, 'V2 command clock mismatch');
}
function publish(session: DuelCommandSessionV2): DuelCommandSessionV2 {
  freeze(session);
  liveSessions.add(session);
  sessionLineage.set(session, { parent: null, origin: Object.freeze(Object.create(null)) });
  return session;
}
/** The private ledger/cursor path is separate from the Core state path. Ledger-only
 * steps may retain the match clock, but must still originate from the actual factory.
 * A fresh adoption of the same match cannot erase receipts and splice into this path. */
export function inspectDuelNativeCommandSessionPathV2(ancestor: DuelCommandSessionV2,
  descendant: DuelCommandSessionV2): readonly {
    readonly before: DuelCommandSessionV2; readonly after: DuelCommandSessionV2;
  }[] {
  requireSession(ancestor);
  requireSession(descendant);
  const root = sessionLineage.get(ancestor)!;
  check(sessionLineage.get(descendant)?.origin === root.origin, 'foreign command session origin');
  const path: { readonly before: DuelCommandSessionV2; readonly after: DuelCommandSessionV2 }[] = [];
  let current = descendant;
  while (current !== ancestor) {
    const parent = sessionLineage.get(current)?.parent;
    check(parent, 'command session is not a native descendant');
    inspectDuelNativeCommitPathV2(parent.match, current.match);
    path.push(Object.freeze({ before: parent, after: current }));
    current = parent;
  }
  return Object.freeze(path.reverse());
}
function verifyPlaying(match: DuelCanonicalPlayingStateV2): void {
  // No-op commit checks BOTH the private WeakMap admission and the whole V2 provenance graph.
  // Never call the V1 validator/transaction or turn a raw JSON object into a capability.
  check(commitDuelPlayingMutationV2(match, draft => ({ match: draft, transitions: [] })) === match,
    'playing admission/immutable no-op');
}
/** Factory route ONLY: authenticated seats, trusted catalog and trusted constructor RNG. */
export function createDuelCommandSessionV2(seats: readonly DuelSetupSeat[], metadata: DuelMatchMetadata,
  randomIndex: (exclusiveUpperBound: number) => number,
  trustedCardType: DuelTrustedCardTypeResolverV2): DuelCommandSessionV2 {
  return publish({ schemaVersion: 2, match: createDuelMatchV2(seats, metadata, randomIndex, trustedCardType),
    receipts: [], requiredTasks: [], priorityPayments: [] });
}
/** Only an ALREADY admitted V2 playing object, not a snapshot. No pending payment/ledger
 * may be silently reconstructed from a raw match. A real archive needs external V2 proof AND
 * a separate validated private ledger codec (not supplied by this module). */
export function adoptAdmittedDuelPlayingSessionV2(match: DuelCanonicalPlayingStateV2): DuelCommandSessionV2 {
  verifyPlaying(match);
  check(match.frame.pendingPayment === null && match.eventSeq === match.stateVersion,
    'pending payment requires bound private ledger and consistent clock');
  return publish({ schemaVersion: 2, match, receipts: [], requiredTasks: [], priorityPayments: [] });
}
function result(session: DuelCommandSessionV2, outcome: DuelCommandOutcomeV2,
  duplicate: boolean, persistRequired: boolean): DuelCommandResultV2 {
  // Results are private objects, not safe network ACKs. Duplicate returns the *current* match
  // and the old outcome, without invoking providers or allocating a new clock.
  return Object.freeze({ session, match: session.match, outcome, duplicate, persistRequired });
}
function pendingBinding(session: DuelCommandSessionV2, match: DuelCanonicalPlayingStateV2) {
  const payment = match.frame.pendingPayment;
  const activeTasks = session.requiredTasks.filter(entry => entry.status === 'active');
  const activePriority = session.priorityPayments.filter(entry => entry.status === 'active');
  check(activeTasks.length + activePriority.length <= 1 &&
    session.requiredTasks.filter(entry => entry.status === 'issued').length <= 1,
  'multiple active/issued payments');
  check(session.requiredTasks.every(entry => entry.matchId === match.matchId) &&
    session.requiredTasks.every(entry => entry.status !== 'issued' || entry.expectedVersion === match.stateVersion) &&
    session.priorityPayments.every(entry => entry.sourceBinding.matchId === match.matchId),
  'issued task expired or cross-match');
  const entry = activeTasks[0] ?? activePriority[0];
  check((entry === undefined) === (payment === null), 'unbound pending payment');
  if (entry && payment) check(entry.paymentId === payment.paymentId && entry.actor === payment.actor &&
    canonical(entry.finalResolvedCost) === canonical(payment.resolvedCost) &&
    canonical(entry.opaqueSource) === canonical(payment.sourceReference) &&
    entry.sourceBinding.matchId === match.matchId && entry.sourceBinding.actor === entry.actor &&
    entry.sourceBinding.paymentId === entry.paymentId &&
    canonical(entry.sourceBinding.sourceReference) === canonical(entry.opaqueSource) &&
    (activeTasks[0] === undefined || (entry.sourceBinding.taskId === activeTasks[0].taskId &&
      entry.sourceBinding.continuationId === activeTasks[0].continuationId)), 'pending binding mismatch');
  return { task: activeTasks[0], ordinary: activePriority[0] };
}
function reserved(session: DuelCommandSessionV2, paymentId: string): boolean {
  return session.requiredTasks.some(entry => entry.paymentId === paymentId) ||
    session.priorityPayments.some(entry => entry.paymentId === paymentId);
}
/** Trusted turn/task executor bridge: one admitted match, one Core V2 clock allocation,
 * one ordered physical transition trace. Never adopt an unrelated match or reconstruct the
 * opaque receipt/task/payment ledgers. Pending payments and issued tasks own the window. */
function commitDuelCommandMutationInternalV2(session: DuelCommandSessionV2,
  mutate: (draft: DuelCanonicalPlayingStateV2) => {
    readonly match: DuelCanonicalPlayingStateV2;
    readonly transitions: readonly DuelPhysicalZoneTransition[];
  }, semanticEvent = false): { readonly session: DuelCommandSessionV2; readonly persistRequired: boolean } {
  requireSession(session);
  const match = session.match;
  check(match.stage === 'playing', 'phase mutation needs playing');
  verifyPlaying(match);
  pendingBinding(session, match);
  check(match.frame.pendingPayment === null &&
    !session.requiredTasks.some(entry => entry.status === 'issued' || entry.status === 'active') &&
    !session.priorityPayments.some(entry => entry.status === 'active'),
  'pending payment or issued task blocks phase mutation');
  check(typeof mutate === 'function', 'trusted phase mutation required');
  const commit = () => commitDuelPlayingMutationV2(match, draft => {
    const output = mutate(draft);
    check(output?.match?.frame?.pendingPayment === null, 'phase mutation cannot install payment');
    return output;
  });
  const next = semanticEvent ? withDuelPlayingV2SemanticEventClock(match, commit) : commit();
  const updated = next === match ? session : publish({ ...session, match: next,
    ...(session.turnCursorV2 ? { turnCursorV2: { ...session.turnCursorV2,
      stateVersion: next.stateVersion, eventSeq: next.eventSeq } } : {}) });
  return Object.freeze({ session: next === match ? session : successor(session, updated),
    persistRequired: next !== match });
}

export function commitDuelCommandMutationV2(session: DuelCommandSessionV2,
  mutate: (draft: DuelCanonicalPlayingStateV2) => {
    readonly match: DuelCanonicalPlayingStateV2;
    readonly transitions: readonly DuelPhysicalZoneTransition[];
  }): { readonly session: DuelCommandSessionV2; readonly persistRequired: boolean } {
  return commitDuelCommandMutationInternalV2(session, mutate);
}

export interface DuelChoiceOpeningEventV2 {
  readonly actor: string;
  readonly cardUID: string;
  readonly commandId: string;
  readonly expectedVersion: number;
}

/**
 * Open one already-authorized optional Unit choice through the native command
 * session. The server owns card-program permission; this bridge owns only the
 * exact Main/actor/hand/session admission and the one semantic Core clock.
 */
export function commitDuelChoiceOpeningEventV2(session: DuelCommandSessionV2,
  rawEvent: DuelChoiceOpeningEventV2): { readonly session: DuelCommandSessionV2; readonly persistRequired: boolean } {
  requireSession(session);
  const event = record(rawEvent, ["actor", "cardUID", "commandId", "expectedVersion"]) as unknown as DuelChoiceOpeningEventV2;
  const match = session.match;
  check(match.stage === 'playing' && match.frame.phase === 'main' && match.frame.stateOpen && match.frame.focusPlayerId === null,
    'choice opening requires open Main');
  check(match.frame.pendingPayment === null &&
    !session.requiredTasks.some(entry => entry.status === 'issued' || entry.status === 'active') &&
    !session.priorityPayments.some(entry => entry.status === 'active'),
  'choice opening blocked by pending payment/task');
  check(typeof event.actor === 'string' && seat(match, event.actor) &&
    match.frame.turnPlayerId === event.actor && match.frame.priorityPlayerId === event.actor,
  'choice opening actor is not current Main owner');
  check(typeof event.commandId === 'string' && event.commandId.length > 0 &&
    typeof event.cardUID === 'string' && event.cardUID.length > 0 &&
    Number.isSafeInteger(event.expectedVersion) && event.expectedVersion === match.stateVersion &&
    match.stateVersion < Number.MAX_SAFE_INTEGER && match.eventSeq < Number.MAX_SAFE_INTEGER,
  'choice opening event identity/version');
  const owner = match.players.find(player => player.playerId === event.actor);
  const physical = match.physicalCardsByUID[event.cardUID];
  check(owner?.hand.some(card => card.uid === event.cardUID) &&
    Number.isSafeInteger(physical?.zoneEpoch) && physical!.zoneEpoch >= 0,
  'choice opening source is not the actor current hand');
  const origin = sessionLineage.get(session)?.origin;
  check(origin, 'choice opening session lineage');
  const claimKey = JSON.stringify([event.actor, event.commandId]);
  const claim = JSON.stringify([event.cardUID, physical!.zoneEpoch, event.expectedVersion]);
  const prior = choiceEventClaims.get(origin);
  check(!prior?.has(claimKey), 'choice opening event already consumed');
  const result = commitDuelCommandMutationInternalV2(session,
    draft => ({ match: draft, transitions: [] }), true);
  check(result.persistRequired && result.session.match.stateVersion === match.stateVersion + 1 &&
    result.session.match.eventSeq === match.eventSeq + 1,
  'choice opening did not allocate one Core event clock');
  const claims = prior ?? new Map<string, string>();
  claims.set(claimKey, claim);
  choiceEventClaims.set(origin, claims);
  return result;
}

/** Attach commits already made by a trusted Core effect/combat executor to the SAME
 * private command ledger. The actual native parent path is required; no snapshot,
 * equivalent factory or sibling may be installed. Payment windows must instead go
 * through this module's bound ledger. This proves native lineage, not effect semantics. */
export function advanceDuelCommandSessionNativeV2(session: DuelCommandSessionV2,
  next: DuelCanonicalPlayingStateV2): {
    readonly session: DuelCommandSessionV2; readonly persistRequired: boolean;
  } {
  requireSession(session);
  const before = session.match;
  check(before.stage === 'playing', 'native successor needs playing');
  verifyPlaying(before);
  pendingBinding(session, before);
  check(before.frame.pendingPayment === null &&
    !session.requiredTasks.some(entry => entry.status === 'issued' || entry.status === 'active') &&
    !session.priorityPayments.some(entry => entry.status === 'active'),
  'pending payment or issued task blocks native successor');
  const path = inspectDuelNativeCommitPathV2(before, next);
  check(next.stage === 'playing' && path.every(commit =>
    commit.before.stage === 'playing' && commit.after.stage === 'playing' &&
    commit.before.frame.pendingPayment === null && commit.after.frame.pendingPayment === null),
  'native successor cannot bypass the private payment ledger');
  if (next === before) return Object.freeze({ session, persistRequired: false });
  verifyPlaying(next);
  const updated = publish({ ...session, match: next,
    ...(session.turnCursorV2 ? { turnCursorV2: { ...session.turnCursorV2,
      stateVersion: next.stateVersion, eventSeq: next.eventSeq } } : {}) });
  return Object.freeze({ session: successor(session, updated), persistRequired: true });
}

/** Private scalar sidecar checkpoint. Never a game-state or archive restoration API. */
export function checkpointDuelTurnCursorV2(session: DuelCommandSessionV2,
  cursor: import('./turn-executor-v2.js').DuelTurnCursorV2): DuelCommandSessionV2 {
  requireSession(session);
  const match = session.match;
  check(match.stage === 'playing', 'turn cursor requires playing');
  verifyPlaying(match);
  pendingBinding(session, match);
  check(match.frame.pendingPayment === null &&
    !session.requiredTasks.some(entry => entry.status === 'issued' || entry.status === 'active') &&
    !session.priorityPayments.some(entry => entry.status === 'active'), 'outstanding cost blocks cursor');
  check(cursor !== null && typeof cursor === 'object' && cursor.matchId === match.matchId &&
    cursor.turn === match.frame.turnNumber && cursor.stateVersion === match.stateVersion &&
    cursor.eventSeq === match.eventSeq && Array.isArray(cursor.consumedIDs) &&
    (cursor.pendingTaskID === null || typeof cursor.pendingTaskID === 'string'), 'cursor clock/identity mismatch');
  return successor(session, publish({ ...session, turnCursorV2: structuredClone(cursor) }));
}

export function commitDuelCommandFrameV2(session: DuelCommandSessionV2,
  frame: DuelCanonicalFrame, trustedFrameAttestor: (before: DuelCanonicalPlayingStateV2,
    proposed: DuelCanonicalFrame) => void):
  { readonly session: DuelCommandSessionV2; readonly persistRequired: boolean } {
  requireSession(session);
  const match = session.match;
  check(match.stage === 'playing', 'frame needs playing');
  verifyPlaying(match);
  pendingBinding(session, match);
  check(match.frame.pendingPayment === null, 'frame executor cannot overwrite pending payment');
  check(record(frame, ['phase', 'turnNumber', 'turnPlayerId', 'priorityPlayerId', 'focusPlayerId',
    'stateOpen', 'pendingPayment']).pendingPayment === null, 'frame executor cannot forge payment');
  // "issued" tasks are reserved for one exact stateVersion; changing the frame would leave an
  // orphaned task/authority. A real executor must first resolve/abort the outstanding task.
  check(!session.requiredTasks.some(entry => entry.status === 'issued'), 'issued task blocks frame changes');
  check(typeof trustedFrameAttestor === 'function', 'turn/phase frame attestor required');
  trustedFrameAttestor(match, frame);
  // Detach before publishing: a trusted executor's mutable frame object is not a reference
  // into an admitted match. Validation happens again in the V2 transaction.
  const proposedFrame: DuelCanonicalFrame = { phase: frame.phase, turnNumber: frame.turnNumber,
    turnPlayerId: frame.turnPlayerId, priorityPlayerId: frame.priorityPlayerId,
    focusPlayerId: frame.focusPlayerId, stateOpen: frame.stateOpen, pendingPayment: null };
  const next = commitDuelPlayingMutationV2(match, draft =>
    ({ match: { ...draft, frame: proposedFrame }, transitions: [] }));
  const updated = next === match ? session : successor(session, publish({ ...session, match: next,
    ...(session.turnCursorV2 ? { turnCursorV2: { ...session.turnCursorV2,
      stateVersion: next.stateVersion, eventSeq: next.eventSeq } } : {}) }));
  return Object.freeze({ session: updated,
    persistRequired: next !== match });
}
/** Trusted TaskExecutor only. Reserve task/payment identities even before an active window;
 * callback independently attests source/task and final resolved cost. The opaque handle is
 * in-process, tied to the exact issued session, never reconstructed from client JSON. */
export function issueDuelRequiredCostTaskV2(session: DuelCommandSessionV2, raw: DuelRequiredCostTaskV2,
  sourceAttestor: DuelSourceAttestorV2): { readonly session: DuelCommandSessionV2;
    readonly authority: DuelRequiredCostAuthorityV2; readonly persistRequired: boolean } {
  requireSession(session);
  const t = task(raw), match = session.match;
  check(match.stage === 'playing', 'required task needs playing');
  verifyPlaying(match);
  pendingBinding(session, match);
  check(active(match.frame) && match.frame.pendingPayment === null &&
    match.matchId === t.matchId && match.stateVersion === t.expectedVersion &&
    seat(match, t.actor), 'required task match/actor/window/version');
  check(!session.requiredTasks.some(entry => entry.status === 'issued'), 'another task is issued');
  check(!reserved(session, t.paymentId), 'payment ID reserved');
  check(!session.requiredTasks.some(entry => entry.taskId === t.taskId), 'task ID reserved');
  check(!session.receipts.some(receipt => receipt.outcome.status === 'applied' &&
    receipt.outcome.paymentCompleted?.paymentId === t.paymentId), 'payment ID already completed');
  // A continuation ID is a one-shot private execution token: re-issuing ANY new task/payment
  // under a previously issued, active or completed continuation must fail here, before the
  // independent source attestor runs, before an authority object exists and before publish.
  // Retrying the SAME task stays with the saved command receipt/ledger, not a new issue.
  check(!session.requiredTasks.some(entry => entry.continuationId === t.continuationId),
    'continuation ID already issued');
  const b = attest({ match, actor: t.actor, paymentId: t.paymentId,
    sourceReference: t.opaqueSource, finalResolvedCost: t.finalResolvedCost,
    taskId: t.taskId, continuationId: t.continuationId }, sourceAttestor);
  const next = successor(session, publish({ ...session, requiredTasks:
    [...session.requiredTasks, { ...t, status: 'issued', sourceBinding: b }] }));
  const authority = Object.freeze(Object.create(null)) as DuelRequiredCostAuthorityV2;
  issued.set(authority, { session: next, task: t });
  return Object.freeze({ session: next, authority, persistRequired: true });
}
/** Prepare requires exact issued capability + independent re-attestation. No Priority bypass
 * exists for clients; the already-issued required task alone grants payer's cost window. */
export function prepareDuelRequiredCostPaymentV2(session: DuelCommandSessionV2,
  authority: DuelRequiredCostAuthorityV2, sourceAttestor: DuelSourceAttestorV2):
  { readonly session: DuelCommandSessionV2; readonly persistRequired: true } {
  requireSession(session);
  const capability = authority && typeof authority === 'object' ? issued.get(authority) : undefined;
  check(capability?.session === session, 'unissued or stale required task authority');
  const match = session.match, t = capability.task;
  check(match.stage === 'playing', 'required payment needs playing');
  verifyPlaying(match);
  pendingBinding(session, match);
  check(match.matchId === t.matchId && match.stateVersion === t.expectedVersion &&
    match.frame.pendingPayment === null && active(match.frame), 'expired required task');
  const entry = session.requiredTasks.find(item => item.taskId === t.taskId);
  check(entry?.status === 'issued' && canonical(task({ matchId: entry.matchId,
    expectedVersion: entry.expectedVersion, taskId: entry.taskId, paymentId: entry.paymentId,
    actor: entry.actor, finalResolvedCost: entry.finalResolvedCost, opaqueSource: entry.opaqueSource,
    continuationId: entry.continuationId })) === canonical(t), 'required task ledger mismatch');
  attest({ match, actor: t.actor, paymentId: t.paymentId,
    sourceReference: t.opaqueSource, finalResolvedCost: t.finalResolvedCost,
    taskId: t.taskId, continuationId: t.continuationId, previous: entry.sourceBinding }, sourceAttestor);
  const next = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft, frame: {
    ...draft.frame, pendingPayment: { paymentId: t.paymentId, actor: t.actor,
      resolvedCost: t.finalResolvedCost, sourceReference: t.opaqueSource } } }, transitions: [] }));
  check(next !== match, 'required preparation must install payment');
  const cursor = mainCursor(session, next);
  const updated = successor(session, publish({ ...session, match: next,
    ...(cursor ? { turnCursorV2: cursor } : {}),
    requiredTasks: session.requiredTasks.map(item =>
      item.taskId === t.taskId ? { ...item, status: 'active' as const } : item) }));
  issued.delete(authority);
  return Object.freeze({ session: updated, persistRequired: true });
}
/** Trusted priority + Cost Resolver only; callback must validate genuine live/pre-exit source.
 * Printed-base cost and a client-supplied source MUST NOT be substituted for final resolved cost. */
export function commitDuelPriorityPaymentV2(session: DuelCommandSessionV2, actor: string,
  paymentId: string, finalResolvedCost: DuelRuneCost, opaqueSource: DuelPaymentSourceReference,
  sourceAttestor: DuelSourceAttestorV2): { readonly session: DuelCommandSessionV2;
    readonly persistRequired: true } {
  requireSession(session);
  const match = session.match;
  check(match.stage === 'playing', 'priority payment needs playing');
  verifyPlaying(match);
  pendingBinding(session, match);
  const payment = id(paymentId), parsedCost = cost(finalResolvedCost), parsedSource = source(opaqueSource);
  check(active(match.frame) && match.frame.pendingPayment === null &&
    seat(match, actor) && match.frame.priorityPlayerId === actor,
  'priority payment requires current Priority and no pending payment');
  check(!session.requiredTasks.some(entry => entry.status === 'issued'),
    'issued required task owns the cost window');
  check(!reserved(session, payment) && !session.receipts.some(receipt =>
    receipt.outcome.status === 'applied' && receipt.outcome.paymentCompleted?.paymentId === payment),
  'payment ID reserved or completed');
  const b = attest({ match, actor, paymentId: payment, sourceReference: parsedSource,
    finalResolvedCost: parsedCost }, sourceAttestor);
  const next = commitDuelPlayingMutationV2(match, draft => ({ match: { ...draft, frame: {
    ...draft.frame, pendingPayment: { paymentId: payment, actor, resolvedCost: parsedCost,
      sourceReference: parsedSource } } }, transitions: [] }));
  check(next !== match, 'priority preparation must install payment');
  const cursor = mainCursor(session, next);
  return Object.freeze({ session: successor(session, publish({ ...session, match: next,
    ...(cursor ? { turnCursorV2: cursor } : {}),
    priorityPayments: [...session.priorityPayments,
      { paymentId: payment, actor, finalResolvedCost: parsedCost, opaqueSource: parsedSource,
        sourceBinding: b, status: 'active' }] })), persistRequired: true });
}

/** Only five explicitly typed commands; invalid/unknown/conflict are not receipted. Other
 * failures (including stale/version/phase) are sticky actor-namespaced private receipts.
 * `trusted.randomIndex` is used only in a genuinely attempted mulligan; source attestation
 * is mandatory at payment and is never invoked on a duplicate receipt. */
/** Read-only pay action inspection. A successful local check is NOT a source authorization:
 * every fresh real payment must still re-attest the previously bound source. This API has
 * no command ID, receipt, attestor, or one-use authority and cannot consume a payment. */
export type DuelPayPendingInspectionV2 =
  | Readonly<{ status: 'blocked'; reason: DuelCommandRejectionV2 }>
  | Readonly<{ status: 'requires-reattest'; reason: 'source-reattest-required' }>;

/** Resource commands that can be inspected without allocating a command receipt. */
export type DuelResourceCommandV2 = Extract<DuelCommandV2,
  { readonly type: 'rune-energy' | 'rune-power' | 'gold-power' }>;
export type DuelResourceLegalityV2 =
  | Readonly<{ status: 'legal' }>
  | Readonly<{ status: 'blocked'; reason: DuelCommandRejectionV2 }>;

/**
 * Check a resource command against the admitted Core capability without creating a
 * successor. The resource kernels are used on their detached resource result so their
 * readiness, ownership, timing and pool invariants remain authoritative. Gold's private
 * token proof is read from the native lifecycle journal; the Gold mutation itself is never
 * called here. This function intentionally has no command ID, receipt, RNG or provider.
 */
export function inspectDuelResourceCommandV2(session: DuelCommandSessionV2,
  authenticatedActor: string, expectedVersion: number,
  rawCommand: unknown): DuelResourceLegalityV2 {
  requireSession(session);
  const blocked = (reason: DuelCommandRejectionV2): DuelResourceLegalityV2 =>
    Object.freeze({ status: 'blocked', reason });
  let parsed: DuelCommandV2;
  try {
    count(expectedVersion);
    parsed = command(rawCommand);
    if (parsed.type !== 'rune-energy' && parsed.type !== 'rune-power' && parsed.type !== 'gold-power')
      return blocked('invalid-command');
  } catch { return blocked('invalid-command'); }
  if (!seat(session.match, authenticatedActor)) return blocked('unknown-actor');
  const match = session.match;
  if (expectedVersion !== match.stateVersion) return blocked('stale-version');
  if (match.stateVersion >= Number.MAX_SAFE_INTEGER || match.eventSeq >= Number.MAX_SAFE_INTEGER)
    return blocked('version-overflow');
  if (match.stage !== 'playing') return blocked('invalid-stage');
  if (session.requiredTasks.some(entry => entry.status === 'issued')) return blocked('no-permission');
  if (!active(match.frame)) return blocked('invalid-phase');

  // This is a capability check, not a snapshot validator. A session admitted by the
  // factory/lineage is already deeply frozen; checking the native match identity here
  // rejects any spread/JSON/exotic substitute before inspecting private fields.
  try {
    assertAdmittedDuelMatchV2(match);
    // Restore retains a caller-owned private inventory. The real command verifies this
    // currentness for every resource kind, so the read-only probe must do the same before
    // touching any detached resource kernel.
    assertDuelNativeTokenInventoryCurrentV2(match);
    const bound = pendingBinding(session, match);
    const payment = match.frame.pendingPayment;
    if (bound.task && bound.task.actor !== authenticatedActor) return blocked('no-permission');
    if (match.frame.priorityPlayerId !== authenticatedActor && payment?.actor !== authenticatedActor)
      return blocked('no-permission');

    if (parsed.type === 'gold-power') {
      activateDuelGoldPowerResource(match.resources, authenticatedActor, parsed.uid, timing(match.frame));
    } else {
      if (parsed.type === 'rune-power') {
        const physical = match.physicalCardsByUID[parsed.uid];
        check(physical !== undefined && Number.isSafeInteger(physical.zoneEpoch) && physical.zoneEpoch >= 0,
          'Rune source has no current physical reference');
      }
      if (parsed.type === 'rune-energy')
        activateBasicRuneEnergy(match.resources, authenticatedActor, parsed.uid, timing(match.frame));
      else activateBasicRunePower(match.resources, authenticatedActor, parsed.uid, timing(match.frame));
    }
  } catch { return blocked('resource-rejected'); }
  return Object.freeze({ status: 'legal' });
}

/** Boolean convenience for callers that only need an enabled/disabled action flag. */
export function isDuelResourceCommandLegalV2(session: DuelCommandSessionV2,
  authenticatedActor: string, expectedVersion: number,
  rawCommand: unknown): boolean {
  return inspectDuelResourceCommandV2(session, authenticatedActor, expectedVersion, rawCommand).status === 'legal';
}

/** Naming alias for adapters that refer to the result as a legality inspection. */
export const inspectDuelResourceLegalityV2 = inspectDuelResourceCommandV2;

export function inspectDuelPendingPaymentV2(session: DuelCommandSessionV2,
  authenticatedActor: string, expectedVersion: number,
  rawCommand: Extract<DuelCommandV2, { readonly type: 'pay-pending' }>): DuelPayPendingInspectionV2 {
  requireSession(session);
  const blocked = (reason: DuelCommandRejectionV2): DuelPayPendingInspectionV2 =>
    Object.freeze({ status: 'blocked', reason });
  let parsed: DuelCommandV2;
  try {
    count(expectedVersion);
    parsed = command(rawCommand);
    if (parsed.type !== 'pay-pending') return blocked('invalid-command');
  } catch { return blocked('invalid-command'); }
  if (!seat(session.match, authenticatedActor)) return blocked('unknown-actor');
  const match = session.match;
  if (expectedVersion !== match.stateVersion) return blocked('stale-version');
  if (match.stateVersion >= Number.MAX_SAFE_INTEGER || match.eventSeq >= Number.MAX_SAFE_INTEGER)
    return blocked('version-overflow');
  if (match.stage !== 'playing') return blocked('invalid-stage');
  if (session.requiredTasks.some(entry => entry.status === 'issued')) return blocked('no-permission');
  if (!active(match.frame)) return blocked('invalid-phase');
  let bound: ReturnType<typeof pendingBinding>;
  try { verifyPlaying(match); bound = pendingBinding(session, match); }
  catch { return blocked('resource-rejected'); }
  const payment = match.frame.pendingPayment;
  if (!payment || payment.paymentId !== parsed.paymentId || payment.actor !== authenticatedActor)
    return blocked('no-permission');
  try {
    const entry = bound.task ?? bound.ordinary;
    check(entry, 'payment has no independent source/task binding');
    // Re-validate the exact saved proof, including a live source's ORIGINAL zone epoch.
    // A pre-exit proof cannot be reconstructed from a current zone: its event-journal
    // verification remains the independent attestor's job at command execution time.
    binding(entry.sourceBinding, { match, actor: payment.actor, paymentId: payment.paymentId,
      sourceReference: payment.sourceReference, finalResolvedCost: payment.resolvedCost,
      ...(bound.task ? { taskId: bound.task.taskId, continuationId: bound.task.continuationId } : {}),
      previous: entry.sourceBinding });
    // Reuse the real payment kernel for explicit-plan and max-flow/default-plan checks.
    // Discard its detached result; do not commit or reserve the plan.
    payDuelRuneCost(match.resources, authenticatedActor, payment.resolvedCost,
      timing(match.frame), parsed.plan);
  } catch { return blocked('payment-rejected'); }
  return Object.freeze({ status: 'requires-reattest', reason: 'source-reattest-required' });
}

export function applyDuelResourceCommandV2(session: DuelCommandSessionV2,
  authenticatedActor: string, envelope: DuelCommandEnvelopeV2,
  trusted?: { readonly randomIndex?: (exclusiveUpperBound: number) => number;
    readonly sourceAttestor?: DuelSourceAttestorV2 }): DuelCommandResultV2 {
  requireSession(session);
  let commandId: string, expectedVersion: number, parsed: DuelCommandV2;
  try {
    const r = record(envelope, ['commandId', 'expectedVersion', 'command']);
    commandId = id(r.commandId); expectedVersion = count(r.expectedVersion); parsed = command(r.command);
  } catch {
    return result(session, Object.freeze({ status: 'rejected', reason: 'invalid-command' }), false, false);
  }
  if (!seat(session.match, authenticatedActor))
    return result(session, Object.freeze({ status: 'rejected', reason: 'unknown-actor' }), false, false);
  const fingerprint = canonical(parsed);
  const prior = session.receipts.find(entry => entry.actor === authenticatedActor && entry.commandId === commandId);
  if (prior) return prior.payloadFingerprint === fingerprint
    ? result(session, prior.outcome, true, false)
    : result(session, Object.freeze({ status: 'rejected', reason: 'command-conflict' }), false, false);
  let next: DuelMatchStateV2 = session.match;
  let completedTask: string | undefined, completedOrdinary: string | undefined;
  let outcome: DuelCommandOutcomeV2 | undefined;
  if (expectedVersion !== next.stateVersion) outcome = { status: 'rejected', reason: 'stale-version' };
  else if (next.stateVersion >= Number.MAX_SAFE_INTEGER || next.eventSeq >= Number.MAX_SAFE_INTEGER)
    outcome = { status: 'rejected', reason: 'version-overflow' };
  else if (parsed.type === 'mulligan') {
    if (next.stage !== 'setup') outcome = { status: 'rejected', reason: 'invalid-stage' };
    else {
      try {
        next = resolveDuelMulliganV2(next, authenticatedActor, parsed.selectedUIDs, trusted?.randomIndex);
        outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq };
      } catch { outcome = { status: 'rejected', reason: 'mulligan-rejected' }; }
    }
  } else if (next.stage !== 'playing') outcome = { status: 'rejected', reason: 'invalid-stage' };
  else if (session.requiredTasks.some(entry => entry.status === 'issued'))
    outcome = { status: 'rejected', reason: 'no-permission' };
  else if (!active(next.frame)) outcome = { status: 'rejected', reason: 'invalid-phase' };
  else {
    // No unverified pending actor (or forged sidecar) can gain a resource window.
    let bound: ReturnType<typeof pendingBinding>;
    try { verifyPlaying(next); bound = pendingBinding(session, next); }
    catch { outcome = { status: 'rejected', reason: 'resource-rejected' };
      bound = { task: undefined, ordinary: undefined }; }
    if (outcome === undefined) {
      const payment = next.frame.pendingPayment;
      if (parsed.type === 'pay-pending') {
        if (!payment || payment.paymentId !== parsed.paymentId || payment.actor !== authenticatedActor)
          outcome = { status: 'rejected', reason: 'no-permission' };
        else {
          try {
            const entry = bound.task ?? bound.ordinary;
            check(entry, 'payment has no independent source/task binding');
            attest({ match: next, actor: payment.actor, paymentId: payment.paymentId,
              sourceReference: payment.sourceReference, finalResolvedCost: payment.resolvedCost,
              ...(bound.task ? { taskId: bound.task.taskId, continuationId: bound.task.continuationId } : {}),
              previous: entry.sourceBinding }, trusted?.sourceAttestor as DuelSourceAttestorV2);
            const paid = payDuelRuneCost(next.resources, authenticatedActor, payment.resolvedCost,
              timing(next.frame), parsed.plan);
            const match = commitDuelPlayingMutationV2(next as DuelCanonicalPlayingStateV2,
              draft => ({ match: { ...draft, resources: paid.resources,
                frame: { ...draft.frame, pendingPayment: null } }, transitions: [] }));
            check(match !== next, 'pay must close pending window');
            next = match;
            completedTask = bound.task?.taskId; completedOrdinary = bound.ordinary?.paymentId;
            outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq,
              paymentCompleted: { paymentId: payment.paymentId,
                sourceReference: { ...payment.sourceReference }, sourceProofId: entry.sourceBinding.sourceProofId,
                plan: { power: paid.plan.power.map(item => ({ ...item })) },
                ...(bound.task ? { requiredTask: { taskId: bound.task.taskId,
                  continuationId: bound.task.continuationId } } : {}) } };
          } catch { outcome = { status: 'rejected', reason: 'payment-rejected' }; }
        }
      } else if (bound.task && bound.task.actor !== authenticatedActor)
        outcome = { status: 'rejected', reason: 'no-permission' };
      else if (next.frame.priorityPlayerId !== authenticatedActor && payment?.actor !== authenticatedActor)
        outcome = { status: 'rejected', reason: 'no-permission' };
      else {
        try {
          const previous = next;
          const trace: DuelPhysicalZoneTransition[] = [];
          // Gold is consumed through the Core V2 token authority (activateDuelGoldPowerV2),
          // which owns the independently attested birth, the live trusted-owner proof, the
          // live-token retirement and the single outer clock in ONE admitted commit. A UID
          // with no attested gold birth, a non-live/foreign token, or an exhausted token still
          // fails closed: this branch never fabricates a token nor infers an owner from the Base.
          const match = parsed.type === 'gold-power'
            ? activateDuelGoldPowerV2(previous, authenticatedActor, parsed.uid, timing(previous.frame))
            : commitDuelPlayingMutationV2(previous, draft => {
              const sourceTiming = timing(draft.frame);
              const resources = parsed.type === 'rune-energy'
                ? activateBasicRuneEnergy(draft.resources, authenticatedActor, parsed.uid, sourceTiming)
                : activateBasicRunePower(draft.resources, authenticatedActor, parsed.uid, sourceTiming);
              if (parsed.type === 'rune-power') {
                const base = draft.resources.bases.find(item => item.playerId === authenticatedActor);
                check(base && base.baseRunes.some(rune => rune.uid === parsed.uid), 'Recycle source must be on own base');
                trace.push({ uid: parsed.uid, from: { kind: 'board-base', locationId: base.locationId },
                  to: { kind: 'rune-deck', zonePlayerId: authenticatedActor } });
              }
              return { match: { ...draft, resources }, transitions: trace };
            });
          check(match !== previous, 'resource command made no change');
          next = match;
          outcome = { status: 'applied', appliedVersion: next.stateVersion, eventSeq: next.eventSeq };
        } catch { outcome = { status: 'rejected', reason: 'resource-rejected' }; }
      }
    }
  }
  check(outcome !== undefined, 'unhandled command outcome');
  const receipt: DuelCommandReceiptV2 = { actor: authenticatedActor, commandId,
    payloadFingerprint: fingerprint, outcome };
  const nextCursor = mainCursor(session, next);
  const updated = publish({ ...session, match: next,
    ...(nextCursor ? { turnCursorV2: nextCursor } : {}), receipts: [...session.receipts, receipt],
    ...(completedTask ? { requiredTasks: session.requiredTasks.map(entry =>
      entry.taskId === completedTask ? { ...entry, status: 'completed' as const } : entry) } : {}),
    ...(completedOrdinary ? { priorityPayments: session.priorityPayments.map(entry =>
      entry.paymentId === completedOrdinary ? { ...entry, status: 'completed' as const } : entry) } : {}) });
  return result(successor(session, updated), outcome, false, true);
}
