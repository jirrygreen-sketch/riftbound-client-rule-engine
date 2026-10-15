// PRIVATE V2 proof kernel. A journal is produced from genuine admitted commits, NEVER
// manufactured from an archive candidate. Neither an in-memory capability nor a JSON head
// authenticates bytes on disk: the archive owner must protect genesis/events/head separately
// from candidate writes and atomically advance a single, linearizable durable head (CAS).
import { assertAdmittedDuelMatchV2, type DuelCanonicalPlayingStateV2 } from './core-v2.js';
import type { DuelMatchStateV2 } from './core-v2.js';
import type { DuelPaymentSourceReference } from './canonical-session.js';
import type { DuelRuneCost, DuelPaymentPlan } from './resources.js';
// Loaded only by this private Node journal; retain the isolated engine typecheck without
// introducing global Node typings into the browser-facing engine package.
// @ts-expect-error Engine TS config intentionally omits @types/node.
import { types as nodeTypes } from 'node:util';
// @ts-expect-error Engine TS config intentionally omits @types/node.
import { createHash } from 'node:crypto';
const isProxy: (value: unknown) => boolean = nodeTypes.isProxy;
import {
  DUEL_DOMAINS, activateBasicRuneEnergy, activateBasicRunePower, activateDuelGoldPower,
  channelDuelRunes, clearAllDuelRunePools, createDuelGoldToken, restoreDuelResources,
  type DuelPowerSource, type DuelResources,
} from './resources.js';

const POWER = [...DUEL_DOMAINS, 'any'] as const;
type Playing = DuelCanonicalPlayingStateV2;

/** Detached audit data. A live append NEVER accepts one of these claims as its authority. */
export type DuelResourceEventSourceV2 =
  | { readonly kind: 'command'; readonly commandId: string; readonly actor: string }
  | { readonly kind: 'turn'; readonly stepId: string; readonly actor: string;
      readonly boundary: 'channel' | 'awaken' | 'main-reset' }
  | { readonly kind: 'effect'; readonly eventId: string; readonly sourceEffectId: string;
      readonly sourceProofId: string; readonly sourceRevision: number; readonly sourceUID: string;
      readonly sourceZoneEpoch: number; readonly actor: string }
  | { readonly kind: 'payment'; readonly paymentId: string; readonly sourceProofId: string;
      readonly sourceRevision: number; readonly sourceUID: string; readonly sourceZoneEpoch: number;
      readonly actor: string; readonly costDigest: string }
  | { readonly kind: 'non-resource'; readonly mutationId: string };

export type DuelResourceActionV2 =
  | { readonly kind: 'channel'; readonly playerId: string;
      /** Exact top-of-deck order and entry readiness; empty channel is not an event. */
      readonly runes: readonly { readonly uid: string; readonly readied: boolean }[] }
  | { readonly kind: 'rune-energy' | 'rune-power' | 'gold-power'; readonly playerId: string; readonly uid: string }
  | { readonly kind: 'gold-create'; readonly playerId: string; readonly uid: string;
      readonly locationId: string; readonly readied: boolean }
  | { readonly kind: 'readiness'; readonly playerId: string; readonly tokenKind: 'rune' | 'gold';
      readonly uid: string; readonly from: boolean; readonly to: boolean }
  | { readonly kind: 'pool-delta'; readonly playerId: string; readonly pool: 'energy' | DuelPowerSource;
      readonly delta: number; readonly consumptionId: string | null }
  | { readonly kind: 'pay'; readonly playerId: string; readonly paymentId: string;
      readonly energy: number; readonly power: readonly { readonly from: DuelPowerSource; readonly amount: number }[] }
  | { readonly kind: 'reset-pools' };

export interface DuelResourceReadinessEventV2 {
  readonly eventId: string;
  /** Exactly one event, including a no-resource-change event, per successful outer V2 commit. */
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly source: DuelResourceEventSourceV2;
  /** Revision of the independent source ledger consumed by this outer commit. */
  readonly sourceRevision: number;
  /** Ordered within the outer commit; replayer checks every intermediate pool/readiness state. */
  readonly actions: readonly DuelResourceActionV2[];
}
/** A trusted outer transaction journal owns this handle; only that journal resolves commit IDs.
 * A brand alone does NOT authorize the journal's issuer: do not issue one from archive/client data. */
export interface DuelResourceOuterCommitAuthorityV2 {
  readonly _duelResourceOuterCommitAuthorityV2: unique symbol;
}
export interface DuelResourceOuterCommitV2 {
  readonly commitId: string;
  readonly before: Playing;
  readonly after: Playing;
  readonly event: DuelResourceReadinessEventV2;
  /** Stable branch capability from factory/admission, not a metadata string. */
  readonly origin: object;
  /** Canonical parent commit ID, null only at playing genesis. */
  readonly parentCommitId: string | null;
  /** Native parent branch capability; core commit must return this exact admitted parent. */
  readonly parent: Playing;
  /** The independent source/payment/turn ledger revision consumed by this commit. */
  readonly sourceRevision: number;
  readonly sourceProof: DuelResourceSourceProofV2;
}
/** These records must be returned by an independent source/payment/turn ledger, never
 * fabricated from the resource action or the outer commit's claimed source. */
export type DuelResourceSourceProofV2 =
  | { readonly kind: 'command'; readonly revision: number; readonly commandId: string;
      readonly actor: string; readonly before: Playing; readonly after: Playing }
  | { readonly kind: 'turn'; readonly revision: number; readonly stepId: string;
      readonly actor: string; readonly boundary: 'channel' | 'awaken' | 'main-reset';
      readonly before: Playing; readonly after: Playing }
  | { readonly kind: 'effect'; readonly revision: number; readonly eventId: string;
      readonly sourceEffectId: string; readonly sourceProofId: string; readonly sourceUID: string;
      readonly sourceZoneEpoch: number; readonly actor: string; readonly before: Playing;
      readonly after: Playing; readonly consumptionIds: readonly string[] }
  | { readonly kind: 'payment'; readonly revision: number; readonly paymentId: string;
      readonly sourceProofId: string; readonly sourceUID: string; readonly sourceZoneEpoch: number;
      readonly actor: string; readonly sourceReference: DuelPaymentSourceReference;
      readonly resolvedCost: DuelRuneCost; readonly plan: DuelPaymentPlan;
      readonly before: Playing; readonly after: Playing }
  | { readonly kind: 'non-resource'; readonly revision: number; readonly mutationId: string;
      readonly before: Playing; readonly after: Playing };
/** The provider is injected by the trusted room/journal owner, not a request/DTO. It must
 * query immutable, separately protected records by ID, enforce a single canonical origin,
 * and independently verify source proofs before issuing one branded authority. */
export interface DuelResourceOuterCommitProviderV2 {
  readonly origin: object;
  readonly genesis: Playing;
  readonly setup: DuelMatchStateV2;
  readonly genesisCommitId: string;
  readonly lookup: (commitId: string) => DuelResourceOuterCommitV2 | null;
}
export interface DuelResourceReadinessGenesisV2 {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly playerIds: readonly [string, string];
  readonly stateVersion: number;
  readonly eventSeq: number;
  /** Genuine factory playing genesis: complete private ordered Rune Decks, pools and tokens. */
  readonly resources: DuelResources;
}
export interface DuelResourceReadinessJournalV2 {
  readonly genesis: DuelResourceReadinessGenesisV2;
  readonly events: readonly DuelResourceReadinessEventV2[];
}
/** A separate, protected archive manifest must pin this head; it is NOT a MAC/checksum. */
export interface DuelResourceReadinessHeadV2 {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly playerIds: readonly [string, string];
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly eventCount: number;
  readonly lastEventId: string | null;
}
/** Non-serializable one-writer capability. Clones and object lookalikes have no authority. */
export interface DuelResourceReadinessWriterV2 {
  readonly _duelResourceReadinessWriterV2: unique symbol;
}
interface WriterState {
  current: Playing;
  readonly authority: DuelResourceOuterCommitAuthorityV2;
  readonly origin: object;
  parentCommitId: string;
  journal: DuelResourceReadinessJournalV2;
  head: DuelResourceReadinessHeadV2;
  sealed: boolean;
  busy: boolean;
  reentryAttempted: boolean;
}
interface OuterAuthorityState {
  readonly provider: DuelResourceOuterCommitProviderV2;
  readonly source: DuelResourceSourceAuthorityV2;
  readonly sourceProvider: DuelResourceSourceProviderV2;
  readonly origin: object;
  readonly genesis: Playing;
  readonly genesisCommitId: string;
  lastLookup: DuelResourceOuterCommitV2 | null;
}
/** Separate trusted source journal provider, never queried by resource actions themselves. */
export interface DuelResourceSourceAuthorityV2 { readonly _duelResourceSourceAuthorityV2: unique symbol }
export interface DuelResourceSourceProviderV2 {
  readonly origin: object;
  readonly lookup: (revision: number) => DuelResourceSourceProofV2 | null;
}
const writers = new WeakMap<object, WriterState>();
const outerAuthorities = new WeakMap<object, OuterAuthorityState>();
const sourceAuthorities = new WeakMap<object, DuelResourceSourceProviderV2>();
const issuedGenesis = new WeakSet<object>();
const issuedOrigins = new WeakSet<object>();
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new TypeError(`Duel resource journal V2: ${message}`);
}
function plainObject(value: unknown, label: string): asserts value is object {
  check(value !== null && typeof value === 'object', `${label} object required`);
  // Proxy rejection must precede ANY trap-triggering reflection. The runtime utility's
  // isProxy detects even revoked proxies without touching the target/traps. Its type-only
  // declaration stays local to avoid changing the shared build/config contracts.
  check(!isProxy(value), `${label} proxy rejected`);
}
function descriptor(value: object, key: string, label: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key);
  check(d !== undefined && 'value' in d && (key === 'length' || d.enumerable), `${label} data descriptor`);
  return d.value;
}
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  plainObject(value, label);
  check(!Array.isArray(value), `${label} plain record`);
  check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    `${label} plain prototype`);
  const actual = Reflect.ownKeys(value);
  check(actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key) &&
    'value' in Object.getOwnPropertyDescriptor(value, key)!), `${label} exact keys/accessors`);
  const detached: Record<string, unknown> = Object.create(null);
  for (const key of keys) detached[key] = descriptor(value, key, label);
  return detached;
}
function list(value: unknown, label: string): readonly unknown[] {
  plainObject(value, label);
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, `${label} plain array`);
  const length = descriptor(value, 'length', label) as number;
  check(Reflect.ownKeys(value).length === length + 1 &&
    Array.from({ length }, (_, i) => Object.getOwnPropertyDescriptor(value, String(i)))
      .every(d => d !== undefined && 'value' in d), `${label} dense array`);
  return Array.from({ length }, (_, i) => descriptor(value, String(i), label));
}
function id(value: unknown, label: string): string {
  check(typeof value === 'string' && value.trim().length > 0, `${label} nonblank ID`);
  return value;
}
function count(value: unknown, label: string): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, `${label} safe count`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  check(typeof value === 'boolean', `${label} boolean`);
  return value;
}
function sourcePool(value: unknown): 'energy' | DuelPowerSource {
  check(value === 'energy' || POWER.some(d => d === value), 'unknown pool/domain');
  return value as 'energy' | DuelPowerSource;
}
function power(value: unknown): DuelPowerSource {
  check(POWER.some(d => d === value), 'unknown Power domain');
  return value as DuelPowerSource;
}
function identities(raw: unknown): [string, string] {
  const ids = list(raw, 'player IDs');
  check(ids.length === 2, 'two player IDs required');
  const first = id(ids[0], 'first player'), second = id(ids[1], 'second player');
  check(first !== second, 'duplicate player IDs');
  return [first, second];
}
function freeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d && 'value' in d) freeze(d.value, seen);
  }
  Object.freeze(value);
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((value, i) => same(value, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key =>
    Object.hasOwn(right, key) && same(left[key], right[key]));
}
function locations(r: DuelResources): [{ playerId: string; locationId: string }, { playerId: string; locationId: string }] {
  return r.bases.map(b => ({ playerId: b.playerId, locationId: b.locationId })) as
    [{ playerId: string; locationId: string }, { playerId: string; locationId: string }];
}
function resourceCopy(raw: unknown): DuelResources {
  const carrier = record(raw, ['playerIds', 'players', 'bases', 'retiredGoldUids'], 'resource carrier');
  const ids = identities(carrier.playerIds), bases = list(carrier.bases, 'resource bases');
  check(bases.length === 2, 'two resource bases required');
  const expected = bases.map((item, i) => {
    const r = record(item, ['playerId', 'locationId', 'baseRunes', 'goldTokens'], 'resource base');
    check(r.playerId === ids[i], 'resource base player mismatch');
    return { playerId: id(r.playerId, 'base player'), locationId: id(r.locationId, 'base location') };
  });
  // All nested records/arrays are checked for proxy/accessors before restore's property reads.
  const clean = strictDataCopy(raw, 'resource carrier');
  return restoreDuelResources(clean, expected);
}
function sameResources(a: DuelResources, b: unknown): boolean {
  return same(a, restoreDuelResources(strictDataCopy(b, 'candidate resources'), locations(a)));
}
function strictDataCopy(value: unknown, label: string, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      typeof value === 'number') return value;
  plainObject(value, label);
  check(!seen.has(value), `${label} cyclic/shared graph`); seen.add(value);
  if (Array.isArray(value)) {
    return list(value, label).map(item => strictDataCopy(item, label, seen));
  }
  const proto = Object.getPrototypeOf(value);
  check(proto === Object.prototype || proto === null, `${label} plain prototype`);
  const keys = Reflect.ownKeys(value);
  check(keys.every(key => typeof key === 'string'), `${label} string keys only`);
  const out: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) out[key] = strictDataCopy(descriptor(value, key, label), label, seen);
  return out;
}
function checkedCost(raw: unknown): DuelRuneCost {
  const r = record(raw, ['energy', 'power'], 'resolved cost');
  const energy = count(r.energy, 'cost energy');
  let total = energy;
  const requirements = list(r.power, 'cost requirements').map(item => {
    const requirement = record(item, ['allowedDomains', 'amount'], 'cost requirement');
    const domains = list(requirement.allowedDomains, 'allowed domains').map(value => {
      check(DUEL_DOMAINS.some(domain => domain === value), 'invalid cost domain');
      return value as (typeof DUEL_DOMAINS)[number];
    });
    check(domains.length > 0 && domains.length <= DUEL_DOMAINS.length &&
      new Set(domains).size === domains.length, 'invalid allowed domains');
    const amount = count(requirement.amount, 'cost amount');
    check(amount > 0 && Number.isSafeInteger(total + amount), 'invalid total cost');
    total += amount;
    return { allowedDomains: domains, amount };
  });
  return { energy, power: requirements };
}
function checkedPlan(raw: unknown, cost: DuelRuneCost): DuelPaymentPlan {
  const r = record(raw, ['power'], 'payment plan');
  const paid = cost.power.map(() => 0);
  const seen = new Set<string>();
  const allocations = list(r.power, 'payment allocations').map(item => {
    const allocation = record(item, ['requirementIndex', 'from', 'amount'], 'payment allocation');
    const requirementIndex = count(allocation.requirementIndex, 'requirement index');
    const from = power(allocation.from), amount = count(allocation.amount, 'allocation amount');
    check(amount > 0 && requirementIndex < cost.power.length &&
      (from === 'any' || cost.power[requirementIndex]!.allowedDomains.includes(from)),
    'payment allocation differs from cost');
    const key = `${requirementIndex}:${from}`;
    check(!seen.has(key) && Number.isSafeInteger(paid[requirementIndex]! + amount),
      'duplicate/overflowing allocation');
    seen.add(key); paid[requirementIndex]! += amount;
    return { requirementIndex, from, amount };
  });
  check(paid.every((amount, i) => amount === cost.power[i]!.amount), 'payment plan does not cover cost');
  return { power: allocations };
}
function paymentParts(rawCost: unknown, rawPlan: unknown): { cost: DuelRuneCost; plan: DuelPaymentPlan } {
  const cost = checkedCost(rawCost);
  return { cost, plan: checkedPlan(rawPlan, cost) };
}
/** Stable source-ledger binding, computed only from checked data descriptors. */
export function digestDuelResourcePaymentV2(rawCost: DuelRuneCost, rawPlan: DuelPaymentPlan): string {
  const { cost, plan } = paymentParts(rawCost, rawPlan);
  const parts = [String(cost.energy), String(cost.power.length)];
  for (const requirement of cost.power) parts.push(String(requirement.allowedDomains.length),
    ...requirement.allowedDomains, String(requirement.amount));
  parts.push(String(plan.power.length));
  for (const allocation of plan.power) parts.push(String(allocation.requirementIndex),
    allocation.from, String(allocation.amount));
  const encoded = parts.map(part => `${part.length}:${part}`).join('');
  return `sha256:${createHash('sha256').update(encoded).digest('hex')}`;
}
function paidAction(paymentId: string, actor: string, rawCost: DuelRuneCost,
  rawPlan: DuelPaymentPlan): DuelResourceActionV2 {
  const { cost, plan } = paymentParts(rawCost, rawPlan);
  const spent = new Map<DuelPowerSource, number>();
  for (const allocation of plan.power) {
    const next = (spent.get(allocation.from) ?? 0) + allocation.amount;
    check(Number.isSafeInteger(next), 'payment allocation overflow');
    spent.set(allocation.from, next);
  }
  return { kind: 'pay', playerId: actor, paymentId, energy: cost.energy,
    power: [...spent].map(([from, amount]) => ({ from, amount })) };
}
function checkIdentifiers(events: readonly DuelResourceReadinessEventV2[],
  entry: DuelResourceReadinessEventV2): void {
  const eventIds = new Set<string>(), commandIds = new Set<string>(), turnIds = new Set<string>();
  const effectIds = new Set<string>(), proofIds = new Set<string>(), paymentIds = new Set<string>();
  const consumptionIds = new Set<string>(), revisions = new Set<number>();
  for (const e of [...events, entry]) {
    check(!eventIds.has(e.eventId) && !revisions.has(e.sourceRevision),
      'duplicate event ID or source revision');
    eventIds.add(e.eventId); revisions.add(e.sourceRevision);
    const s = e.source;
    if (s.kind === 'command') {
      check(!commandIds.has(s.commandId), 'duplicate command source'); commandIds.add(s.commandId);
    } else if (s.kind === 'turn') {
      check(!turnIds.has(s.stepId), 'duplicate turn step'); turnIds.add(s.stepId);
    } else if (s.kind === 'effect') {
      check(!effectIds.has(s.eventId) && !proofIds.has(s.sourceProofId),
        'duplicate effect event/proof');
      effectIds.add(s.eventId); proofIds.add(s.sourceProofId);
    } else if (s.kind === 'payment') {
      check(!paymentIds.has(s.paymentId) && !proofIds.has(s.sourceProofId),
        'duplicate payment/proof');
      paymentIds.add(s.paymentId); proofIds.add(s.sourceProofId);
    }
    for (const action of e.actions) if (action.kind === 'pool-delta') {
      check(action.consumptionId !== null && !consumptionIds.has(action.consumptionId),
        'duplicate consumption ID');
      consumptionIds.add(action.consumptionId);
    }
  }
}
/** Mint handles ONLY at the trusted outer/source journal wiring seam. This is an injected
 * provider, not cryptographic authentication of an arbitrary caller-supplied callback. */
export function createDuelResourceSourceAuthorityV2(provider: DuelResourceSourceProviderV2):
  DuelResourceSourceAuthorityV2 {
  check(provider !== null && typeof provider === 'object' && provider.origin !== null &&
    typeof provider.origin === 'object' && typeof provider.lookup === 'function',
  'trusted source journal provider required');
  const handle = Object.freeze({}) as DuelResourceSourceAuthorityV2;
  sourceAuthorities.set(handle, provider);
  return handle;
}
export function createDuelResourceOuterCommitAuthorityV2(provider: DuelResourceOuterCommitProviderV2,
  sourceAuthority: DuelResourceSourceAuthorityV2): DuelResourceOuterCommitAuthorityV2 {
  const sourceProvider = sourceAuthorities.get(sourceAuthority);
  check(sourceProvider, 'branded independent source journal authority required');
  check(provider !== null && typeof provider === 'object' && provider.origin !== null &&
    typeof provider.origin === 'object' && provider.origin === sourceProvider.origin &&
    typeof provider.lookup === 'function' && provider.genesis !== null &&
    typeof provider.genesis === 'object', 'trusted outer branch provider required');
  assertAdmittedDuelMatchV2(provider.setup);
  assertAdmittedDuelMatchV2(provider.genesis);
  check(provider.setup.stage === 'setup' && provider.genesis.stage === 'playing' &&
    provider.genesis.stateVersion === provider.setup.stateVersion + 1 &&
    provider.genesis.eventSeq === provider.setup.eventSeq + 1 &&
    provider.setup.matchId === provider.genesis.matchId &&
    provider.setup.dataVersion === provider.genesis.dataVersion &&
    provider.setup.catalogDigest === provider.genesis.catalogDigest &&
    same(provider.setup.roster.map(p => p.playerId), provider.genesis.roster.map(p => p.playerId)),
  'playing genesis must be immediate admitted setup successor');
  const genesisCommitId = id(provider.genesisCommitId, 'genesis commit');
  const handle = Object.freeze({}) as DuelResourceOuterCommitAuthorityV2;
  outerAuthorities.set(handle, { provider, source: sourceAuthority, sourceProvider,
    origin: provider.origin, genesis: provider.genesis, genesisCommitId, lastLookup: null });
  return handle;
}
/** Acquire once for the exact admitted playing genesis and creation-origin handle. */
export function beginDuelResourceReadinessJournalFromSetupV2(before: DuelMatchStateV2,
  after: Playing, authority: DuelResourceOuterCommitAuthorityV2): DuelResourceReadinessWriterV2 {
  const outer = outerAuthorities.get(authority);
  check(outer && outer.provider.setup === before && outer.genesis === after,
    'genesis requires exact branded setup/playing origin');
  return beginDuelResourceReadinessJournalV2(after, authority);
}
function source(raw: unknown): DuelResourceEventSourceV2 {
  const kind = recordKind(raw, 'event source');
  if (kind === 'command') {
    const r = record(raw, ['kind', 'commandId', 'actor'], 'command source');
    return { kind, commandId: id(r.commandId, 'command'), actor: id(r.actor, 'command actor') };
  }
  if (kind === 'turn') {
    const r = record(raw, ['kind', 'stepId', 'actor', 'boundary'], 'turn source');
    check(r.boundary === 'channel' || r.boundary === 'awaken' || r.boundary === 'main-reset',
      'unknown turn boundary');
    return { kind, stepId: id(r.stepId, 'turn step'), actor: id(r.actor, 'turn actor'),
      boundary: r.boundary };
  }
  if (kind === 'effect') {
    const r = record(raw, ['kind', 'eventId', 'sourceEffectId', 'sourceProofId', 'sourceRevision',
      'sourceUID', 'sourceZoneEpoch', 'actor'], 'effect source');
    return { kind, eventId: id(r.eventId, 'effect event'), sourceEffectId: id(r.sourceEffectId, 'effect'),
      sourceProofId: id(r.sourceProofId, 'effect source proof'),
      sourceRevision: count(r.sourceRevision, 'effect source revision'),
      sourceUID: id(r.sourceUID, 'effect source UID'),
      sourceZoneEpoch: count(r.sourceZoneEpoch, 'effect source epoch'), actor: id(r.actor, 'effect actor') };
  }
  if (kind === 'payment') {
    const r = record(raw, ['kind', 'paymentId', 'sourceProofId', 'sourceRevision', 'sourceUID',
      'sourceZoneEpoch', 'actor', 'costDigest'], 'payment source');
    return { kind, paymentId: id(r.paymentId, 'payment'),
      sourceProofId: id(r.sourceProofId, 'payment source proof'),
      sourceRevision: count(r.sourceRevision, 'payment source revision'),
      sourceUID: id(r.sourceUID, 'payment source UID'),
      sourceZoneEpoch: count(r.sourceZoneEpoch, 'payment source epoch'),
      actor: id(r.actor, 'payment actor'), costDigest: id(r.costDigest, 'payment cost digest') };
  }
  if (kind === 'non-resource') {
    const r = record(raw, ['kind', 'mutationId'], 'non-resource source');
    return { kind, mutationId: id(r.mutationId, 'mutation') };
  }
  check(false, 'unknown event source');
}
function recordKind(raw: unknown, label: string): unknown {
  plainObject(raw, label);
  check(!Array.isArray(raw), `${label} record`);
  return descriptor(raw, 'kind', label);
}
function action(raw: unknown, origin: DuelResourceEventSourceV2): DuelResourceActionV2 {
  const kind = recordKind(raw, 'action');
  if (kind === 'channel') {
    check(origin.kind === 'turn' || origin.kind === 'effect', 'channel needs turn/effect source');
    const r = record(raw, ['kind', 'playerId', 'runes'], 'channel');
    const runes = list(r.runes, 'channel runes').map(item => {
      const rune = record(item, ['uid', 'readied'], 'channel rune');
      return { uid: id(rune.uid, 'rune'), readied: bool(rune.readied, 'entry readiness') };
    });
    check(runes.length > 0, 'empty channel');
    return { kind, playerId: id(r.playerId, 'channel player'), runes };
  }
  if (kind === 'rune-energy' || kind === 'rune-power' || kind === 'gold-power') {
    check(origin.kind === 'command' || origin.kind === 'effect', 'activation needs command/effect source');
    const r = record(raw, ['kind', 'playerId', 'uid'], 'activation');
    return { kind, playerId: id(r.playerId, 'activation player'), uid: id(r.uid, 'activation UID') };
  }
  if (kind === 'gold-create') {
    check(origin.kind === 'effect', 'Gold creation needs independently linked effect');
    const r = record(raw, ['kind', 'playerId', 'uid', 'locationId', 'readied'], 'Gold creation');
    return { kind, playerId: id(r.playerId, 'Gold player'), uid: id(r.uid, 'Gold UID'),
      locationId: id(r.locationId, 'Gold base'), readied: bool(r.readied, 'Gold entry readiness') };
  }
  if (kind === 'readiness') {
    check(origin.kind === 'turn' || origin.kind === 'effect', 'readiness needs turn/effect source');
    const r = record(raw, ['kind', 'playerId', 'tokenKind', 'uid', 'from', 'to'], 'readiness');
    check(r.tokenKind === 'rune' || r.tokenKind === 'gold', 'unknown readiness token kind');
    const from = bool(r.from, 'prior readiness'), to = bool(r.to, 'next readiness');
    check(from !== to, 'readiness must change');
    return { kind, playerId: id(r.playerId, 'readiness player'), tokenKind: r.tokenKind,
      uid: id(r.uid, 'readiness UID'), from, to };
  }
  if (kind === 'pool-delta') {
    check(origin.kind === 'effect', 'free pool delta has no independently linked effect');
    const r = record(raw, ['kind', 'playerId', 'pool', 'delta', 'consumptionId'], 'pool delta');
    const delta = r.delta;
    check(typeof delta === 'number' && Number.isSafeInteger(delta) && delta !== 0, 'nonzero safe delta required');
    const pool = sourcePool(r.pool);
    check(r.consumptionId === null || typeof r.consumptionId === 'string', 'consumption association');
    const consumptionId = r.consumptionId === null ? null : id(r.consumptionId, 'consumption');
    check(consumptionId !== null, 'pool delta requires source/consumption association');
    return { kind, playerId: id(r.playerId, 'pool player'), pool, delta, consumptionId };
  }
  if (kind === 'pay') {
    check(origin.kind === 'payment', 'payment needs independently linked payment source');
    const r = record(raw, ['kind', 'playerId', 'paymentId', 'energy', 'power'], 'payment');
    const paymentId = id(r.paymentId, 'payment');
    check(paymentId === origin.paymentId, 'payment source ID mismatch');
    const seen = new Set<string>();
    const allocations = list(r.power, 'payment power').map(item => {
      const p = record(item, ['from', 'amount'], 'payment allocation');
      const from = power(p.from), amount = count(p.amount, 'payment amount');
      check(amount > 0 && !seen.has(from), 'zero/duplicate payment allocation');
      seen.add(from);
      return { from, amount };
    });
    return { kind, playerId: id(r.playerId, 'payment player'), paymentId,
      energy: count(r.energy, 'paid energy'), power: allocations };
  }
  if (kind === 'reset-pools') {
    check(origin.kind === 'turn' && origin.boundary === 'main-reset', 'pool reset needs turn boundary');
    record(raw, ['kind'], 'pool reset');
    return { kind };
  }
  check(false, 'unknown resource action');
}
function validateEvent(raw: unknown, priorVersion: number, priorSeq: number): DuelResourceReadinessEventV2 {
  const r = record(raw, ['eventId', 'stateVersion', 'eventSeq', 'source', 'sourceRevision',
    'actions'], 'journal event');
  const stateVersion = count(r.stateVersion, 'stateVersion'), eventSeq = count(r.eventSeq, 'eventSeq');
  check(priorVersion < Number.MAX_SAFE_INTEGER && priorSeq < Number.MAX_SAFE_INTEGER &&
    stateVersion === priorVersion + 1 && eventSeq === priorSeq + 1 && stateVersion === eventSeq,
  'clock gap, duplicate, reordering or overflow');
  const origin = source(r.source);
  const actions = list(r.actions, 'event actions').map(item => action(item, origin));
  check((origin.kind === 'non-resource') === (actions.length === 0), 'non-resource event/action mismatch');
  check(origin.kind !== 'payment' || actions.length === 1 && actions[0]?.kind === 'pay',
    'payment source must have exactly one payment');
  check(origin.kind !== 'turn' || actions.every(a =>
    origin.boundary === 'channel' ? a.kind === 'channel' :
      origin.boundary === 'awaken' ? a.kind === 'readiness' : a.kind === 'reset-pools'),
  'turn action must match boundary');
  const sourceRevision = count(r.sourceRevision, 'source revision');
  check((origin.kind !== 'effect' && origin.kind !== 'payment') ||
    origin.sourceRevision === sourceRevision, 'source journal revision mismatch');
  return { eventId: id(r.eventId, 'event'), stateVersion, eventSeq, source: origin,
    sourceRevision, actions };
}
function index(resources: DuelResources, playerId: string): 0 | 1 {
  if (playerId === resources.playerIds[0]) return 0;
  if (playerId === resources.playerIds[1]) return 1;
  check(false, `unknown resource player ${playerId}`);
}
function updatePool(resources: DuelResources, playerId: string, slot: 'energy' | DuelPowerSource,
  delta: number): DuelResources {
  const i = index(resources, playerId);
  const result = resourceCopy(resources);
  const player = result.players[i];
  const pool = player.runePool;
  const before = slot === 'energy' ? pool.energy : pool.power[slot];
  const after = before + delta;
  check(Number.isSafeInteger(after) && after >= 0, 'negative or overflowing pool delta');
  const updated = slot === 'energy' ? { ...pool, energy: after } :
    { ...pool, power: { ...pool.power, [slot]: after } };
  const players = result.players.map((p, n) => n === i ? { ...p, runePool: updated } : p) as
    [typeof player, typeof player];
  return restoreDuelResources({ ...result, players }, locations(result)); // checks aggregate pool overflow
}
function apply(resources: DuelResources, a: DuelResourceActionV2): DuelResources {
  if (a.kind === 'channel') {
    const i = index(resources, a.playerId);
    check(a.runes.every((r, n) => resources.players[i].runeDeck[n]?.uid === r.uid), 'channel not top-of-deck order');
    let next = resources;
    for (const r of a.runes) next = channelDuelRunes(next, a.playerId, 1, r.readied);
    return next;
  }
  if (a.kind === 'rune-energy' || a.kind === 'rune-power' || a.kind === 'gold-power') {
    const t = { stateOpen: true, priorityPlayerId: a.playerId, resourcePaymentPlayerId: null };
    return a.kind === 'rune-energy' ? activateBasicRuneEnergy(resources, a.playerId, a.uid, t) :
      a.kind === 'rune-power' ? activateBasicRunePower(resources, a.playerId, a.uid, t) :
        activateDuelGoldPower(resources, a.playerId, a.uid, t);
  }
  if (a.kind === 'gold-create') return createDuelGoldToken(resources, {
    playerId: a.playerId, uid: a.uid, locationId: a.locationId, readied: a.readied,
  });
  if (a.kind === 'readiness') {
    const i = index(resources, a.playerId), state = resourceCopy(resources), base = state.bases[i];
    const key = a.tokenKind === 'rune' ? 'baseRunes' : 'goldTokens';
    const tokens = base[key];
    const position = tokens.findIndex(t => t.uid === a.uid);
    check(position >= 0 && tokens[position]?.readied === a.from, 'unknown, foreign or stale readiness UID');
    const bases = state.bases.map((b, n) => n !== i ? b : a.tokenKind === 'rune'
      ? { ...b, baseRunes: b.baseRunes.map(t => t.uid === a.uid ? { ...t, readied: a.to } : t) }
      : { ...b, goldTokens: b.goldTokens.map(t => t.uid === a.uid ? { ...t, readied: a.to } : t) }) as
      [typeof base, typeof base];
    return restoreDuelResources({ ...state, bases }, locations(state));
  }
  if (a.kind === 'pool-delta') return updatePool(resources, a.playerId, a.pool, a.delta);
  if (a.kind === 'pay') {
    let next = resources;
    if (a.energy !== 0) next = updatePool(next, a.playerId, 'energy', -a.energy);
    for (const allocation of a.power) next = updatePool(next, a.playerId, allocation.from, -allocation.amount);
    return next;
  }
  return clearAllDuelRunePools(resources);
}
function genesis(raw: unknown): DuelResourceReadinessGenesisV2 {
  const r = record(raw, ['matchId', 'dataVersion', 'catalogDigest', 'playerIds',
    'stateVersion', 'eventSeq', 'resources'], 'journal genesis');
  const playerIds = identities(r.playerIds);
  const stateVersion = count(r.stateVersion, 'genesis version'), eventSeq = count(r.eventSeq, 'genesis sequence');
  // Core V2 enters playing only after the two authenticated mulligan commits (0 -> 1 -> 2).
  // Pinning this first playing clock prevents minting a fresh "genesis" from a later empty
  // candidate after a pool reset or other round-trip.
  check(stateVersion === 2 && eventSeq === 2, 'genesis must be first playing clock');
  const resources = resourceCopy(r.resources);
  check(same(playerIds, resources.playerIds) && resources.bases.every(b =>
    b.baseRunes.length === 0 && b.goldTokens.length === 0) && resources.retiredGoldUids.length === 0 &&
    resources.players.every(p => p.runePool.energy === 0 && POWER.every(d => p.runePool.power[d] === 0)),
  'nonempty or unrelated playing genesis');
  return { matchId: id(r.matchId, 'match'), dataVersion: id(r.dataVersion, 'data version'),
    catalogDigest: id(r.catalogDigest, 'catalog digest'), playerIds, stateVersion, eventSeq, resources };
}
function headFor(g: DuelResourceReadinessGenesisV2, events: readonly DuelResourceReadinessEventV2[]): DuelResourceReadinessHeadV2 {
  const last = events.at(-1);
  return { matchId: g.matchId, dataVersion: g.dataVersion, catalogDigest: g.catalogDigest,
    playerIds: [...g.playerIds] as [string, string], stateVersion: last?.stateVersion ?? g.stateVersion,
    eventSeq: last?.eventSeq ?? g.eventSeq, eventCount: events.length, lastEventId: last?.eventId ?? null };
}
function checkedHead(raw: unknown): DuelResourceReadinessHeadV2 {
  const r = record(raw, ['matchId', 'dataVersion', 'catalogDigest', 'playerIds',
    'stateVersion', 'eventSeq', 'eventCount', 'lastEventId'], 'independent journal head');
  const lastEventId = r.lastEventId === null ? null : id(r.lastEventId, 'last event');
  const eventCount = count(r.eventCount, 'head event count');
  check((eventCount === 0) === (lastEventId === null), 'head last event/count mismatch');
  const stateVersion = count(r.stateVersion, 'head version'), eventSeq = count(r.eventSeq, 'head sequence');
  check(stateVersion === eventSeq && eventCount <= Number.MAX_SAFE_INTEGER - 1 &&
    stateVersion >= eventCount, 'head clock/count mismatch');
  return { matchId: id(r.matchId, 'head match'), dataVersion: id(r.dataVersion, 'head data version'),
    catalogDigest: id(r.catalogDigest, 'head catalog digest'), playerIds: identities(r.playerIds),
    stateVersion, eventSeq, eventCount, lastEventId };
}

/** Only a live, resource-empty V2 playing state can issue an in-memory writer.
 * For factory playing genesis use begin...FromSetupV2 to bind the predecessor. An archive
 * must never use this function to mint a replacement journal during restore. */
export function beginDuelResourceReadinessJournalV2(match: Playing,
  authority: DuelResourceOuterCommitAuthorityV2): DuelResourceReadinessWriterV2 {
  const outer = outerAuthorities.get(authority);
  check(outer && outer.genesis === match && outer.provider.genesis === match &&
    outer.provider.origin === outer.origin && outer.sourceProvider.origin === outer.origin,
  'playing genesis requires bound outer/source authority');
  assertAdmittedDuelMatchV2(match);
  check(match.stage === 'playing', 'playing genesis required');
  check(!issuedGenesis.has(match) && !issuedOrigins.has(outer.origin),
    'duplicate writer for admitted genesis/creation origin');
  const g = genesis({ matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, playerIds: match.roster.map(p => p.playerId),
    stateVersion: match.stateVersion, eventSeq: match.eventSeq, resources: match.resources });
  const journal: DuelResourceReadinessJournalV2 = { genesis: g, events: [] };
  const head = headFor(g, []);
  freeze(journal); freeze(head);
  const writer = Object.freeze({}) as DuelResourceReadinessWriterV2;
  writers.set(writer, { current: match, authority, origin: outer.origin,
    parentCommitId: outer.genesisCommitId, journal, head, sealed: false,
    busy: false, reentryAttempted: false });
  issuedGenesis.add(match); issuedOrigins.add(outer.origin);
  return writer;
}
/** Source IDs cannot authorize themselves: the independent ledger must return an exact
 * record at the outer commit's revision, matching the committed native before/after. */
function checkSourceProof(w: WriterState, commit: DuelResourceOuterCommitV2,
  entry: DuelResourceReadinessEventV2): void {
  const outer = outerAuthorities.get(w.authority);
  check(outer && outer.origin === w.origin &&
    outer.sourceProvider.origin === w.origin && sourceAuthorities.get(outer.source) === outer.sourceProvider,
  'source journal authority/branch mismatch');
  const ledger = outer.sourceProvider.lookup(entry.sourceRevision);
  check(ledger && ledger === commit.sourceProof && ledger.kind === entry.source.kind &&
    ledger.revision === entry.sourceRevision && ledger.before === commit.before &&
    ledger.after === commit.after, 'missing/foreign independent source proof');
  const proof = ledger;
  const s = entry.source;
  check(commit.sourceRevision === entry.sourceRevision, 'outer/source revision mismatch');
  if (s.kind !== 'non-resource' && s.kind !== 'turn') {
    check(entry.actions.every(action => !('playerId' in action) || action.playerId === s.actor),
      'resource action actor differs from independent source');
  }
  if (s.kind === 'non-resource') {
    check(proof.kind === 'non-resource' && s.mutationId === proof.mutationId,
      'mutation proof mismatch');
  } else if (s.kind === 'command') {
    check(proof.kind === 'command' && s.commandId === proof.commandId && s.actor === proof.actor,
      'command proof/actor mismatch');
  } else if (s.kind === 'turn') {
    check(proof.kind === 'turn' && s.stepId === proof.stepId && s.actor === proof.actor &&
      s.boundary === proof.boundary && proof.actor === commit.before.frame.turnPlayerId &&
      proof.actor === commit.after.frame.turnPlayerId &&
      entry.actions.every(action => !('playerId' in action) || action.playerId === s.actor) &&
      commit.before.frame.turnNumber === commit.after.frame.turnNumber &&
      commit.before.frame.pendingPayment === null && commit.after.frame.pendingPayment === null,
    'turn proof/actor/boundary mismatch');
    const before = commit.before.frame, after = commit.after.frame;
    if (s.boundary === 'channel') check(before.phase === 'scoring' && after.phase === 'channel' &&
      !after.stateOpen, 'channel phase transition required');
    if (s.boundary === 'awaken') check(before.phase === 'awaiting-turn-start' &&
      after.phase === 'awaken' && after.stateOpen, 'Awaken phase transition required');
    if (s.boundary === 'main-reset') check(before.phase === 'draw' && after.phase === 'main' &&
      !after.stateOpen, 'Main pool reset transition required');
  } else if (s.kind === 'effect') {
    check(proof.kind === 'effect' && s.eventId === proof.eventId &&
      s.sourceEffectId === proof.sourceEffectId && s.sourceProofId === proof.sourceProofId &&
      s.sourceUID === proof.sourceUID && s.sourceZoneEpoch === proof.sourceZoneEpoch &&
      s.actor === proof.actor, 'effect source proof/UID/epoch/actor mismatch');
    const origin = commit.before.physicalCardsByUID[s.sourceUID];
    check(origin !== undefined && origin.zoneEpoch === s.sourceZoneEpoch &&
      (s.actor === commit.before.frame.turnPlayerId ||
        commit.before.roster.some(p => p.playerId === s.actor)),
    'effect source UID/epoch/actor not live on canonical branch');
    check(same(proof.consumptionIds, entry.actions.filter(a => a.kind === 'pool-delta')
      .map(a => a.consumptionId)), 'effect consumption grouping differs from source journal');
  } else {
    const pending = commit.before.frame.pendingPayment;
    check(proof.kind === 'payment' && s.paymentId === proof.paymentId &&
      s.sourceProofId === proof.sourceProofId && s.sourceUID === proof.sourceUID &&
      s.sourceZoneEpoch === proof.sourceZoneEpoch && s.actor === proof.actor,
    'payment source proof/UID/epoch/actor mismatch');
    // The independent ledger validates current or pre-exit source epoch. The pending
    // payment binds its complete source identity, even when that epoch is no longer live.
    check(pending !== null && s.sourceUID === pending.sourceReference.sourceUID &&
      proof.sourceReference.sourceUID === s.sourceUID &&
      same(proof.sourceReference, pending.sourceReference),
    'payment source does not match canonical pending source reference');
    const paymentAction = entry.actions[0];
    check(paymentAction?.kind === 'pay' && paymentAction.playerId === s.actor &&
      s.actor === pending.actor && s.paymentId === pending.paymentId &&
      commit.after.frame.pendingPayment === null &&
      same(proof.resolvedCost, pending.resolvedCost) &&
      s.costDigest === digestDuelResourcePaymentV2(proof.resolvedCost, proof.plan) &&
      same(paymentAction, paidAction(proof.paymentId, proof.actor, proof.resolvedCost, proof.plan)),
    'payment proof/cost/plan/actor does not match canonical pending payment');
  }
}
/** Append by ID only. Neither caller-provided before/after nor caller-provided source strings
 * can override the two independent trusted ledgers' native objects and proof record. */
export function appendDuelResourceReadinessEventV2(writer: DuelResourceReadinessWriterV2,
  authority: DuelResourceOuterCommitAuthorityV2, commitId: string): DuelResourceReadinessHeadV2 {
  const w = writers.get(writer);
  check(w && !w.sealed, 'unknown, cloned or sealed writer');
  if (w.busy) {
    w.reentryAttempted = true;
    check(false, 'writer reentry during append');
  }
  w.busy = true;
  w.reentryAttempted = false;
  try {
    return appendLocked(w, writer, authority, commitId);
  } finally {
    w.busy = false;
    w.reentryAttempted = false;
  }
}
function appendLocked(w: WriterState, writer: DuelResourceReadinessWriterV2,
  authority: DuelResourceOuterCommitAuthorityV2, commitId: string): DuelResourceReadinessHeadV2 {
  const outer = outerAuthorities.get(authority);
  check(outer && authority === w.authority && outer.origin === w.origin &&
    outer.provider.origin === w.origin && outer.provider.genesis === outer.genesis,
  'foreign outer authority/branch');
  const requestedId = id(commitId, 'outer commit');
  const commit = outer.provider.lookup(requestedId);
  check(commit && commit === outer.provider.lookup(requestedId) && commit.commitId === requestedId &&
    commit.origin === w.origin && commit.parent === w.current &&
    commit.parentCommitId === w.parentCommitId && commit.before === w.current,
  'outer commit parent/branch mismatch');
  assertAdmittedDuelMatchV2(commit.before); assertAdmittedDuelMatchV2(commit.after);
  const before = commit.before, after = commit.after;
  check(before.stage === 'playing' && after.stage === 'playing' && after !== before &&
    after.matchId === w.head.matchId && after.dataVersion === w.head.dataVersion &&
    after.catalogDigest === w.head.catalogDigest && same(after.roster.map(p => p.playerId), w.head.playerIds),
  'commit identity mismatch');
  check(before.stateVersion === w.head.stateVersion && before.eventSeq === w.head.eventSeq &&
    sameResources(before.resources, w.journal.events.length === 0 ? w.journal.genesis.resources :
      replayDuelResourceReadinessJournalV2(w.journal, w.head).resources), 'writer parent proof mismatch');
  const entry = validateEvent(commit.event, w.head.stateVersion, w.head.eventSeq);
  check(after.stateVersion === entry.stateVersion && after.eventSeq === entry.eventSeq,
    'committed match clock differs from journal event');
  checkSourceProof(w, commit, entry);
  checkIdentifiers(w.journal.events, entry);
  let resources = resourceCopy(before.resources);
  for (const a of entry.actions) resources = apply(resources, a);
  check(sameResources(resources, after.resources), 'resource actions differ from trusted committed match');
  const events = [...w.journal.events, entry];
  const journal = { genesis: w.journal.genesis, events };
  const head = headFor(journal.genesis, events);
  freeze(journal); freeze(head);
  check(!w.reentryAttempted, 'writer reentry attempted during append');
  writers.set(writer, { ...w, current: after, parentCommitId: requestedId, journal, head,
    busy: false, reentryAttempted: false });
  return head;
}

/** Seals the in-memory writer; detached frozen JSON-shaped data, not a durable certificate. */
export function sealDuelResourceReadinessJournalV2(writer: DuelResourceReadinessWriterV2): {
  readonly journal: DuelResourceReadinessJournalV2; readonly head: DuelResourceReadinessHeadV2;
} {
  const w = writers.get(writer);
  check(w && !w.sealed, 'unknown, cloned or sealed writer');
  if (w.busy) {
    w.reentryAttempted = true;
    check(false, 'writer reentry during seal');
  }
  w.sealed = true;
  // Re-decode for distinct, detached heads/genesis/event records (no writer object is serialized).
  const journal: DuelResourceReadinessJournalV2 = {
    genesis: genesis(w.journal.genesis),
    events: w.journal.events.map((e, n) => validateEvent(e, w.journal.genesis.stateVersion + n,
      w.journal.genesis.eventSeq + n)),
  };
  const head = headFor(journal.genesis, journal.events);
  freeze(journal); freeze(head);
  return Object.freeze({ journal, head });
}

/** Replay ONLY the externally supplied protected genesis/events to the separately pinned head.
 * Compare to the candidate *after* replay, never derive events/genesis/head from it. */
export function replayDuelResourceReadinessJournalV2(raw: unknown, independentHead: unknown): {
  readonly resources: DuelResources; readonly head: DuelResourceReadinessHeadV2;
} {
  const r = record(raw, ['genesis', 'events'], 'protected journal');
  const g = genesis(r.genesis), h = checkedHead(independentHead);
  const entries = list(r.events, 'journal events');
  check(entries.length === h.eventCount, 'missing/extra journal events against protected head');
  let resources = g.resources;
  const verified: DuelResourceReadinessEventV2[] = [];
  let version = g.stateVersion, seq = g.eventSeq, lastEventId: string | null = null;
  for (const rawEvent of entries) {
    const e = validateEvent(rawEvent, version, seq);
    checkIdentifiers(verified, e);
    verified.push(e);
    for (const a of e.actions) resources = apply(resources, a);
    version = e.stateVersion; seq = e.eventSeq; lastEventId = e.eventId;
  }
  check(same(h, { matchId: g.matchId, dataVersion: g.dataVersion, catalogDigest: g.catalogDigest,
    playerIds: g.playerIds, stateVersion: version, eventSeq: seq,
    eventCount: entries.length, lastEventId }), 'independent head/identity mismatch');
  const result = { resources: resourceCopy(resources), head: h };
  freeze(result);
  return result;
}

/** Throws on any mismatch; archive caller must supply an independently protected head/journal. */
export function assertDuelResourceReadinessProofV2(raw: unknown, independentHead: unknown,
  candidate: Pick<Playing, 'matchId' | 'dataVersion' | 'catalogDigest' | 'roster' |
    'stateVersion' | 'eventSeq' | 'resources'>): void {
  const result = replayDuelResourceReadinessJournalV2(raw, independentHead), h = result.head;
  plainObject(candidate, 'candidate');
  const field = (key: string): unknown => descriptor(candidate, key, 'candidate');
  const roster = list(field('roster'), 'candidate roster').map(seat => {
    plainObject(seat, 'candidate seat');
    return id(descriptor(seat, 'playerId', 'candidate seat'), 'candidate player');
  });
  check(field('matchId') === h.matchId && field('dataVersion') === h.dataVersion &&
    field('catalogDigest') === h.catalogDigest &&
    same(identities(roster), h.playerIds) &&
    field('stateVersion') === h.stateVersion && field('eventSeq') === h.eventSeq,
  'candidate identity/clock differs from independent proof head');
  check(sameResources(result.resources, field('resources')),
    'candidate private pools, ordered Rune Decks, Gold or readiness differ from independent replay');
}
