import type { ObjectRef, PowerPaymentSource } from '../effects/contract.js';
import {
  DUEL_DOMAINS, normalizeDuelPowerSource, planDuelRunePayment,
  type DuelPaymentPlan, type DuelPowerSource, type DuelRuneCost, type DuelRunePool
} from './resources.js';

/** Trusted payment purpose, supplied by Finalize, never inferred from a cost's domains. */
export type ResourceUse = 'play-unit' | 'play-gear' | 'play-spell' | 'activate-unit' | 'activate-gear' | 'activate-legend';
export interface ResourcePaymentPurpose {
  readonly use?: ResourceUse;
  readonly showdown?: boolean;
}
export interface ResourceSpendRestriction {
  /** Disjunction of permitted uses; combined with showdownOnly by conjunction (054.2). */
  readonly uses?: readonly ResourceUse[];
  readonly showdownOnly?: boolean;
}
/** One addition to a Rune Pool. The ID identifies the lot, not just its color. */
export interface ResourceSource {
  readonly id: string;
  readonly resource: 'energy' | PowerPaymentSource;
  readonly amount: number;
  readonly origin?: ObjectRef;
  readonly restriction?: ResourceSpendRestriction;
}
/** Opt-in inventory for a host with provenance support; legacy snapshots stay unchanged. */
export interface ResourcePool {
  readonly sources: readonly ResourceSource[];
}
export interface ResourceAllocation {
  readonly sourceId: string;
  readonly amount: number;
  /** Absent for Energy, otherwise an index in the locked Power requirements. */
  readonly requirementIndex?: number;
}
export interface ResourcePaymentOptions {
  readonly purpose?: ResourcePaymentPurpose;
  readonly power?: DuelPaymentPlan;
  readonly sources?: readonly ResourceAllocation[];
}
export interface ResourcePayment {
  readonly energy: number;
  readonly power: DuelPaymentPlan;
  readonly sources: readonly ResourceAllocation[];
}

const USES: readonly ResourceUse[] = ['play-unit', 'play-gear', 'play-spell', 'activate-unit', 'activate-gear', 'activate-legend'];
function fail(message: string): never { throw new TypeError(`Resource provenance: ${message}`); }
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected a plain record');
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) fail('missing or unknown keys');
  for (const key of keys) if (!('value' in Object.getOwnPropertyDescriptor(value, key)!)) fail('accessors are not supported');
  return value as Record<string, unknown>;
}
function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('expected an array');
  if (Reflect.ownKeys(value).length !== value.length + 1) fail('expected a dense array without extra keys');
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !('value' in Object.getOwnPropertyDescriptor(value, String(i))!)) fail('expected array values');
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) fail('expected a nonempty ID');
  return value;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('expected a nonnegative safe integer');
  return value;
}
function sum(a: number, b: number): number { return count(a + b); }
function use(value: unknown): ResourceUse {
  if (!USES.includes(value as ResourceUse)) fail('unknown spending purpose');
  return value as ResourceUse;
}
function restriction(value: unknown): ResourceSpendRestriction {
  const raw = record(value, [], ['uses', 'showdownOnly']);
  if (raw.showdownOnly !== undefined && typeof raw.showdownOnly !== 'boolean') fail('showdownOnly must be boolean');
  const uses = raw.uses === undefined ? undefined : array(raw.uses).map(use);
  if (uses && (!uses.length || new Set(uses).size !== uses.length)) fail('uses must be nonempty and unique');
  if (!uses && raw.showdownOnly !== true) fail('restriction needs a spending limit');
  return { ...(uses ? { uses } : {}), ...(raw.showdownOnly === undefined ? {} : { showdownOnly: raw.showdownOnly as boolean }) };
}
function source(value: unknown): ResourceSource {
  const raw = record(value, ['id', 'resource', 'amount'], ['origin', 'restriction']);
  const resource = raw.resource === 'energy' ? 'energy' : normalizeDuelPowerSource(raw.resource);
  let origin: ObjectRef | undefined;
  if (raw.origin !== undefined) {
    const ref = record(raw.origin, ['id', 'zoneEntryId']);
    origin = { id: id(ref.id), zoneEntryId: count(ref.zoneEntryId) };
  }
  return { id: id(raw.id), resource, amount: count(raw.amount), ...(origin ? { origin } : {}),
    ...(raw.restriction === undefined ? {} : { restriction: restriction(raw.restriction) }) };
}
function purpose(value: unknown): ResourcePaymentPurpose {
  if (value === undefined) return {};
  const raw = record(value, [], ['use', 'showdown']);
  if (raw.showdown !== undefined && typeof raw.showdown !== 'boolean') fail('showdown must be boolean');
  return { ...(raw.use === undefined ? {} : { use: use(raw.use) }),
    ...(raw.showdown === undefined ? {} : { showdown: raw.showdown as boolean }) };
}
function permits(source: ResourceSource, purpose: ResourcePaymentPurpose): boolean {
  const limit = source.restriction;
  return (!limit?.showdownOnly || purpose.showdown === true) &&
    (!limit?.uses || purpose.use !== undefined && limit.uses.includes(purpose.use));
}
function aggregate(sources: readonly ResourceSource[]): DuelRunePool {
  let energy = 0, total = 0;
  const power = { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 };
  for (const entry of sources) {
    total = sum(total, entry.amount);
    if (entry.resource === 'energy') energy = sum(energy, entry.amount);
    else {
      const from = normalizeDuelPowerSource(entry.resource);
      power[from] = sum(power[from], entry.amount);
    }
  }
  return { energy, power };
}

/** Validate trusted saved inventory and detach every nested value. No live state is mutated. */
export function restoreResourcePool(value: unknown): ResourcePool {
  const raw = record(value, ['sources']);
  const sources = array(raw.sources).map(source);
  if (new Set(sources.map(entry => entry.id)).size !== sources.length) fail('duplicate source ID');
  aggregate(sources); // Check the complete pool, including currently ineligible lots, for overflow.
  return { sources };
}
export function createResourcePool(): ResourcePool { return { sources: [] }; }
export function addResourceSource(pool: ResourcePool, addition: ResourceSource): ResourcePool {
  const checked = restoreResourcePool(pool);
  return restoreResourcePool({ sources: [...checked.sources, source(addition)] });
}
/** Public totals are a projection, never the inventory used to authorize payment. */
export function projectResourcePool(pool: ResourcePool): DuelRunePool {
  return aggregate(restoreResourcePool(pool).sources);
}
/** CR 167: clearing a pool also clears every resource lot and its spending limits. */
export function clearResourcePool(pool: ResourcePool): ResourcePool {
  restoreResourcePool(pool);
  return createResourcePool();
}

function allocations(raw: unknown, sources: readonly ResourceSource[], cost: DuelRuneCost): {
  readonly sources: ResourceAllocation[]; readonly power: DuelPaymentPlan;
} {
  const available = new Map(sources.map(entry => [entry.id, entry.amount]));
  const byId = new Map(sources.map(entry => [entry.id, entry]));
  const seen = new Set<string>();
  const power: { requirementIndex: number; from: DuelPowerSource; amount: number }[] = [];
  let energy = 0;
  const selected = array(raw).map(value => {
    const item = record(value, ['sourceId', 'amount'], ['requirementIndex']);
    const sourceId = id(item.sourceId), amount = count(item.amount);
    const from = byId.get(sourceId);
    if (!from || amount === 0 || amount > available.get(sourceId)!) fail('unavailable source allocation');
    available.set(sourceId, available.get(sourceId)! - amount);
    const requirementIndex = item.requirementIndex === undefined ? undefined : count(item.requirementIndex);
    const key = JSON.stringify([sourceId, requirementIndex ?? null]);
    if (seen.has(key)) fail('duplicate source/requirement allocation');
    seen.add(key);
    if (from.resource === 'energy') {
      if (requirementIndex !== undefined) fail('Energy cannot pay Power');
      energy = sum(energy, amount);
      return { sourceId, amount };
    }
    if (requirementIndex === undefined) fail('Power cannot pay Energy');
    const resource = normalizeDuelPowerSource(from.resource);
    const previous = power.find(entry => entry.requirementIndex === requirementIndex && entry.from === resource);
    if (previous) previous.amount = sum(previous.amount, amount);
    else power.push({ requirementIndex, from: resource, amount });
    return { sourceId, amount, requirementIndex };
  });
  if (energy !== cost.energy) fail('source allocations do not cover Energy exactly');
  const validated = planDuelRunePayment(aggregate(sources), cost, { power });
  return { sources: selected, power: validated };
}
function samePower(a: DuelPaymentPlan, b: DuelPaymentPlan): boolean {
  const normalized = (plan: DuelPaymentPlan) => plan.power.map(entry => JSON.stringify([entry.requirementIndex, entry.from, entry.amount])).sort();
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

/**
 * Reuse the exact legacy max-flow allocator after excluding ineligible lots.
 * Domainless requirements never mint Universal Power (163.2.b). Missing purpose
 * excludes restricted sources rather than interpreting them as unrestricted.
 */
export function prepareResourcePayment(pool: ResourcePool, cost: DuelRuneCost, options: ResourcePaymentOptions = {}): ResourcePayment {
  const checked = restoreResourcePool(pool);
  const raw = record(options, [], ['purpose', 'power', 'sources']);
  const spending = purpose(raw.purpose);
  const eligible = checked.sources.filter(entry => permits(entry, spending));
  const power = planDuelRunePayment(aggregate(eligible), cost, options.power);
  if (raw.sources !== undefined) {
    const selected = allocations(raw.sources, eligible, cost);
    if (raw.power !== undefined && !samePower(power, selected.power)) fail('source allocations disagree with the Power plan');
    return { energy: cost.energy, ...selected };
  }
  const remaining = new Map(eligible.map(entry => [entry.id, entry.amount]));
  const selected: ResourceAllocation[] = [];
  const take = (resource: 'energy' | DuelPowerSource, amount: number, requirementIndex?: number) => {
    for (const entry of eligible) {
      if (entry.resource !== resource || amount === 0) continue;
      const used = Math.min(amount, remaining.get(entry.id)!);
      if (!used) continue;
      selected.push({ sourceId: entry.id, amount: used, ...(requirementIndex === undefined ? {} : { requirementIndex }) });
      remaining.set(entry.id, remaining.get(entry.id)! - used);
      amount -= used;
    }
    if (amount !== 0) fail('incomplete source allocation');
  };
  take('energy', cost.energy);
  for (const allocation of power.power) take(allocation.from, allocation.amount, allocation.requirementIndex);
  return { energy: cost.energy, power, sources: selected };
}

/** Prepare and consume from one immutable snapshot; stale/forged plans cannot partially debit it. */
export function payResourceCost(pool: ResourcePool, cost: DuelRuneCost, options: ResourcePaymentOptions = {}): {
  readonly pool: ResourcePool; readonly payment: ResourcePayment;
} {
  const checked = restoreResourcePool(pool);
  const payment = prepareResourcePayment(checked, cost, options);
  const spent = new Map<string, number>();
  for (const entry of payment.sources) spent.set(entry.sourceId, sum(spent.get(entry.sourceId) ?? 0, entry.amount));
  return { pool: { sources: checked.sources.map(entry => ({ ...entry, amount: entry.amount - (spent.get(entry.id) ?? 0) })) }, payment };
}

/** Adapt only legacy six-domain snapshots. It cannot invent Universal or restricted sources. */
export function resourcePoolFromDomains(energy: number, power: readonly string[]): ResourcePool {
  const sources: ResourceSource[] = [{ id: 'energy', resource: 'energy', amount: count(energy) }];
  const amounts = new Map<DuelPowerSource, number>();
  for (const value of array(power)) {
    if (!DUEL_DOMAINS.includes(value as typeof DUEL_DOMAINS[number])) fail('invalid Power domain in player snapshot');
    const domain = value as typeof DUEL_DOMAINS[number];
    amounts.set(domain, sum(amounts.get(domain) ?? 0, 1));
  }
  for (const [resource, amount] of amounts) sources.push({ id: `power:${resource}`, resource, amount });
  return restoreResourcePool({ sources });
}
