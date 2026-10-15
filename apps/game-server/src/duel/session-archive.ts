/**
 * PRIVATE duel command-session archive. No wire/room route uses this module.
 * A parsed file is data, never an authority: the caller binds the server-owned match,
 * roster and catalog, and supplies trusted registries for any resumable cost source.
 * Validating a receipt's structure cannot reconstruct its historical execution;
 * durability/integrity and persist-before-ACK remain responsibilities of the caller.
 */
import {
  detachedDuelPlaying, restoreDuelSetup,
  type DuelCanonicalMatchState, type DuelCanonicalPlayingState,
  type DuelCommandOutcome, type DuelCommandReceipt, type DuelCommandRejection,
  type DuelCommandSession, type DuelPaymentCompleted, type DuelPaymentSourceReference,
  type DuelPendingPayment, type DuelRequiredTaskLedgerEntry,
  type DuelMatchPerson, type DuelPaymentPlan, type DuelRuneCost,
  DUEL_DOMAINS,
} from '@riftbound/engine-core/duel';
import { isDuelCommand, type DuelWireCommand } from '@riftbound/protocol';

export interface DuelSessionRestoreContext {
  /** Server-owned match identity, NOT a value recovered from this archive. */
  readonly expectedMatchId: string;
  /** Both authenticated seats, including names and seat order. */
  readonly expectedRoster2: readonly [DuelMatchPerson, DuelMatchPerson];
  readonly expectedCatalog: { readonly dataVersion: string; readonly catalogDigest: string };
  /** A trusted executor/registry must independently attest the task's origin AND final cost. */
  readonly requiredTaskSourceValidator?: (
    task: DuelRequiredTaskLedgerEntry, match: DuelCanonicalPlayingState,
  ) => boolean;
  /** Separate trusted resolver for an ordinary Priority payment with no required-task ledger. */
  readonly priorityPaymentSourceValidator?: (
    payment: DuelPendingPayment, match: DuelCanonicalPlayingState,
  ) => boolean;
}
export interface DuelSessionArchive {
  readonly schemaVersion: 1;
  readonly kind: 'duel-command-session';
  readonly session: DuelCommandSession;
}
export type DuelSessionArchiveErrorCode =
  | 'invalid-archive' | 'unsupported-sidecar' | 'context-mismatch' | 'untrusted-payment-source';
export class DuelSessionArchiveError extends TypeError {
  constructor(readonly code: DuelSessionArchiveErrorCode, message: string) {
    super(`Duel session archive (${code}): ${message}`);
    this.name = 'DuelSessionArchiveError';
  }
}
function fail(code: DuelSessionArchiveErrorCode, detail: string): never {
  throw new DuelSessionArchiveError(code, detail);
}
function ensure(ok: unknown, detail: string): asserts ok {
  if (!ok) fail('invalid-archive', detail);
}
function exact(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  ensure(raw !== null && typeof raw === 'object' && !Array.isArray(raw), `${label} record`);
  ensure(Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null,
    `${label} prototype`);
  const actual = Reflect.ownKeys(raw);
  ensure(actual.length === keys.length && keys.every(key => actual.includes(key)) &&
    actual.every(key => {
      const desc = Object.getOwnPropertyDescriptor(raw, key);
      return typeof key === 'string' && desc?.enumerable === true && 'value' in desc;
    }),
  `${label} exact keys/accessors`);
  return raw as Record<string, unknown>;
}
function array(raw: unknown, label: string): readonly unknown[] {
  ensure(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype, `${label} array`);
  ensure(Reflect.ownKeys(raw).length === raw.length + 1 &&
    Array.from({ length: raw.length }, (_, i) => Object.getOwnPropertyDescriptor(raw, String(i)))
      .every(desc => desc !== undefined && desc.enumerable === true && 'value' in desc),
    `${label} dense elements`);
  return raw;
}
function id(raw: unknown, label: string): string {
  ensure(typeof raw === 'string' && raw.trim().length > 0, `${label} nonblank identifier`);
  return raw;
}
function count(raw: unknown, label: string): number {
  ensure(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0, `${label} safe counter`);
  return raw;
}
function source(raw: unknown): DuelPaymentSourceReference {
  ensure(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'payment source');
  const s = exact(raw, Object.hasOwn(raw, 'sourceUID')
    ? ['kind', 'referenceId', 'sourceUID'] : ['kind', 'referenceId'], 'payment source');
  ensure(s.kind === 'card' || s.kind === 'effect', 'payment source kind');
  return { kind: s.kind, referenceId: id(s.referenceId, 'source referenceId'),
    ...(Object.hasOwn(s, 'sourceUID') ? { sourceUID: id(s.sourceUID, 'source UID') } : {}) };
}
function cost(raw: unknown): DuelRuneCost {
  const c = exact(raw, ['energy', 'power'], 'final resolved cost');
  let sum = count(c.energy, 'cost energy');
  const power = array(c.power, 'cost power').map(value => {
    const entry = exact(value, ['allowedDomains', 'amount'], 'cost requirement');
    const domains = array(entry.allowedDomains, 'allowed domains');
    ensure(domains.length > 0 && domains.length <= DUEL_DOMAINS.length &&
      new Set(domains).size === domains.length &&
      domains.every(domain => DUEL_DOMAINS.some(known => known === domain)), 'cost domains');
    const amount = count(entry.amount, 'cost power amount');
    ensure(amount > 0, 'positive cost requirement');
    sum += amount;
    ensure(Number.isSafeInteger(sum), 'cost sum overflow');
    return { allowedDomains: [...domains] as (typeof DUEL_DOMAINS)[number][], amount };
  });
  return { energy: c.energy as number, power };
}
function plan(raw: unknown): DuelPaymentPlan {
  const p = exact(raw, ['power'], 'payment plan');
  const pairs = new Set<string>();
  return { power: array(p.power, 'plan power').map(value => {
    const entry = exact(value, ['requirementIndex', 'from', 'amount'], 'plan allocation');
    const requirementIndex = count(entry.requirementIndex, 'requirement index');
    const amount = count(entry.amount, 'allocation amount');
    ensure(amount > 0 && (entry.from === 'any' || DUEL_DOMAINS.some(domain => domain === entry.from)),
      'positive allocation/known source');
    const from = entry.from as (typeof DUEL_DOMAINS)[number] | 'any';
    const key = `${requirementIndex}:${from}`;
    ensure(!pairs.has(key), 'duplicate plan allocation');
    pairs.add(key);
    return { requirementIndex, from, amount };
  }) };
}
function paymentCompleted(raw: unknown): DuelPaymentCompleted {
  ensure(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'payment completion');
  const p = exact(raw, Object.hasOwn(raw, 'requiredTask')
    ? ['paymentId', 'sourceReference', 'plan', 'requiredTask']
    : ['paymentId', 'sourceReference', 'plan'], 'payment completion');
  const requiredTask = Object.hasOwn(p, 'requiredTask')
    ? exact(p.requiredTask, ['taskId', 'continuationId'], 'completion continuation') : null;
  return { paymentId: id(p.paymentId, 'completed payment ID'), sourceReference: source(p.sourceReference),
    plan: plan(p.plan), ...(requiredTask ? { requiredTask: {
      taskId: id(requiredTask.taskId, 'completed task ID'),
      continuationId: id(requiredTask.continuationId, 'completed continuation ID'),
    } } : {}) };
}
const REJECTIONS: readonly DuelCommandRejection[] = [
  'invalid-command', 'unknown-actor', 'command-conflict', 'stale-version', 'invalid-stage',
  'invalid-phase', 'no-permission', 'mulligan-rejected', 'resource-rejected',
  'payment-rejected', 'version-overflow',
];
function outcome(raw: unknown, match: DuelCanonicalMatchState): DuelCommandOutcome {
  ensure(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'receipt outcome');
  const status = Object.getOwnPropertyDescriptor(raw, 'status')?.value as unknown;
  if (status === 'rejected') {
    const o = exact(raw, ['status', 'reason'], 'rejected outcome');
    ensure(REJECTIONS.some(reason => reason === o.reason), 'unknown rejection reason');
    return { status, reason: o.reason as DuelCommandRejection };
  }
  ensure(status === 'applied', 'unknown outcome status');
  const o = exact(raw, Object.hasOwn(raw, 'paymentCompleted')
    ? ['status', 'appliedVersion', 'eventSeq', 'paymentCompleted']
    : ['status', 'appliedVersion', 'eventSeq'], 'applied outcome');
  const version = count(o.appliedVersion, 'receipt applied version');
  const seq = count(o.eventSeq, 'receipt event sequence');
  ensure(version > 0 && seq > 0 && version === seq &&
    version <= match.stateVersion && seq <= match.eventSeq, 'receipt future/drifted clock');
  return { status, appliedVersion: version, eventSeq: seq,
    ...(Object.hasOwn(o, 'paymentCompleted')
      ? { paymentCompleted: paymentCompleted(o.paymentCompleted) } : {}) };
}
/** Same sorted-object-key, ordered-array canonicalization as core's private semantic fingerprint. */
function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJSON(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function commandFingerprint(raw: unknown): { fingerprint: string; command: DuelWireCommand } {
  const fingerprint = id(raw, 'payload fingerprint');
  let parsed: unknown;
  try { parsed = JSON.parse(fingerprint); }
  catch { return fail('invalid-archive', 'invalid command fingerprint JSON'); }
  ensure(isDuelCommand(parsed), 'fingerprint must encode an actual DuelWireCommand');
  // The core accepts overlong/duplicate selectedUID arrays (which it later rejects),
  // whereas the wire guard deliberately accepts only legal-length unique mulligan selections
  // and nonduplicate positive plan allocations. This stricter archive does not synthesize a
  // missing original command; callers must not treat rejected-invalid wire payloads as receipts.
  ensure(canonicalJSON(parsed) === fingerprint, 'noncanonical command fingerprint');
  return { fingerprint, command: parsed };
}
function receipts(raw: unknown, match: DuelCanonicalMatchState): DuelCommandReceipt[] {
  const seen = new Set<string>(), completed = new Set<string>();
  let lastApplied = 0;
  return array(raw, 'receipts').map(value => {
    const r = exact(value, ['actor', 'commandId', 'payloadFingerprint', 'outcome'], 'receipt');
    const actor = id(r.actor, 'receipt actor');
    ensure(match.roster.some(seat => seat.playerId === actor), 'receipt actor outside roster');
    const commandId = id(r.commandId, 'receipt command ID');
    const key = JSON.stringify([actor, commandId]);
    ensure(!seen.has(key), 'duplicate actor/command ID');
    seen.add(key);
    const { fingerprint, command } = commandFingerprint(r.payloadFingerprint);
    const result = outcome(r.outcome, match);
    if (result.status === 'applied') {
      ensure(result.appliedVersion > lastApplied, 'applied receipts out of clock order');
      lastApplied = result.appliedVersion;
      if (command.type === 'mulligan') {
        ensure(result.appliedVersion <= 2 &&
          actor === match.turnOrder[result.appliedVersion - 1], 'mulligan applied seat/version');
      } else ensure(match.stage === 'playing' && result.appliedVersion > 2,
        'resource/payment applied before playing');
      if (result.paymentCompleted) {
        ensure(command.type === 'pay-pending' &&
          command.paymentId === result.paymentCompleted.paymentId, 'completion/command mismatch');
        ensure(!completed.has(command.paymentId), 'payment ID completed more than once');
        completed.add(command.paymentId);
      } else ensure(command.type !== 'pay-pending', 'applied payment lacks completion');
    }
    return { actor, commandId, payloadFingerprint: fingerprint, outcome: result };
  });
}
function task(raw: unknown, match: DuelCanonicalMatchState): DuelRequiredTaskLedgerEntry {
  const t = exact(raw, ['matchId', 'expectedVersion', 'taskId', 'paymentId', 'actor',
    'finalResolvedCost', 'opaqueSource', 'continuationId', 'status'], 'required task');
  ensure(t.status === 'issued' || t.status === 'active' || t.status === 'completed', 'task status');
  const matchId = id(t.matchId, 'task match ID'), expectedVersion = count(t.expectedVersion, 'task version');
  const actor = id(t.actor, 'task actor');
  ensure(match.stage === 'playing' && matchId === match.matchId && expectedVersion <= match.stateVersion &&
    match.roster.some(seat => seat.playerId === actor), 'task match/actor/version binding');
  return { matchId, expectedVersion, taskId: id(t.taskId, 'task ID'),
    paymentId: id(t.paymentId, 'task payment ID'), actor,
    finalResolvedCost: cost(t.finalResolvedCost), opaqueSource: source(t.opaqueSource),
    continuationId: id(t.continuationId, 'continuation ID'), status: t.status };
}
function same(left: unknown, right: unknown): boolean { return canonicalJSON(left) === canonicalJSON(right); }
/** A completed required task's recorded allocation must actually cover its attested final Power cost. */
function completedPlanCoversCost(paymentPlan: DuelPaymentPlan, finalCost: DuelRuneCost): boolean {
  const paid = finalCost.power.map(() => 0);
  for (const allocation of paymentPlan.power) {
    const requirement = finalCost.power[allocation.requirementIndex];
    if (!requirement || (allocation.from !== 'any' &&
      !requirement.allowedDomains.includes(allocation.from))) return false;
    paid[allocation.requirementIndex] = paid[allocation.requirementIndex]! + allocation.amount;
    if (!Number.isSafeInteger(paid[allocation.requirementIndex])) return false;
  }
  return paid.every((amount, index) => amount === finalCost.power[index]!.amount);
}
function requiredTasks(raw: unknown, match: DuelCanonicalMatchState, ledgerPresent: boolean,
  rs: readonly DuelCommandReceipt[]): DuelRequiredTaskLedgerEntry[] | undefined {
  const entries = ledgerPresent ? array(raw, 'required tasks').map(value => task(value, match)) : undefined;
  const tasks = entries ?? [];
  const taskIds = new Set<string>(), paymentIds = new Set<string>();
  for (const entry of tasks) {
    ensure(!taskIds.has(entry.taskId) && !paymentIds.has(entry.paymentId), 'duplicate task/payment identity');
    taskIds.add(entry.taskId); paymentIds.add(entry.paymentId);
  }
  const active = tasks.filter(entry => entry.status === 'active');
  ensure(active.length <= 1, 'multiple active tasks');
  const pending = match.stage === 'playing' ? match.frame.pendingPayment : null;
  if (pending !== null) ensure(match.stateVersion > 2, 'pending payment lacks playing window');
  if (active.length) {
    const entry = active[0]!;
    ensure(pending !== null && entry.expectedVersion < match.stateVersion &&
      entry.actor === pending.actor && entry.paymentId === pending.paymentId &&
      same(entry.finalResolvedCost, pending.resolvedCost) &&
      same(entry.opaqueSource, pending.sourceReference), 'active task/pending cost/source binding');
  }
  const completions = rs.flatMap(receipt => receipt.outcome.status === 'applied' &&
    receipt.outcome.paymentCompleted ? [{ actor: receipt.actor,
      version: receipt.outcome.appliedVersion, completion: receipt.outcome.paymentCompleted }] : []);
  if (pending !== null) ensure(!completions.some(({ completion }) =>
    completion.paymentId === pending.paymentId), 'pending payment already completed');
  for (const entry of tasks) {
    const matching = completions.filter(({ completion }) => completion.paymentId === entry.paymentId);
    if (entry.status === 'completed') {
      ensure(matching.length === 1 && matching[0]!.actor === entry.actor &&
        matching[0]!.version > entry.expectedVersion &&
        matching[0]!.completion.requiredTask?.taskId === entry.taskId &&
        matching[0]!.completion.requiredTask?.continuationId === entry.continuationId &&
        same(matching[0]!.completion.sourceReference, entry.opaqueSource) &&
        completedPlanCoversCost(matching[0]!.completion.plan, entry.finalResolvedCost),
      'completed task/receipt/continuation/plan binding');
    } else ensure(matching.length === 0 &&
      (entry.status !== 'active' || pending !== null), 'issued/active task already completed');
  }
  for (const { completion } of completions) if (completion.requiredTask) {
    ensure(tasks.some(entry => entry.status === 'completed' &&
      entry.taskId === completion.requiredTask?.taskId && entry.paymentId === completion.paymentId &&
      entry.continuationId === completion.requiredTask?.continuationId),
    'completion refers to missing/noncompleted required task');
  }
  return entries;
}
function match(raw: unknown): DuelCanonicalMatchState {
  ensure(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'match record');
  const stage = Object.getOwnPropertyDescriptor(raw, 'stage')?.value as unknown;
  if (stage === 'playing') {
    // The core helper performs the actual complete private UID/board/resource/scoring/frame
    // validation and returns a detached state. The cast only supplies its typed input parameter.
    return detachedDuelPlaying(raw as DuelCanonicalPlayingState);
  }
  ensure(stage === 'setup', 'match stage');
  const m = exact(raw, ['stage', 'schemaVersion', 'rulesetId', 'matchId', 'dataVersion',
    'catalogDigest', 'stateVersion', 'eventSeq', 'roster', 'turnOrder', 'setup'], 'setup match');
  ensure(m.schemaVersion === 1 && m.rulesetId === 'riftbound-duel', 'setup schema/ruleset');
  const matchId = id(m.matchId, 'match ID');
  const dataVersion = id(m.dataVersion, 'data version');
  const catalogDigest = id(m.catalogDigest, 'catalog digest');
  const stateVersion = count(m.stateVersion, 'match state version');
  const eventSeq = count(m.eventSeq, 'match event sequence');
  const roster = array(m.roster, 'match roster');
  ensure(roster.length === 2, 'two roster seats');
  const seats = roster.map(value => {
    const person = exact(value, ['playerId', 'displayName'], 'roster person');
    return { playerId: id(person.playerId, 'roster player'), displayName: id(person.displayName, 'roster name') };
  }) as [DuelMatchPerson, DuelMatchPerson];
  ensure(seats[0].playerId !== seats[1].playerId, 'distinct roster seats');
  const order = array(m.turnOrder, 'turn order');
  ensure(order.length === 2 && new Set(order).size === 2 &&
    order.every(value => seats.some(seat => seat.playerId === value)), 'turn order permutation');
  const setup = restoreDuelSetup(m.setup);
  ensure(setup.stage === 'mulligan' && setup.playerIds.every((value, i) => value === seats[i]!.playerId) &&
    setup.turnOrder.every((value, i) => value === order[i]), 'setup roster/turn/stage binding');
  const completed = setup.players.filter(player => player.mulliganStatus === 'complete').length;
  ensure(stateVersion === completed && completed <= 1 && eventSeq === stateVersion &&
    (completed === 0 || setup.players.find(player => player.playerId === order[0])?.mulliganStatus === 'complete'),
    'setup mulligan clocks/turn');
  return { stage: 'setup', schemaVersion: 1, rulesetId: 'riftbound-duel', matchId,
    dataVersion, catalogDigest, stateVersion, eventSeq, roster: seats,
    turnOrder: [...order] as [string, string], setup };
}
function session(raw: unknown): DuelCommandSession {
  ensure(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'session record');
  const keys = Reflect.ownKeys(raw);
  ensure(keys.every(key => typeof key === 'string'), 'session symbols are not JSON-safe');
  if (keys.some(key => key !== 'match' && key !== 'receipts' && key !== 'requiredTasks'))
    fail('unsupported-sidecar', 'session sidecar requires a registered validator');
  const s = exact(raw, Object.hasOwn(raw, 'requiredTasks')
    ? ['match', 'receipts', 'requiredTasks'] : ['match', 'receipts'], 'session');
  const checkedMatch = match(s.match);
  ensure(checkedMatch.stateVersion === checkedMatch.eventSeq &&
    (checkedMatch.stage !== 'playing' || checkedMatch.stateVersion >= 2),
    'match clock/stage mismatch');
  const checkedReceipts = receipts(s.receipts, checkedMatch);
  // Receipt identity/shape is checked above; we do not reconstruct historical trusted
  // executor steps from archive metadata alone. A restored match is the sole current state.
  const checkedTasks = requiredTasks(s.requiredTasks, checkedMatch,
    Object.hasOwn(s, 'requiredTasks'), checkedReceipts);
  return { match: checkedMatch, receipts: checkedReceipts,
    ...(checkedTasks === undefined ? {} : { requiredTasks: checkedTasks }) };
}
function trustedContext(raw: DuelSessionRestoreContext): DuelSessionRestoreContext {
  ensure(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'trusted restore context');
  const c = exact(raw, ['expectedMatchId', 'expectedRoster2', 'expectedCatalog',
    ...(['requiredTaskSourceValidator', 'priorityPaymentSourceValidator'] as const)
      .filter(key => Object.hasOwn(raw, key))], 'trusted restore context');
  const roster = array(c.expectedRoster2, 'expected roster');
  ensure(roster.length === 2, 'expected two seats');
  const expectedRoster2 = roster.map(value => {
    const seat = exact(value, ['playerId', 'displayName'], 'expected seat');
    return { playerId: id(seat.playerId, 'expected player ID'),
      displayName: id(seat.displayName, 'expected name') };
  }) as [DuelMatchPerson, DuelMatchPerson];
  ensure(expectedRoster2[0].playerId !== expectedRoster2[1].playerId, 'distinct expected seats');
  const catalog = exact(c.expectedCatalog, ['dataVersion', 'catalogDigest'], 'expected catalog');
  for (const key of ['requiredTaskSourceValidator', 'priorityPaymentSourceValidator'] as const)
    if (Object.hasOwn(c, key)) ensure(typeof c[key] === 'function', `${key} must be a function`);
  return { expectedMatchId: id(c.expectedMatchId, 'expected match ID'), expectedRoster2,
    expectedCatalog: { dataVersion: id(catalog.dataVersion, 'expected data version'),
      catalogDigest: id(catalog.catalogDigest, 'expected catalog digest') },
    ...(Object.hasOwn(c, 'requiredTaskSourceValidator')
      ? { requiredTaskSourceValidator: c.requiredTaskSourceValidator as DuelSessionRestoreContext['requiredTaskSourceValidator'] } : {}),
    ...(Object.hasOwn(c, 'priorityPaymentSourceValidator')
      ? { priorityPaymentSourceValidator: c.priorityPaymentSourceValidator as DuelSessionRestoreContext['priorityPaymentSourceValidator'] } : {}) };
}
function freeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  Object.freeze(value);
}
function verifySources(checked: DuelCommandSession, context: DuelSessionRestoreContext): void {
  const { match: m } = checked;
  const ledger = checked.requiredTasks ?? [];
  const pending = m.stage === 'playing' ? m.frame.pendingPayment : null;
  if (ledger.length || pending !== null) ensure(m.stage === 'playing', 'payment outside playing');
  if (m.stage !== 'playing') return;
  if (ledger.length) {
    if (!context.requiredTaskSourceValidator)
      fail('untrusted-payment-source', 'required task source/final cost validator is missing');
    for (const entry of ledger) {
      const sourceTask = { ...entry, finalResolvedCost: cost(entry.finalResolvedCost),
        opaqueSource: source(entry.opaqueSource) };
      freeze(sourceTask);
      const sourceMatch = detachedDuelPlaying(m);
      freeze(sourceMatch);
      if (context.requiredTaskSourceValidator(sourceTask, sourceMatch) !== true)
        fail('untrusted-payment-source', 'required task source/final cost not attested');
    }
  }
  if (pending !== null && !ledger.some(entry => entry.status === 'active')) {
    if (!context.priorityPaymentSourceValidator)
      fail('untrusted-payment-source', 'priority payment source/final cost validator is missing');
    const sourcePayment = { paymentId: pending.paymentId, actor: pending.actor,
      resolvedCost: cost(pending.resolvedCost), sourceReference: source(pending.sourceReference) };
    freeze(sourcePayment);
    const sourceMatch = detachedDuelPlaying(m);
    freeze(sourceMatch);
    if (context.priorityPaymentSourceValidator(sourcePayment, sourceMatch) !== true)
      fail('untrusted-payment-source', 'priority payment source/final cost not attested');
  }
}
function boundary<T>(action: () => T): T {
  try { return action(); }
  catch (error) {
    if (error instanceof DuelSessionArchiveError) throw error;
    throw new DuelSessionArchiveError('invalid-archive',
      error instanceof Error ? error.message : 'malformed archive');
  }
}
/** Export only a detached private JSON-compatible envelope; never serialize opaque capabilities. */
export function exportDuelSessionArchive(input: DuelCommandSession): DuelSessionArchive {
  // Input is trusted in-process state; source attestation is mandatory on *restore*, not export.
  return boundary(() => ({ schemaVersion: 1, kind: 'duel-command-session', session: session(input) }));
}
/** Fail closed before treating any disk JSON as an authoritative DuelCommandSession. */
export function restoreDuelSessionArchive(raw: unknown, context: DuelSessionRestoreContext): DuelCommandSession {
  return boundary(() => {
    const trusted = trustedContext(context);
    const archive = exact(raw, ['schemaVersion', 'kind', 'session'], 'archive envelope');
    ensure(archive.schemaVersion === 1 && archive.kind === 'duel-command-session', 'archive version/kind');
    const checked = session(archive.session);
    const m = checked.match;
    if (m.matchId !== trusted.expectedMatchId ||
      !same(m.roster, trusted.expectedRoster2) ||
      m.dataVersion !== trusted.expectedCatalog.dataVersion ||
      m.catalogDigest !== trusted.expectedCatalog.catalogDigest)
      fail('context-mismatch', 'trusted match/roster/catalog binding failed');
    verifySources(checked, trusted);
    return checked;
  });
}
