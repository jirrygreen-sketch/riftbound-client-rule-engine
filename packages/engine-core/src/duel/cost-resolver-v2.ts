// INTERNAL, server-only Duel V2 resource-cost resolver (CR 204, 356).
// The service that creates this authority must obtain the printed/copied base cost and the COMPLETE
// cost-affecting source/choice evidence from trusted, catalog-bound state. Neither this factory nor
// its callback may be exposed to a wire command. Unknown sources, incomplete choices and any
// non-resource cost are NOT equivalent to zero: this resource-only kernel refuses them. In
// particular, a numeric printed base cost is not proof that there are no additional costs.
import { DUEL_DOMAINS, type DuelDomain, type DuelRuneCost } from './resources.js';

export interface DuelCostRequestV2 {
  readonly transactionId: string;
  /** Trusted printing/ability identity, never supplied as a cost by a client. */
  readonly subjectId: string;
  readonly kind: 'card-play';
}
export type DuelCostStageV2 = 'base' | 'component-discount' | 'additional' |
  'additional-component-discount' | 'increase' | 'increase-component-discount' |
  'total-discount' | 'total-modification';
export type DuelCostTargetV2 =
  | { readonly kind: 'base' }
  | { readonly kind: 'new-component' }
  | { readonly kind: 'component'; readonly componentId: string }
  | { readonly kind: 'total' };

interface DuelCostModifierCommonV2 {
  /** Unique, stable *within this transaction*. Never use an untrusted card-text string as an ID. */
  readonly id: string;
  /** Opaque evidence reference; MUST NOT contain private source contents or be sent on the wire. */
  readonly sourceProofId: string;
  readonly target: DuelCostTargetV2;
}
export type DuelCostModifierV2 = DuelCostModifierCommonV2 & (
  | { readonly stage: 'base'; readonly operation: 'replace-base'; readonly cost: DuelRuneCost }
  | { readonly stage: 'base'; readonly operation: 'ignore-base-energy' | 'ignore-base-power' | 'ignore-base' }
  | { readonly stage: 'additional'; readonly operation: 'add';
      readonly choice: 'mandatory' | 'chosen-optional'; readonly cost: DuelRuneCost }
  | { readonly stage: 'increase'; readonly operation: 'increase'; readonly cost: DuelRuneCost }
  | { readonly stage: 'component-discount' | 'additional-component-discount' |
        'increase-component-discount' | 'total-discount'; readonly operation: 'discount';
      readonly reduction: DuelCostReductionV2 }
  | { readonly stage: 'total-modification'; readonly operation: 'replace-total'; readonly cost: DuelRuneCost }
  | { readonly stage: 'total-modification'; readonly operation: 'ignore-all-costs' }
);
/** Explicit Power requirement indices prevent scalar Power discounts from erasing Domain restrictions.
 * An index addresses the target component's CURRENT nonzero requirement list at this point in the
 * ordered pipeline (after any prior discount removed a zero requirement). A total discount indexes
 * the CURRENT concatenation in component order. Every floor belongs to ONE discount only
 * (356.4.e), not the final cost. */
export interface DuelCostReductionV2 {
  readonly energy?: { readonly amount: number; readonly floor?: number };
  readonly power?: readonly { readonly requirementIndex: number; readonly amount: number;
    readonly floor?: number }[];
}
export interface DuelCostSourceProofV2 {
  readonly proofId: string;
  readonly modifierId: string;
  readonly request: DuelCostRequestV2;
  readonly target: DuelCostTargetV2;
  readonly status: 'complete' | 'unknown';
  readonly applicability: 'applies' | 'does-not-apply' | 'unknown';
  /** Bound to the independent source snapshot, not just to the decision's own modifier ID. */
  readonly sourceUid: string;
  readonly sourceEpoch: number;
  readonly registryRevision: string;
  readonly catalogRevision: string;
  readonly modifierFingerprint: string;
  readonly candidateSourcesFingerprint: string;
  readonly resolvedChoicesFingerprint: string;
}
/** Complete coverage is a separate assertion over ALL potentially cost-affecting sources,
 * including sources which produce no modifier. It cannot be inferred from an empty modifier list. */
export interface DuelCostDecisionV2 {
  readonly request: DuelCostRequestV2;
  readonly base: { readonly cost: DuelRuneCost; readonly proofId: string;
    readonly status: 'complete' | 'unknown'; readonly request: DuelCostRequestV2;
    readonly sourceUid: string; readonly sourceEpoch: number;
    readonly registryRevision: string; readonly catalogRevision: string };
  readonly coverage: { readonly proofId: string; readonly status: 'complete' | 'unknown';
    readonly request: DuelCostRequestV2; readonly allModifierSourcesCovered: boolean;
    readonly choicesResolved: boolean; readonly nonResourceCosts: 'none' | 'present' | 'unknown';
    readonly registryRevision: string; readonly catalogRevision: string;
    readonly candidateSourcesFingerprint: string; readonly resolvedChoicesFingerprint: string };
  readonly proofs: readonly DuelCostSourceProofV2[];
  /** Already ordered by the trusted source/choice resolver; ordering within a stage is significant. */
  readonly modifiers: readonly DuelCostModifierV2[];
}
/** This is a separate, independently enumerated snapshot of ALL possible cost-affecting sources.
 * A source with no effect or a declined optional choice still MUST appear in candidates.
 * The verifier MUST read a stable catalog/transaction snapshot, never copy the service decision.
 * Its modifiers are the actual ordered effects of that source, not caller assertions. */
export interface DuelCostVerifiedSourcesV2 {
  readonly registryRevision: string;
  readonly catalogRevision: string;
  /** Independently checked against the pinned transaction, not copied from decision.coverage. */
  readonly nonResourceCosts: 'none' | 'present' | 'unknown';
  readonly base: { readonly cost: DuelRuneCost; readonly sourceUid: string; readonly sourceEpoch: number };
  /** Every potential source, including inert and declined sources, from the pinned independent snapshot. */
  readonly candidates: readonly { readonly sourceUid: string; readonly sourceEpoch: number;
    readonly choice: 'mandatory' | 'chosen-optional' | 'declined-optional' | 'not-applicable';
    readonly modifierIds: readonly string[] }[];
  /** All expected effects in RULE ORDER, independently derived (not copied from the service). */
  readonly orderedModifiers: readonly DuelCostModifierV2[];
}
export type DuelCostServiceV2 = (request: Readonly<DuelCostRequestV2>) => DuelCostDecisionV2;
export type DuelCostVerifierV2 = (request: Readonly<DuelCostRequestV2>) => DuelCostVerifiedSourcesV2;
export interface DuelCostResolverAuthorityV2 { readonly _duelCostResolverAuthorityV2: unique symbol }
interface AuthorityState {
  service: DuelCostServiceV2;
  verifier: DuelCostVerifierV2;
  inFlight: Set<string>;
  poisoned: Set<string>;
  completed: Set<string>;
}
const authorities = new WeakMap<object, AuthorityState>();

/** ONLY trusted server composition may call this factory. Both callbacks MUST be pure read-only
 * operations over the SAME pinned catalog/transaction snapshot; the verifier independently enumerates
 * every candidate (even non-applicable ones). A JSON decision or a cloned authority is insufficient.
 * This resolver cannot undo mutations performed by callbacks; settle payment only after verification. */
export function createDuelCostResolverAuthorityV2(trustedService: DuelCostServiceV2,
  independentVerifier: DuelCostVerifierV2): DuelCostResolverAuthorityV2 {
  if (typeof trustedService !== 'function' || typeof independentVerifier !== 'function')
    fail('trusted source service and independent verifier required');
  const authority = Object.freeze(Object.create(null)) as DuelCostResolverAuthorityV2;
  authorities.set(authority, { service: trustedService, verifier: independentVerifier,
    inFlight: new Set(), poisoned: new Set(), completed: new Set() });
  return authority;
}
export interface DuelCostApplicationV2 {
  readonly modifierId: string;
  readonly sourceProofId: string;
  readonly stage: DuelCostStageV2;
  readonly target: DuelCostTargetV2;
  /** For component operations, these are the isolated component, NOT the summed total.
   * add/increase starts at zero; all total operations use the combined cost. */
  readonly before: DuelRuneCost;
  readonly after: DuelRuneCost;
}
/** INTERNAL audit record; only `finalResolvedCost` may be passed to the existing payment path.
 * No source payloads, card text, service references or private zone contents are copied here.
 * Do NOT serialize this whole record to the client: even opaque proof IDs are internal. */
export interface DuelResolvedCostV2 {
  readonly finalResolvedCost: DuelRuneCost;
  readonly baseCost: DuelRuneCost;
  readonly baseProofId: string;
  readonly coverageProofId: string;
  readonly applications: readonly DuelCostApplicationV2[];
}

class CostResolverError extends TypeError {
  constructor(message: string) { super(`Duel cost resolver: ${message}`); }
}
function fail(message: string): never { throw new CostResolverError(message); }
/** Only own data descriptors are trusted. Double-read keys, descriptors and prototype so a
 * time-varying Proxy is rejected. JS cannot generally identify a Proxy which consistently fakes a
 * plain object: the independent verifier, not "plain object" testing, is the trust boundary. */
function dataSnapshot(raw: object, label: string): Map<PropertyKey, unknown> {
  try {
    const proto = Object.getPrototypeOf(raw);
    const names = Reflect.ownKeys(raw);
    const values = new Map<PropertyKey, unknown>();
    const descriptors = new Map<PropertyKey, PropertyDescriptor>();
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label} must not contain accessors`);
      descriptors.set(name, descriptor);
      values.set(name, descriptor.value);
    }
    const again = Reflect.ownKeys(raw);
    if (Object.getPrototypeOf(raw) !== proto || names.length !== again.length ||
        names.some((name, index) => name !== again[index])) fail(`${label} changed during snapshot`);
    for (const name of again) {
      const first = descriptors.get(name)!;
      const second = Object.getOwnPropertyDescriptor(raw, name);
      if (!second || !Object.hasOwn(second, 'value') ||
          first.configurable !== second.configurable || first.enumerable !== second.enumerable ||
          first.writable !== second.writable || !Object.is(first.value, second.value))
        fail(`${label} changed during snapshot`);
    }
    return values;
  } catch (error) {
    if (error instanceof CostResolverError) throw error;
    fail('invalid input snapshot'); // Never propagate a Proxy trap's private error/cause/stack.
  }
}
function record(raw: unknown, keys: readonly string[], label: string, optional: readonly string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') fail(`${label} must be a plain record`);
  let proto: object | null;
  try {
    if (Array.isArray(raw)) fail(`${label} must be a plain record`);
    proto = Object.getPrototypeOf(raw);
  } catch { fail('invalid input snapshot'); }
  if (proto !== Object.prototype && proto !== null) fail(`${label} must be a plain record`);
  const values = dataSnapshot(raw, label);
  if ([...values.keys()].some(key => typeof key !== 'string' || !keys.includes(key) && !optional.includes(key)) ||
      keys.some(key => !values.has(key))) fail(`${label} has missing or unknown keys`);
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, value] of values) out[key as string] = value;
  return out;
}
function array(raw: unknown, label: string): readonly unknown[] {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) fail(`${label} must be an array`);
  } catch { fail('invalid input snapshot'); }
  const values = dataSnapshot(raw as object, label);
  const length = values.get('length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 ||
      values.size !== length + 1 || !values.has('length')) fail(`${label} must be dense without extra keys`);
  const out: unknown[] = [];
  for (let i = 0; i < length; i++) {
    if (!values.has(String(i))) fail(`${label} must be dense without extra keys`);
    out.push(values.get(String(i)));
  }
  return out;
}
function id(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !raw.trim()) fail(`${label} must be a nonempty ID`);
  return raw;
}
function count(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) fail(`${label} must be a nonnegative safe integer`);
  return raw;
}
function positive(raw: unknown, label: string): number {
  const amount = count(raw, label);
  if (amount === 0) fail(`${label} must be positive`);
  return amount;
}
function add(a: number, b: number, label: string): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) fail(`${label} overflows safe integers`);
  return sum;
}
function request(raw: unknown): DuelCostRequestV2 {
  const r = record(raw, ['transactionId', 'subjectId', 'kind'], 'request');
  if (r.kind !== 'card-play') fail('unsupported cost request kind');
  return { transactionId: id(r.transactionId, 'transaction ID'), subjectId: id(r.subjectId, 'subject ID'), kind: 'card-play' };
}
function sameRequest(raw: unknown, expected: DuelCostRequestV2, label: string): void {
  const r = request(raw);
  if (r.transactionId !== expected.transactionId || r.subjectId !== expected.subjectId || r.kind !== expected.kind)
    fail(`${label} is bound to a different request`);
}
function target(raw: unknown): DuelCostTargetV2 {
  const t = record(raw, ['kind'], 'modifier target', ['componentId']);
  if (t.kind === 'component') {
    if (!Object.hasOwn(t, 'componentId')) fail('component target requires componentId');
    return { kind: 'component', componentId: id(t.componentId, 'component ID') };
  }
  if (Object.hasOwn(t, 'componentId') ||
      (t.kind !== 'base' && t.kind !== 'new-component' && t.kind !== 'total')) fail('invalid modifier target');
  return { kind: t.kind };
}
function sameTarget(left: DuelCostTargetV2, right: DuelCostTargetV2): boolean {
  return left.kind === right.kind &&
    (left.kind !== 'component' || right.kind === 'component' && left.componentId === right.componentId);
}
function cost(raw: unknown): DuelRuneCost {
  const c = record(raw, ['energy', 'power'], 'cost');
  const energy = count(c.energy, 'Energy cost');
  let total = energy;
  const power: { allowedDomains: DuelDomain[]; amount: number }[] = [];
  for (const item of array(c.power, 'Power requirements')) {
    const r = record(item, ['allowedDomains', 'amount'], 'Power requirement');
    const domains: DuelDomain[] = [];
    for (const domain of array(r.allowedDomains, 'allowedDomains')) {
      if (!(DUEL_DOMAINS as readonly unknown[]).includes(domain)) fail('unknown Power Domain');
      domains.push(domain as DuelDomain);
    }
    if (domains.length === 0 || new Set(domains).size !== domains.length) fail('Power requirement must have unique, nonempty Domains');
    const amount = positive(r.amount, 'Power requirement amount');
    total = add(total, amount, 'cost');
    power.push({ allowedDomains: domains, amount });
  }
  return { energy, power };
}
function freezeCost(c: DuelRuneCost): DuelRuneCost {
  return Object.freeze({ energy: c.energy, power: Object.freeze(c.power.map(r =>
    Object.freeze({ allowedDomains: Object.freeze([...r.allowedDomains]), amount: r.amount }))) });
}
function sumCosts(costs: readonly DuelRuneCost[]): DuelRuneCost {
  let energy = 0, total = 0;
  const power: { allowedDomains: readonly DuelDomain[]; amount: number }[] = [];
  for (const c of costs) {
    energy = add(energy, c.energy, 'combined Energy');
    for (const req of c.power) power.push({ allowedDomains: [...req.allowedDomains], amount: req.amount });
  }
  total = energy;
  for (const req of power) total = add(total, req.amount, 'combined cost');
  return { energy, power };
}
function reduction(raw: unknown): DuelCostReductionV2 {
  const r = record(raw, [], 'discount', ['energy', 'power']);
  if (!Object.hasOwn(r, 'energy') && !Object.hasOwn(r, 'power')) fail('empty discount');
  let energy: { amount: number; floor?: number } | undefined;
  if (Object.hasOwn(r, 'energy')) {
    const e = record(r.energy, ['amount'], 'Energy discount', ['floor']);
    energy = { amount: positive(e.amount, 'Energy discount amount') };
    if (Object.hasOwn(e, 'floor')) energy.floor = count(e.floor, 'Energy discount floor');
  }
  let power: { requirementIndex: number; amount: number; floor?: number }[] | undefined;
  if (Object.hasOwn(r, 'power')) {
    const seen = new Set<number>();
    power = [];
    for (const item of array(r.power, 'Power discounts')) {
      const p = record(item, ['requirementIndex', 'amount'], 'Power discount', ['floor']);
      const requirementIndex = count(p.requirementIndex, 'requirement index');
      if (seen.has(requirementIndex)) fail('duplicate requirement discount index');
      seen.add(requirementIndex);
      const out: { requirementIndex: number; amount: number; floor?: number } =
        { requirementIndex, amount: positive(p.amount, 'Power discount amount') };
      if (Object.hasOwn(p, 'floor')) out.floor = count(p.floor, 'Power discount floor');
      power.push(out);
    }
    if (!power.length) fail('empty Power discount');
  }
  return { ...(energy ? { energy } : {}), ...(power ? { power } : {}) };
}
function discounted(before: DuelRuneCost, r: DuelCostReductionV2): DuelRuneCost {
  const energy = r.energy ? Math.min(before.energy, Math.max(r.energy.floor ?? 0, before.energy - r.energy.amount)) : before.energy;
  const power = before.power.map(p => ({ allowedDomains: [...p.allowedDomains], amount: p.amount }));
  for (const part of r.power ?? []) {
    const selected = power[part.requirementIndex];
    if (!selected) fail('Power discount references absent requirement');
    selected.amount = Math.min(selected.amount, Math.max(part.floor ?? 0, selected.amount - part.amount));
  }
  return { energy, power: power.filter(p => p.amount !== 0) };
}
function modifier(raw: unknown): DuelCostModifierV2 {
  const m = record(raw, ['id', 'sourceProofId', 'target', 'stage', 'operation'], 'modifier',
    ['cost', 'choice', 'reduction']);
  const common = { id: id(m.id, 'modifier ID'), sourceProofId: id(m.sourceProofId, 'source proof ID'), target: target(m.target) };
  const optional = (keys: readonly string[]): void => {
    for (const key of ['cost', 'choice', 'reduction']) if (Object.hasOwn(m, key) !== keys.includes(key)) fail('modifier has unexpected or missing operation fields');
  };
  switch (m.stage) {
    case 'base':
      if (common.target.kind !== 'base') fail('base modifier must target base');
      if (m.operation === 'replace-base') { optional(['cost']); return { ...common, stage: 'base', operation: 'replace-base', cost: cost(m.cost) }; }
      if (m.operation === 'ignore-base-energy' || m.operation === 'ignore-base-power' || m.operation === 'ignore-base') {
        optional([]); return { ...common, stage: 'base', operation: m.operation };
      }
      break;
    case 'additional':
      if (common.target.kind !== 'new-component' || m.operation !== 'add') break;
      optional(['cost', 'choice']);
      if (m.choice !== 'mandatory' && m.choice !== 'chosen-optional') fail('unknown additional-cost choice');
      return { ...common, stage: 'additional', operation: 'add', choice: m.choice, cost: cost(m.cost) };
    case 'increase':
      if (common.target.kind !== 'new-component' || m.operation !== 'increase') break;
      optional(['cost']); return { ...common, stage: 'increase', operation: 'increase', cost: cost(m.cost) };
    case 'increase-component-discount':
      if (common.target.kind !== 'component' || m.operation !== 'discount') break;
      optional(['reduction']); return { ...common, stage: 'increase-component-discount', operation: 'discount', reduction: reduction(m.reduction) };
    case 'additional-component-discount':
      if (common.target.kind !== 'component' || m.operation !== 'discount') break;
      optional(['reduction']); return { ...common, stage: 'additional-component-discount', operation: 'discount', reduction: reduction(m.reduction) };
    case 'component-discount':
      if (common.target.kind !== 'component' || m.operation !== 'discount') break;
      optional(['reduction']); return { ...common, stage: 'component-discount', operation: 'discount', reduction: reduction(m.reduction) };
    case 'total-discount':
      if (common.target.kind !== 'total' || m.operation !== 'discount') break;
      optional(['reduction']); return { ...common, stage: 'total-discount', operation: 'discount', reduction: reduction(m.reduction) };
    case 'total-modification':
      if (common.target.kind !== 'total') break;
      if (m.operation === 'replace-total') { optional(['cost']); return { ...common, stage: 'total-modification', operation: 'replace-total', cost: cost(m.cost) }; }
      if (m.operation === 'ignore-all-costs') { optional([]); return { ...common, stage: 'total-modification', operation: 'ignore-all-costs' }; }
      break;
  }
  fail('unsupported modifier stage, target or operation');
}
const STAGES: readonly DuelCostStageV2[] = Object.freeze(['base', 'component-discount',
  'additional', 'additional-component-discount', 'increase', 'increase-component-discount',
  'total-discount', 'total-modification']);

// SHA-256 of a length-delimited canonical encoding of ALREADY VALIDATED, copied data.
// A digest is NOT a signature: only an independently enumerated verifier snapshot plus
// the unforgeable authority handle authenticates the candidate set and modifier effects.
const SHA256_K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function rotateRight(x: number, n: number): number { return x >>> n | x << (32 - n); }
function sha256(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = BigInt(bytes.length) * 8n;
  view.setUint32(padded.length - 8, Number(bits >> 32n & 0xffffffffn));
  view.setUint32(padded.length - 4, Number(bits & 0xffffffffn));
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!, y = w[i - 2]!;
      w[i] = (w[i - 16]! + (rotateRight(x, 7) ^ rotateRight(x, 18) ^ x >>> 3) +
        w[i - 7]! + (rotateRight(y, 17) ^ rotateRight(y, 19) ^ y >>> 10)) >>> 0;
    }
    let [a, b, c, d, e, f, g, q] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const t1 = (q + s1 + (e & f ^ ~e & g) + SHA256_K[i]! + w[i]!) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const t2 = (s0 + (a & b ^ a & c ^ b & c)) >>> 0;
      q = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    for (const [i, value] of [a, b, c, d, e, f, g, q].entries()) h[i] = (h[i]! + value) >>> 0;
  }
  return h.map(n => n.toString(16).padStart(8, '0')).join('');
}
function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `s${new TextEncoder().encode(value).length}:${value}`;
  if (typeof value === 'number') return `n${value};`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `a${value.length}:[${value.map(canonical).join('')}]`;
  if (typeof value === 'object') {
    const fields = Object.keys(value).sort();
    return `o${fields.length}:{${fields.map(key => canonical(key) + canonical((value as Record<string, unknown>)[key])).join('')}}`;
  }
  fail('invalid canonical fingerprint input');
}
function fingerprint(value: unknown): string { return sha256(canonical(value)); }
function modifierFingerprint(m: DuelCostModifierV2, requested: DuelCostRequestV2): string {
  // Proof IDs are audit references, not content. Include request and ALL effect-bearing fields,
  // including Power domain sets, discount floors and choice.
  return fingerprint({ request: requested, id: m.id, stage: m.stage, operation: m.operation,
    target: m.target, choice: 'choice' in m ? m.choice : null, cost: 'cost' in m ? m.cost : null,
    reduction: 'reduction' in m ? m.reduction : null });
}
type SourceIdentity = { readonly sourceUid: string; readonly sourceEpoch: number };
function source(raw: unknown): SourceIdentity {
  const s = record(raw, ['sourceUid', 'sourceEpoch'], 'source identity');
  return { sourceUid: id(s.sourceUid, 'source UID'), sourceEpoch: count(s.sourceEpoch, 'source epoch') };
}
function verifiedSnapshot(raw: unknown): {
  registryRevision: string; catalogRevision: string; base: SourceIdentity & { cost: DuelRuneCost };
  candidates: { sourceUid: string; sourceEpoch: number; choice: string; modifierIds: string[] }[];
  orderedModifiers: DuelCostModifierV2[];
} {
  const v = record(raw, ['registryRevision', 'catalogRevision', 'nonResourceCosts', 'base',
    'candidates', 'orderedModifiers'], 'verified sources');
  const registryRevision = id(v.registryRevision, 'registry revision');
  const catalogRevision = id(v.catalogRevision, 'catalog revision');
  if (v.nonResourceCosts !== 'none') fail('incomplete cost source/choice/non-resource coverage');
  const rawBase = record(v.base, ['cost', 'sourceUid', 'sourceEpoch'], 'verified base');
  const base = { ...source({ sourceUid: rawBase.sourceUid, sourceEpoch: rawBase.sourceEpoch }), cost: cost(rawBase.cost) };
  const candidates: { sourceUid: string; sourceEpoch: number; choice: string; modifierIds: string[] }[] = [];
  const seenSources = new Set<string>(), seenModifiers = new Set<string>();
  for (const entry of array(v.candidates, 'candidate sources')) {
    const c = record(entry, ['sourceUid', 'sourceEpoch', 'choice', 'modifierIds'], 'candidate source');
    const identity = source({ sourceUid: c.sourceUid, sourceEpoch: c.sourceEpoch });
    if (seenSources.has(identity.sourceUid)) fail('duplicate candidate source');
    seenSources.add(identity.sourceUid);
    if (c.choice !== 'mandatory' && c.choice !== 'chosen-optional' &&
        c.choice !== 'declined-optional' && c.choice !== 'not-applicable') fail('unresolved source choice');
    const modifierIds: string[] = [];
    for (const rawId of array(c.modifierIds, 'candidate modifier IDs')) {
      const modifierId = id(rawId, 'candidate modifier ID');
      if (seenModifiers.has(modifierId)) fail('duplicate candidate modifier ID');
      seenModifiers.add(modifierId);
      modifierIds.push(modifierId);
    }
    if ((c.choice === 'declined-optional' || c.choice === 'not-applicable') && modifierIds.length)
      fail('inactive source cannot apply modifiers');
    candidates.push({ ...identity, choice: c.choice, modifierIds });
  }
  const orderedModifiers: DuelCostModifierV2[] = [];
  for (const rawModifier of array(v.orderedModifiers, 'verified modifiers')) orderedModifiers.push(modifier(rawModifier));
  if (seenModifiers.size !== orderedModifiers.length ||
      orderedModifiers.some(m => !seenModifiers.has(m.id)) ||
      new Set(orderedModifiers.map(m => m.id)).size !== orderedModifiers.length)
    fail('verified modifier sources are incomplete');
  return { registryRevision, catalogRevision, base, candidates, orderedModifiers };
}
/** Canonical comparison fingerprints for trusted service composition. These are NOT signatures:
 * only agreement with an INDEPENDENT verified source snapshot authenticates a decision. */
export function fingerprintDuelCostModifierV2(rawRequest: DuelCostRequestV2,
  rawModifier: DuelCostModifierV2): string {
  return modifierFingerprint(modifier(rawModifier), request(rawRequest));
}
export function fingerprintDuelCostCoverageV2(rawSources: DuelCostVerifiedSourcesV2): {
  readonly candidateSourcesFingerprint: string; readonly resolvedChoicesFingerprint: string;
} {
  const v = verifiedSnapshot(rawSources);
  return Object.freeze({
    candidateSourcesFingerprint: fingerprint(v.candidates.map(c =>
      ({ sourceUid: c.sourceUid, sourceEpoch: c.sourceEpoch }))),
    resolvedChoicesFingerprint: fingerprint(v.candidates.map(c =>
      ({ sourceUid: c.sourceUid, sourceEpoch: c.sourceEpoch, choice: c.choice, modifierIds: c.modifierIds }))),
  });
}
function authenticateDecision(v: ReturnType<typeof verifiedSnapshot>, requested: DuelCostRequestV2,
  baseCost: DuelRuneCost, b: Record<string, unknown>,
  coverage: Record<string, unknown>, modifiers: readonly DuelCostModifierV2[],
  proofs: ReadonlyMap<string, { modifierId: string; target: DuelCostTargetV2;
    sourceUid: string; sourceEpoch: number; registryRevision: string; catalogRevision: string;
    modifierFingerprint: string; candidateSourcesFingerprint: string;
    resolvedChoicesFingerprint: string }>): void {
  if (id(b.sourceUid, 'base source UID') !== v.base.sourceUid ||
      count(b.sourceEpoch, 'base source epoch') !== v.base.sourceEpoch ||
      id(b.registryRevision, 'base registry revision') !== v.registryRevision ||
      id(b.catalogRevision, 'base catalog revision') !== v.catalogRevision ||
      fingerprint(baseCost) !== fingerprint(v.base.cost)) fail('base source snapshot mismatch');
  if (id(coverage.registryRevision, 'coverage registry revision') !== v.registryRevision ||
      id(coverage.catalogRevision, 'coverage catalog revision') !== v.catalogRevision ||
      id(coverage.candidateSourcesFingerprint, 'candidate sources fingerprint') !== fingerprint(v.candidates.map(c =>
        ({ sourceUid: c.sourceUid, sourceEpoch: c.sourceEpoch }))) ||
      id(coverage.resolvedChoicesFingerprint, 'resolved choices fingerprint') !== fingerprint(v.candidates.map(c =>
        ({ sourceUid: c.sourceUid, sourceEpoch: c.sourceEpoch, choice: c.choice, modifierIds: c.modifierIds }))))
    fail('source coverage snapshot mismatch');
  if (modifiers.length !== v.orderedModifiers.length) fail('source modifiers are incomplete');
  const sourceById = new Map<string, typeof v.candidates[number]>();
  for (const c of v.candidates) for (const modifierId of c.modifierIds) sourceById.set(modifierId, c);
  for (let i = 0; i < modifiers.length; i++) {
    const m = modifiers[i]!;
    const verified = v.orderedModifiers[i]!;
    const source = sourceById.get(m.id), p = proofs.get(m.sourceProofId);
    if (!source || !p || !sameTarget(m.target, verified.target) ||
        modifierFingerprint(m, requested) !== modifierFingerprint(verified, requested) ||
        p.sourceUid !== source.sourceUid || p.sourceEpoch !== source.sourceEpoch ||
        p.registryRevision !== v.registryRevision || p.catalogRevision !== v.catalogRevision ||
        p.modifierFingerprint !== modifierFingerprint(verified, requested) ||
        p.candidateSourcesFingerprint !== coverage.candidateSourcesFingerprint ||
        p.resolvedChoicesFingerprint !== coverage.resolvedChoicesFingerprint ||
        ('choice' in m && m.choice !== source.choice)) fail('modifier source snapshot mismatch');
  }
}

/** Resolve exactly one source-bound transaction. The request carries IDs only; it cannot carry a
 * client-computed total, base, modifier, or proof. Failure does not mutate the resolver's inputs
 * or payment state; callback side effects CANNOT be undone and are forbidden by contract. */
export function resolveDuelTotalCostV2(authority: DuelCostResolverAuthorityV2,
  rawRequest: DuelCostRequestV2): DuelResolvedCostV2 {
  let state: AuthorityState | undefined;
  try { state = authority && typeof authority === 'object' ? authorities.get(authority) : undefined; }
  catch { fail('unrecognized resolver authority'); }
  if (!state) fail('unrecognized resolver authority');
  const requested = request(rawRequest);
  const transaction = requested.transactionId;
  if (state.inFlight.has(transaction)) {
    state.poisoned.add(transaction); // Even if a callback catches the nested failure, outer resolve MUST fail.
    fail('transaction already in flight');
  }
  if (state.completed.has(transaction) || state.poisoned.has(transaction)) fail('transaction already resolved');
  state.inFlight.add(transaction);
  try {
    let untrustedDecision: DuelCostDecisionV2;
    try { untrustedDecision = state.service(Object.freeze({ ...requested })); }
    catch { fail('source callback failed'); } // Never propagate callback message, cause or stack.
    const d = record(untrustedDecision, ['request', 'base', 'coverage', 'proofs', 'modifiers'], 'trusted decision');
    sameRequest(d.request, requested, 'decision');
    const b = record(d.base, ['cost', 'proofId', 'status', 'request', 'sourceUid', 'sourceEpoch',
      'registryRevision', 'catalogRevision'], 'base proof');
  sameRequest(b.request, requested, 'base proof');
  if (b.status !== 'complete') fail('unknown or incomplete base proof');
  const baseProofId = id(b.proofId, 'base proof ID'), baseCost = cost(b.cost);
  const coverage = record(d.coverage, ['proofId', 'status', 'request', 'allModifierSourcesCovered',
    'choicesResolved', 'nonResourceCosts', 'registryRevision', 'catalogRevision',
    'candidateSourcesFingerprint', 'resolvedChoicesFingerprint'], 'source coverage');
  sameRequest(coverage.request, requested, 'source coverage');
  const coverageProofId = id(coverage.proofId, 'coverage proof ID');
  if (coverage.status !== 'complete' || coverage.allModifierSourcesCovered !== true ||
      coverage.choicesResolved !== true || coverage.nonResourceCosts !== 'none')
    fail('incomplete cost source/choice/non-resource coverage');
  const modifiers: DuelCostModifierV2[] = [];
  for (const entry of array(d.modifiers, 'modifiers')) modifiers.push(modifier(entry));
  const proofEntries = array(d.proofs, 'source proofs');
  if (proofEntries.length !== modifiers.length) fail('every modifier needs exactly one source proof');
  const proofs = new Map<string, { modifierId: string; target: DuelCostTargetV2;
    sourceUid: string; sourceEpoch: number; registryRevision: string; catalogRevision: string;
    modifierFingerprint: string; candidateSourcesFingerprint: string;
    resolvedChoicesFingerprint: string }>();
  const proofIds = new Set([baseProofId, coverageProofId]);
  if (proofIds.size !== 2) fail('base and coverage proof IDs must differ');
  for (const entry of proofEntries) {
    const p = record(entry, ['proofId', 'modifierId', 'request', 'target', 'status', 'applicability',
      'sourceUid', 'sourceEpoch', 'registryRevision', 'catalogRevision', 'modifierFingerprint',
      'candidateSourcesFingerprint', 'resolvedChoicesFingerprint'], 'source proof');
    const proofId = id(p.proofId, 'source proof ID');
    if (proofIds.has(proofId)) fail('duplicate proof ID');
    proofIds.add(proofId);
    sameRequest(p.request, requested, 'source proof');
    if (p.status !== 'complete' || p.applicability !== 'applies') fail('unknown, incomplete or inapplicable source proof');
    proofs.set(proofId, { modifierId: id(p.modifierId, 'proof modifier ID'), target: target(p.target),
      sourceUid: id(p.sourceUid, 'proof source UID'), sourceEpoch: count(p.sourceEpoch, 'proof source epoch'),
      registryRevision: id(p.registryRevision, 'proof registry revision'),
      catalogRevision: id(p.catalogRevision, 'proof catalog revision'),
      modifierFingerprint: id(p.modifierFingerprint, 'modifier fingerprint'),
      candidateSourcesFingerprint: id(p.candidateSourcesFingerprint, 'proof candidate fingerprint'),
      resolvedChoicesFingerprint: id(p.resolvedChoicesFingerprint, 'proof choices fingerprint') });
  }
  // This callback is the independent authority over the complete *candidate* set, not a
  // second parse of decision.coverage. No raw JSON decision may resolve without it.
  let untrustedSources: DuelCostVerifiedSourcesV2;
  try { untrustedSources = state.verifier(Object.freeze({ ...requested })); }
  catch { fail('source callback failed'); }
  const verified = verifiedSnapshot(untrustedSources);
  authenticateDecision(verified, requested, baseCost, b, coverage, modifiers, proofs);
  if (state.poisoned.has(transaction)) fail('transaction reentered during source verification');
  const seen = new Set<string>(), components: { id: string; cost: DuelRuneCost; kind: 'base' | 'additional' | 'increase' }[] =
    [{ id: 'base', cost: baseCost, kind: 'base' }];
  const applications: DuelCostApplicationV2[] = [];
  let previousStage = 0, total: DuelRuneCost | undefined;
  let immediateComponent: string | undefined;
  for (const m of modifiers) {
    // CR 356.4.c: a discount solely on one component happens when that component is
    // introduced (modified base, additional cost or increase), before later components or
    // discounts on the entire total. Each introduction may have multiple local discounts.
    const stageIndex = m.stage === 'additional-component-discount' ? STAGES.indexOf('additional') :
      m.stage === 'increase-component-discount' ? STAGES.indexOf('increase') : STAGES.indexOf(m.stage);
    if (stageIndex < previousStage) fail('modifiers out of cost-stage order');
    previousStage = stageIndex;
    if (m.stage === 'component-discount' || m.stage === 'additional-component-discount' ||
        m.stage === 'increase-component-discount') {
      const expected = m.stage === 'component-discount' ? 'base' : immediateComponent;
      if (m.target.kind !== 'component' || m.target.componentId !== expected)
        fail('component discount must address the current stage component');
    } else immediateComponent = undefined;
    if (m.id === 'base' || seen.has(m.id)) fail('duplicate or reserved modifier ID');
    seen.add(m.id);
    const proof = proofs.get(m.sourceProofId);
    if (!proof || proof.modifierId !== m.id || !sameTarget(proof.target, m.target)) fail('modifier source proof or applicability mismatch');
    let before: DuelRuneCost, after: DuelRuneCost;
    if (m.stage === 'base') {
      before = components[0]!.cost;
      after = m.operation === 'replace-base' ? m.cost :
        m.operation === 'ignore-base-energy' ? { energy: 0, power: before.power } :
          m.operation === 'ignore-base-power' ? { energy: before.energy, power: [] } : { energy: 0, power: [] };
      components[0]!.cost = after;
    } else if (m.stage === 'additional' || m.stage === 'increase') {
      before = { energy: 0, power: [] };
      after = m.cost;
      if (after.energy === 0 && !after.power.length) fail('empty additional cost/increase');
      components.push({ id: m.id, cost: after, kind: m.stage });
      immediateComponent = m.id;
    } else if (m.stage === 'component-discount' || m.stage === 'additional-component-discount' ||
        m.stage === 'increase-component-discount') {
      if (m.target.kind !== 'component') fail('component discount has invalid target');
      const componentId = m.target.componentId;
      const c = components.find(c => c.id === componentId);
      if (!c || m.stage === 'additional-component-discount' && c.kind !== 'additional' ||
          m.stage === 'increase-component-discount' && c.kind !== 'increase' ||
          m.stage === 'component-discount' && c.kind !== 'base')
        fail('discount references unknown or wrong-kind component');
      before = c.cost;
      after = discounted(before, m.reduction);
      c.cost = after;
    } else {
      if (!total) total = sumCosts(components.map(c => c.cost));
      before = total;
      after = m.stage === 'total-discount' ? discounted(before, m.reduction) :
        m.operation === 'replace-total' ? m.cost : { energy: 0, power: [] };
      total = after;
    }
    // Deliberately conservative P3 policy: every intermediate combined total must fit a safe
    // integer, EVEN immediately before a local component discount or a later total rewrite.
    // No later reduction may hide an overflow; this can reject an otherwise representable
    // mathematical result but will never undercharge due to floating-point precision loss.
    sumCosts(components.map(c => c.cost));
    if (total) cost(total);
    applications.push(Object.freeze({ modifierId: m.id, sourceProofId: m.sourceProofId,
      stage: m.stage, target: Object.freeze({ ...m.target }), before: freezeCost(before), after: freezeCost(after) }));
  }
  if (state.poisoned.has(transaction)) fail('transaction reentered during source verification');
  const result = Object.freeze({ finalResolvedCost: freezeCost(total ?? sumCosts(components.map(c => c.cost))),
    baseCost: freezeCost(baseCost), baseProofId, coverageProofId, applications: Object.freeze(applications) });
  state.completed.add(transaction);
  return result;
  } catch (error) {
    // Known validation errors carry fixed diagnostic codes only. Never return a foreign
    // exception (Proxy traps, callbacks, etc.) with private message, cause or stack.
    if (error instanceof CostResolverError) throw error;
    fail('invalid input snapshot');
  } finally {
    state.inFlight.delete(transaction);
  }
}
