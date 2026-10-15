// INTERNAL Duel V2 Chain kernel. CardPlay classifies items, checks card legality,
// and owns the canonical effect transaction. No effect callback is ever executed
// by this module. All handles/tickets/proofs are process-local capabilities; a
// JSON projection of any of them is NOT a continuation or a transaction receipt.

export type DuelChainItemStatusV2 = 'pending' | 'finalized';
export type DuelChainResolutionModeV2 = 'immediate' | 'fepr';
export type DuelChainPhaseV2 = 'open' | 'finalize' | 'execute' | 'resolve' | 'await-commit' | 'handoff';
export type DuelChainContinuationStepV2 = 'append' | 'finalize' | 'pass' | 'request-resolution' | 'commit-resolution' | 'handoff';

export interface DuelChainItemV2 {
  readonly id: string;
  /** Source-owned label; this kernel never interprets card kinds. */
  readonly kind: string;
  readonly controllerPlayerId: string;
  readonly executorId: string;
  /** CardPlay supplies this classification; do not infer it from `kind`. */
  readonly resolutionMode: DuelChainResolutionModeV2;
  readonly status: DuelChainItemStatusV2;
  readonly appendedAtVersion: number;
  readonly finalizedAtVersion: number | null;
}

export interface DuelChainItemDraftV2 {
  readonly id: string;
  readonly kind: string;
  readonly controllerPlayerId: string;
  readonly executorId?: string;
  readonly resolutionMode: DuelChainResolutionModeV2;
}

export interface DuelChainContinuationV2 {
  readonly id: string;
  readonly expectedVersion: number;
  readonly step: DuelChainContinuationStepV2;
  readonly priorityPlayerId: string | null;
}

/** Showdown handoff has no playable priority until the outer phase takes over. */
export type DuelChainCloseContextV2 =
  | { readonly kind: 'main-phase'; readonly returnPriorityPlayerId: string }
  | { readonly kind: 'showdown'; readonly returnFocusPlayerId: string }
  | { readonly kind: 'showdown-handoff' };

export interface DuelChainV2 {
  readonly schemaVersion: 2;
  readonly chainId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly turnOrder: readonly string[];
  readonly closeContext: DuelChainCloseContextV2;
  readonly priorityPlayerId: string | null;
  /** Derived from items.length, including an empty, non-playable handoff. */
  readonly stateOpen: boolean;
  readonly status: 'open' | 'closed' | 'handoff';
  readonly phase: DuelChainPhaseV2;
  readonly consecutivePasses: number;
  readonly items: readonly DuelChainItemV2[];
  /** Never release an ID on resolution; prevent ABA/replay reuse. */
  readonly issuedItemIds: readonly string[];
  readonly continuation: DuelChainContinuationV2;
}

export interface DuelChainConfigV2 {
  readonly turnOrder: readonly string[];
  readonly initialPriorityPlayerId?: string;
  readonly chainId?: string;
  readonly closeContext: DuelChainCloseContextV2;
  /** Bind the canonical transaction's read-only receipt authority at creation. */
  readonly resolutionAuthority: DuelChainResolutionAuthorityV2;
  /** Trusted parent entropy tape only. Commands/archives never supply callbacks.
   * Each allocation must be recorded by the same owner as Core UID allocation. */
  readonly identityFactory?: () => string;
}

/** A handle identifies an external effect, but deliberately contains no callback. */
export interface DuelChainExecutorV2 {
  readonly executorId: string;
  readonly _duelChainExecutorV2: unique symbol;
}

export interface DuelChainAppendRequestV2 {
  readonly actor: string;
  readonly expectedVersion: number;
  readonly item: DuelChainItemDraftV2;
  readonly executor: DuelChainExecutorV2;
}
export interface DuelChainFinalizeRequestV2 {
  readonly actor: string;
  readonly expectedVersion: number;
}
export interface DuelChainPassRequestV2 {
  readonly actor: string;
  readonly expectedVersion: number;
}
export interface DuelChainRequestResolutionV2 {
  readonly expectedVersion: number;
  readonly actor?: string;
  /** Optional exact-identity assertion; never binds an executor after append. */
  readonly executor?: DuelChainExecutorV2;
}

/** External transaction MUST use this exact key for atomic, durable idempotency. */
export interface DuelChainResolutionTicketV2 {
  readonly idempotencyKey: string;
  readonly chainId: string;
  readonly itemId: string;
  readonly item: DuelChainItemV2;
  readonly executorId: string;
  readonly executor: DuelChainExecutorV2;
  readonly requestedAtVersion: number;
  readonly lockedAtVersion: number;
  readonly _duelChainResolutionTicketV2: unique symbol;
}

/** A new pending item emitted by a committed effect, in exact append order. */
export interface DuelChainProducedItemV2 {
  readonly item: DuelChainItemDraftV2;
  readonly executor: DuelChainExecutorV2;
}

/**
 * Result of a READ-ONLY lookup of the canonical transaction's committed receipt.
 * Transaction adapters must persist these exact ticket identities atomically
 * with effect application; the kernel verifies them before signing a proof.
 */
export interface DuelChainCommittedReceiptV2 {
  readonly status: 'committed';
  readonly idempotencyKey: string;
  readonly chainId: string;
  readonly itemId: string;
  readonly executorId: string;
  readonly produced?: readonly DuelChainProducedItemV2[];
}

/** null means blocked, failed, or unknown: do NOT claim a transaction committed. */
export type DuelChainCommittedLookupV2 =
  (ticket: DuelChainResolutionTicketV2) => DuelChainCommittedReceiptV2 | null;

export interface DuelChainResolutionAuthorityV2 {
  readonly _duelChainResolutionAuthorityV2: unique symbol;
}

/** Branded, immutable, ticket-bound proof; a caller cannot supply its own receipt to commit. */
export interface DuelChainCommittedProofV2 {
  readonly idempotencyKey: string;
  readonly itemId: string;
  readonly produced: readonly DuelChainProducedItemV2[];
  readonly _duelChainCommittedProofV2: unique symbol;
}

export interface DuelChainCommitRequestV2 {
  readonly expectedVersion: number;
  readonly ticket: DuelChainResolutionTicketV2;
  readonly proof: DuelChainCommittedProofV2;
}

export type DuelChainBlockCodeV2 =
  | 'untrusted-chain' | 'stale-continuation' | 'stale-version'
  | 'invalid-request' | 'invalid-turn-order' | 'invalid-item' | 'duplicate-item-id'
  | 'wrong-actor' | 'wrong-priority' | 'invalid-phase' | 'pending-item'
  | 'no-pending-item' | 'item-not-finalized' | 'passes-incomplete'
  | 'unknown-executor' | 'executor-mismatch' | 'duplicate-executor-id'
  | 'untrusted-authority' | 'untrusted-ticket' | 'stale-ticket'
  | 'untrusted-proof' | 'proof-mismatch' | 'resolution-query-failed'
  | 'reentrant-transition' | 'numeric-overflow';

export class DuelChainBlockedErrorV2 extends TypeError {
  readonly code: DuelChainBlockCodeV2;
  constructor(code: DuelChainBlockCodeV2, message: string) {
    super(`Duel Chain V2 blocked [${code}]: ${message}`);
    this.name = 'DuelChainBlockedErrorV2';
    this.code = code;
  }
}

interface ExecutorEntryV2 {
  readonly id: string;
  readonly handle: DuelChainExecutorV2;
  readonly owner?: ChainAuthorityV2;
}
interface ResolutionAuthorityEntryV2 {
  readonly readCommitted: DuelChainCommittedLookupV2;
}
interface ChainAuthorityV2 {
  current: DuelChainV2;
  readonly resolutionAuthority: DuelChainResolutionAuthorityV2;
  readonly identityFactory?: () => string;
  readonly executorNamespace: Map<string, ExecutorEntryV2>;
  readonly issuedTicketKeys: Set<string>;
  executors: ReadonlyMap<string, ExecutorEntryV2>;
  ticket: DuelChainResolutionTicketV2 | null;
  proof: DuelChainCommittedProofV2 | null;
  busy: boolean;
}
interface TicketEntryV2 {
  readonly chain: ChainAuthorityV2;
  readonly locked: DuelChainV2;
  readonly item: DuelChainItemV2;
  readonly executor: ExecutorEntryV2;
}

const chainAuthorities = new WeakMap<object, ChainAuthorityV2>();
const executorAuthorities = new WeakMap<object, ExecutorEntryV2>();
const executorIds = new Set<string>();
const issuedTicketKeys = new Set<string>();
const resolutionAuthorities = new WeakMap<object, ResolutionAuthorityEntryV2>();
const ticketAuthorities = new WeakMap<object, TicketEntryV2>();
const proofAuthorities = new WeakMap<object, DuelChainResolutionTicketV2>();
let generatedExecutorId = 0;

function blocked(code: DuelChainBlockCodeV2, message: string): never {
  throw new DuelChainBlockedErrorV2(code, message);
}
function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}
function immutable<T extends object>(value: T): T { return Object.freeze(value); }
function immutableList<T>(values: readonly T[]): readonly T[] { return immutable([...values]); }
function secureRandomUUID(): string {
  const crypto = globalThis.crypto;
  try {
    const randomUUID = crypto?.randomUUID;
    if (typeof randomUUID !== 'function') blocked('invalid-request', 'secure idempotency key is unavailable');
    const id: unknown = randomUUID.call(crypto);
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      blocked('invalid-request', 'secure idempotency key is malformed');
    }
    return id;
  } catch (error) {
    if (error instanceof DuelChainBlockedErrorV2) throw error;
    blocked('invalid-request', 'secure idempotency key generation failed');
  }
}
function text(value: unknown, label: string, code: DuelChainBlockCodeV2 = 'invalid-request'): string {
  if (typeof value !== 'string' || value.trim().length === 0) blocked(code, `${label} must be a nonblank string`);
  return value;
}
function safeInteger(value: unknown, label: string, code: DuelChainBlockCodeV2 = 'invalid-request'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    blocked(code, `${label} must be a nonnegative safe integer`);
  }
  return value;
}
function nextSafe(value: number, label: string): number {
  if (value >= Number.MAX_SAFE_INTEGER) blocked('numeric-overflow', `${label} overflow`);
  return value + 1;
}

/**
 * Copy descriptor VALUES exactly once into a fresh null-prototype record. All
 * reflection, including Proxy traps, happens under the chain's busy guard.
 * Never read a raw input's properties via `obj.field` or invoke a getter.
 * JavaScript cannot prevent arbitrary side effects in a malicious Proxy trap;
 * it CAN prevent that trap from advancing this same Chain continuation.
 */
function snapshotRecord(raw: unknown, label: string, code: DuelChainBlockCodeV2 = 'invalid-request'): Record<string, unknown> {
  if (!isObject(raw)) blocked(code, `${label} must be a plain data record`);
  try {
    if (Array.isArray(raw)) blocked(code, `${label} must be a plain data record`);
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) blocked(code, `${label} must be a plain data record`);
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(raw)) {
      if (typeof key !== 'string') blocked(code, `${label} has a symbol property`);
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !('value' in descriptor)) blocked(code, `${label}.${key} is not a data property`);
      Object.defineProperty(snapshot, key, { value: descriptor.value, enumerable: true, writable: false, configurable: false });
    }
    return snapshot;
  } catch (error) {
    if (error instanceof DuelChainBlockedErrorV2) throw error;
    blocked(code, `${label} could not be snapshotted`);
  }
}
function snapshotList(raw: unknown, label: string, code: DuelChainBlockCodeV2 = 'invalid-request'): readonly unknown[] {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) {
      blocked(code, `${label} must be a plain array`);
    }
    const length = Object.getOwnPropertyDescriptor(raw, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0) blocked(code, `${label} has an invalid length`);
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== length + 1 || !keys.includes('length')) blocked(code, `${label} contains holes or extra properties`);
    const values: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
      if (!descriptor || !('value' in descriptor)) blocked(code, `${label} contains a hole or accessor`);
      values.push(descriptor.value);
    }
    return values;
  } catch (error) {
    if (error instanceof DuelChainBlockedErrorV2) throw error;
    blocked(code, `${label} could not be snapshotted`);
  }
}
function onlyKeys(value: Record<string, unknown>, label: string, allowed: readonly string[], code: DuelChainBlockCodeV2 = 'invalid-request'): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) blocked(code, `${label}.${key} is not accepted`);
  }
}
function snapshotItem(raw: unknown): DuelChainItemDraftV2 {
  const value = snapshotRecord(raw, 'item', 'invalid-item');
  onlyKeys(value, 'item', ['id', 'kind', 'controllerPlayerId', 'executorId', 'resolutionMode'], 'invalid-item');
  const id = text(value.id, 'item.id', 'invalid-item');
  const kind = text(value.kind, 'item.kind', 'invalid-item');
  const controllerPlayerId = text(value.controllerPlayerId, 'item.controllerPlayerId', 'invalid-item');
  const resolutionMode = value.resolutionMode;
  if (resolutionMode !== 'immediate' && resolutionMode !== 'fepr') {
    blocked('invalid-item', 'CardPlay must classify item.resolutionMode explicitly');
  }
  const executorId = value.executorId === undefined ? undefined : text(value.executorId, 'item.executorId', 'invalid-item');
  return immutable({ id, kind, controllerPlayerId, resolutionMode, ...(executorId === undefined ? {} : { executorId }) });
}
function executorEntry(raw: unknown): ExecutorEntryV2 {
  if (!isObject(raw)) blocked('unknown-executor', 'executor handle is missing');
  const entry = executorAuthorities.get(raw);
  if (!entry) blocked('unknown-executor', 'executor is not a live process-local handle');
  return entry;
}
function assertExecutor(item: DuelChainItemDraftV2, raw: unknown): ExecutorEntryV2 {
  const executor = executorEntry(raw);
  if (item.executorId !== undefined && item.executorId !== executor.id) {
    blocked('executor-mismatch', 'item.executorId does not match the exact supplied handle');
  }
  return executor;
}
function snapshotCloseContext(raw: unknown, players: readonly string[]): DuelChainCloseContextV2 {
  const value = snapshotRecord(raw, 'closeContext');
  onlyKeys(value, 'closeContext', ['kind', 'returnPriorityPlayerId', 'returnFocusPlayerId']);
  if (value.kind === 'main-phase') {
    if (Object.keys(value).length !== 2 || value.returnFocusPlayerId !== undefined) blocked('invalid-request', 'main-phase requires only returnPriorityPlayerId');
    const id = text(value.returnPriorityPlayerId, 'returnPriorityPlayerId');
    if (!players.includes(id)) blocked('invalid-turn-order', 'return priority is not in turn order');
    return immutable({ kind: 'main-phase', returnPriorityPlayerId: id });
  }
  if (value.kind === 'showdown') {
    if (Object.keys(value).length !== 2 || value.returnPriorityPlayerId !== undefined) blocked('invalid-request', 'showdown requires only returnFocusPlayerId');
    const id = text(value.returnFocusPlayerId, 'returnFocusPlayerId');
    if (!players.includes(id)) blocked('invalid-turn-order', 'return Focus is not in turn order');
    return immutable({ kind: 'showdown', returnFocusPlayerId: id });
  }
  if (value.kind === 'showdown-handoff' && Object.keys(value).length === 1) {
    return immutable({ kind: 'showdown-handoff' });
  }
  blocked('invalid-request', 'invalid chain close context');
}

function freezeState(state: {
  readonly chainId: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly turnOrder: readonly string[];
  readonly closeContext: DuelChainCloseContextV2;
  readonly priorityPlayerId: string | null;
  readonly phase: DuelChainPhaseV2;
  readonly consecutivePasses: number;
  readonly items: readonly DuelChainItemV2[];
  readonly issuedItemIds: readonly string[];
}): DuelChainV2 {
  const items = immutableList(state.items.map(item => immutable({ ...item })));
  const issuedItemIds = immutableList(state.issuedItemIds);
  const turnOrder = immutableList(state.turnOrder);
  const stateOpen = items.length === 0;
  const continuationStep: DuelChainContinuationStepV2 =
    state.phase === 'handoff' ? 'handoff' : stateOpen ? 'append' :
      state.phase === 'finalize' ? 'finalize' : state.phase === 'resolve' ? 'request-resolution' :
        state.phase === 'await-commit' ? 'commit-resolution' : 'pass';
  const continuation = immutable({
    id: `${state.chainId}:${state.eventSeq}`,
    expectedVersion: state.stateVersion,
    step: continuationStep,
    priorityPlayerId: state.priorityPlayerId,
  });
  return immutable({
    schemaVersion: 2 as const,
    chainId: state.chainId,
    stateVersion: state.stateVersion,
    eventSeq: state.eventSeq,
    turnOrder,
    closeContext: state.closeContext,
    priorityPlayerId: state.priorityPlayerId,
    stateOpen,
    status: state.phase === 'handoff' ? 'handoff' as const : stateOpen ? 'open' as const : 'closed' as const,
    phase: state.phase,
    consecutivePasses: state.consecutivePasses,
    items,
    issuedItemIds,
    continuation,
  });
}
function authorityFor(state: unknown): ChainAuthorityV2 {
  if (!isObject(state)) blocked('untrusted-chain', 'chain state capability is missing');
  const authority = chainAuthorities.get(state);
  if (!authority) blocked('untrusted-chain', 'chain state was not created in this process');
  if (authority.current !== state) blocked('stale-continuation', 'chain continuation has already advanced');
  if (authority.busy) blocked('reentrant-transition', 'cannot re-enter the same chain during input snapshot or receipt lookup');
  return authority;
}
function guarded<T>(state: DuelChainV2, operation: (authority: ChainAuthorityV2) => T): T {
  const authority = authorityFor(state);
  authority.busy = true;
  try { return operation(authority); } finally { authority.busy = false; }
}
function assertExpectedVersion(state: DuelChainV2, expected: unknown): void {
  const version = safeInteger(expected, 'expectedVersion', 'stale-version');
  if (version !== state.stateVersion) blocked('stale-version', `expected ${version}, current ${state.stateVersion}`);
}
function assertKnownPlayer(state: DuelChainV2, playerId: string, label: string): void {
  if (!state.turnOrder.includes(playerId)) blocked('wrong-actor', `${label} is not in turn order`);
}
function nextPlayer(state: DuelChainV2, playerId: string): string {
  const index = state.turnOrder.indexOf(playerId);
  if (index < 0) blocked('wrong-actor', `unknown turn-order player ${playerId}`);
  const next = state.turnOrder[(index + 1) % state.turnOrder.length];
  if (next === undefined) blocked('invalid-turn-order', 'turn order is empty');
  return next;
}
function transition(
  authority: ChainAuthorityV2, state: DuelChainV2, phase: DuelChainPhaseV2,
  priorityPlayerId: string | null, consecutivePasses: number,
  items: readonly DuelChainItemV2[], issuedItemIds: readonly string[],
  executors: ReadonlyMap<string, ExecutorEntryV2>,
): DuelChainV2 {
  const result = freezeState({
    chainId: state.chainId,
    stateVersion: nextSafe(state.stateVersion, 'stateVersion'),
    eventSeq: nextSafe(state.eventSeq, 'eventSeq'),
    turnOrder: state.turnOrder,
    closeContext: state.closeContext,
    priorityPlayerId,
    phase,
    consecutivePasses,
    items,
    issuedItemIds,
  });
  authority.current = result;
  authority.executors = executors;
  chainAuthorities.set(result, authority);
  return result;
}
function actorVersion(raw: unknown, version: unknown, label: string): { actor: string; expectedVersion: number } {
  if (typeof raw === 'string') return { actor: text(raw, `${label}.actor`), expectedVersion: safeInteger(version, `${label}.expectedVersion`, 'stale-version') };
  const value = snapshotRecord(raw, label);
  onlyKeys(value, label, ['actor', 'expectedVersion']);
  return { actor: text(value.actor, `${label}.actor`), expectedVersion: safeInteger(value.expectedVersion, `${label}.expectedVersion`, 'stale-version') };
}

/** Step 4 resolves the newest finalized item, even when newer items are pending. */
function newestFinalizedItemIndex(items: readonly DuelChainItemV2[]): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (items[index]?.status === 'finalized') return index;
  }
  return -1;
}

/** Globally unique executor IDs and exact handles (not a callback or an ID alone). */
export function createDuelChainExecutorV2(executorId?: string): DuelChainExecutorV2 {
  if (arguments.length > 1) blocked('invalid-request', 'executor callbacks are not accepted by the Chain kernel');
  let id: string;
  if (executorId === undefined) {
    do {
      generatedExecutorId = nextSafe(generatedExecutorId, 'executor ID');
      id = `executor-${generatedExecutorId}`;
    } while (executorIds.has(id));
  } else {
    id = text(executorId, 'executorId');
  }
  if (executorIds.has(id)) blocked('duplicate-executor-id', `executorId ${id} is already registered`);
  const handle = immutable({ executorId: id }) as DuelChainExecutorV2;
  executorIds.add(id);
  executorAuthorities.set(handle, { id, handle });
  return handle;
}
export const createDuelChainItemExecutorV2 = createDuelChainExecutorV2;

/** Fresh capability within one admitted Chain lineage. A replay may use the
 * same DATA id in another fresh lineage; the handle itself cannot cross over. */
export function createDuelChainScopedExecutorV2(chain: DuelChainV2): DuelChainExecutorV2 {
  if (arguments.length !== 1) blocked('invalid-request', 'an admitted Chain is required');
  return guarded(chain, authority => {
    const id = text(authority.identityFactory ? authority.identityFactory() : secureRandomUUID(), 'executor identity');
    if (authority.executorNamespace.has(id)) blocked('duplicate-executor-id', 'executor identity already issued in this Chain');
    const handle = immutable({ executorId: id }) as DuelChainExecutorV2;
    const entry = { id, handle, owner: authority };
    authority.executorNamespace.set(id, entry);
    executorAuthorities.set(handle, entry);
    return handle;
  });
}
function assertExecutorScope(authority: ChainAuthorityV2, executor: ExecutorEntryV2): void {
  if (executor.owner && executor.owner !== authority || authority.identityFactory && !executor.owner)
    blocked('executor-mismatch', 'executor does not belong to this recorded Chain');
  const prior = authority.executorNamespace.get(executor.id);
  if (prior && prior !== executor) blocked('executor-mismatch', 'executor DATA identity cannot replace its capability');
}

/** Only a trusted canonical-transaction adapter may receive this authority. */
export function createDuelChainResolutionAuthorityV2(readCommitted: DuelChainCommittedLookupV2): DuelChainResolutionAuthorityV2 {
  if (typeof readCommitted !== 'function' || arguments.length !== 1) blocked('invalid-request', 'a read-only committed-receipt lookup is required');
  const handle = immutable({}) as DuelChainResolutionAuthorityV2;
  resolutionAuthorities.set(handle, { readCommitted });
  return handle;
}

export function createDuelChainV2(config: DuelChainConfigV2): DuelChainV2 {
  const value = snapshotRecord(config, 'chain config');
  onlyKeys(value, 'chain config', ['turnOrder', 'initialPriorityPlayerId', 'chainId', 'closeContext', 'resolutionAuthority', 'identityFactory']);
  const players = snapshotList(value.turnOrder, 'turnOrder', 'invalid-turn-order').map((player, index) =>
    text(player, `turnOrder[${index}]`, 'invalid-turn-order'));
  if (players.length !== 2 || new Set(players).size !== 2) {
    blocked('invalid-turn-order', 'Duel V2 Chain requires exactly two distinct players');
  }
  // All config inputs below must be read before the first live state exists.
  // `players` is an owned snapshot, never the raw config array.
  const priority = value.initialPriorityPlayerId === undefined ? players[0] : text(value.initialPriorityPlayerId, 'initialPriorityPlayerId');
  if (priority === undefined || !players.includes(priority)) blocked('invalid-turn-order', 'initial priority is not in turn order');
  const id = value.chainId === undefined ? 'duel-chain-v2' : text(value.chainId, 'chainId');
  const closeContext = snapshotCloseContext(value.closeContext, players);
  const resolutionAuthority = value.resolutionAuthority;
  if (value.identityFactory !== undefined && typeof value.identityFactory !== 'function')
    blocked('invalid-request', 'identityFactory must be a trusted parent function');
  if (!isObject(resolutionAuthority) || !resolutionAuthorities.has(resolutionAuthority)) {
    blocked('untrusted-authority', 'resolution authority must be registered at chain creation');
  }
  const state = freezeState({
    chainId: id, stateVersion: 0, eventSeq: 0, turnOrder: players, closeContext,
    priorityPlayerId: priority, phase: 'open', consecutivePasses: 0, items: [], issuedItemIds: [],
  });
  chainAuthorities.set(state, {
    current: state, resolutionAuthority: resolutionAuthority as DuelChainResolutionAuthorityV2,
    ...(value.identityFactory ? { identityFactory: value.identityFactory as () => string } : {}),
    executorNamespace: new Map(), issuedTicketKeys: new Set(),
    executors: new Map(), ticket: null, proof: null, busy: false,
  });
  return state;
}

export function chainIsEmptyV2(chain: DuelChainV2): boolean { return chain.items.length === 0; }
export function chainItemPendingV2(item: DuelChainItemV2): boolean { return item.status === 'pending'; }
export function chainItemFinalizedV2(item: DuelChainItemV2): boolean { return item.status === 'finalized'; }
export function assertDuelChainV2(value: unknown): asserts value is DuelChainV2 {
  const state = snapshotRecord(value, 'chain');
  const items = snapshotList(state.items, 'chain.items');
  if (state.schemaVersion !== 2 || typeof state.stateOpen !== 'boolean' ||
      state.stateOpen !== (items.length === 0) ||
      state.status !== (state.phase === 'handoff' ? 'handoff' : items.length === 0 ? 'open' : 'closed')) {
    blocked('invalid-request', 'invalid public chain shape');
  }
  // A public shape assertion deliberately does not bestow transition authority.
}

export function appendDuelChainItemV2(chain: DuelChainV2, request: DuelChainAppendRequestV2): DuelChainV2;
export function appendDuelChainItemV2(chain: DuelChainV2, actor: string, item: DuelChainItemDraftV2, expectedVersion: number, executor: DuelChainExecutorV2): DuelChainV2;
export function appendDuelChainItemV2(chain: DuelChainV2, first: DuelChainAppendRequestV2 | string, second?: DuelChainItemDraftV2, third?: number, fourth?: DuelChainExecutorV2): DuelChainV2 {
  return guarded(chain, authority => {
    let actor: string;
    let expectedVersion: number;
    let rawItem: unknown;
    let rawExecutor: unknown;
    if (typeof first === 'string') {
      actor = text(first, 'append.actor');
      expectedVersion = safeInteger(third, 'append.expectedVersion', 'stale-version');
      rawItem = second;
      rawExecutor = fourth;
    } else {
      const request = snapshotRecord(first, 'append');
      onlyKeys(request, 'append', ['actor', 'expectedVersion', 'item', 'executor']);
      actor = text(request.actor, 'append.actor');
      expectedVersion = safeInteger(request.expectedVersion, 'append.expectedVersion', 'stale-version');
      rawItem = request.item;
      rawExecutor = request.executor;
    }
    const item = snapshotItem(rawItem);
    const executor = assertExecutor(item, rawExecutor);
    assertExecutorScope(authority, executor);
    assertExpectedVersion(chain, expectedVersion);
    assertKnownPlayer(chain, actor, 'append.actor');
    if (chain.phase !== 'open' && chain.phase !== 'execute') blocked('invalid-phase', 'append requires Open or Execute');
    if (actor !== chain.priorityPlayerId) blocked('wrong-priority', `append requires priority ${chain.priorityPlayerId}`);
    if (chain.items.some(value => value.status === 'pending')) blocked('pending-item', 'pending item must be finalized first');
    if (chain.issuedItemIds.includes(item.id)) blocked('duplicate-item-id', `item ${item.id} was already issued`);
    if (item.controllerPlayerId !== actor) blocked('wrong-actor', 'item controller must be the appending actor');
    const version = nextSafe(chain.stateVersion, 'stateVersion');
    const appended = immutable({
      id: item.id, kind: item.kind, controllerPlayerId: item.controllerPlayerId,
      executorId: executor.id, resolutionMode: item.resolutionMode,
      status: 'pending' as const, appendedAtVersion: version, finalizedAtVersion: null,
    });
    const executors = new Map(authority.executors);
    executors.set(item.id, executor);
    const next = transition(authority, chain, 'finalize', chain.priorityPlayerId, 0,
      [...chain.items, appended], [...chain.issuedItemIds, item.id], executors);
    authority.executorNamespace.set(executor.id, executor);
    return next;
  });
}

export function finalizeDuelChainItemV2(chain: DuelChainV2, request: DuelChainFinalizeRequestV2): DuelChainV2;
export function finalizeDuelChainItemV2(chain: DuelChainV2, actor: string, expectedVersion: number): DuelChainV2;
export function finalizeDuelChainItemV2(chain: DuelChainV2, first: DuelChainFinalizeRequestV2 | string, second?: number): DuelChainV2 {
  return guarded(chain, authority => {
    const request = actorVersion(first, second, 'finalize');
    assertExpectedVersion(chain, request.expectedVersion);
    assertKnownPlayer(chain, request.actor, 'finalize.actor');
    const pendingIndex = chain.items.findIndex(item => item.status === 'pending');
    if (pendingIndex < 0) blocked('no-pending-item', 'no pending item remains');
    if (chain.phase !== 'finalize') blocked('invalid-phase', 'Finalize requires a pending item');
    const pending = chain.items[pendingIndex];
    if (pending === undefined) blocked('no-pending-item', 'pending item disappeared');
    if (pending.controllerPlayerId !== request.actor) blocked('wrong-actor', `oldest pending item belongs to ${pending.controllerPlayerId}`);
    const version = nextSafe(chain.stateVersion, 'stateVersion');
    const items = chain.items.map((item, index) => index === pendingIndex
      ? immutable({ ...item, status: 'finalized' as const, finalizedAtVersion: version }) : item);
    const nextPending = items.find(item => item.status === 'pending');
    const finalizedIndex = newestFinalizedItemIndex(items);
    const finalized = finalizedIndex < 0 ? undefined : items[finalizedIndex];
    // CR 337.2 takes precedence over returning to Finalize: the item just
    // finalized resolves before any newer pending item is processed.
    const justFinalized = items[pendingIndex];
    const immediate = justFinalized?.resolutionMode === 'immediate';
    const phase: DuelChainPhaseV2 = immediate ? 'resolve' : nextPending ? 'finalize' : finalized?.resolutionMode === 'immediate' ? 'resolve' : 'execute';
    const priority = immediate ? justFinalized!.controllerPlayerId
      : nextPending?.controllerPlayerId ?? finalized?.controllerPlayerId ?? chain.priorityPlayerId;
    return transition(authority, chain, phase, priority, 0, items, chain.issuedItemIds, authority.executors);
  });
}

export function passDuelChainPriorityV2(chain: DuelChainV2, request: DuelChainPassRequestV2): DuelChainV2;
export function passDuelChainPriorityV2(chain: DuelChainV2, actor: string, expectedVersion: number): DuelChainV2;
export function passDuelChainPriorityV2(chain: DuelChainV2, first: DuelChainPassRequestV2 | string, second?: number): DuelChainV2 {
  return guarded(chain, authority => {
    const request = actorVersion(first, second, 'pass');
    assertExpectedVersion(chain, request.expectedVersion);
    assertKnownPlayer(chain, request.actor, 'pass.actor');
    if (chain.phase !== 'execute') blocked('invalid-phase', 'Pass is legal only during FEPR Execute');
    if (chain.items.some(item => item.status !== 'finalized')) blocked('pending-item', 'finalize all pending items first');
    if (request.actor !== chain.priorityPlayerId) blocked('wrong-priority', `pass requires priority ${chain.priorityPlayerId}`);
    const passes = nextSafe(chain.consecutivePasses, 'consecutivePasses');
    if (passes > chain.turnOrder.length) blocked('passes-incomplete', 'priority passed too many times');
    const complete = passes === chain.turnOrder.length;
    return transition(authority, chain, complete ? 'resolve' : 'execute', nextPlayer(chain, request.actor),
      passes, chain.items, chain.issuedItemIds, authority.executors);
  });
}

/**
 * Consume the FEPR/Immediate continuation BEFORE any external effect. The
 * returned state is locked in await-commit; transaction retries use the SAME
 * ticket.idempotencyKey, never re-request a resolution or re-execute in here.
 */
export function requestDuelChainResolutionV2(chain: DuelChainV2, request: DuelChainRequestResolutionV2): { readonly chain: DuelChainV2; readonly ticket: DuelChainResolutionTicketV2 } {
  return guarded(chain, authority => {
    const value = snapshotRecord(request, 'resolution request');
    onlyKeys(value, 'resolution request', ['expectedVersion', 'actor', 'executor']);
    assertExpectedVersion(chain, value.expectedVersion);
    if (value.actor !== undefined) {
      const actor = text(value.actor, 'resolution request.actor');
      assertKnownPlayer(chain, actor, 'resolution request.actor');
      if (actor !== chain.priorityPlayerId) blocked('wrong-priority', `resolution requires priority ${chain.priorityPlayerId}`);
    }
    if (chain.phase !== 'resolve') blocked(chain.phase === 'execute' ? 'passes-incomplete' : 'invalid-phase', 'newest finalized item is not ready for resolution');
    const resolvingIndex = newestFinalizedItemIndex(chain.items);
    const resolving = resolvingIndex < 0 ? undefined : chain.items[resolvingIndex];
    if (!resolving || resolving.status !== 'finalized') blocked('item-not-finalized', 'newest finalized Chain Item must be finalized');
    const executor = authority.executors.get(resolving.id);
    if (!executor || executor.id !== resolving.executorId) blocked('unknown-executor', 'resolving item has no bound executor');
    if (value.executor !== undefined && executorEntry(value.executor) !== executor) {
      blocked('executor-mismatch', 'resolution handle differs from append-time handle identity');
    }
    // A parent tape records identities for isolated replay. Its uniqueness is
    // local to this native Chain; tickets/proofs remain exact private handles.
    // The legacy mode retains WebCrypto and process-global duplicate rejection.
    const key = authority.identityFactory
      ? `duel-chain-v2:${JSON.stringify([chain.chainId, text(authority.identityFactory(), 'ticket identity')])}`
      : `duel-chain-v2:${secureRandomUUID()}`;
    if (authority.issuedTicketKeys.has(key) || !authority.identityFactory && issuedTicketKeys.has(key))
      blocked('invalid-request', 'duplicate idempotency key; ticket was not issued');
    const locked = transition(authority, chain, 'await-commit', chain.priorityPlayerId, chain.consecutivePasses,
      chain.items, chain.issuedItemIds, authority.executors);
    const ticket = immutable({
      idempotencyKey: key, chainId: chain.chainId, itemId: resolving.id, item: resolving,
      executorId: executor.id, executor: executor.handle,
      requestedAtVersion: chain.stateVersion, lockedAtVersion: locked.stateVersion,
    }) as DuelChainResolutionTicketV2;
    authority.ticket = ticket;
    authority.proof = null;
    authority.issuedTicketKeys.add(key);
    if (!authority.identityFactory) issuedTicketKeys.add(key);
    ticketAuthorities.set(ticket, { chain: authority, locked, item: resolving, executor });
    return immutable({ chain: locked, ticket });
  });
}

function ticketFor(authority: ChainAuthorityV2, ticket: unknown): TicketEntryV2 {
  if (!isObject(ticket)) blocked('untrusted-ticket', 'resolution ticket is missing');
  const entry = ticketAuthorities.get(ticket);
  if (!entry) blocked('untrusted-ticket', 'ticket is not a process-local request');
  if (entry.chain !== authority) blocked('untrusted-ticket', 'ticket belongs to a different chain');
  if (authority.ticket !== ticket || authority.current !== entry.locked) {
    blocked('stale-ticket', 'ticket was already committed or replaced');
  }
  return entry;
}

function snapshotProduced(raw: unknown, chain: DuelChainV2): readonly DuelChainProducedItemV2[] {
  if (raw === undefined) return immutableList([]);
  const values = snapshotList(raw, 'committed receipt.produced');
  const seen = new Set(chain.issuedItemIds);
  const produced: DuelChainProducedItemV2[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = snapshotRecord(values[index], `committed receipt.produced[${index}]`);
    onlyKeys(value, `committed receipt.produced[${index}]`, ['item', 'executor']);
    const item = snapshotItem(value.item);
    const executor = assertExecutor(item, value.executor);
    assertExecutorScope(chainAuthorities.get(chain)!, executor);
    if (!chain.turnOrder.includes(item.controllerPlayerId)) blocked('wrong-actor', 'produced item controller is not in turn order');
    if (seen.has(item.id)) blocked('duplicate-item-id', `produced item ${item.id} was already issued`);
    seen.add(item.id);
    produced.push(immutable({ item, executor: executor.handle }));
  }
  return immutableList(produced);
}

/**
 * Read ONLY the committed record for this exact ticket. The trusted lookup
 * MUST NOT execute an effect; unknown/failed/blocked transactions return null.
 * Query failure cannot consume the ticket. Once observed, one immutable proof
 * is cached; retries return the same proof without a second lookup.
 */
export function queryDuelChainCommittedProofV2(
  authorityHandle: DuelChainResolutionAuthorityV2,
  ticket: DuelChainResolutionTicketV2,
): DuelChainCommittedProofV2 | null {
  if (!isObject(authorityHandle) || !resolutionAuthorities.has(authorityHandle)) {
    blocked('untrusted-authority', 'committed-receipt authority is not a live handle');
  }
  if (!isObject(ticket)) blocked('untrusted-ticket', 'resolution ticket is missing');
  const entry = ticketAuthorities.get(ticket);
  if (!entry) blocked('untrusted-ticket', 'ticket is not a process-local request');
  const chain = entry.chain;
  if (chain.resolutionAuthority !== authorityHandle) blocked('untrusted-authority', 'authority is not bound to this chain');
  // Query uses the same guard as transitions; even Proxy traps in a receipt
  // cannot advance this Chain while receipt fields are normalized.
  return guarded(entry.locked, authority => {
    ticketFor(authority, ticket);
    if (authority.proof !== null) return authority.proof;
    const readCommitted = resolutionAuthorities.get(authorityHandle)?.readCommitted;
    if (!readCommitted) blocked('untrusted-authority', 'read-only lookup is unavailable');
    let raw: unknown;
    try { raw = readCommitted(ticket); }
    catch { blocked('resolution-query-failed', 'committed-receipt lookup failed; retry the same ticket'); }
    if (raw === null) return null;
    const receipt = snapshotRecord(raw, 'committed receipt');
    onlyKeys(receipt, 'committed receipt', ['status', 'idempotencyKey', 'chainId', 'itemId', 'executorId', 'produced']);
    if (receipt.status !== 'committed') blocked('invalid-request', 'lookup must return a committed receipt or null');
    if (receipt.idempotencyKey !== ticket.idempotencyKey || receipt.chainId !== ticket.chainId ||
        receipt.itemId !== ticket.itemId || receipt.executorId !== ticket.executorId) {
      blocked('proof-mismatch', 'canonical transaction receipt does not bind this exact ticket and executor');
    }
    const produced = snapshotProduced(receipt.produced, entry.locked);
    const proof = immutable({ idempotencyKey: ticket.idempotencyKey, itemId: entry.item.id, produced }) as DuelChainCommittedProofV2;
    proofAuthorities.set(proof, ticket);
    authority.proof = proof;
    return proof;
  });
}

/** Private journal handoff: read identities only from an actually issued proof.
 * This retains the committed-lookup trust boundary; DATA clones carry no authority. */
export function inspectDuelChainCommittedProofV2(proof: DuelChainCommittedProofV2): Readonly<{
  idempotencyKey: string; chainId: string; itemId: string; executorId: string;
  resolutionAuthority: DuelChainResolutionAuthorityV2;
  produced: readonly DuelChainProducedItemV2[];
}> {
  const ticket = isObject(proof) ? proofAuthorities.get(proof) : undefined;
  if (!ticket) blocked('untrusted-proof', 'committed proof is not a process-local capability');
  const entry = ticketAuthorities.get(ticket);
  if (!entry) blocked('untrusted-ticket', 'committed proof has no issued ticket');
  return immutable({ idempotencyKey: ticket.idempotencyKey, chainId: ticket.chainId,
    itemId: ticket.itemId, executorId: ticket.executorId,
    resolutionAuthority: entry.chain.resolutionAuthority, produced: proof.produced });
}

/** Commit cannot call an effect, query a receipt, or accept an unbranded proof. */
export function commitDuelChainResolutionV2(chain: DuelChainV2, request: DuelChainCommitRequestV2): DuelChainV2 {
  return guarded(chain, authority => {
    const value = snapshotRecord(request, 'commit');
    onlyKeys(value, 'commit', ['expectedVersion', 'ticket', 'proof']);
    assertExpectedVersion(chain, value.expectedVersion);
    if (chain.phase !== 'await-commit') blocked('invalid-phase', 'no resolution is awaiting commit');
    const entry = ticketFor(authority, value.ticket);
    const proof = value.proof;
    if (!isObject(proof) || !proofAuthorities.has(proof)) blocked('untrusted-proof', 'committed proof is not a process-local capability');
    if (proofAuthorities.get(proof) !== value.ticket || authority.proof !== proof) {
      blocked('proof-mismatch', 'proof is not bound to the active ticket');
    }
    const resolvingIndex = chain.items.findIndex(item => item.id === entry.item.id);
    const resolving = resolvingIndex < 0 ? undefined : chain.items[resolvingIndex];
    if (!resolving || resolving.id !== entry.item.id || resolving.status !== 'finalized' ||
        entry.locked !== chain || entry.executor !== authority.executors.get(resolving.id)) {
      blocked('proof-mismatch', 'ticket no longer locks the selected resolving item and executor');
    }
    // Proof/produced DTOs are deeply frozen process-owned snapshots. Recheck
    // issued IDs and order atomically before updating the single continuation.
    const seen = new Set(chain.issuedItemIds);
    const version = nextSafe(chain.stateVersion, 'stateVersion');
    const executors = new Map(authority.executors);
    executors.delete(resolving.id);
    const produced: DuelChainItemV2[] = [];
    for (const value of (proof as DuelChainCommittedProofV2).produced) {
      const draft = value.item;
      const executor = executorEntry(value.executor);
      assertExecutorScope(authority, executor);
      if (draft.executorId !== undefined && draft.executorId !== executor.id) blocked('executor-mismatch', 'produced item executor changed');
      if (!chain.turnOrder.includes(draft.controllerPlayerId)) blocked('wrong-actor', 'produced controller is not in turn order');
      if (seen.has(draft.id)) blocked('duplicate-item-id', `produced item ${draft.id} was already issued`);
      seen.add(draft.id);
      executors.set(draft.id, executor);
      produced.push(immutable({
        id: draft.id, kind: draft.kind, controllerPlayerId: draft.controllerPlayerId,
        executorId: executor.id, resolutionMode: draft.resolutionMode,
        status: 'pending' as const, appendedAtVersion: version, finalizedAtVersion: null,
      }));
    }
    const items = [
      ...chain.items.slice(0, resolvingIndex),
      ...chain.items.slice(resolvingIndex + 1),
      ...produced,
    ];
    let phase: DuelChainPhaseV2;
    let priority: string | null;
    const oldestPending = items.find(item => item.status === 'pending');
    const newTop = items[items.length - 1];
    if (oldestPending) {
      phase = 'finalize';
      priority = oldestPending.controllerPlayerId;
    } else if (newTop) {
      phase = newTop.resolutionMode === 'immediate' ? 'resolve' : 'execute';
      priority = newTop.controllerPlayerId;
    } else if (chain.closeContext.kind === 'showdown-handoff') {
      phase = 'handoff';
      priority = null;
    } else {
      phase = 'open';
      priority = chain.closeContext.kind === 'main-phase'
        ? chain.closeContext.returnPriorityPlayerId : chain.closeContext.returnFocusPlayerId;
    }
    const result = transition(authority, chain, phase, priority, 0, items,
      [...chain.issuedItemIds, ...produced.map(item => item.id)], executors);
    for (const executor of executors.values()) authority.executorNamespace.set(executor.id, executor);
    authority.ticket = null;
    authority.proof = null;
    return result;
  });
}

/** Private fingerprint data only. There is intentionally no restore/adopt API:
 * DATA copies cannot allocate executors or redeem tickets/proofs. */
export function inspectDuelChainPrivateStateV2(chain: DuelChainV2): Readonly<{
  identityMode: 'parent-recorded' | 'process-default';
  allocatedExecutors: readonly { readonly executorId: string; readonly scope: 'chain' | 'process' }[];
  issuedTicketKeys: readonly string[];
  boundItems: readonly { readonly itemId: string; readonly executorId: string }[];
  ticket: null | { readonly idempotencyKey: string; readonly itemId: string; readonly executorId: string;
    readonly lockedAtVersion: number };
  proof: null | { readonly idempotencyKey: string; readonly itemId: string;
    readonly produced: readonly { readonly item: DuelChainItemDraftV2; readonly executorId: string }[] };
}> {
  const authority = authorityFor(chain), ticket = authority.ticket, proof = authority.proof;
  return immutable({ identityMode: authority.identityFactory ? 'parent-recorded' : 'process-default',
    allocatedExecutors: immutableList([...authority.executorNamespace.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(entry => immutable({ executorId: entry.id, scope: entry.owner ? 'chain' as const : 'process' as const }))),
    issuedTicketKeys: immutableList([...authority.issuedTicketKeys].sort()),
    boundItems: immutableList([...authority.executors].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([itemId, entry]) => immutable({ itemId, executorId: entry.id }))),
    ticket: ticket ? immutable({ idempotencyKey: ticket.idempotencyKey, itemId: ticket.itemId,
      executorId: ticket.executorId, lockedAtVersion: ticket.lockedAtVersion }) : null,
    proof: proof ? immutable({ idempotencyKey: proof.idempotencyKey, itemId: proof.itemId,
      produced: immutableList(proof.produced.map(value => immutable({ item: value.item,
        executorId: executorEntry(value.executor).id }))) }) : null,
  });
}

// Explicit spellings to distinguish request issuance from proof-checked commit.
export const resolveDuelChainItemV2 = requestDuelChainResolutionV2;
export const resolveDuelChainV2 = requestDuelChainResolutionV2;
export const passDuelChainV2 = passDuelChainPriorityV2;
export const finalizeDuelChainV2 = finalizeDuelChainItemV2;
export const appendDuelChainV2 = appendDuelChainItemV2;
