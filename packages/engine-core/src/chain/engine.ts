import type { Condition } from '@riftbound/card-dsl';
import { performingEffect } from '../events/effect-actor.js';
import type { LocationFilter } from '@riftbound/card-dsl';
import type { ActionOutcome, ContractGameAction, GameAction, Instruction, ObjectRef, ObjectSnapshot, PlayerId, PowerPaymentSource, ResolveContext, Value } from '../effects/contract.js';
import { AwaitChoice } from '../effects/contract.js';
import { CONTRACT_ACTION_CAPABILITY_VERSION } from '../effects/contract.js';
import type { ExecutionOutcome } from '../effects/interpreter.js';
import { resolveChainBody } from './interpreter-adapter.js';
import { buildCostPlan } from '../cost/cost-plan.js';
import { assessCostPayment, payCostPlan } from '../cost/payment.js';
import { CostPlanError, type CostComponentInput, type CostPlan, type CostPlanInput, type CostPaymentReceipt } from '../cost/plan-types.js';
import { finalizeTargetPlan, resolveTargetPlan, TargetSelectionError, type TargetFinalizeOptions, type TargetPlan, type TargetRequirement } from '../target/target-plan.js';
import { LayerEngine, derivedLayerEpoch, hostObjectGeneration } from '../layers/engine.js';
import { matchesObjectFilter } from '../layers/filter.js';
import { actionTimings, canAct as canActByRules, playLocations, restrictions as ruleRestrictions } from '../layers/rules/query.js';
import type { RegisteredContinuousEffect } from '../layers/types.js';
import { literal, record } from '../programs/static-adapters/model.js';
import { locationPermissionMatches, playPermissionAllows } from '../programs/play-permissions.js';
import { EventPipeline } from '../events/pipeline.js';
import { evaluateAcceleratePayment } from '../effects/keywords/Accelerate.js';
import { triggerEventObjectBinding, type PipelineHost, type ReplacementCostEvidence, type TimingEmission, type TriggerRegistration, type TriggerSnapshot } from '../events/pipeline-types.js';
import type { TimingPointId } from '../events/timing-points.js';
import { bindResolveContext } from '../events/action-adapter.js';
import { deriveMightChangedEmissions } from '../events/producers/might-change.js';
import { finalizeOrderedPickPlans, lockedOrderedPicks, type OrderedPickPlan } from './picks/plan.js';
import { choicePlanAnswers, ChoicePlanError, type ChoicePlan } from './finalize/choices.js';
import { ChoiceMemory } from './finalize/choice-memory.js';
import { controlNodeTargetRequirements, finalizeCostPlanInput, finalizeInstructionChoices, finalizeInstructionInstances, hasChoiceMemory, hasFinalizeChoices, instancePathKey, withFinalizePlanLinks } from './finalize/index.js';
import { collectTargetTaxes } from '../target/tax/index.js';
import { boundTargetTaxes, ignoresTargetTax, staticCostSources } from '../programs/static-adapters/capabilities.js';
import { finalizeCostPlan, type CostDiscountSources, type FinalizedCardPlay, type StaticCostAbility } from '../cost/discounts/index.js';
import { bindWeaponmasterNoEquipPolicy } from '../effects/instructions/cost.modify.js';

function chainDraftPrefix(item: ChainDraft, turn: number): string {
  const source = item.trigger?.source.ref ?? item.source.ref;
  return [item.id, turn, item.controller, source.id, source.zoneEntryId].join('\u0000');
}

export type ChainSpeed = 'normal' | 'action' | 'reaction';
export type ChainKind = 'spell' | 'unit' | 'gear' | 'activated' | 'triggered' | 'add';
export interface ChainDraft {
  readonly id: string;
  readonly controller: PlayerId;
  readonly source: ObjectSnapshot;
  readonly kind: ChainKind;
  readonly speed?: ChainSpeed;
  readonly body: readonly Instruction[];
  readonly cost?: CostPlanInput;
  /** The played card's own "this costs" statics, collected at Finalize (CR 356). */
  readonly costStatics?: readonly StaticCostAbility[];
  readonly targets?: readonly { readonly requirement: TargetRequirement; readonly options?: Omit<TargetFinalizeOptions, 'isPending' | 'onTargetsFinalized' | 'onTargeted' | 'taxAdapter'> }[];
  readonly requirements?: readonly Condition[];
  readonly restrictions?: readonly Condition[];
  readonly conditionalReaction?: Condition;
  readonly location?: Extract<GameAction, { type: 'play' }>['location'];
  readonly trigger?: TriggerSnapshot;
  readonly mayAtFinalize?: boolean;
}
export interface FinalizeExtensionContext {
  readonly chainItemId: string;
  readonly turn: number;
  readonly controller: PlayerId;
  readonly source: ObjectSnapshot;
  /** Instruction path plus repeat index, encoded as UTF-8 URI path segments. */
  readonly instancePath: readonly string[];
  readonly instanceKey: string;
  readonly context: ResolveContext;
  /** Stable root for every request/result owned by this instance. */
  readonly receiptPrefix: string;
}
export interface FinalizeExtensionReceipt {
  readonly key: string;
  readonly value: Value;
}
export interface FinalizeExtensionResult {
  /** Each receipt key is owned by this exact instruction/repeat instance. */
  readonly receipts?: readonly FinalizeExtensionReceipt[];
}
  /**
   * Additive semantic adapter owned by the named/ShowOff primitive owner.
   * Chain supplies only scope, rollback and replay; the extension owns all
   * trusted catalogs, receipts and object-condition semantics.
   */
export interface FinalizeInstructionExtension {
  readonly op: string;
  evaluate(input: FinalizeExtensionContext): FinalizeExtensionResult;
}
/** Authoritative identity for one parent Pay Costs suspension point. */
export interface PaymentContinuationSnapshot {
  readonly contract: 'riftbound.chain.payment-continuation.v1';
  readonly continuationId: string;
  readonly itemId: string;
  readonly epoch: string;
  /** Digest of the frozen parent, choices, targets and cost-plan content. */
  readonly digest: string;
  readonly turn: number;
  readonly payer: PlayerId;
  readonly source: ObjectRef;
  readonly costPlanId: string;
}

/** Opaque in-process authority. JSON clones are deliberately not restartable. */
export interface PaymentContinuation {
  readonly snapshot: PaymentContinuationSnapshot;
}

export interface PaymentContinuationExecutionOptions {
  /** Exact current player and source incarnation supplied by the authority owner. */
  readonly payer: PlayerId;
  readonly source: ObjectRef;
  /** A Reaction Add draft. Resume revalidates its actor/source against the handle. */
  readonly add: ChainDraft;
}

export interface PaymentContinuationResult {
  readonly continuationId: string;
  readonly epoch: string;
  readonly itemId: string;
  readonly add: PaymentReactionAddReceipt;
  readonly payment: CostPaymentReceipt;
}

export interface PaymentReactionAddReceipt {
  readonly itemId: string;
  readonly outcome: ExecutionOutcome;
  readonly resources: { readonly energy: number; readonly power: readonly PowerPaymentSource[] };
  readonly receipt: {
    readonly instructionId: string;
    readonly value: { readonly energy: number; readonly power: readonly PowerPaymentSource[] };
  };
  readonly cost: CostPaymentReceipt;
}

/** The host journals/rebuilds this JSON-safe notice; it carries no capability. */
export interface PaymentContinuationHostPort {
  /**
   * Journal this exact JSON-safe notice and return true only after it is
   * durable. The notice is comparison data; it never becomes a capability.
   * After rebuilding the same command through this Chain, the host passes the
   * journaled notice to restorePaymentContinuationHandle for equality checks.
   */
  persist(notice: PaymentContinuationSnapshot): boolean;
}

interface PaymentContinuationBinding {
  readonly notice: PaymentContinuationSnapshot;
  readonly checkpoint: unknown;
  readonly owner: ChainEngine;
  state: 'suspended' | 'live' | 'consumed';
}

interface TurnFinalizeRecord extends FinalizedCardPlay {
  readonly turn: number;
  readonly sequence: number;
  readonly finalizedAt: 'chain-item-finalize';
}

const PAYMENT_CONTINUATION_BINDINGS = new WeakMap<PaymentContinuation, PaymentContinuationBinding>();

/** Canonical, content-sensitive serialization used only for payment identity. */
function paymentContinuationContent(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === 'bigint') return `bigint:${value}`;
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (seen.has(value)) throw new TypeError('Payment continuation content must be acyclic');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `array:[${value.map(entry => paymentContinuationContent(entry, seen)).join(',')}]`;
    if (value instanceof Map) return `map:[${[...value.entries()]
      .map(([key, entry]) => `${paymentContinuationContent(key, seen)}=>${paymentContinuationContent(entry, seen)}`)
      .sort().join(',')}]`;
    if (value instanceof Set) return `set:[${[...value]
      .map(entry => paymentContinuationContent(entry, seen)).sort().join(',')}]`;
    const record = value as Readonly<Record<string, unknown>>;
    return `object:{${Object.keys(record).sort()
      .map(key => `${JSON.stringify(key)}:${paymentContinuationContent(record[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function paymentContinuationDigest(content: unknown): string {
  return `sha256:${sha256(paymentContinuationContent(content))}`;
}

const PAYMENT_DIGEST_ROUNDS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function paymentRotateRight(value: number, count: number): number {
  return value >>> count | value << (32 - count);
}

/** Small dependency-free SHA-256 for the JSON-safe continuation identity. */
function sha256(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = BigInt(bytes.length) * 8n;
  view.setUint32(padded.length - 8, Number(bits >> 32n & 0xffffffffn));
  view.setUint32(padded.length - 4, Number(bits & 0xffffffffn));
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Array<number>(64);
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const first = words[index - 15]!, second = words[index - 2]!;
      words[index] = (words[index - 16]! +
        (paymentRotateRight(first, 7) ^ paymentRotateRight(first, 18) ^ first >>> 3) +
        words[index - 7]! +
        (paymentRotateRight(second, 17) ^ paymentRotateRight(second, 19) ^ second >>> 10)) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index++) {
      const sum1 = paymentRotateRight(e, 6) ^ paymentRotateRight(e, 11) ^ paymentRotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sum1 + choice + PAYMENT_DIGEST_ROUNDS[index]! + words[index]!) >>> 0;
      const sum0 = paymentRotateRight(a, 2) ^ paymentRotateRight(a, 13) ^ paymentRotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => { hash[index] = (hash[index]! + value) >>> 0; });
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

function paymentContinuationNoticeEqual(
  left: PaymentContinuationSnapshot,
  right: PaymentContinuationSnapshot,
): boolean {
  return left.contract === right.contract && left.continuationId === right.continuationId &&
    left.itemId === right.itemId && left.epoch === right.epoch && left.digest === right.digest &&
    left.turn === right.turn && left.payer === right.payer && left.costPlanId === right.costPlanId &&
    left.source.id === right.source.id && left.source.zoneEntryId === right.source.zoneEntryId;
}

function paymentContinuationAuthority(input: {
  readonly itemId: string;
  readonly payer: PlayerId;
  readonly source: ObjectRef;
  readonly costPlanId: string;
  readonly checkpoint: unknown;
  readonly turn: number;
  readonly digest: string;
  readonly owner: ChainEngine;
}): PaymentContinuation {
  const snapshot = Object.freeze({
    contract: 'riftbound.chain.payment-continuation.v1' as const,
    continuationId: `payment-continuation:${input.digest}`, itemId: input.itemId,
    epoch: `${input.itemId}\u0000${input.source.id}\u0000${input.source.zoneEntryId}\u0000${input.costPlanId}\u0000${input.turn}\u0000${input.digest}`,
    digest: input.digest,
    turn: input.turn, payer: input.payer,
    source: Object.freeze({ id: input.source.id, zoneEntryId: input.source.zoneEntryId }),
    costPlanId: input.costPlanId,
  });
  const handle = Object.freeze({ snapshot }) as PaymentContinuation;
  PAYMENT_CONTINUATION_BINDINGS.set(handle, {
    notice: snapshot, checkpoint: input.checkpoint, owner: input.owner, state: 'suspended',
  });
  return handle;
}

function paymentContinuationBinding(handle: unknown): PaymentContinuationBinding | null {
  return handle !== null && typeof handle === 'object'
    ? PAYMENT_CONTINUATION_BINDINGS.get(handle as PaymentContinuation) ?? null : null;
}

function paymentReactionAddReceipt(
  events: readonly import('../events/pipeline-types.js').PipelineEvent[],
  item: ChainItem,
  outcome: ExecutionOutcome,
  itemId: string,
  draft: ChainDraft,
): PaymentReactionAddReceipt {
  const linkedId = draft.body.length === 1 ? `${encodeURIComponent(draft.body[0]!.id)}.resources` : 'resources';
  const linked = outcome.linkedValues[linkedId] ?? outcome.linkedValues.resources;
  const links = linked !== null && typeof linked === 'object' && !Array.isArray(linked)
    ? linked as Readonly<Record<string, Value>> : null;
  const resourceResult = outcome.results.find(result => result.op === 'effect.resources')?.result;
  const resultValue = resourceResult?.status === 'executed' ? resourceResult.linkedValues?.resources : undefined;
  const result = resultValue !== null && typeof resultValue === 'object' && !Array.isArray(resultValue)
    ? resultValue as Readonly<Record<string, Value>> : null;
  if (result === null) throw new Error('Reaction Add lacks an executed resource instruction receipt');
  const energy = result.energy;
  const power = result.power;
  if (typeof energy !== 'number' || !Number.isSafeInteger(energy) || energy < 0 || !Array.isArray(power) ||
      power.some(value => typeof value !== 'string')) {
    throw new Error('Reaction Add resource receipt is malformed');
  }
  const actual = { energy, power: power as readonly PowerPaymentSource[] };
  const linkedEnergy = typeof links?.energy === 'number' && Number.isSafeInteger(links.energy) ? links.energy : null;
  const linkedPower = Array.isArray(links?.power)
    ? links.power.filter((value): value is PowerPaymentSource => typeof value === 'string') as readonly PowerPaymentSource[] : null;
  const linkedMatches = linkedEnergy === null || linkedPower === null
    ? false
    : linkedEnergy === actual.energy && linkedPower.length === actual.power.length &&
      linkedPower.every((value, index) => value === actual.power[index]);
  if (actual.energy + actual.power.length === 0 || (links !== null && !linkedMatches)) {
    throw new Error('Reaction Add must publish exactly the real resource gain');
  }
  const resourceEvents = events.filter(event =>
    (typeof event.action === 'string' ? event.action : event.action?.type) === 'gain-energy' ||
    (typeof event.action === 'string' ? event.action : event.action?.type) === 'gain-power');
  return Object.freeze({
    itemId,
    outcome: Object.freeze({ ...outcome, events: resourceEvents.length > 0 ? Object.freeze(resourceEvents) : outcome.events }),
    resources: Object.freeze({ energy: actual.energy, power: Object.freeze(actual.power) }),
    receipt: Object.freeze({
      instructionId: draft.body.length === 1 ? draft.body[0]!.id : 'resources',
      value: Object.freeze({ energy: actual.energy, power: Object.freeze(actual.power) }),
    }),
    cost: item.payment ?? (() => { throw new Error('Reaction Add has no finalized payment receipt'); })(),
  });
}


export interface ChainItem extends ChainDraft {
  status: 'pending' | 'finalized';
  object: ObjectRef;
  targetPlans: TargetPlan[];
  pickPlans?: readonly OrderedPickPlan[];
  costPlan?: CostPlan;
  payment?: CostPaymentReceipt;
  choicePlan?: ChoicePlan;
  finalizeLinks?: Readonly<Record<string, Readonly<Record<string, Value>>>>;
  costInput?: CostPlanInput;
  /** Number of paid whole-body Repeat executions whose targets were locked. */
  repeatTargetCount?: number;
}
export interface ChainTrace {
  readonly step: string;
  readonly item?: string;
  readonly player?: string | null;
  readonly reason?: string;
  readonly timingPoint?: TimingPointId;
}
export interface ChainEngineOptions {
  readonly turnOrder: readonly PlayerId[];
  readonly turnPlayer: PlayerId;
  readonly phase?: string;
  readonly host: PipelineHost;
  /** Required rules task; it must perform changes through engine.commit(). */
  readonly cleanup: (engine: ChainEngine) => boolean;
  readonly layers?: LayerEngine;
  readonly describePlay?: (action: Extract<GameAction, { type: 'play' }>, source: ObjectSnapshot) => ChainDraft;
  readonly finalizeExtensions?: readonly FinalizeInstructionExtension[];
  /**
   * Trusted production host: receives a JSON-safe notice and journals it.
   * The Chain keeps the actual checkpoint privately for its own journal replay.
   */
  readonly paymentContinuation?: PaymentContinuationHostPort;
}

/**
 * The only Resolve failure Chain can turn into a no-attachment completion.
 * Requiring the exact expanded Weaponmaster body plus its locked target keeps
 * ordinary cannot-pay failures exceptional.
 */
function isWeaponmasterUnpayableResolve(item: ChainItem, error: unknown): boolean {
  return error instanceof CostPlanError && error.reason === 'cannot-pay-cost' && isWeaponmasterResolveShape(item);
}

/**
 * A leading-may Triggered Ability is already on the Chain. If its cost within
 * instructions has no legal object choice while Finalize locks the receipt,
 * CR 403.4 removes the Triggered Ability instead of treating the authored
 * choice as a malformed cost plan. Keep this narrow: direct Card Plays and
 * every other invalid plan retain their existing CostPlanError contract.
 */
function isUnpayableFinalizeMayCost(item: ChainItem, error: unknown): boolean {
  return item.kind === 'triggered' && item.mayAtFinalize === true &&
    error instanceof CostPlanError && error.reason === 'invalid-cost-plan' &&
    error.message === 'Cost choice cannot be completed from the current zone';
}

function isWeaponmasterResolveShape(item: ChainItem): boolean {
  if (item.source.cardId !== 'card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef' ||
      item.kind !== 'triggered' || item.body.length !== 1 || item.body[0]?.op !== 'sequence' ||
      !item.targetPlans.some(plan => plan.requirement.id === 'weaponmaster-equipment' && plan.selected.length === 1)) {
    return false;
  }
  const body = item.body[0].args.body;
  if (body === undefined || (body.kind !== 'constant' && body.kind !== 'literal') || !Array.isArray(body.value)) return false;
  return body.value.some(candidate => candidate.id === 'weaponmaster-cost' && candidate.op === 'cost.modify') &&
    body.value.some(candidate => candidate.id === 'weaponmaster-pay' && candidate.op === 'cost.pay') &&
    body.value.some(candidate => candidate.id === 'weaponmaster-attach' && candidate.op === 'effect.attach');
}

/**
 * Recognise the authored form `effect.exhaust source -> linked effect.channel`.
 * Its exact argument/payment shape is required so this adapter cannot silently
 * reinterpret an unrelated trigger or a different exhaust effect.
 */
function leadingSourceExhaustShape(body: readonly Instruction[]): string | undefined {
  const [first, second] = body;
  if (first?.op !== 'effect.exhaust' || first.condition !== undefined || first.targets !== undefined ||
      first.picks !== undefined || first.locations !== undefined || first.linkedTo !== undefined) return undefined;
  const args = first.args as Readonly<Record<string, { readonly kind?: unknown; readonly value?: unknown }>>;
  if (Object.keys(args).length !== 1 || args.target?.kind !== 'constant' || args.target.value !== 'source' ||
      second?.op !== 'effect.channel' || second.linkedTo !== first.id) return undefined;
  const channel = second.args as Readonly<Record<string, { readonly kind?: unknown; readonly value?: unknown }>>;
  if (channel.amount?.kind !== 'constant' || channel.amount.value !== 1 ||
      channel.exhausted?.kind !== 'constant' || channel.exhausted.value !== true) return undefined;
  return first.id;
}

/**
 * CR 383.3.a/383.3.a.2 decides the leading may at Finalize. CR 383.3.b/
 * 383.3.b.1 then makes the immediately following "exhaust me" its base cost.
 * Move that authored instruction into the Chain item's cost and remove the
 * paid `linkedTo` gate before Resolve; a failed Finalize cannot reach Resolve.
 * Keep the raw registration unchanged so program registration remains a pure
 * compile/bind view until an actual Chain item needs Finalize semantics.
 */
function chainTriggerDraft(registration: TriggerRegistration): ChainDraft {
  const base: ChainDraft = {
    id: '', controller: registration.controller, source: registration.source,
    kind: 'triggered', body: registration.body, cost: registration.cost,
    targets: registration.targets, mayAtFinalize: registration.mayAtFinalize,
  };
  if (registration.optional !== true || registration.mayAtFinalize === true) return base;
  const paidId = leadingSourceExhaustShape(registration.body);
  if (paidId === undefined) return base;
  return {
    ...base,
    mayAtFinalize: true,
    cost: {
      id: 'cost:leading-source-exhaust',
      cost: { kind: 'activated', payments: [{ kind: 'exhaust', object: 'self' }] },
    },
    body: registration.body.slice(1).map(instruction => instruction.linkedTo === paidId
      ? Object.fromEntries(Object.entries(instruction).filter(([key]) => key !== 'linkedTo')) as unknown as Instruction
      : instruction),
  };
}

function paysLeadingSourceExhaustDuringFinalize(item: ChainItem): boolean {
  return item.kind === 'triggered' && item.trigger !== undefined && item.cost?.id === 'cost:leading-source-exhaust' &&
    item.source.zone === 'legend' && item.body.length > 0 &&
    item.trigger.registration.body.some(instruction => instruction.op === 'effect.exhaust');
}

/**
 * CR 107 includes the Legend Zone in the Board. The generic cost evaluator's
 * exhaust check predates that zone spelling and accepts only `board` and
 * `rune-zone`; expose the exact Legend source as Board only inside this
 * Finalize payment read. The submitted action and state owner still receive the
 * exact authoritative Legend ref and mutate the real host object.
 */
function boardViewForLegendExhaustCost(context: ResolveContext, source: ObjectSnapshot): ResolveContext {
  return bindResolveContext(context, {
    object: ref => {
      const object = context.object(ref);
      return object !== null && object.ref.id === source.ref.id &&
        object.ref.zoneEntryId === source.ref.zoneEntryId && object.zone === 'legend'
        ? { ...object, zone: 'board' }
        : object;
    },
  });
}

/** RIFT-999 debug: report the first field where a cached layered view differs from a fresh pass. */
function assertSameLayerView(kind: string, memo: readonly ObjectSnapshot[], fresh: readonly ObjectSnapshot[]): void {
  const index = (view: readonly ObjectSnapshot[]) => new Map(view.map(object => [`${object.ref.id}:${object.ref.zoneEntryId}`, object]));
  const a = index(memo); const b = index(fresh);
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) as Record<string, unknown> | undefined; const y = b.get(key) as Record<string, unknown> | undefined;
    if (!x || !y) throw new Error(`RIFT-999 ${kind} layer memo drifted: object ${key} ${x ? 'missing from fresh' : 'missing from memo'}`);
    for (const field of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (JSON.stringify(x[field]) !== JSON.stringify(y[field])) {
        throw new Error(`RIFT-999 ${kind} layer memo drifted: ${key}.${field} memo=${JSON.stringify(x[field])?.slice(0, 200)} fresh=${JSON.stringify(y[field])?.slice(0, 200)}`);
      }
    }
  }
}

/**
 * RIFT-999: monotonic epoch bumped around every host write or rollback routed
 * through a ChainEngine (execute, contract execution, restore, atomic
 * rollback). Module-level so an Object.assign rollback of engine fields can
 * never rewind it and revive a stale cached layered view.
 */
let hostWriteEpoch = 0;

/** Run a host write so any stable layered view taken before or during it is discarded. */
function hostWrite<T>(write: () => T): T {
  hostWriteEpoch++;
  try { return write(); } finally { hostWriteEpoch++; }
}

/** Route a host-provided ResolveContext's direct writes through hostWrite. */
function countHostWrites(context: ResolveContext): ResolveContext {
  return new Proxy(context, { get: (target, key) => {
    const value = Reflect.get(target, key);
    if (key === 'perform' && typeof value === 'function') {
      return (...args: unknown[]) => hostWrite(() => (value as (...input: unknown[]) => unknown).apply(target, args));
    }
    if (key === 'contractActions' && value !== undefined && value !== null) {
      const capability = value as NonNullable<ResolveContext['contractActions']>;
      return { ...capability, perform: (action: Parameters<typeof capability.perform>[0]) => hostWrite(() => capability.perform(action)) };
    }
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

/** Debug switch for RIFT-999's stable layered-view cache; inert outside Node. */
function layerMemoCheck(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.RIFT_LAYER_MEMO_CHECK === '1';
}

/** The new rules layer. Legacy duel runtimes deliberately do not call it yet. */
export class ChainEngine {
  readonly pipeline: EventPipeline;
  private readonly chainHost: PipelineHost;
  readonly layers: LayerEngine;
  private entries: ChainItem[] = [];
  /** A nested Play remains Pending while its parent Resolve is in progress (CR 354.3). */
  private parentResolveDepth = 0;
  private issued = new Set<string>();
  private traces: ChainTrace[] = [];
  private outstanding: string[] = [];
  private cleanupNeeded = false;
  private busy: 'idle' | 'cleanup' | 'finalize' | 'resolve' = 'idle';
  private priorityHolder: PlayerId | null = null;
  private focusHolder: PlayerId | null = null;
  private showdown = false;
  private origin: ChainKind | null = null;
  private priorityPasses = 0;
  private focusPasses = 0;
  private triggerSequence = 0;
  private delayedSequence = 0;
  private transactionDepth = 0;
  /** Successful card Finalizes in the pipeline's current turn (CR 420.4.b / 812.1.c). */
  private finalizedPlaysThisTurn: TurnFinalizeRecord[] = [];
  private finalizeSequence = 0;
  private readonly choiceMemory = new ChoiceMemory();
  private finalizeAnswers = new Map<string, unknown>();
  private paymentContinuation: PaymentContinuation | null = null;
  private paymentContinuationCheckpoint: unknown = null;
  private paymentSuspended = false;
  private resumingPaymentContinuation = false;
  private readonly consumedPaymentContinuations = new Set<string>();
  private readonly suspendedPaymentContinuations = new Map<string, PaymentContinuation>();
  private readonly combatRoles = new Map<string, 'attacker' | 'defender'>();
  private readonly battlefieldControllers = new Map<string, PlayerId | null>();
  private activeCombatId: string | null = null;
  private activeCombatBattlefieldId: string | null = null;
  private activeCombatAttackerId: PlayerId | null = null;
  private activeCombatDefenderId: PlayerId | null = null;
  private hostReadSnapshot: readonly ObjectSnapshot[] | undefined;
  private phase: string;
  constructor(private readonly options: ChainEngineOptions) {
    this.phase = options.phase ?? 'main';
    this.layers = options.layers ?? new LayerEngine(this.hostObjects());
    const chainHost: PipelineHost & {
      finalizedCardPlaysThisTurn: () => readonly FinalizedCardPlay[];
    } = {
      ...options.host,
      checkpoint: () => options.host.checkpoint(),
      restore: checkpoint => { hostWriteEpoch++; options.host.restore(checkpoint); },
      choose: request => options.host.choose(request),
      objects: () => this.layerObjects(),
      context: (source, controller, at) => this.hostObjectContext(source, controller, at),
      finalizedCardPlaysThisTurn: () => this.finalizedPlaysThisTurn,
      execute: action => this.executeHostAction(action),
      ...(options.host.executeContract === undefined ? {} : {
        executeContract: (action: Parameters<NonNullable<PipelineHost['executeContract']>>[0]) =>
          hostWrite(() => options.host.executeContract!(action)),
      }),
      // A confirmed Kill writes the host before, during (replacements already
      // applied when the boundary callback runs) and after its boundary.
      ...(options.host.deathBoundary === undefined ? {} : (() => {
        const boundary = options.host.deathBoundary;
        return { deathBoundary: {
          version: boundary.version,
          execute: (action: Parameters<typeof boundary.execute>[0], callback: Parameters<typeof boundary.execute>[1]) =>
            this.executeDeathBoundary(boundary.execute.bind(boundary), action, callback),
          executeContract: (action: Parameters<typeof boundary.executeContract>[0], callback: Parameters<typeof boundary.executeContract>[1]) =>
            this.executeDeathBoundary(boundary.executeContract.bind(boundary), action, callback),
        } };
      })()),
    };
    this.chainHost = chainHost;
    this.pipeline = new EventPipeline(this.chainHost, options.turnOrder, options.turnPlayer);
    const scanChoose = this.pipeline.host.choose;
    this.pipeline.host.choose = <T>(request: import('../effects/contract.js').ChoiceRequest<T>): T => {
      if (request.type === 'optional' && request.id.startsWith('trigger:') && request.id.endsWith(':optional')) {
        const eventId = request.id.split(':')[1];
        const occurrence = request.id.split(':').at(-2);
        const owned = this.pipeline.registeredTriggers().some(candidate =>
          request.id === `trigger:${eventId}:${candidate.id}:${occurrence}:optional` &&
          leadingSourceExhaustShape(candidate.body) !== undefined);
        // CR 383.3.a: admit the verified shape to Pending. Its single optional
        // choice is performed during Finalize by acceptAtFinalize below.
        if (owned) return true as T;
      }
      return scanChoose(request);
    };
    this.pipeline.routeAction = action => {
      if (action.type === 'play') {
        const source = options.host.objects().find(object => object.ref.id === action.object.id && object.ref.zoneEntryId === action.object.zoneEntryId);
        if (!source || !options.describePlay) throw new Error('Play action requires a card-program adapter');
        let draft = options.describePlay(action, source);
        if (draft.controller !== action.player || draft.source.ref.id !== source.ref.id || draft.source.ref.zoneEntryId !== source.ref.zoneEntryId) throw new Error('Card-program adapter returned a mismatched play');
        if (action.cost) {
          const cost = action.cost;
          if (cost.finalized !== true) throw new Error('Effect Play requires a finalized cost override');
          draft = { ...draft, cost: { id: `effect-cost:${draft.id}`, cost: {
            energy: { kind: 'constant', value: cost.energy ?? 0 }, power: { kind: 'constant', value: cost.power ?? [] },
            payments: [
              ...(cost.xp ? [{ kind: 'xp', amount: { kind: 'constant' as const, value: cost.xp } }] : []),
              ...(cost.exhaust ?? []).map(object => ({ kind: 'exhaust', object })),
              ...(cost.recycle ?? []).map(object => ({ kind: 'recycle', object }))
            ]
          } } };
        }
        this.appendCard(draft);
        return { outcome: { status: 'done', events: [] }, emissions: [] };
      }
      if (action.type === 'counter') {
        const item = this.entries.find(entry => entry.status === 'finalized' && entry.object.id === action.object.id && entry.object.zoneEntryId === action.object.zoneEntryId);
        if (!item) return { outcome: { status: 'impossible', events: [] }, emissions: [] };
        const execution = ['unit', 'gear', 'spell'].includes(item.kind) ? this.executeStateAction(action) : { outcome: { status: 'done' as const, events: [] }, emissions: [] };
        if (execution.outcome.status === 'done') this.remove(item, 'countered');
        return execution;
      }
      return undefined;
    };
    this.pipeline.onTrigger = trigger => {
      this.append({
        ...chainTriggerDraft(trigger.registration),
        id: `trigger:${++this.triggerSequence}`,
        controller: trigger.controller,
        source: trigger.source,
        trigger,
      });
    };
    this.pipeline.onEvent = event => {
      if (event.timingPoint === 'turn-start') this.finalizedPlaysThisTurn = [];
      this.observeCombatRoleEvent(event);
      this.observeBattlefieldControl(event);
      this.layers.setObjects(this.hostObjects());
      this.layers.advance({ id: event.timingPoint, player: event.player });
      this.record({ step: 'event', timingPoint: event.timingPoint });
    };
    this.grantIdle();
  }
  /** Seed setup-time control; runtime changes remain driven by committed events. */
  initializeBattlefieldControl(fields: readonly { readonly id: string; readonly controller: PlayerId | null }[]): void {
    this.battlefieldControllers.clear();
    for (const field of fields) this.battlefieldControllers.set(field.id, field.controller);
  }
  /** Runtime projection used by TurnFlow when no event has established control yet. */
  setBattlefieldController(battlefieldId: string, controller: PlayerId | null): void {
    this.battlefieldControllers.set(battlefieldId, controller);
  }
  /** Whether setup state or a committed control event currently says this player controls the field. */
  controlsBattlefield(player: PlayerId, battlefieldId: string): boolean {
    return this.battlefieldControllers.get(battlefieldId) === player;
  }
  /** Authoritative successful card-Finalize history for the current pipeline turn. */
  finalizedCardPlaysThisTurn(): readonly FinalizedCardPlay[] {
    return Object.freeze(this.finalizedPlaysThisTurn.map(record => structuredClone({
      object: record.object,
      player: record.player,
    })));
  }
  get items(): readonly ChainItem[] { return structuredClone(this.entries); }
  /** Apply only exact Unit combat roles held in this active Combat window. */
  combatRoleSnapshot(object: ObjectSnapshot): ObjectSnapshot {
    const role = this.combatRoles.get(`${object.ref.id}:${object.ref.zoneEntryId}`);
    return role === undefined || object.combatRole === role ? object : Object.freeze({ ...object, combatRole: role });
  }
  /** Read-only chain host view; static adapters may compose roles onto it. */
  hostObjects(): readonly ObjectSnapshot[] {
    const objects = this.hostReadSnapshot ?? this.options.host.objects();
    if (this.combatRoles.size === 0) return objects;
    return Object.freeze(objects.map(object => this.combatRoleSnapshot(object)));
  }
  /** Give every ResolveContext object read the same read-only designation view. */
  private hostObjectContext(source: ObjectSnapshot, controller: PlayerId, at: TimingPointId): ResolveContext {
    const base = countHostWrites(source.combatRole === null || source.combatRole === undefined
      ? this.options.host.context(source, controller, at)
      : bindResolveContext(this.options.host.context(source, controller, at), { source }));
    if (this.combatRoles.size === 0) return base;
    return new Proxy(base, { get: (target, key) => {
      if (key === 'object') return (ref: ObjectRef) => {
        const object = target.object(ref);
        if (object === null) return null;
        return this.combatRoleSnapshot(object);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  /** Project only CombatFlow's complete start/designation/end event window. */
  private observeCombatRoleEvent(event: import('../events/pipeline-types.js').PipelineEvent): void {
    if (event.timingPoint === 'combat-start') {
      const combatId = event.details?.combatId;
      const battlefieldId = event.details?.battlefieldId;
      const attackerId = event.details?.attackerId;
      const defenderId = event.details?.defenderId;
      if (typeof combatId !== 'string' || typeof battlefieldId !== 'string' ||
          typeof attackerId !== 'string' || typeof defenderId !== 'string') {
        this.combatRoles.clear();
        this.activeCombatId = null;
        return;
      }
      this.activeCombatId = combatId;
      this.activeCombatBattlefieldId = battlefieldId;
      this.activeCombatAttackerId = attackerId;
      this.activeCombatDefenderId = defenderId;
      this.combatRoles.clear();
      return;
    }
    if (event.timingPoint === 'attack-declared' || event.timingPoint === 'defense-declared') {
      if (this.activeCombatId === null || event.details?.combatId !== this.activeCombatId || event.object === undefined) return;
      this.combatRoles.set(`${event.object.ref.id}:${event.object.ref.zoneEntryId}`,
        event.timingPoint === 'attack-declared' ? 'attacker' : 'defender');
      return;
    }
    if (event.timingPoint === 'cleanup-end' && this.activeCombatId !== null) {
      this.combatRoles.clear();
      for (const object of this.hostObjects()) {
        if (object.zone !== 'board' || !object.types.includes('unit') ||
            object.location?.type !== 'battlefield' || object.location.id !== this.activeCombatBattlefieldId) continue;
        if (object.controller === this.activeCombatAttackerId) this.combatRoles.set(`${object.ref.id}:${object.ref.zoneEntryId}`, 'attacker');
        else if (object.controller === this.activeCombatDefenderId) this.combatRoles.set(`${object.ref.id}:${object.ref.zoneEntryId}`, 'defender');
      }
      return;
    }
    if (event.timingPoint === 'combat-end') {
      this.combatRoles.clear();
      this.activeCombatId = null;
      this.activeCombatBattlefieldId = null;
      this.activeCombatAttackerId = null;
      this.activeCombatDefenderId = null;
    }
  }
  private observeBattlefieldControl(event: import('../events/pipeline-types.js').PipelineEvent): void {
    if (event.timingPoint !== 'control-established' && event.timingPoint !== 'control-lost') return;
    const battlefieldId = event.details?.battlefieldId;
    if (typeof battlefieldId !== 'string') return;
    this.battlefieldControllers.set(battlefieldId,
      event.timingPoint === 'control-established' ? event.player ?? null : null);
  }
  private layerPassInFlight = false;
  private stableLayerDepth = 0;
  private hostViewAuthority?: { readonly objects: readonly ObjectSnapshot[]; readonly epoch: number; readonly ids: string };
  private stableLayerView: {
    readonly revision: number; readonly mutations: number; readonly epoch: number; readonly view: readonly ObjectSnapshot[];
  } | undefined;

  /**
   * RIFT-999: lifecycle and keyword re-expansion sweep every object and read
   * the layered host view once per object. Inside one synchronous sweep the
   * host objects do not change; only registrations do. Reuse the last complete
   * top-level layered view while neither the shared registry revision nor any
   * host write routed through this engine has changed, so a sweep costs one
   * layer pass instead of one per object. A registry write (a static bound
   * during the sweep) or a host write (an effect resolving inside an event
   * handler) invalidates the view immediately, and so does any change to
   * derived keyword-grant state (derivedLayerEpoch), which this view reads
   * while a keyword refresh is in progress.
   * Target planning and Resolve-time target revalidation use the same window:
   * enumerating legal candidates reads each candidate through the host but
   * changes neither objects nor registry.
   */
  withStableLayers<T>(run: () => T): T {
    this.stableLayerDepth++;
    try { return run(); } finally {
      if (--this.stableLayerDepth === 0) this.stableLayerView = undefined;
    }
  }
  private layerObjects(): readonly ObjectSnapshot[] {
    // RIFT-927: static/keyword adapters resolve live sources through the
    // pipeline host, which is this layered view. Re-entering it while a layered
    // pass is in flight used to re-set the layer engine objects (dropping
    // every cached group) and start another full pass at each nesting level,
    // which grew exponentially with the number of bound statics. A nested read
    // sees the same host state, so it evaluates on the in-flight engine without
    // resetting it: the layer engine dependency path (partial and group views,
    // cycle restart) then supplies the layered characteristics that conditions
    // and filters depend on, exactly as a direct nested evaluation does.
    if (this.layerPassInFlight) return this.layers.evaluateAll();
    // Any other read nested inside this engine's own evaluation keeps the
    // pre-memo reentrant semantics.
    if (this.layers.inEvaluation) return this.freshLayerObjects();
    const stable = this.stableLayerDepth > 0 ? this.stableLayerView : undefined;
    if (stable !== undefined && stable.revision === this.layers.registry.revision &&
        stable.mutations === hostWriteEpoch && stable.epoch === derivedLayerEpoch()) {
      if (layerMemoCheck()) assertSameLayerView('stable', stable.view, this.freshLayerObjects());
      return stable.view;
    }
    const view = this.freshLayerObjects();
    if (this.stableLayerDepth > 0) {
      this.stableLayerView = { revision: this.layers.registry.revision, mutations: hostWriteEpoch, epoch: derivedLayerEpoch(), view };
    }
    return view;
  }
  /** One complete top-level layered pass over the current host objects. */
  private freshLayerObjects(): readonly ObjectSnapshot[] {
    return this.layeredPass(() => this.layers.evaluateAll());
  }
  /**
   * Run a read against this engine's layers as one layered pass: set the
   * objects once at the top level, and let reads nested inside the pass
   * (live sources resolved through the pipeline host) evaluate on the
   * in-flight engine instead of resetting it (RIFT-927, RIFT-999).
   */
  private layeredPass<T>(read: () => T): T {
    if (this.layerPassInFlight) return read();
    this.layerPassInFlight = true;
    const hostView = this.options.host.objects();
    this.hostReadSnapshot = hostView;
    const mappedView = this.hostObjects();
    // A completed plan belongs to the exact host generation from which it was
    // built. A fresh `setObjects` and full pass must occur before the key can
    // be compared, while a later pass over the same generation may reuse it.
    try {
      const prior = this.hostViewAuthority;
      const sameHostGeneration = prior !== undefined && !prior.ids.startsWith('mutable:') && prior.epoch === hostWriteEpoch &&
        prior.objects.length === hostView.length && prior.objects.every((object, index) => object === hostView[index]);
      const authority = sameHostGeneration ? prior.ids : this.commandAuthority(hostView);
      if (!sameHostGeneration) this.hostViewAuthority = { objects: Object.freeze([...hostView]), epoch: hostWriteEpoch, ids: authority };
      this.layers.setCommandPlanAuthority(authority);
      this.layers.rearmCommandPlan();
      this.layers.setObjects(mappedView, true);
      return read();
    } finally {
      this.layerPassInFlight = false;
      this.hostReadSnapshot = undefined;
    }
  }
  private commandAuthority(hostView: readonly ObjectSnapshot[]): string {
    // Production hosts retain one deeply frozen object identity per write.
    // Mutable fixtures fail closed with a fresh generation on every read.
    const combatRoles = this.combatRoles.size === 0
      ? ''
      : JSON.stringify([...this.combatRoles.entries()].sort(([left], [right]) => left.localeCompare(right)));
    return `${hostObjectGeneration(hostView)}:${combatRoles}`;
  }
  private executeStateAction(action: GameAction) {
    const key = (object: ObjectSnapshot) => JSON.stringify(object.ref);
    const before = new Map(this.layerObjects().map(object => [key(object), object]));
    hostWriteEpoch++;
    const execution = this.options.host.execute(action);
    hostWriteEpoch++;
    const after = new Map(this.layerObjects().map(object => [key(object), object]));
    const snapshot = (object: ObjectSnapshot | undefined, previous = false) => object ? (previous ? before.get(key(object)) : after.get(key(object))) ?? before.get(key(object)) ?? object : undefined;
    return { ...execution, emissions: execution.emissions.map(event => {
      const leaving = event.timingPoint.startsWith('object-leaves-') || event.timingPoint === 'object-killed';
      return {
        ...event,
        object: snapshot(event.object, leaving),
        ...(event.it === undefined ? {} : { it: snapshot(event.it, leaving) }),
        source: snapshot(event.source, true),
        target: snapshot(event.target),
      };
    }) };
  }
  /**
   * The adapter's confirmed-Kill callback runs after replacements but before
   * Trash. Freeze the complete layered Board view at that exact boundary and
   * use it only for death and leave timings (CR 383.2.c.3.b, 429.1.a.1.b,
   * 708, 710, 808.1.d.3). Ordinary action emissions keep their existing path.
   */
  private executeDeathBoundary<
    Action,
    Callback extends (context: import('../events/pipeline-types.js').PipelineDeathBoundaryContext) => void,
    Execution extends { readonly emissions: readonly TimingEmission[] },
  >(
    invoke: (action: Action, callback: Callback) => Execution,
    action: Action,
    callback: Callback,
  ): Execution {
    const key = (object: ObjectSnapshot) => JSON.stringify(object.ref);
    let confirmed: Map<string, ObjectSnapshot> | undefined;
    const layeredCallback = ((context: import('../events/pipeline-types.js').PipelineDeathBoundaryContext) => {
      if (confirmed !== undefined) throw new Error('Death boundary invoked more than once');
      confirmed = new Map(this.layerObjects().map(object => [key(object), object]));
      const before = context.before.map(object => confirmed!.get(key(object)) ?? object);
      const emissions = context.emissions.map(event => this.withDeathLkiSnapshot(event, confirmed!, confirmed!));
      hostWrite(() => callback({ ...context, before, emissions }));
    }) as Callback;
    const execution = hostWrite(() => invoke(action, layeredCallback));
    if (confirmed === undefined) return execution;
    const after = new Map(this.layerObjects().map(object => [key(object), object]));
    return {
      ...execution,
      emissions: execution.emissions.map(event => this.withDeathLkiSnapshot(event, confirmed!, after)),
    };
  }
  private withDeathLkiSnapshot(
    event: TimingEmission,
    before: ReadonlyMap<string, ObjectSnapshot>,
    after: ReadonlyMap<string, ObjectSnapshot>,
  ): TimingEmission {
    const key = (object: ObjectSnapshot) => JSON.stringify(object.ref);
    const previous = (object: ObjectSnapshot | undefined) => object === undefined
      ? undefined : before.get(key(object)) ?? object;
    const current = (object: ObjectSnapshot | undefined) => object === undefined
      ? undefined : after.get(key(object)) ?? before.get(key(object)) ?? object;
    const deathObject = event.timingPoint.startsWith('object-leaves-') || event.timingPoint === 'object-killed';
    return {
      ...event,
      ...(event.object === undefined ? {} : {
        object: deathObject ? previous(event.object) : event.object,
      }),
      ...(event.source === undefined ? {} : { source: previous(event.source) }),
      ...(event.target === undefined ? {} : { target: current(event.target) }),
      ...(deathObject && (event.it ?? event.object) !== undefined
        ? { it: previous(event.it ?? event.object) }
        : {}),
    };
  }
  /**
   * Preserve a token Play as a Pending Chain item when lifecycle falls back to
   * the host because the token has no registered CardProgram. The source
   * identity is already the Chain incarnation returned by create-token.
   */
  private executeHostAction(action: GameAction) {
    if (action.type === 'play' && this.parentResolveDepth > 0 && this.isProgramlessTokenPlay(action)) {
      const id = `play:${action.object.id}:${action.object.zoneEntryId}:${action.player}`;
      const source = this.options.host.objects().find(object => object.ref.id === action.object.id &&
        object.ref.zoneEntryId === action.object.zoneEntryId)!;
      // Its zero cost is rule-level (185.3.a.1). Retain the primitive's Chain
      // incarnation and continue through the ordinary Finalize/Resolve path.
      if (this.entries.some(item => item.id === id)) {
        return { outcome: { status: 'impossible' as const, events: [] }, emissions: [] };
      }
      this.appendCard(this.programlessTokenDraft(action, source, id));
      return { outcome: { status: 'done' as const, events: [] }, emissions: [] };
    }
    return this.executeStateAction(action);
  }
  /** The host fallback is scoped to tokens without any registered program. */
  private isProgramlessTokenPlay(action: Extract<GameAction, { type: 'play' }>): boolean {
    const source = this.options.host.objects().find(object => object.ref.id === action.object.id &&
      object.ref.zoneEntryId === action.object.zoneEntryId);
    if (source?.isToken !== true || source.zone !== 'chain') return false;
    // Without a program registry the unstable cardId cannot prove that the
    // token is programless; preserve the previous legacy host behavior.
    if (this.options.describePlay === undefined) return false;
    try { this.options.describePlay(action, source); }
    catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code === 'unknown-program') return true;
      throw error;
    }
    return false;
  }
  private programlessTokenDraft(action: Extract<GameAction, { type: 'play' }>, source: ObjectSnapshot, id: string): ChainDraft {
    const types = source.types.map(type => type.toLowerCase());
    const kind = (['spell', 'unit', 'gear'] as const).find(type => types.includes(type));
    if (kind === undefined) throw new Error('Played token has no supported card type');
    return {
      id,
      controller: action.player,
      source,
      kind,
      body: [],
      cost: {
        id: `cost:${id}`,
        cost: {
          energy: { kind: 'constant', value: 0 },
          power: { kind: 'constant', value: [] },
          payments: [],
        },
      },
      ...(action.location === undefined ? {} : { location: action.location }),
    };
  }

  /** Compare effective snapshots in the same transaction after all instruction effects commit. */
  private publishMightChanges(before: readonly ObjectSnapshot[], source: ObjectSnapshot, cause: string): void {
    const emissions = deriveMightChangedEmissions(before, this.layerObjects(), {
      cause, source, simultaneousGroup: `${source.ref.id}:${source.ref.zoneEntryId}:${cause}`,
    });
    const active = emissions.filter(emission => emission.object?.zone === 'board' && emission.object.types.includes('unit') &&
      emission.details?.before !== undefined && emission.details?.after !== undefined &&
      (emission.details.before as ObjectSnapshot).ref.id === emission.object.ref.id &&
      (emission.details.before as ObjectSnapshot).ref.zoneEntryId === emission.object.ref.zoneEntryId);
    // `might-changed` is a general differential producer. The typed
    // becomesMighty predicate belongs to the trigger matcher and must perform
    // the actual <5 to >=5 decision with the frozen before/after snapshots.
    if (active.length > 0) this.pipeline.emitBatch(active);
  }
  get trace(): readonly ChainTrace[] { return structuredClone(this.traces); }
  get priority(): PlayerId | null { return this.priorityHolder; }
  get focus(): PlayerId | null { return this.focusHolder; }
  get turnState(): 'neutral-open' | 'neutral-closed' | 'showdown-open' | 'showdown-closed' {
    return `${this.showdown ? 'showdown' : 'neutral'}-${this.entries.length ? 'closed' : 'open'}`;
  }
  private record(trace: ChainTrace): void { this.traces.push(trace); }
  private next(player: PlayerId): PlayerId { return this.options.turnOrder[(this.options.turnOrder.indexOf(player) + 1) % this.options.turnOrder.length]!; }
  private grantPriority(player: PlayerId | null): void {
    if (this.busy === 'cleanup') throw new Error('Cannot grant Priority during Cleanup');
    this.priorityHolder = player; this.record({ step: 'priority-granted', player });
  }
  private grantFocus(player: PlayerId): void {
    if (!this.showdown || this.busy !== 'idle') throw new Error('Cannot grant Focus now');
    this.focusHolder = player; this.record({ step: 'focus-granted', player }); this.grantPriority(player);
  }
  private grantIdle(): void {
    if (this.entries.length || this.cleanupNeeded || this.outstanding.length || this.busy !== 'idle') return;
    if (this.showdown && this.focusHolder) this.grantPriority(this.focusHolder);
    else this.grantPriority(this.phase === 'main' ? this.pipeline.turnPlayer : null);
  }
  /** Public test/diagnostic seam for the default cache switch. */
  setLayerPlanCacheEnabled(enabled: boolean): void { this.layers.setPlanCacheEnabled(enabled); }
  get layerPlanCacheEnabled(): boolean { return this.layers.planCacheEnabled; }
  /** Committed Pay Costs suspensions are command endpoints just like choices. */
  private closeCommandPlanAtSuspension(): void {
    this.layers.abandonCommandPlan();
  }
  private atomic<T>(run: () => T): T {
    // Keep the established checkpoint/rollback body in one place. Only the
    // outermost command opens the process-local plan lane.
    const execute = (): T => {
      const host = this.options.host.checkpoint(), events = this.pipeline.checkpoint();
      const layerEntries = this.layers.registry.snapshot();
      const suspended = new Map(this.suspendedPaymentContinuations);
      const saved = {
        entries: structuredClone(this.entries), issued: new Set(this.issued), traces: [...this.traces], outstanding: [...this.outstanding],
        cleanupNeeded: this.cleanupNeeded, priorityHolder: this.priorityHolder, focusHolder: this.focusHolder, showdown: this.showdown,
        origin: this.origin, priorityPasses: this.priorityPasses, focusPasses: this.focusPasses, triggerSequence: this.triggerSequence,
        delayedSequence: this.delayedSequence, phase: this.phase, busy: this.busy, choiceMemorySnapshot: this.choiceMemory.snapshot(),
        finalizedPlaysThisTurn: structuredClone(this.finalizedPlaysThisTurn),
        finalizeSequence: this.finalizeSequence,
        finalizeAnswers: new Map([...this.finalizeAnswers].map(([key, value]) => [key, structuredClone(value)] as const)),
        paymentContinuation: this.paymentContinuation,
        paymentContinuationCheckpoint: this.paymentContinuationCheckpoint,
        paymentSuspended: this.paymentSuspended,
        resumingPaymentContinuation: this.resumingPaymentContinuation,
        suspendedPaymentContinuations: suspended,
        combatRoles: new Map(this.combatRoles),
        battlefieldControllers: new Map(this.battlefieldControllers),
        activeCombatId: this.activeCombatId,
        activeCombatBattlefieldId: this.activeCombatBattlefieldId,
        activeCombatAttackerId: this.activeCombatAttackerId,
        activeCombatDefenderId: this.activeCombatDefenderId,
      };
      this.transactionDepth++;
      try { return run(); }
      catch (error) {
        // A successfully journaled Pay Costs suspension is a committed Chain
        // state, not an exception that discards the preceding Finalize work.
        // Persistence rejection and every ordinary failure still roll back.
        if (error instanceof PaymentContinuationSuspendedError) {
          this.closeCommandPlanAtSuspension();
          const handle = this.paymentContinuation;
          if (handle !== null) {
            this.paymentContinuation = null;
            this.paymentContinuationCheckpoint = null;
            this.paymentSuspended = true;
            this.suspendedPaymentContinuations.set(handle.snapshot.continuationId, handle);
          }
          throw error;
        }
        const suspendedHandle = this.paymentSuspended ? this.paymentContinuation : null;
        const suspendedCheckpoint = this.paymentSuspended ? this.paymentContinuationCheckpoint : null;
        const pendingFinalizeAnswers = error instanceof AwaitChoice ? new Map(this.finalizeAnswers) : undefined;
        hostWriteEpoch++; this.options.host.restore(host); this.pipeline.restore(events); Object.assign(this, saved);
        this.choiceMemory.restore(saved.choiceMemorySnapshot);
        if (pendingFinalizeAnswers !== undefined) this.finalizeAnswers = new Map([...saved.finalizeAnswers, ...pendingFinalizeAnswers]);
        this.layers.registry.clear();
        for (const entry of layerEntries) this.layers.registry.register(entry.effect, entry.duration, entry.timestamp);
        this.layers.setObjects(this.hostObjects());
        throw error;
      } finally { this.transactionDepth--; }
    };
    if (this.transactionDepth > 0) return execute();
    return this.layers.withCommandPlanCache('command', execute);
  }
  isPending(ref: ObjectRef): boolean { return this.entries.some(item => item.status === 'pending' && item.object.id === ref.id && item.object.zoneEntryId === ref.zoneEntryId); }
  canAct(player: PlayerId, speed: ChainSpeed, ref?: ObjectRef, object?: ObjectSnapshot | null): boolean {
    if (this.busy !== 'idle' || this.cleanupNeeded || this.outstanding.length || this.entries.some(item => item.status === 'pending') || this.priorityHolder !== player) return false;
    if (this.entries.length && speed !== 'reaction') return false;
    if (this.showdown && !this.entries.length && (this.focusHolder !== player || speed === 'normal')) return false;
    if (!this.showdown && !this.entries.length && (this.phase !== 'main' || this.pipeline.turnPlayer !== player)) return false;

    // The old chain state machine remains the owner of Priority/Focus and
    // chain response shape. Rule-query timing grants are combined with the
    // intrinsic speed declared by the draft, so a card with Reaction remains
    // usable even before an extra continuous grant is registered.
    const grants = new Set<string>(speed === 'normal' ? [] : [speed]);
    if (ref !== undefined) {
      const snapshot = object === undefined ? this.layeredPass(() => this.layers.evaluate(ref)) : object;
      for (const timing of actionTimings(this.layers.registry, ref, snapshot, player)) grants.add(timing);
    }
    return canActByRules({
      player,
      speed,
      showdown: this.showdown,
      closedState: this.entries.length > 0,
      turnPlayer: this.entries.length ? player : this.pipeline.turnPlayer,
      priorityHolder: this.priorityHolder,
      focusHolder: this.focusHolder,
      chainDepth: this.entries.length,
      grants: grants.size === 0 ? undefined : [...grants],
    });
  }
  requestCleanup(reason = 'state-change'): void { this.cleanupNeeded = true; this.record({ step: 'cleanup-requested', reason }); }
  requestTask(id: string): void { if (!this.outstanding.includes(id)) this.outstanding.push(id); }
  completeTask(id: string): void { this.outstanding = this.outstanding.filter(task => task !== id); }
  setPhase(phase: string): void { this.atomic(() => { if (this.entries.length || this.busy !== 'idle') throw new Error('Phase cannot change during a chain'); this.phase = phase; this.priorityHolder = null; this.grantIdle(); }); }
  openShowdown(contestedBy: PlayerId): void {
    this.atomic(() => {
      if (this.busy !== 'idle' || this.cleanupNeeded || this.outstanding.length || this.entries.length || !this.options.turnOrder.includes(contestedBy)) throw new Error('Outstanding work blocks Showdown');
      this.showdown = true; this.focusPasses = 0;
      this.pipeline.emit({ timingPoint: 'showdown-open', player: contestedBy }); this.grantFocus(contestedBy);
    });
  }
  emit(emission: TimingEmission): void { this.atomic(() => {
    this.pipeline.emit(emission);
    this.choiceMemory.beginTurn(this.pipeline.clock.turn);
    this.requestCleanup('timing');
  }); }
  /** Called by primitives as well as structural rules tasks. No trigger hooks live in primitives. */
  commit(action: GameAction): ActionOutcome { return this.atomic(() => {
    const outcome = this.pipeline.commit(action);
    if (outcome.status === 'done' || outcome.status === 'replaced') this.requestCleanup('action');
    return outcome;
  }); }
  execute(draft: ChainDraft): void {
    this.atomic(() => {
      if (this.suspendedPaymentContinuations.size > 0) {
        throw new Error('A suspended Pay Costs continuation must be resumed before another Chain action');
      }
      const context = this.context(draft);
      const speed = draft.conditionalReaction && context.test(draft.conditionalReaction) ? 'reaction' : draft.speed ?? 'normal';
      if (!this.canAct(draft.controller, speed, draft.source.ref, draft.source)) throw new Error('Action is not legally timed');
      if (this.actionIsRestricted(draft, speed)) throw new Error('Action is restricted by a continuous rule');
      this.appendCard(draft);
      this.advance();
    });
  }
  private appendCard(draft: ChainDraft): void {
    this.pipeline.deferTriggerScan(() => {
      this.validateDraft(draft);
      let object = ['unit', 'gear', 'spell'].includes(draft.kind) ? draft.source.ref : { id: draft.id, zoneEntryId: 0 };
      if (draft.kind === 'unit' || draft.kind === 'gear' || draft.kind === 'spell') {
        if (draft.source.zone !== 'chain') {
          const outcome = this.pipeline.commit({ type: 'move-zone', object, to: 'chain' });
          if (outcome.status !== 'done') throw new Error('Cannot move played card to Chain');
          object = this.options.host.objects().find(candidate => candidate.ref.id === draft.source.ref.id)!.ref;
        }
      }
      this.append(draft, object);
    });
  }
  private validateDraft(draft: ChainDraft): void {
    if (!draft.id || this.issued.has(draft.id) || !this.options.turnOrder.includes(draft.controller)) throw new Error('Invalid or reused chain identity');
  }
  /** Rules modules may add pending abilities without a discretionary timing check. */
  enqueue(draft: ChainDraft): void {
    this.atomic(() => {
      if (draft.kind !== 'triggered' && draft.kind !== 'add') throw new Error('Only rules-generated abilities may bypass Execute');
      this.append(draft);
    });
  }
  private append(draft: ChainDraft, object = { id: draft.id, zoneEntryId: 0 }): void {
    this.validateDraft(draft);
    const item: ChainItem = { ...structuredClone(draft), object: { ...object }, status: 'pending', targetPlans: [] };
    if (!this.entries.length && this.origin === null) { this.origin = draft.kind; this.pipeline.clock.chain++; }
    this.entries.push(item); this.issued.add(item.id); this.priorityPasses = 0; this.focusPasses = 0;
    this.record({ step: 'pending', item: item.id }); this.requestCleanup('item-pending');
    this.pipeline.emit({ timingPoint: 'chain-item-pending', object: item.source, player: item.controller, details: { item: item.id } });
  }
  private context(
    item: ChainDraft,
    at: TimingPointId = 'chain-item-finalize',
    targetPlans: readonly TargetPlan[] = [],
    choicePlan?: ChoicePlan,
    repeatExecution?: number,
  ): ResolveContext {
    const source = item.trigger?.source ?? item.source;
    const base = this.options.host.context(source, item.controller, at);
    const actor = { source, controller: item.controller, timingPoint: at };
    const answers = choicePlan === undefined ? undefined : choicePlanAnswers(choicePlan);
    const answerPrefix = this.finalizeAnswerPrefix(item);
    const targets = new Map<string, ObjectRef[]>();
    const overrides: Partial<ResolveContext> = {
      source, controller: item.controller, timingPoint: at,
      transaction: run => this.atomic(run),
      choose: <T>(request: import('../effects/contract.js').ChoiceRequest<T>): T => {
        const key = `${answerPrefix}\u0000${request.id}`;
        if (answers !== undefined && Object.prototype.hasOwnProperty.call(answers, request.id)) {
          const value = structuredClone(answers[request.id]) as T;
          if (at === 'chain-item-finalize') this.finalizeAnswers.set(key, value);
          return value;
        }
        // ChoicePlan questions are already instruction-path qualified. Keep
        // those answers stable across an AwaitChoice retry as well, but never
        // expose them to Resolve or to another chain item.
        if (this.finalizeAnswers.has(key)) {
          return structuredClone(this.finalizeAnswers.get(key)) as T;
        }
        const answer = base.choose(request);
        this.finalizeAnswers.set(key, structuredClone(answer));
        return answer;
      },
      ...(item.trigger === undefined ? {} : { eventObject: (role: 'it') => triggerEventObjectBinding(item.trigger!, role) }),
      contractActions: {
        version: CONTRACT_ACTION_CAPABILITY_VERSION,
        perform: (action: ContractGameAction) => performingEffect(actor, () => this.pipeline.commitContract(action)),
      },
      targets: id => targets.get(id) ?? [],
      picks: id => lockedOrderedPicks((item as Partial<ChainItem>).pickPlans ?? [], id) ?? base.picks(id),
      object: ref => this.layeredPass(() => this.layers.evaluate(ref)),
      query: filter => this.layeredPass(() => {
        const normalized = { ...filter };
        for (const key of ['controller', 'owner']) if (normalized[key] === 'self') normalized[key] = item.controller;
        return this.layers.evaluateAll().filter(object => {
          for (const key of ['controller', 'owner'] as const) if (normalized[key] === 'opponent' && object[key] === item.controller) return false;
          return matchesObjectFilter({ ...normalized, ...(normalized.controller === 'opponent' ? { controller: 'any' } : {}), ...(normalized.owner === 'opponent' ? { owner: 'any' } : {}) }, object);
        });
      }),
      perform: action => performingEffect(actor, () =>
        this.commit(action.type === 'create-token' && action.to === undefined ? { ...action, to: 'board' } : action)),
      addContinuous: (effect, duration) => { this.layers.addContinuous(effect, duration); this.requestCleanup('continuous-effect'); },
      registerDelayedTrigger: (spec, body) => this.pipeline.registerTrigger({ id: `delayed:${++this.delayedSequence}`, source, controller: item.controller, spec: spec as unknown as TriggerSnapshot['registration']['spec'], body, delayed: true })
    };
    const context = new Proxy(base, { get: (target, key) => {
      if (key in overrides) return overrides[key as keyof ResolveContext];
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    for (const plan of targetPlans) {
      if (repeatExecution !== undefined && plan.repeatIndex !== repeatExecution) continue;
      const resolution = resolveTargetPlan(context, plan, { stableReads: run => this.withStableLayers(run), isPending: ref => this.isPending(ref),
        isLegal: snapshot => this.targetIsLegal(snapshot, item.controller),
      });
      const existing = targets.get(plan.requirement.id) ?? [];
      targets.set(plan.requirement.id, [...existing, ...resolution.selected]);
    }
    return context;
  }
  private finalizeAnswerPrefix(item: ChainDraft): string {
    return chainDraftPrefix(item, this.pipeline.clock.turn);
  }
  /** Exact instance receipt for one path; the preferred adapter read. */
  finalizeInstanceLinks(item: Pick<ChainItem, 'id' | 'controller' | 'source' | 'trigger' | 'finalizeLinks'>, instancePath: readonly string[]): Readonly<Record<string, Value>> | undefined {
    return item.finalizeLinks?.[instancePathKey(instancePath)];
  }
  private lockFinalizeAnswers(prefix: string): void {
    const locked = new Map<string, unknown>();
    for (const [key, value] of this.finalizeAnswers) if (key.startsWith(`${prefix}\u0000`)) locked.set(key, value);
    this.finalizeAnswers = locked;
  }
  private targetIsLegal(snapshot: ObjectSnapshot, chooser: PlayerId): boolean {
    return ruleRestrictions(this.layers.registry, 'target', snapshot.ref, snapshot, chooser).length === 0 &&
      ruleRestrictions(this.layers.registry, 'choose-as-target', snapshot.ref, snapshot, chooser).length === 0;
  }
  private handleOutstanding(): void {
    if (this.outstanding.length) throw new Error(`Outstanding task: ${this.outstanding[0]}`);
    let iterations = 0;
    while (this.cleanupNeeded) {
      if (++iterations > 1000) throw new Error('Cleanup did not reach a fixed point');
      this.cleanupNeeded = false; this.busy = 'cleanup';
      this.pipeline.emit({ timingPoint: 'cleanup-start' });
      const changed = this.options.cleanup(this);
      this.pipeline.emit({ timingPoint: 'cleanup-end' });
      if (changed) this.cleanupNeeded = true;
      this.busy = 'idle';
      if (this.outstanding.length) throw new Error(`Outstanding task: ${this.outstanding[0]}`);
    }
  }
  private finalize(item: ChainItem): void {
    this.atomic(() => {
      this.busy = 'finalize'; this.record({ step: 'finalize-start', item: item.id });
      const controlPlanRequired = hasFinalizeChoices(item.body, new Set(this.options.finalizeExtensions?.map(extension => extension.op) ?? [])) ||
        item.body.some(instruction => this.options.finalizeExtensions?.some(extension => extension.op === instruction.op));
      assertFinalizationSurface(item.body, controlPlanRequired);
      let context = this.context(item);
      if (item.mayAtFinalize && !this.acceptAtFinalize(item, context)) return;
      if (item.trigger?.frequencyKey && !this.pipeline.consume(item.trigger)) { this.remove(item, 'frequency-exhausted'); this.busy = 'idle'; return; }
      if ([...(item.requirements ?? []), ...(item.restrictions ?? [])].some(condition => !context.test(condition))) throw new Error('Finalize legality failed');
      if (!this.playDestinationIsLegal(item)) throw new Error('Play destination is not legally allowed');
      if (item.conditionalReaction && item.speed !== 'reaction' && this.entries.length > 1 && !context.test(item.conditionalReaction)) throw new Error('Conditional Reaction no longer applies');
      const targetTaxes: CostComponentInput[] = [];
      const answerPrefix = this.finalizeAnswerPrefix(item);
      try {
        const legendExhaustCost = paysLeadingSourceExhaustDuringFinalize(item);
        const baseInput = item.costInput ?? item.cost ??
          (['unit', 'gear', 'spell'].includes(item.kind) ? { id: `cost:${item.id}`, cost: { kind: 'printed' } } : undefined);
        if (controlPlanRequired) {
          const rememberModes = hasChoiceMemory(item.body);
          const abilityId = item.trigger?.registration.id ?? `${item.kind}:${item.body.map(instruction => instruction.id).join('/')}`;
          item.choicePlan = finalizeInstructionChoices(context, item.body, {
            ...(rememberModes ? {
              memory: this.choiceMemory,
              turn: this.pipeline.clock.turn,
              memoryKey: {
                controller: item.controller,
                source: item.trigger?.source.ref ?? item.source.ref,
                abilityId,
              },
            } : {}),
            targetOptions: {
              isPending: ref => this.isPending(ref),
              isLegal: (snapshot, phase) => this.targetIsLegal(snapshot, item.controller) &&
                (phase !== 'finalize' || this.targetTaxesAreCandidateSafe(context, snapshot)),
            },
          });
          context = this.context(item, 'chain-item-finalize', [], item.choicePlan);
          const plannedTargets: { requirement: TargetRequirement; selected?: readonly ObjectRef[]; mode?: string; repeatIndex?: number }[] = item.choicePlan.targets.map(target => ({
            requirement: target.plan.requirement,
            selected: target.plan.selected,
            mode: target.plan.mode,
            repeatIndex: target.plan.repeatIndex,
          }));
          const covered = new Set(plannedTargets.map(target => target.requirement.id));
          for (const requirement of controlNodeTargetRequirements(item.body, item.choicePlan)) {
            if (!covered.has(requirement.id)) plannedTargets.push({ requirement, selected: undefined, mode: undefined, repeatIndex: undefined });
          }
          for (const planned of plannedTargets) {
            const configured = item.targets?.find(target => target.requirement.id === planned.requirement.id);
            const finalized = finalizeTargetPlan(context, planned.requirement, { stableReads: run => this.withStableLayers(run), ...(configured?.options ?? {}),
              ...(planned.selected === undefined ? {} : { selected: planned.selected }),
              mode: planned.mode,
              repeatIndex: planned.repeatIndex,
              isPending: ref => this.isPending(ref),
              isLegal: snapshot => {
                const existing = configured?.options?.isLegal;
                return (existing?.(snapshot, 'finalize') ?? true) && this.targetIsLegal(snapshot, item.controller);
              },
              taxAdapter: { appendTargetTax: tax => {
                if (tax.kind !== 'deflect' || tax.amount === 0) return;
                targetTaxes.push({
                  id: `target-tax:${planned.requirement.id}:${targetTaxes.length}`,
                  cost: { energy: { kind: 'constant', value: tax.amount } },
                });
              } },
              onTargetsFinalized: () => this.record({ step: 'targets-finalized', item: item.id }),
              onTargeted: event => this.emitBecameTarget(item, context, event.target),
            });
            item.targetPlans.push(finalized);
          }
        }
        if (!controlPlanRequired) {
          const targetSpecs = item.targets ?? item.body.flatMap(instruction => (instruction.targets ?? []).map(requirement => ({ requirement })));
          for (const target of targetSpecs) {
            const explicitTargetTax = target.requirement.id;
            const plan = finalizeTargetPlan(context, target.requirement, { stableReads: run => this.withStableLayers(run), ...('options' in target ? target.options : {}),
              isPending: ref => this.isPending(ref),
              isLegal: (snapshot, phase) => {
                const existing = 'options' in target ? target.options?.isLegal : undefined;
                return (existing?.(snapshot, phase) ?? true) && this.targetIsLegal(snapshot, item.controller);
              },
              taxAdapter: { appendTargetTax: tax => {
                if (tax.kind !== 'deflect' || tax.amount === 0) return;
                targetTaxes.push({
                  id: `target-tax:${explicitTargetTax}:${targetTaxes.length}`,
                  cost: { energy: { kind: 'constant', value: tax.amount } },
                });
              } },
              onTargetsFinalized: () => this.record({ step: 'targets-finalized', item: item.id }),
              onTargeted: event => this.emitBecameTarget(item, context, event.target),
            });
            item.targetPlans.push(plan);
          }
        }
        const extensionInstances = item.choicePlan !== undefined
          ? finalizeInstructionInstances(item.body, item.choicePlan)
          : this.options.finalizeExtensions === undefined
            ? []
            : item.body.map(instruction => ({ instruction, instancePath: Object.freeze([instruction.id]) }));
        for (const instance of extensionInstances) {
          const extension = this.options.finalizeExtensions?.find(candidate => candidate.op === instance.instruction.op);
          if (extension === undefined) continue;
          const instanceKey = instancePathKey(instance.instancePath);
          const receiptPrefix = `${chainDraftPrefix(item, this.pipeline.clock.turn)}\u0000${instanceKey}\u0000`;
          const result = extension.evaluate({
            chainItemId: item.id,
            turn: this.pipeline.clock.turn,
            controller: item.controller,
            source: item.trigger?.source ?? item.source,
            instancePath: instance.instancePath,
            instanceKey,
            receiptPrefix,
            context,
          });
          const receipts = result.receipts ?? [];
          if (receipts.some(receipt => receipt.key.trim().length === 0) ||
              new Set(receipts.map(receipt => receipt.key)).size !== receipts.length) {
            throw new ChainContractBlockedError(`Finalize extension ${instanceKey} returned duplicate receipt keys`);
          }
          const qualified = receipts.map(receipt => ({
            key: `${receiptPrefix}${encodeURIComponent(receipt.key)}`,
            value: structuredClone(receipt.value),
          }));
          const links = Object.freeze(Object.fromEntries(qualified.map(receipt => [receipt.key, receipt.value])));
          const duplicate = qualified.find(receipt =>
            Object.values(item.finalizeLinks ?? {}).some(values => Object.hasOwn(values, receipt.key)));
          if (duplicate !== undefined) {
            throw new ChainContractBlockedError(`Finalize extension receipt key ${duplicate.key} was reused`);
          }
          item.finalizeLinks = Object.freeze({ ...(item.finalizeLinks ?? {}), [instanceKey]: links });
          context = withFinalizePlanLinks(context, item.finalizeLinks);
        }
        item.pickPlans = finalizeOrderedPickPlans(context, item.body);
        // Preserve the production Make Relevant Choices order: existing target
        // locks are made before optional additional costs. Once the frozen
        // Repeat decision is known, add one target lock per paid execution and
        // collect all target taxes before payment (CR 355.1.a, 355.5, 820.2.a).
        const hasRepeat = (baseInput?.optionalAdditional ?? []).some(optional => optional.kind === 'repeat');
        if (hasRepeat && item.repeatTargetCount === undefined) {
          const repeatAnswers = (baseInput!.optionalAdditional ?? []).filter(optional => optional.kind === 'repeat');
          const selections = new Map<string, boolean>();
          for (const optional of repeatAnswers) {
            if (optional.selected !== undefined) selections.set(optional.id, optional.selected);
          }
          const paid = repeatAnswers.filter(optional => {
            if (optional.selected !== undefined) return optional.selected;
            const answer = context.choose<boolean>({
              id: `${baseInput!.id}:optional:${optional.id}`,
              type: 'optional',
              chooser: item.controller,
              visibility: 'public',
            });
            if (typeof answer !== 'boolean') throw new TypeError('Optional additional cost selection must be boolean');
            selections.set(optional.id, answer);
            return answer;
          });
          item.repeatTargetCount = paid.length;
          if (item.targetPlans.length === 0) {
            const targetSpecs = item.targets ?? item.body.flatMap(instruction =>
              (instruction.targets ?? []).map(requirement => ({ requirement })));
            for (const target of targetSpecs) {
              item.targetPlans.push(finalizeTargetPlan(context, target.requirement, { stableReads: run => this.withStableLayers(run), ...('options' in target ? target.options : {}),
                repeatIndex: 0,
                isPending: ref => this.isPending(ref),
                isLegal: (snapshot, phase) => {
                  const existing = 'options' in target ? target.options?.isLegal : undefined;
                  return (existing?.(snapshot, phase) ?? true) && this.targetIsLegal(snapshot, item.controller);
                },
                taxAdapter: { appendTargetTax: tax => {
                  if (tax.kind !== 'deflect' || tax.amount === 0) return;
                  targetTaxes.push({
                    id: `target-tax:${target.requirement.id}:0:${targetTaxes.length}`,
                    cost: { energy: { kind: 'constant', value: tax.amount } },
                  });
                } },
                onTargetsFinalized: () => this.record({ step: 'targets-finalized', item: item.id }),
                onTargeted: event => this.emitBecameTarget(item, context, event.target),
              }));
            }
          }
          const optionalAdditional = (baseInput!.optionalAdditional ?? []).map(optional =>
            selections.has(optional.id) ? { ...optional, selected: selections.get(optional.id)! } : optional);
          item.costInput = { ...baseInput!, optionalAdditional };
        }
        const paidRepeatCount = item.repeatTargetCount ?? 0;
        if (paidRepeatCount > 0) {
          if (controlPlanRequired) {
            throw new ChainContractBlockedError('Paid whole-body Repeat requires an instruction-and-iteration mode lifecycle');
          }
          const originals = item.targetPlans.map(plan => ({ ...plan, repeatIndex: plan.repeatIndex ?? 0 }));
          item.targetPlans = [...originals];
          for (let repeatIndex = 1; repeatIndex <= paidRepeatCount; repeatIndex++) {
            for (const original of originals) {
              const configured = item.targets?.find(target => target.requirement.id === original.requirement.id);
              const selected = finalizeTargetPlan(context, original.requirement, { stableReads: run => this.withStableLayers(run), ...(configured?.options ?? {}),
                repeatIndex,
                isPending: ref => this.isPending(ref),
                isLegal: snapshot => {
                  const existing = configured?.options?.isLegal;
                  return (existing?.(snapshot, 'finalize') ?? true) && this.targetIsLegal(snapshot, item.controller);
                },
                taxAdapter: { appendTargetTax: tax => {
                  if (tax.kind !== 'deflect' || tax.amount === 0) return;
                  targetTaxes.push({
                    id: `target-tax:${original.requirement.id}:${repeatIndex}:${targetTaxes.length}`,
                    cost: { energy: { kind: 'constant', value: tax.amount } },
                  });
                } },
                onTargetsFinalized: () => this.record({ step: 'targets-finalized', item: item.id }),
                onTargeted: event => this.emitBecameTarget(item, context, event.target),
              });
              item.targetPlans.push(selected);
            }
          }
        }
        this.collectBoundTargetTaxes(item, context, targetTaxes);
        if (baseInput || targetTaxes.length) {
          // Leaving-source abilities retain LKI for the effect, but a leading
          // "recycle me" cost acts on the card now in Trash (CR 383.3.b).
          const currentSource = item.kind === 'triggered' ? this.options.host.objects().find(object => object.ref.id === item.source.ref.id) : undefined;
          const incumbentContext = currentSource ? bindResolveContext(context, { source: currentSource }) : context;
          const paymentContext = legendExhaustCost
            ? boardViewForLegendExhaustCost(incumbentContext, currentSource ?? context.source)
            : incumbentContext;
          const rawInput = baseInput ?? { id: `cost:${item.id}`, cost: { energy: { kind: 'constant' as const, value: 0 } } };
          const finalized = finalizeCostPlanInput(paymentContext, rawInput, item.costInput?.costChoices);
          const mandatoryAdditional = [...(finalized.input.mandatoryAdditional ?? []), ...targetTaxes.filter(tax => tax.id !== '' && !('stage' in tax))];
          const finalizedInput: CostPlanInput = { ...finalized.input, ...(mandatoryAdditional.length === 0 ? {} : { mandatoryAdditional }) };
          item.costInput = finalizedInput;
          // CR 356 / contract 5.1: Finalize applies every active cost
          // modification (bound Board statics, the played card's own "this
          // costs" statics, and resolved continuous effects) before payment.
          item.costPlan = finalizedInput.ignoreAllCosts === true
            ? buildCostPlan(paymentContext, finalizedInput)
            : finalizeCostPlan(paymentContext, finalizedInput, this.costDiscountSources(item));
          if (this.options.paymentContinuation !== undefined && !this.resumingPaymentContinuation) {
            item.status = 'finalized';
            this.record({ step: 'finalized', item: item.id });
            const handle = this.suspendPaymentContinuation(item);
            if (!this.options.paymentContinuation.persist(handle.snapshot)) {
              throw new Error('Payment continuation notice was not durably accepted');
            }
            this.paymentSuspended = true;
            throw new PaymentContinuationSuspendedError();
          }
          item.payment = payCostPlan(paymentContext, item.costPlan, { transaction: run => this.atomic(run) });
        }
      } catch (error) {
        const noOptions = error instanceof TargetSelectionError && (error.code === 'no-legal-targets' || error.code === 'target-tax-unpayable');
        const cannotPay = error instanceof CostPlanError && error.reason === 'cannot-pay-cost';
        const unpayableMay = isUnpayableFinalizeMayCost(item, error);
        if (item.kind === 'triggered' && (noOptions || cannotPay || unpayableMay)) throw new TriggerFinalizeFailure(error);
        if (error instanceof ChoicePlanError) throw new ChainContractBlockedError(error.message);
        if (error instanceof CostPlanError && (error.reason === 'judge-required' || error.reason === 'missing-printed-cost')) throw new ChainContractBlockedError(error.message);
        throw error;
      }
      this.lockFinalizeAnswers(answerPrefix);
      if (item.status !== 'finalized') {
        item.status = 'finalized'; this.record({ step: 'finalized', item: item.id });
      }
      if (['unit', 'gear', 'spell'].includes(item.kind)) {
        this.recordCardFinalize(item);
      }
      this.pipeline.emit({ timingPoint: 'chain-item-finalize', object: item.source, player: item.controller,
        details: { item: item.id, ...(['unit', 'gear', 'spell'].includes(item.kind) ? { cardFinalize: true } : {}) } });
      this.requestCleanup('item-finalized'); this.busy = 'idle';
    });
  }
  private acceptAtFinalize(item: ChainItem, context: ResolveContext): boolean {
    const requestId = `finalize:${item.id}:optional`;
    const registration = item.trigger?.registration;
    const stableId = /^program:/.test(registration?.id ?? '') &&
      leadingSourceExhaustShape(registration?.body ?? []) !== undefined
      ? `trigger:${item.trigger!.event.eventId}:${registration!.id}:${item.trigger!.occurrence ?? 0}:optional`
      : requestId;
    const answerKey = `${this.finalizeAnswerPrefix(item)}\u0000${stableId}`;
    const locked = this.finalizeAnswers.get(answerKey);
    if (typeof locked === 'boolean') {
      if (locked) return true;
      this.remove(item, 'declined'); this.busy = 'idle';
      return false;
    }
    const finalizeAccepted = context.choose<boolean>({
      id: stableId, chooser: item.controller, visibility: 'public', type: 'optional',
    });
    if (typeof finalizeAccepted !== 'boolean') throw new TypeError('Finalize decision must be boolean');
    if (finalizeAccepted) return true;
    this.remove(item, 'declined'); this.busy = 'idle';
    return false;
  }
  private emitBecameTarget(item: ChainDraft, context: ResolveContext, target: ObjectRef): void {
    const object = context.object(target);
    if (object) this.pipeline.emit({ timingPoint: 'became-target', object, target: object, source: item.source, player: item.controller });
  }
  private targetTaxesAreCandidateSafe(context: ResolveContext, snapshot: ObjectSnapshot): boolean {
    if (snapshot.zone !== 'board') return true;
    const taxes = collectTargetTaxes(context, snapshot, {
      kind: 'ability',
      effects: boundTargetTaxes(this),
      ignoreDeflect: ignoresTargetTax(this, context.controller),
    });
    return taxes.every(tax => tax.cost.kind === undefined || tax.cost.kind === 'explicit' || tax.cost.kind === 'activated');
  }
  /**
   * Cost modification sources visible at this item's Finalize. Bound Board
   * statics arrive through their cost capability; the matching layer mirror
   * (marked costModification) is excluded so no static is counted twice.
   */
  private costDiscountSources(item: ChainItem): CostDiscountSources {
    return {
      statics: [...staticCostSources(this), ...(item.costStatics ?? [])],
      continuous: this.layers.registry.list().filter(entry =>
        (entry.effect.effect as { costModification?: unknown }).costModification !== true),
      finalizedPlaysThisTurn: this.finalizedPlaysThisTurn,
      // An activated Add is re-tagged kind add for its immediate resolution
      // (CR 430.2) but is still an activated ability for cost purposes
      // (CR 399-401); only a triggered Add carries a trigger snapshot.
      purpose: item.kind === 'activated' || (item.kind === 'add' && item.trigger === undefined) ? 'activate' : 'play',
      targets: (item.targetPlans ?? []).flatMap(plan => plan.selected),
      originZone: item.source.zone,
    };
  }
  /** Capture the exact successful Finalize, before Resolve or Counter (CR 420.4.b). */
  private recordCardFinalize(item: ChainItem): void {
    const object = this.options.host.objects().find(candidate =>
      candidate.ref.id === item.object.id && candidate.ref.zoneEntryId === item.object.zoneEntryId) ?? item.source;
    this.finalizedPlaysThisTurn.push(structuredClone({
      object,
      player: item.controller,
      turn: this.pipeline.clock.turn,
      sequence: ++this.finalizeSequence,
      finalizedAt: 'chain-item-finalize',
    }));
  }
  private collectBoundTargetTaxes(item: ChainItem, context: ResolveContext, into: CostComponentInput[]): void {
    const effects = boundTargetTaxes(this);
    const ignoreTax = ignoresTargetTax(this, item.controller);
    for (const plan of item.targetPlans ?? []) {
      for (const ref of plan.selected) {
        const target = context.object(ref);
        if (target === null) throw new TargetSelectionError('invalid-target-choice', 'A finalized target disappeared before tax collection');
        const collected = collectTargetTaxes(context, target, {
          kind: item.kind === 'spell' ? 'spell' : 'ability',
          effects,
          ignoreDeflect: ignoreTax,
        });
        collected.forEach((tax, index) => into.push({
          id: `target-tax:${plan.requirement.id}:${ref.zoneEntryId}:${index}:${tax.id}`,
          cost: tax.cost,
        }));
      }
    }
  }
  private actionIsRestricted(draft: ChainDraft, speed: ChainSpeed): boolean {
    const actionNames = new Set<string>([speed, 'play', 'play-card']);
    if (draft.kind === 'activated') {
      actionNames.add('activate');
      actionNames.add('activate-ability');
    } else if (draft.kind === 'spell' || draft.kind === 'unit' || draft.kind === 'gear') {
      actionNames.add(`play-${draft.kind}`);
    }
    return [...actionNames].some(action => ruleRestrictions(
      this.layers.registry,
      action,
      draft.source.ref,
      draft.source,
      draft.controller,
    ).length > 0);
  }
  private playDestinationIsLegal(item: ChainItem): boolean {
    if (item.kind !== 'unit' && item.kind !== 'gear') return true;
    const destination = item.location ?? { type: 'base' as const, player: item.controller };
    const objects = this.hostObjects();
    const state = this.playDestinationState(destination, objects);
    // CR 355.2.a gives Units (including Unit+Gear under 178.1/.2) a Base or
    // controller-controlled Battlefield. CR 148.1.a.1, 149.2, and 359.2.d
    // instead send a Non-Unit Gear to its player's Base unless a specific
    // effect such as Deploy grants another destination.
    const unitLike = item.kind === 'unit';
    const baselineAllowed = destination.type === 'base'
      ? destination.player === item.controller
      : !unitLike
        ? false
      : !this.battlefieldControllers.has(destination.id)
        ? !state.battlefieldExists || state.controller === item.controller
        : this.battlefieldControllers.get(destination.id) === item.controller;
    // CR 355.2.a/b; 806.3 and 813.3.a do not broaden this inherent play rule.
    const hasPermission = this.hasStructuredPlayLocationPermission(item, destination, state, objects);
    const view = playLocations(this.layers.registry, item.source.ref, item.source, item.controller);
    const deployAllowed = item.kind === 'gear' && this.hasDeployPermission(item, destination, objects);
    if (!baselineAllowed && !hasPermission && !deployAllowed) return false;
    const blockedKind = destination.type;
    const blockers = new Set(view.restrictions.map(entry => entry.name.toLowerCase()));
    const unrestricted = !blockers.has(`no-${blockedKind}`) && !blockers.has(`cannot-${blockedKind}`) &&
      !blockers.has(`cannot-play-${blockedKind}`);
    return unrestricted;
  }
  private playDestinationState(
    destination: Exclude<ChainDraft['location'], undefined>,
    objects: readonly ObjectSnapshot[],
  ): {
    readonly ref: Exclude<ChainDraft['location'], undefined>;
    readonly controller: PlayerId | null | undefined;
    readonly battlefieldExists: boolean;
    readonly owner?: PlayerId;
    readonly occupied: boolean;
    readonly units: readonly ObjectRef[];
  } {
    if (destination.type === 'base') {
      const baseUnits = objects.filter(object => object.zone === 'board' && object.types.some(type => type.toLowerCase() === 'unit') &&
        object.location?.type === 'base' && object.location.player === destination.player).map(object => object.ref);
      return { ref: destination, controller: destination.player, owner: destination.player,
        battlefieldExists: false, occupied: baseUnits.length > 0, units: baseUnits };
    }
    const units = objects.filter(object => object.zone === 'board' && object.types.some(type => type.toLowerCase() === 'unit') &&
      object.location?.type === 'battlefield' && object.location.id === destination.id).map(object => object.ref);
    return {
      ref: destination,
      controller: this.battlefieldController(destination.id),
      battlefieldExists: this.battlefieldExists(destination.id),
      occupied: units.length > 0,
      units,
    };
  }
  private battlefieldExists(battlefieldId: string): boolean {
    if (this.battlefieldControllers.has(battlefieldId)) return true;
    return this.hostObjects().some(object => object.zone === 'board' &&
      object.types.some(type => type.toLowerCase() === 'battlefield') &&
      (object.ref.id === battlefieldId || object.location?.type === 'battlefield' && object.location.id === battlefieldId));
  }
  private battlefieldController(battlefieldId: string): PlayerId | undefined {
    if (this.battlefieldControllers.has(battlefieldId)) {
      return this.battlefieldControllers.get(battlefieldId) ?? undefined;
    }
    const battlefield = this.hostObjects().find(object => object.zone === 'board' &&
      object.types.some(type => type.toLowerCase() === 'battlefield') &&
      (object.ref.id === battlefieldId || object.location?.type === 'battlefield' && object.location.id === battlefieldId));
    if (battlefield !== undefined) return battlefield.controller;
    const genericOccupant = this.hostObjects().find(object => object.zone === 'board' &&
      object.types.some(type => type.toLowerCase() === 'unit') &&
      object.location?.type === 'battlefield' && object.location.id === battlefieldId);
    return genericOccupant?.controller;
  }
  private hasStructuredPlayLocationPermission(
    item: ChainItem,
    destination: Exclude<ChainDraft['location'], undefined>,
    state: ReturnType<ChainEngine['playDestinationState']>,
    objects: readonly ObjectSnapshot[],
  ): boolean {
    const sourceObject = objects.find(object => object.ref.id === item.source.ref.id &&
      object.ref.zoneEntryId === item.object.zoneEntryId) ?? item.source;
    const permissionSource = { ...sourceObject, controller: item.controller };
    if (playPermissionAllows(this.layers.registry, permissionSource, destination, {
      player: item.controller, state, objects,
    })) return true;
    for (const entry of this.layers.registry.list() as readonly RegisteredContinuousEffect[]) {
      const effect = record(entry.effect.effect);
      const kind = String(effect.kind ?? '').toLowerCase();
      if (kind !== 'play-location-permission' && kind !== 'continuous.location' && kind !== 'location') continue;
      if (entry.effect.source !== undefined && entry.effect.source.id !== item.source.ref.id) continue;
      if (entry.effect.source?.zoneEntryId !== undefined && entry.effect.source.zoneEntryId !== item.object.zoneEntryId) continue;
      const raw = record(literal(effect.value));
      const candidate = raw.kind === 'constant' || raw.kind === 'literal' ? literal(raw.value) : literal(effect.location ?? raw.location ?? effect.permission);
      const filter = record(candidate);
      if (Object.keys(filter).length === 0) continue;
      if (literal(filter.appliesTo) === 'friendly-units' && sourceObject.controller !== item.controller) continue;
      if (locationPermissionMatches(filter as LocationFilter, destination, { player: item.controller, state, objects })) return true;
    }
    return false;
  }
  private hasDeployPermission(
    item: ChainItem,
    destination: Exclude<ChainDraft['location'], undefined>,
    objects: readonly ObjectSnapshot[],
  ): boolean {
    if (destination.type !== 'battlefield') return false;
    const source = objects.find(object => object.ref.id === item.source.ref.id &&
      object.ref.zoneEntryId === item.object.zoneEntryId) ?? item.source;
    return source.keywords.some(keyword => keyword.id.toLowerCase() === 'deploy') ||
      this.layers.registry.list().some(entry => {
        if (entry.effect.source?.id !== item.source.ref.id) return false;
        const effect = record(entry.effect.effect);
        const play = record(effect.play);
        return effect.kind === 'continuous.location' && play.anyBattlefield === true;
      });
  }
  /** CR 430.3: Reaction Add can interrupt payment without transferring Priority. */
  activateAddDuringPayment(draft: ChainDraft): void {
    if (this.busy !== 'finalize' || draft.kind !== 'add' || draft.speed !== 'reaction') throw new Error('Only Reaction Add is allowed during payment');
    const parent = this.entries.find(item => item.status === 'finalized' && item.costPlan !== undefined) ??
      this.entries.find(item => item.status === 'pending' && item.costPlan === undefined);
    if (parent === undefined) throw new Error('A Reaction Add requires one parent Pay Costs item');
    if (parent.costPlan !== undefined && draft.controller !== parent.costPlan.player) throw new Error('Only the parent payer can activate a Reaction Add');
    this.append(draft);
    const item = this.entries.at(-1)!;
    this.finalize(item); this.resolve(item); this.busy = 'finalize';
  }

  /** Snapshot the only parent whose Pay Costs may accept an external Reaction Add. */
  private suspendPaymentContinuation(item: ChainItem): PaymentContinuation {
    if (this.busy !== 'finalize' || this.transactionDepth <= 0) throw new Error('Pay Costs continuation requires the active Finalize transaction');
    if (this.paymentContinuation !== null) throw new Error('A Pay Costs continuation is already suspended');
    if (this.entries.some(candidate => candidate.status === 'pending') || item.status !== 'finalized' || item.costPlan === undefined) {
      throw new Error('Pay Costs continuation requires one finalized parent');
    }
    if (item.controller !== item.costPlan.player) throw new Error('Pay Costs continuation payer mismatch');
    const choiceMemory = this.choiceMemory.snapshot();
    const finalizeAnswers = new Map([...this.finalizeAnswers].map(([key, value]) => [key, structuredClone(value)] as const));
    const frozenParent = structuredClone(this.entries.find(entry => entry.id === item.id)!);
    const digest = paymentContinuationDigest({ itemId: item.id, parent: frozenParent, choiceMemory, finalizeAnswers });
    const handle = paymentContinuationAuthority({
      itemId: item.id, payer: item.controller, source: item.source.ref, costPlanId: item.costPlan.id,
      turn: this.pipeline.clock.turn,
      digest,
      owner: this,
      checkpoint: {
        itemId: item.id,
        chain: {
          entries: structuredClone(this.entries),
          issued: [...this.issued], traces: [...this.traces], outstanding: [...this.outstanding],
          cleanupNeeded: this.cleanupNeeded, priorityHolder: this.priorityHolder,
          focusHolder: this.focusHolder, showdown: this.showdown, origin: item.kind,
          priorityPasses: this.priorityPasses, focusPasses: this.focusPasses,
          triggerSequence: this.triggerSequence, delayedSequence: this.delayedSequence,
          finalizedPlaysThisTurn: structuredClone(this.finalizedPlaysThisTurn), finalizeSequence: this.finalizeSequence,
          phase: this.phase, choiceMemory, finalizeAnswers,
        },
        pipeline: this.pipeline.checkpoint(),
        layers: this.layers.registry.snapshot(),
      },
    });
    this.paymentContinuation = handle;
    this.paymentContinuationCheckpoint = paymentContinuationBinding(handle)!.checkpoint;
    this.paymentSuspended = true;
    return handle;
  }

  /** The production host calls this after replaying its journal to the exact suspension. */
  restorePaymentContinuationHandle(journalNotice?: PaymentContinuationSnapshot): PaymentContinuation {
    if (this.suspendedPaymentContinuations.size !== 1) throw new Error('Payment continuation was not rebuilt by this authoritative Chain');
    const handle = [...this.suspendedPaymentContinuations.values()][0]!;
    if (this.paymentContinuation === handle && paymentContinuationBinding(handle)?.state === 'live') {
      throw new Error('Payment continuation handle was already restored');
    }
    if (journalNotice !== undefined && !paymentContinuationNoticeEqual(journalNotice, handle.snapshot)) {
      throw new Error('Payment continuation journal notice does not match this authoritative Chain');
    }
    if (this.consumedPaymentContinuations.has(handle.snapshot.continuationId)) {
      throw new Error('Payment continuation handle is stale or not authoritative: already consumed');
    }
    const binding = paymentContinuationBinding(handle);
    if (binding === null) throw new Error('Payment continuation handle is stale or not authoritative');
    if (binding.state === 'live') throw new Error('Payment continuation requires authoritative journal replay');
    binding.state = 'live';
    this.paymentContinuation = handle;
    this.paymentContinuationCheckpoint = binding.checkpoint;
    return handle;
  }

  /** Resume the suspension rebuilt by this authoritative Chain/journal replay. */
  resumePaymentContinuation(handle: PaymentContinuation, options: PaymentContinuationExecutionOptions): PaymentContinuationResult {
    const binding = paymentContinuationBinding(handle);
    // A handle is an opaque process-local capability owned by the exact
    // authoritative Chain that created it. Equal content digests never make
    // handles interchangeable across Chain instances.
    if (binding !== null && binding.owner !== this) {
      throw new Error('Payment continuation handle belongs to another authoritative Chain');
    }
    if (binding !== null && this.consumedPaymentContinuations.has(handle.snapshot.continuationId)) {
      throw new Error('Payment continuation handle is stale or not authoritative: already consumed');
    }
    if (binding !== null && this.suspendedPaymentContinuations.get(handle.snapshot.continuationId) !== handle &&
        this.paymentContinuation !== handle) {
      throw new Error('Payment continuation handle is not a member of this authoritative Chain');
    }
    const current = this.paymentContinuation;
    if (binding === null || (current === null && binding.state !== 'suspended') || (current !== null && binding.state !== 'live')) {
      throw new Error('Payment continuation handle is stale or not authoritative');
    }
    const key = handle.snapshot.continuationId;
    if (this.consumedPaymentContinuations.has(key)) {
      throw new Error('Payment continuation handle is stale or not authoritative: already consumed');
    }
    const snapshot = handle.snapshot;
    if (snapshot !== binding.notice || (current !== null && snapshot !== current.snapshot)) throw new Error('Payment continuation identity mismatch');
    if (options.payer !== snapshot.payer || options.source.id !== snapshot.source.id || options.source.zoneEntryId !== snapshot.source.zoneEntryId) throw new Error('Payment continuation actor or source incarnation mismatch');
    if (options.add.controller !== snapshot.payer) throw new Error('Payment continuation Add actor mismatch');
    if (options.add.source === undefined || options.add.source.ref.id === undefined || options.add.source.ref.zoneEntryId === undefined) throw new Error('Payment continuation Add source is invalid');
    const addSource = this.options.host.objects().find(object =>
      object.ref.id === options.add.source.ref.id && object.ref.zoneEntryId === options.add.source.ref.zoneEntryId);
    if (addSource === undefined || addSource.controller !== snapshot.payer) throw new Error('Payment continuation Add source is not this payer’s exact current incarnation');
    if (options.add.kind !== 'add' || options.add.speed !== 'reaction') throw new Error('Only Reaction Add is allowed during payment');
    try {
      return this.atomic(() => {
        this.paymentContinuation = null;
        this.resumingPaymentContinuation = true;
        this.busy = 'finalize';
        const parent = this.entries.find(item => item.id === snapshot.itemId && item.status === 'finalized');
        if (parent === undefined || parent.controller !== snapshot.payer || parent.source.ref.id !== snapshot.source.id ||
            parent.source.ref.zoneEntryId !== snapshot.source.zoneEntryId || parent.costPlan?.id !== snapshot.costPlanId) {
          throw new Error('Payment continuation parent, actor, source or cost plan no longer matches');
        }
        this.assertFinalizedParentSource(parent);
        if (!this.playDestinationIsLegal(parent)) throw new Error('Play destination is no longer legally allowed');
        this.assertFinalizedTargetsLegal(parent, 'before Pay Costs');
        const add = this.executePaymentReactionAdd(options.add);
        this.assertFinalizedTargetsLegal(parent, 'after the Reaction Add');
        const after = assessCostPayment(this.context(parent, 'chain-item-finalize', parent.targetPlans, parent.choicePlan), parent.costPlan!, {
          transaction: run => this.atomic(run),
        });
        if (!after.payable) throw new Error('Parent cost remains unpayable after the Reaction Add');
        const payment = this.payFinalizedParent(parent);
        parent.status = 'finalized';
        this.recordCardFinalize(parent);
        this.pipeline.emit({ timingPoint: 'chain-item-finalize', object: parent.source, player: parent.controller,
          details: { item: parent.id, cardFinalize: true } });
        this.requestCleanup('item-finalized');
        this.busy = 'idle';
        binding.state = 'consumed';
        this.paymentSuspended = false;
        this.consumedPaymentContinuations.add(key);
        this.suspendedPaymentContinuations.delete(key);
        this.paymentContinuation = null;
        this.paymentContinuationCheckpoint = null;
        return { continuationId: snapshot.continuationId, epoch: snapshot.epoch, itemId: snapshot.itemId, add, payment };
      });
    } catch (error) {
      // The nested atomic rollback restores the detached view from before this
      // resume. Reattach only the frozen structure from the private checkpoint
      // so the failed attempt leaves no effects while preserving a legal retry.
      binding.state = 'suspended';
      this.paymentContinuation = null;
      this.paymentContinuationCheckpoint = null;
      this.paymentSuspended = true;
      throw error;
    } finally {
      this.resumingPaymentContinuation = false;
    }
  }

  private payFinalizedParent(item: ChainItem): CostPaymentReceipt {
    if (item.costPlan === undefined) throw new Error('Parent has no finalized cost plan');
    const context = this.context(item, 'chain-item-finalize', item.targetPlans, item.choicePlan);
    const receipt = payCostPlan(context, item.costPlan, { transaction: run => this.atomic(run) });
    const persisted = this.entries.find(candidate => candidate.id === item.id);
    if (persisted === undefined) throw new Error('Parent disappeared during Pay Costs');
    persisted.payment = receipt;
    return receipt;
  }
  private assertFinalizedTargetsLegal(item: ChainItem, boundary: 'before Pay Costs' | 'after the Reaction Add'): void {
    for (const plan of item.targetPlans) {
      const resolution = resolveTargetPlan(this.context(item, 'chain-item-finalize', [], item.choicePlan, plan.repeatIndex), plan, { stableReads: run => this.withStableLayers(run), isPending: ref => this.isPending(ref), isLegal: snapshot => this.targetIsLegal(snapshot, item.controller),
      });
      if (resolution.invalid.length > 0 || resolution.status !== 'resolved' ||
          resolution.selected.length !== plan.selected.length) {
        throw new TargetSelectionError('invalid-target-choice', `A parent target is no longer legal ${boundary}`);
      }
    }
  }
  /**
   * Validate the finalizing source before accepting a Reaction Add. A played
   * card may use its exact Chain successor; every other same-id replacement is
   * a later incarnation and must not receive payment from this continuation.
   */
  private assertFinalizedParentSource(item: ChainItem): void {
    const plan = item.costPlan;
    if (plan === undefined || plan.source.id !== item.source.ref.id ||
        plan.source.zoneEntryId !== item.source.ref.zoneEntryId) {
      throw new Error('Finalized parent cost source is not bound to its parent source');
    }
    const context = this.context(item, 'chain-item-finalize', [], item.choicePlan);
    const exact = context.object(plan.source);
    if (exact !== null) {
      if (exact.controller !== plan.player && exact.controller !== context.source.controller) {
        throw new Error('Finalized parent source is no longer controlled by the payer');
      }
      return;
    }
    const current = context.query({}).find(object => object.ref.id === plan.source.id);
    if (current?.zone === 'chain' && current.controller === context.source.controller) return;
    if (current !== undefined) {
      throw new Error('Finalized parent source has been replaced by another incarnation');
    }
    if (plan.source.zoneEntryId !== context.source.ref.zoneEntryId) {
      throw new Error('Finalized parent source incarnation no longer exists');
    }
  }
  /** Execute the Add item through Finalize/Resolve and return its real receipts. */
  private executePaymentReactionAdd(draft: ChainDraft): PaymentReactionAddReceipt {
    if (this.busy !== 'finalize') throw new Error('Only Reaction Add is allowed during payment');
    const beforeEvents = this.pipeline.events.length;
    this.append(draft);
    const item = this.entries.at(-1)!;
    this.finalize(item);
    const finalized = this.entries.find(candidate => candidate.id === item.id);
    if (finalized === undefined) throw new Error('Reaction Add disappeared before Resolve');
    const outcome = this.resolve(finalized);
    const receipt = paymentReactionAddReceipt(this.pipeline.events.slice(beforeEvents), finalized, outcome, item.id, draft);
    this.busy = 'finalize';
    return receipt;
  }
  advance(): void {
    if (this.busy !== 'idle') throw new Error('HOT FEPR is not reentrant');
    // A Game Effect may Play a card/token during its own Resolve. CR 354.3
    // requires the parent Resolve to finish before the nested item continues
    // through Playing steps 2-5. The nested item is already Pending; it must
    // never be finalized or resolved reentrantly by this outer advance pass.
    if (this.parentResolveDepth > 0) return;
    while (true) {
      this.atomic(() => this.handleOutstanding());
      const pending = this.entries.find(item => item.status === 'pending');
      if (!pending) break;
      try { this.finalize(pending); }
      catch (error) {
        if (!(error instanceof TriggerFinalizeFailure)) throw error;
        this.atomic(() => this.remove(this.entries.find(item => item.id === pending.id)!, 'unperformable-trigger'));
        continue;
      }
      const finalized = this.entries.find(item => item.id === pending.id);
      if (finalized?.status === 'finalized' && ['unit', 'gear', 'add'].includes(finalized.kind)) {
        this.atomic(() => this.handleOutstanding());
        this.resolve(finalized);
      }
    }
    this.atomic(() => {
      if (this.entries.length) this.grantPriority(this.entries.at(-1)!.controller);
      else this.closeChain();
    });
  }
  private resolve(item: ChainItem): ExecutionOutcome {
    return this.atomic(() => {
      this.busy = 'resolve'; this.record({ step: 'resolve-start', item: item.id });
      const initializedContext = this.context(item, 'chain-item-resolve', item.targetPlans, item.choicePlan);
      const context = item.finalizeLinks === undefined ? initializedContext : withFinalizePlanLinks(initializedContext, item.finalizeLinks);
      if (item.kind === 'unit' || item.kind === 'gear') {
        const location = item.location ?? { type: 'base' as const, player: item.controller };
        const move: Extract<GameAction, { type: 'move-zone' }> = {
          type: 'move-zone', object: item.object, to: location.type === 'base' ? 'base' : 'battlefield', location,
        };
        // Program-bound Accelerate units enter exhausted and let the real
        // replacement apply. Harnesses without a program lifecycle retain the
        // selected-plan fallback used by the published chain scenario.
        const acceleratePaid = item.costPlan !== undefined && item.payment !== undefined &&
          evaluateAcceleratePayment({
            plan: item.costPlan, receipt: item.payment, source: item.source.ref, action: move,
          });
        const hasEntryReplacement = this.pipeline.hasReplacementRegistration(
          `replacement:${item.object.id}:${item.object.zoneEntryId}`,
        );
        // Gear enters ready (359.2.d) unless the effect that plays it
        // stipulates otherwise (184.1 / 185.2.d). A token Played by an effect
        // carries that stipulated entry state on the object it created on the
        // Chain, so resolution keeps it instead of applying the Gear default.
        const onChain = this.options.host.objects().find(object =>
          object.ref.id === item.object.id && object.ref.zoneEntryId === item.object.zoneEntryId);
        const stipulatedExhausted = item.kind === 'gear' && onChain?.isToken === true && onChain.exhausted === true;
        const ready = item.kind === 'gear' ? !stipulatedExhausted : acceleratePaid && !hasEntryReplacement;
        const state = this.pipeline.commit({ type: ready ? 'ready' : 'exhaust', object: item.object });
        if (state.status !== 'done') throw new Error('Permanent entry state could not be applied');
        const evidence = this.playCostEvidence(item, move);
        const outcome = evidence === undefined
          ? this.pipeline.commit(move)
          : this.withPlayCostEvidence(evidence, () => this.pipeline.commit(move));
        if (outcome.status !== 'done' && outcome.status !== 'replaced') throw new Error('Permanent could not enter Board');
        if (this.options.host.objects().find(object => object.ref.id === item.object.id)?.zone === 'chain') throw new Error('Replacement left a resolving permanent on the Chain');
      }
      const conditionInputs = item.trigger?.event === undefined && item.costPlan === undefined && item.payment === undefined
        ? {}
        : {
          event: item.trigger?.event,
          ...(item.costPlan !== undefined || item.payment !== undefined
            ? { cost: { plan: item.costPlan, receipt: item.payment } }
            : {})
        };
      const beforeMight = this.layerObjects();
      let result: ExecutionOutcome;
      try {
        this.parentResolveDepth++;
        if (isWeaponmasterResolveShape(item)) {
          bindWeaponmasterNoEquipPolicy(context.contractActions);
        }
        result = resolveChainBody(item.body, context, { ...conditionInputs, targetPlans: item.targetPlans });
      } catch (error) {
        if (!isWeaponmasterUnpayableResolve(item, error)) throw error;
        // CR 821.1.c.5 is a no-attachment result, not a zero-cost payment. The
        // inner transaction rolled back resources/events. The Chain item
        // completes without a payment receipt, so linkedTo never attaches.
        result = { status: 'executed', results: [], linkedValues: {}, events: [] };
      } finally {
        this.parentResolveDepth--;
      }
      this.publishMightChanges(beforeMight, item.source, `resolve:${item.id}`);
      if (item.kind === 'spell' || item.kind === 'unit' || item.kind === 'gear') {
        const playedObject = this.options.host.objects().find(object => object.ref.id === item.source.ref.id) ?? item.source;
        const playedFromZone = item.source.zone;
        const printed = { energy: item.source.energy, power: item.source.power, might: item.source.might };
        const provenance = { fromZone: playedFromZone, playedFromZone, playedFromHand: playedFromZone === 'hand', printed };
        this.pipeline.emit({
          timingPoint: 'card-played', object: playedObject, source: item.source,
          player: item.controller, fromZone: playedFromZone,
          details: { ...provenance, object: provenance, source: provenance }
        });
      }
      if (item.kind === 'spell') {
        const outcome = this.pipeline.commit({ type: 'move-zone', object: item.object, to: 'trash' });
        if (outcome.status !== 'done') throw new Error('Resolved spell could not leave Chain');
      }
      this.pipeline.emit({ timingPoint: 'chain-item-resolve', object: item.source, player: item.controller, details: { item: item.id } });
      this.record({ step: 'resolved', item: item.id }); this.remove(item, 'resolved'); this.busy = 'idle'; return result;
    });
  }
  /** Frozen Finalize evidence is scoped to this resolution's one Board-entry move. */
  private playCostEvidence(item: ChainItem, action: Extract<GameAction, { type: 'move-zone' }>): ReplacementCostEvidence | undefined {
    if (item.costPlan === undefined || item.payment === undefined) return undefined;
    return {
      plan: item.costPlan,
      receipt: item.payment,
      source: item.source.ref,
      action: structuredClone(action),
    };
  }
  /** Idempotent for an existing adapter that supplies the exact same evidence. */
  private withPlayCostEvidence<T>(evidence: ReplacementCostEvidence, run: () => T): T {
    const pipeline = this.pipeline;
    const original = pipeline.withPlayCostEvidence;
    const sameEvidence = (candidate: ReplacementCostEvidence) =>
      candidate.plan.id === evidence.plan.id &&
      candidate.receipt.planId === evidence.receipt.planId &&
      candidate.source.id === evidence.source.id &&
      candidate.source.zoneEntryId === evidence.source.zoneEntryId &&
      candidate.action.object.id === evidence.action.object.id &&
      candidate.action.object.zoneEntryId === evidence.action.object.zoneEntryId &&
      candidate.action.to === evidence.action.to;
    pipeline.withPlayCostEvidence = (<U>(candidate: ReplacementCostEvidence, task: () => U): U =>
      sameEvidence(candidate) ? task() : original.call(pipeline, candidate, task) as U
    ) as typeof pipeline.withPlayCostEvidence;
    try { return original.call(pipeline, evidence, run) as T; }
    finally { pipeline.withPlayCostEvidence = original; }
  }
  private remove(item: ChainItem, reason: string): void { this.entries = this.entries.filter(entry => entry.id !== item.id); this.priorityPasses = 0; this.record({ step: 'removed', item: item.id, reason }); this.requestCleanup('item-removed'); }
  private closeChain(): void {
    const origin = this.origin; this.origin = null;
    if (origin !== null) {
      this.record({ step: 'chain-closed' });
      if (this.showdown && this.focusHolder && origin !== 'triggered' && origin !== 'add') this.grantFocus(this.next(this.focusHolder));
    }
    this.grantIdle();
  }
  pass(player: PlayerId): void {
    if (!this.canPass(player)) throw new Error('Player cannot pass now');
    if (this.entries.length) {
      this.atomic(() => {
        this.priorityPasses++; this.record({ step: 'pass', player });
        if (this.priorityPasses === this.options.turnOrder.length) this.resolve(this.entries.at(-1)!);
        else this.grantPriority(this.next(player));
      });
      if (this.priorityPasses === 0) this.advance();
    } else if (this.showdown) {
      this.atomic(() => {
        this.focusPasses++; this.record({ step: 'focus-pass', player });
        if (this.focusPasses === this.options.turnOrder.length) {
          this.pipeline.emit({ timingPoint: 'showdown-close', player }); this.showdown = false; this.focusHolder = null; this.priorityHolder = null; this.focusPasses = 0; this.grantIdle();
        } else this.grantFocus(this.next(player));
      });
      this.advance();
    } else { this.record({ step: 'phase-complete', player }); this.priorityHolder = null; }
  }
  private canPass(player: PlayerId): boolean { return this.busy === 'idle' && !this.cleanupNeeded && !this.outstanding.length && !this.entries.some(item => item.status === 'pending') && this.priorityHolder === player; }
}
class TriggerFinalizeFailure extends Error { constructor(readonly cause: unknown) { super('Trigger cannot be finalized'); } }
export class PaymentContinuationSuspendedError extends Error {
  readonly status = 'suspended' as const;
  constructor() { super('Finalize suspended for an external Pay Costs continuation'); this.name = 'PaymentContinuationSuspendedError'; }
}

/** Never let interpreter-local target choices silently bypass the event pipeline. */
function assertFinalizationSurface(body: readonly Instruction[], controlPlanRequired = false, nested = false, repeated = false): void {
  for (const instruction of body) {
    if (instruction.op === 'repeat' && instruction.targets?.length) {
      throw new ChainContractBlockedError('Repeated targets require an instruction-and-iteration target lifecycle adapter');
    }
    if (repeated && instruction.targets?.length) {
      throw new ChainContractBlockedError('Repeated targets require an instruction-and-iteration target lifecycle adapter');
    }
    if (nested && instruction.targets?.length) {
      if (!controlPlanRequired) throw new ChainContractBlockedError('Nested/repeated targets require an interpreter target-selection lifecycle adapter');
    }
    if (instruction.op === 'choice.mode') {
      if (!controlPlanRequired || instruction.args.count === undefined || instruction.args.different === undefined) {
        throw new ChainContractBlockedError('Mode choices require complete Finalize/Resolve choice-plan metadata');
      }
    }
    const expression = instruction.args.body;
    if (['sequence', 'choice.optional', 'repeat'].includes(instruction.op) && expression && (expression.kind === 'constant' || expression.kind === 'literal') && Array.isArray(expression.value)) {
      assertFinalizationSurface(expression.value as unknown as readonly Instruction[], controlPlanRequired, true, repeated || instruction.op === 'repeat');
    }
    const modes = instruction.args.modes;
    if (instruction.op === 'choice.mode' && modes && (modes.kind === 'constant' || modes.kind === 'literal') && Array.isArray(modes.value)) {
      for (const mode of modes.value as unknown as readonly { readonly body?: unknown }[]) {
        if (Array.isArray(mode.body)) assertFinalizationSurface(mode.body as readonly Instruction[], controlPlanRequired, true, repeated);
      }
    }
  }
}
export class ChainContractBlockedError extends Error {
  readonly status = 'blocked';
  constructor(message: string) { super(message); this.name = 'ChainContractBlockedError'; }
}
