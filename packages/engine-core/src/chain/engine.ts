import type { Condition } from '@riftbound/card-dsl';
import type { ActionOutcome, ContractGameAction, GameAction, Instruction, ObjectRef, ObjectSnapshot, PlayerId, ResolveContext, Value } from '../effects/contract.js';
import { AwaitChoice } from '../effects/contract.js';
import { CONTRACT_ACTION_CAPABILITY_VERSION } from '../effects/contract.js';
import type { ExecutionOutcome } from '../effects/interpreter.js';
import { resolveChainBody } from './interpreter-adapter.js';
import { buildCostPlan } from '../cost/cost-plan.js';
import { assessCostPayment, payCostPlan } from '../cost/payment.js';
import { CostPlanError, type CostComponentInput, type CostPlan, type CostPlanInput, type CostPaymentReceipt } from '../cost/plan-types.js';
import { finalizeTargetPlan, resolveTargetPlan, TargetSelectionError, type TargetFinalizeOptions, type TargetPlan, type TargetRequirement } from '../target/target-plan.js';
import { LayerEngine } from '../layers/engine.js';
import { matchesObjectFilter } from '../layers/filter.js';
import { actionTimings, canAct as canActByRules, playLocations, restrictions as ruleRestrictions } from '../layers/rules/query.js';
import { EventPipeline } from '../events/pipeline.js';
import { triggerEventObjectBinding, type PipelineHost, type TimingEmission, type TriggerSnapshot } from '../events/pipeline-types.js';
import type { TimingPointId } from '../events/timing-points.js';
import { bindResolveContext } from '../events/action-adapter.js';
import { finalizeOrderedPickPlans, lockedOrderedPicks, type OrderedPickPlan } from './picks/plan.js';
import { choicePlanAnswers, ChoicePlanError, type ChoicePlan } from './finalize/choices.js';
import { ChoiceMemory } from './finalize/choice-memory.js';
import { controlNodeTargetRequirements, finalizeCostPlanInput, finalizeInstructionChoices, finalizeInstructionInstances, hasChoiceMemory, hasFinalizeChoices, instancePathKey, withFinalizePlanLinks } from './finalize/index.js';
import { collectTargetTaxes } from '../target/tax/index.js';
import { boundTargetTaxes, ignoresTargetTax } from '../programs/static-adapters/capabilities.js';

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
  readonly itemId: string;
  readonly epoch: number;
  readonly payer: PlayerId;
  readonly source: ObjectRef;
  readonly costPlanId: string;
}

/** Opaque in-process authority. JSON clones are deliberately not restartable. */
export interface PaymentContinuation {
  readonly snapshot: PaymentContinuationSnapshot;
}

export interface PaymentContinuationExecutionOptions<A> {
  /** Exact current player and source incarnation supplied by the authority owner. */
  readonly payer: PlayerId;
  readonly source: ObjectRef;
  /** A Reaction Add draft. Resume revalidates its actor/source against the handle. */
  readonly add: ChainDraft;
  /**
   * Reconstruct and reload the checkpoint after the runtime has restored its
   * authoritative journal. The Chain then restores its own half of that same
   * checkpoint, so neither side can trust a serialized capability.
   */
  readonly restore: (checkpoint: PaymentContinuationRestorePoint) => void;
  /** Execute inside the parent Pay Costs action after the suspended Add completes. */
  readonly parent: (resume: () => A) => A;
  /** Complete parent Pay Costs in this same external call. */
  readonly payParent?: boolean;
}

/** Detached data only; authority comes from restore into the live Chain. */
export interface PaymentContinuationRestorePoint {
  readonly handle: PaymentContinuationSnapshot;
  readonly checkpoint: unknown;
}

export interface PaymentContinuationResult<A> {
  readonly value: A;
  readonly handle?: PaymentContinuation;
  readonly payment?: CostPaymentReceipt;
  readonly add: ExecutionOutcome;
}

interface PaymentContinuationBinding {
  readonly itemId: string;
  readonly epoch: number;
  readonly payer: PlayerId;
  readonly source: ObjectRef;
  readonly costPlanId: string;
  readonly checkpoint: unknown;
  state: 'live' | 'resumed' | 'invalidated';
}

const PAYMENT_CONTINUATION_BINDING_KEY = Symbol('payment-continuation-binding');

function paymentContinuationAuthority(input: {
  readonly itemId: string;
  readonly payer: PlayerId;
  readonly source: ObjectRef;
  readonly costPlanId: string;
  readonly checkpoint: unknown;
}): PaymentContinuation {
  const epoch = input.checkpoint === null || typeof input.checkpoint !== 'object' || Array.isArray(input.checkpoint)
    ? Number.NaN
    : ((input.checkpoint as { readonly epoch?: unknown }).epoch as number | undefined) ?? Number.NaN;
  if (!Number.isSafeInteger(epoch)) throw new RangeError('Payment continuation epoch exhausted');
  const snapshot = Object.freeze({
    contract: 'riftbound.chain.payment-continuation.v1' as const,
    itemId: input.itemId, epoch, payer: input.payer,
    source: Object.freeze({ id: input.source.id, zoneEntryId: input.source.zoneEntryId }),
    costPlanId: input.costPlanId,
  });
  const handle = Object.freeze(Object.defineProperty({ snapshot }, PAYMENT_CONTINUATION_BINDING_KEY, {
    value: Object.freeze({ ...snapshot, checkpoint: input.checkpoint, state: 'live' as const }), enumerable: false,
  })) as PaymentContinuation;
  return handle;
}

function paymentContinuationBinding(handle: unknown): PaymentContinuationBinding | null {
  if (handle === null || typeof handle !== 'object') return null;
  const binding = (handle as { readonly [PAYMENT_CONTINUATION_BINDING_KEY]?: PaymentContinuationBinding })[PAYMENT_CONTINUATION_BINDING_KEY];
  return binding === undefined || binding === null ? null : binding;
}

function detachedPaymentContinuation(handle: PaymentContinuation): PaymentContinuationRestorePoint {
  const binding = paymentContinuationBinding(handle);
  if (binding === null) return { handle: structuredClone(handle.snapshot), checkpoint: null };
  return { handle: structuredClone(handle.snapshot), checkpoint: structuredClone(binding.checkpoint) };
}

function paymentCheckpointRecord(checkpoint: unknown): Readonly<Record<string, unknown>> {
  if (checkpoint === null || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new TypeError('Payment continuation checkpoint must be detached record data');
  }
  return checkpoint as Readonly<Record<string, unknown>>;
}

function paymentCheckpointKey(point: PaymentContinuationRestorePoint): string {
  const epoch = point.handle.epoch;
  return [point.handle.itemId, epoch, point.handle.payer, point.handle.source.id,
    point.handle.source.zoneEntryId, symbolDigest(point.checkpoint)].join('\u0000');
}

function symbolDigest(value: unknown): string {
  if (value === null || typeof value !== 'object') return typeof value === 'symbol' ? String(value) : '';
  const keys = Reflect.ownKeys(value as object).map(key => typeof key === 'symbol' ? String(key) : key).sort();
  return keys.map(key => {
    if (key === 'global') return 'global';
    const child = Object.getOwnPropertyDescriptor(value as object, key)?.value;
    return typeof child === 'object' ? Array.isArray(child) ? `a:${child.length}` : `o:${Object.keys(child).length}` :
      typeof child === 'symbol' ? String(child) : String(child);
  }).join('|');
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
   * Called immediately before Pay Costs after choices, targets and the CostPlan
   * are frozen. Returning true means the host persisted the restore point and
   * will complete the same Finalize from a later authoritative command.
   */
  readonly suspendPayment?: (input: PaymentContinuationRestorePoint) => boolean;
}

/** The new rules layer. Legacy duel runtimes deliberately do not call it yet. */
export class ChainEngine {
  readonly pipeline: EventPipeline;
  readonly layers: LayerEngine;
  private entries: ChainItem[] = [];
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
  private readonly choiceMemory = new ChoiceMemory();
  private finalizeAnswers = new Map<string, unknown>();
  private paymentContinuation: PaymentContinuation | null = null;
  private paymentContinuationCheckpoint: unknown = null;
  private paymentSuspended = false;
  private readonly consumedPaymentContinuations = new Set<string>();
  private phase: string;
  constructor(private readonly options: ChainEngineOptions) {
    this.phase = options.phase ?? 'main';
    this.layers = options.layers ?? new LayerEngine(options.host.objects());
    this.pipeline = new EventPipeline({ ...options.host, objects: () => this.layerObjects(), execute: action => this.executeStateAction(action) }, options.turnOrder, options.turnPlayer);
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
    this.pipeline.onTrigger = trigger => this.append({ id: `trigger:${++this.triggerSequence}`, controller: trigger.controller, source: trigger.source, kind: 'triggered', body: trigger.registration.body, cost: trigger.registration.cost, targets: trigger.registration.targets, mayAtFinalize: trigger.registration.mayAtFinalize, trigger });
    this.pipeline.onEvent = event => {
      this.layers.setObjects(options.host.objects());
      this.layers.advance({ id: event.timingPoint, player: event.player });
      this.record({ step: 'event', timingPoint: event.timingPoint });
    };
    this.grantIdle();
  }
  get items(): readonly ChainItem[] { return structuredClone(this.entries); }
  private layerObjects(): readonly ObjectSnapshot[] {
    this.layers.setObjects(this.options.host.objects()); return this.layers.evaluateAll();
  }
  private executeStateAction(action: GameAction) {
    const key = (object: ObjectSnapshot) => JSON.stringify(object.ref);
    const before = new Map(this.layerObjects().map(object => [key(object), object]));
    const execution = this.options.host.execute(action);
    const after = new Map(this.layerObjects().map(object => [key(object), object]));
    const snapshot = (object: ObjectSnapshot | undefined, previous = false) => object ? (previous ? before.get(key(object)) : after.get(key(object))) ?? before.get(key(object)) ?? object : undefined;
    return { ...execution, emissions: execution.emissions.map(event => ({ ...event, object: snapshot(event.object, event.timingPoint.startsWith('object-leaves-') || event.timingPoint === 'object-killed'), source: snapshot(event.source, true), target: snapshot(event.target) })) };
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
  private atomic<T>(run: () => T): T {
    const host = this.options.host.checkpoint(), events = this.pipeline.checkpoint();
    const layerEntries = this.layers.registry.snapshot();
    const saved = {
      entries: structuredClone(this.entries), issued: new Set(this.issued), traces: [...this.traces], outstanding: [...this.outstanding],
      cleanupNeeded: this.cleanupNeeded, priorityHolder: this.priorityHolder, focusHolder: this.focusHolder, showdown: this.showdown,
      origin: this.origin, priorityPasses: this.priorityPasses, focusPasses: this.focusPasses, triggerSequence: this.triggerSequence,
      delayedSequence: this.delayedSequence, phase: this.phase, busy: this.busy, choiceMemorySnapshot: this.choiceMemory.snapshot(),
      finalizeAnswers: new Map([...this.finalizeAnswers].map(([key, value]) => [key, structuredClone(value)] as const)),
      paymentContinuation: this.paymentContinuation,
      paymentContinuationCheckpoint: this.paymentContinuationCheckpoint,
      paymentSuspended: this.paymentSuspended,
    };
    this.transactionDepth++;
    try { return run(); }
    catch (error) {
      const pendingFinalizeAnswers = error instanceof AwaitChoice ? new Map(this.finalizeAnswers) : undefined;
      this.options.host.restore(host); this.pipeline.restore(events); Object.assign(this, saved);
      this.choiceMemory.restore(saved.choiceMemorySnapshot);
      if (this.paymentSuspended) {
        this.paymentContinuation = null;
        this.paymentContinuationCheckpoint = null;
        this.paymentSuspended = false;
        for (const entry of saved.entries) {
          if (entry.id !== saved.paymentContinuation?.snapshot.itemId) continue;
          const pending = { ...entry, status: 'pending' as const };
          this.entries = this.entries.map(candidate => candidate.id === pending.id ? pending : candidate);
        }
      }
      if (pendingFinalizeAnswers !== undefined) this.finalizeAnswers = new Map([...saved.finalizeAnswers, ...pendingFinalizeAnswers]);
      this.layers.registry.clear();
      for (const entry of layerEntries) this.layers.registry.register(entry.effect, entry.duration, entry.timestamp);
      this.layers.setObjects(this.options.host.objects());
      throw error;
    } finally { this.transactionDepth--; }
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
      this.layers.setObjects(this.options.host.objects());
      const snapshot = object === undefined ? this.layers.evaluate(ref) : object;
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
  ): ResolveContext {
    const source = item.trigger?.source ?? item.source;
    const base = this.options.host.context(source, item.controller, at);
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
        perform: (action: ContractGameAction) => this.pipeline.commitContract(action),
      },
      targets: id => targets.get(id) ?? [],
      picks: id => lockedOrderedPicks((item as Partial<ChainItem>).pickPlans ?? [], id) ?? base.picks(id),
      object: ref => { this.layers.setObjects(this.options.host.objects()); return this.layers.evaluate(ref); },
      query: filter => {
        this.layers.setObjects(this.options.host.objects());
        const normalized = { ...filter };
        for (const key of ['controller', 'owner']) if (normalized[key] === 'self') normalized[key] = item.controller;
        return this.layers.evaluateAll().filter(object => {
          for (const key of ['controller', 'owner'] as const) if (normalized[key] === 'opponent' && object[key] === item.controller) return false;
          return matchesObjectFilter({ ...normalized, ...(normalized.controller === 'opponent' ? { controller: 'any' } : {}), ...(normalized.owner === 'opponent' ? { owner: 'any' } : {}) }, object);
        });
      },
      perform: action => this.commit(action.type === 'create-token' && action.to === undefined ? { ...action, to: 'board' } : action),
      addContinuous: (effect, duration) => { this.layers.addContinuous(effect, duration); this.requestCleanup('continuous-effect'); },
      registerDelayedTrigger: (spec, body) => this.pipeline.registerTrigger({ id: `delayed:${++this.delayedSequence}`, source, controller: item.controller, spec: spec as unknown as TriggerSnapshot['registration']['spec'], body, delayed: true })
    };
    const context = new Proxy(base, { get: (target, key) => {
      if (key in overrides) return overrides[key as keyof ResolveContext];
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    for (const plan of targetPlans) {
      const resolution = resolveTargetPlan(context, plan, {
        isPending: ref => this.isPending(ref),
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
      if (!this.playDestinationIsLegal(item)) throw new Error('Play destination is not legally allowed');
      if (item.mayAtFinalize) {
        const accepted = context.choose<boolean>({ id: `finalize:${item.id}:optional`, chooser: item.controller, visibility: 'public', type: 'optional' });
        if (typeof accepted !== 'boolean') throw new TypeError('Finalize decision must be boolean');
        if (!accepted) { this.remove(item, 'declined'); this.busy = 'idle'; return; }
      }
      if (item.trigger?.frequencyKey && !this.pipeline.consume(item.trigger)) { this.remove(item, 'frequency-exhausted'); this.busy = 'idle'; return; }
      if ([...(item.requirements ?? []), ...(item.restrictions ?? [])].some(condition => !context.test(condition))) throw new Error('Finalize legality failed');
      if (item.conditionalReaction && item.speed !== 'reaction' && this.entries.length > 1 && !context.test(item.conditionalReaction)) throw new Error('Conditional Reaction no longer applies');
      const targetTaxes: CostComponentInput[] = [];
      const answerPrefix = this.finalizeAnswerPrefix(item);
      try {
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
            const finalized = finalizeTargetPlan(context, planned.requirement, {
              ...(configured?.options ?? {}),
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
            const plan = finalizeTargetPlan(context, target.requirement, {
              ...('options' in target ? target.options : {}),
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
        this.collectBoundTargetTaxes(item, context, targetTaxes);
        item.pickPlans = finalizeOrderedPickPlans(context, item.body);
        const baseInput = item.costInput ?? item.cost ?? (['unit', 'gear', 'spell'].includes(item.kind) ? { id: `cost:${item.id}`, cost: { kind: 'printed' } } : undefined);
        if (baseInput || targetTaxes.length) {
          // Leaving-source abilities retain LKI for the effect, but a leading
          // "recycle me" cost acts on the card now in Trash (CR 383.3.b).
          const currentSource = item.kind === 'triggered' ? this.options.host.objects().find(object => object.ref.id === item.source.ref.id) : undefined;
          const paymentContext = currentSource ? bindResolveContext(context, { source: currentSource }) : context;
          const rawInput = baseInput ?? { id: `cost:${item.id}`, cost: { energy: { kind: 'constant' as const, value: 0 } } };
          const finalized = finalizeCostPlanInput(paymentContext, rawInput, item.costInput?.costChoices);
          const mandatoryAdditional = [...(finalized.input.mandatoryAdditional ?? []), ...targetTaxes.filter(tax => tax.id !== '' && !('stage' in tax))];
          const finalizedInput: CostPlanInput = { ...finalized.input, ...(mandatoryAdditional.length === 0 ? {} : { mandatoryAdditional }) };
          item.costInput = finalizedInput;
          item.costPlan = buildCostPlan(paymentContext, finalizedInput);
          if (this.options.suspendPayment !== undefined) {
            const handle = paymentContinuationAuthority({
              itemId: item.id,
              payer: item.controller,
              source: item.source.ref,
              costPlanId: item.costPlan.id,
              checkpoint: {
                epoch: this.pipeline.clock.turn * 1_000_000 + this.entries.length,
                itemId: item.id,
                host: this.options.host.checkpoint(),
                pipeline: this.pipeline.checkpoint(),
                chain: {
                  entries: structuredClone(this.entries), issued: [...this.issued], traces: [...this.traces],
                  outstanding: [...this.outstanding], cleanupNeeded: this.cleanupNeeded,
                  priorityHolder: this.priorityHolder, focusHolder: this.focusHolder, showdown: this.showdown,
                  origin: this.origin, priorityPasses: this.priorityPasses, focusPasses: this.focusPasses,
                  triggerSequence: this.triggerSequence, delayedSequence: this.delayedSequence,
                  phase: this.phase, busy: this.busy, choiceMemory: this.choiceMemory.snapshot(),
                  finalizeAnswers: new Map([...this.finalizeAnswers].map(([key, value]) => [key, structuredClone(value)] as const)),
                },
                layers: this.layers.registry.snapshot(),
              },
            });
            this.paymentContinuation = handle;
            this.paymentContinuationCheckpoint = paymentContinuationBinding(handle)!.checkpoint;
            if (this.options.suspendPayment(detachedPaymentContinuation(handle))) {
              this.paymentSuspended = true;
              throw new PaymentContinuationSuspendedError();
            }
            this.paymentContinuation = null;
            this.paymentContinuationCheckpoint = null;
          }
          item.payment = payCostPlan(paymentContext, item.costPlan, { transaction: run => this.atomic(run) });
        }
      } catch (error) {
        const noOptions = error instanceof TargetSelectionError && (error.code === 'no-legal-targets' || error.code === 'target-tax-unpayable');
        const cannotPay = error instanceof CostPlanError && error.reason === 'cannot-pay-cost';
        if (item.kind === 'triggered' && (noOptions || cannotPay)) throw new TriggerFinalizeFailure(error);
        if (error instanceof ChoicePlanError) throw new ChainContractBlockedError(error.message);
        if (error instanceof CostPlanError && (error.reason === 'judge-required' || error.reason === 'missing-printed-cost')) throw new ChainContractBlockedError(error.message);
        throw error;
      }
      this.lockFinalizeAnswers(answerPrefix);
      item.status = 'finalized'; this.record({ step: 'finalized', item: item.id });
      this.pipeline.emit({ timingPoint: 'chain-item-finalize', object: item.source, player: item.controller, details: { item: item.id } });
      this.requestCleanup('item-finalized'); this.busy = 'idle';
    });
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
    const destination = item.location;
    if (destination === undefined) return true;
    const view = playLocations(this.layers.registry, item.source.ref, item.source, item.controller);
    const permissions = new Set(view.permissions.map(entry => entry.name.toLowerCase()));
    const restrictions = new Set(view.restrictions.map(entry => entry.name.toLowerCase()));
    // The host still owns baseline placement rules (controlled Battlefield,
    // default Base, and card-specific legality). The query bridge only adds
    // explicit continuous.location prohibitions or permissions; an absent
    // location effect must therefore leave the existing host validation intact.
    if (permissions.size === 0 && restrictions.size === 0) return true;
    const blocked = (kind: 'base' | 'battlefield'): boolean =>
      restrictions.has(`no-${kind}`) || restrictions.has(`cannot-${kind}`) || restrictions.has(`cannot-play-${kind}`);
    if (destination.type === 'battlefield') {
      if (blocked('battlefield')) return false;
      return true;
    }
    if (blocked('base')) return false;
    return true;
  }
  /** CR 430.3: Reaction Add can interrupt payment without transferring Priority. */
  activateAddDuringPayment(draft: ChainDraft): void {
    if (this.busy !== 'finalize' || draft.kind !== 'add' || draft.speed !== 'reaction') throw new Error('Only Reaction Add is allowed during payment');
    this.append(draft);
    const item = this.entries.at(-1)!;
    this.finalize(item); this.resolve(item); this.busy = 'finalize';
  }

  /** Snapshot the only parent whose Pay Costs may accept an external Reaction Add. */
  suspendPaymentContinuation(): PaymentContinuation {
    if (this.busy !== 'finalize' || this.transactionDepth <= 0) throw new Error('Pay Costs continuation requires the active Finalize transaction');
    if (this.paymentContinuation !== null) throw new Error('A Pay Costs continuation is already suspended');
    const pending = this.entries.filter(item => item.status === 'pending').at(-1);
    const finalized = this.entries.filter(item => item.status === 'finalized').at(-1);
    const item = finalized;
    if (pending !== undefined || item === undefined || item.costPlan === undefined) throw new Error('Pay Costs continuation requires one finalized parent');
    if (item.controller !== item.costPlan.player) throw new Error('Pay Costs continuation payer mismatch');
    const handle = paymentContinuationAuthority({
      itemId: item.id, payer: item.controller, source: item.source.ref, costPlanId: item.costPlan.id,
      checkpoint: {
        epoch: this.pipeline.clock.turn * 1_000_000 + this.entries.length,
        itemId: item.id,
        host: this.options.host.checkpoint(), pipeline: this.pipeline.checkpoint(),
        chain: {
          entries: structuredClone(this.entries), issued: [...this.issued], traces: [...this.traces],
          outstanding: [...this.outstanding], cleanupNeeded: this.cleanupNeeded,
          priorityHolder: this.priorityHolder, focusHolder: this.focusHolder, showdown: this.showdown,
          origin: this.origin, priorityPasses: this.priorityPasses, focusPasses: this.focusPasses,
          triggerSequence: this.triggerSequence, delayedSequence: this.delayedSequence,
          phase: this.phase, busy: this.busy, choiceMemory: this.choiceMemory.snapshot(),
          finalizeAnswers: new Map([...this.finalizeAnswers].map(([key, value]) => [key, structuredClone(value)] as const)),
        },
        layers: this.layers.registry.snapshot(),
      },
    });
    this.paymentContinuation = handle;
    this.paymentContinuationCheckpoint = paymentContinuationBinding(handle)!.checkpoint;
    return handle;
  }

  /** The production host calls this only after replaying its own authoritative journal. */
  restorePaymentContinuationHandle(point: PaymentContinuationRestorePoint): PaymentContinuation {
    const key = paymentCheckpointKey(point);
    if (this.consumedPaymentContinuations.has(key)) throw new Error('Payment continuation was already consumed');
    const binding = point as unknown as PaymentContinuationBinding;
    const snapshot = Object.freeze(structuredClone(point.handle));
    const handle = Object.freeze(Object.defineProperty({ snapshot }, PAYMENT_CONTINUATION_BINDING_KEY, {
      value: Object.freeze({ ...binding, ...snapshot, checkpoint: structuredClone(point.checkpoint), state: 'live' as const }), enumerable: false,
    })) as PaymentContinuation;
    if (this.paymentContinuation !== null) throw new Error('A Pay Costs continuation is already suspended');
    this.paymentContinuation = handle;
    this.paymentContinuationCheckpoint = structuredClone(point.checkpoint);
    return handle;
  }

  /**
   * Resume one exact suspended Pay Costs step. The authority owner must reload
   * its verified checkpoint in `restore`; serialized or cloned handles have no
   * authority and can never resume.
   */
  resumePaymentContinuation<A>(handle: PaymentContinuation, options: PaymentContinuationExecutionOptions<A>): PaymentContinuationResult<A> {
    const binding = paymentContinuationBinding(handle);
    if (binding === null || binding.state !== 'live' || this.paymentContinuation !== handle) throw new Error('Payment continuation handle is stale or not authoritative');
    const restorePoint = { handle: structuredClone(handle.snapshot), checkpoint: structuredClone(binding.checkpoint) };
    const key = paymentCheckpointKey(restorePoint);
    if (this.consumedPaymentContinuations.has(key)) throw new Error('Payment continuation was already consumed');
    const snapshot = handle.snapshot;
    if (snapshot.itemId !== binding.itemId || snapshot.epoch !== binding.epoch || snapshot.costPlanId !== binding.costPlanId) throw new Error('Payment continuation identity mismatch');
    if (options.payer !== snapshot.payer || options.source.id !== snapshot.source.id) throw new Error('Payment continuation actor or source incarnation mismatch');
    if (options.add.controller !== snapshot.payer) throw new Error('Payment continuation Add actor mismatch');
    if (options.add.source === undefined || options.add.source.ref.id === undefined || options.add.source.ref.zoneEntryId === undefined) throw new Error('Payment continuation Add source is invalid');
    if (options.add.kind !== 'add' || options.add.speed !== 'reaction') throw new Error('Only Reaction Add is allowed during payment');
    binding.state = 'resumed';
    this.paymentContinuation = null;
    try {
      this.consumedPaymentContinuations.add(key);
      this.restorePaymentContinuation(restorePoint.checkpoint);
      options.restore(restorePoint);
      return this.paymentContinuationAtomic(() => {
        if (this.busy !== 'finalize') throw new Error('Payment continuation is no longer at Pay Costs');
        const parent = this.entries.find(item => item.id === snapshot.itemId && item.status === 'finalized');
        if (parent === undefined || parent.controller !== snapshot.payer || parent.source.ref.id !== snapshot.source.id ||
            parent.source.ref.zoneEntryId !== snapshot.source.zoneEntryId || parent.costPlan?.id !== snapshot.costPlanId) {
          throw new Error('Payment continuation parent, actor, source or cost plan no longer matches');
        }
        if (!this.playDestinationIsLegal(parent)) throw new Error('Play destination is no longer legally allowed');
        for (const plan of parent.targetPlans) {
          const resolution = resolveTargetPlan(this.context(parent, 'chain-item-finalize', [], parent.choicePlan), plan, {
            isPending: ref => this.isPending(ref), isLegal: snapshot => this.targetIsLegal(snapshot, parent.controller),
          });
          if (resolution.invalid.length > 0) throw new TargetSelectionError('invalid-target-choice', 'A parent target is no longer legal before Pay Costs');
        }
        const paymentContext = this.context(parent, 'chain-item-finalize', parent.targetPlans, parent.choicePlan);
        const current = assessCostPayment(paymentContext, parent.costPlan!, {
          transaction: run => this.atomic(run),
        });
        if (!current.payable) throw new Error('Parent cost is no longer payable before the Reaction Add');
        this.activateAddDuringPayment(options.add);
        const after = assessCostPayment(this.context(parent, 'chain-item-finalize', parent.targetPlans, parent.choicePlan), parent.costPlan!, {
          transaction: run => this.atomic(run),
        });
        if (!after.payable) throw new Error('Parent cost remains unpayable after the Reaction Add');
        let payment: CostPaymentReceipt | undefined;
        const resume = () => { payment = this.payFinalizedParent(parent); return payment as A; };
        const value = options.parent(resume);
        if (options.payParent === true && payment === undefined) throw new Error('Payment continuation parent callback did not pay the frozen cost');
        return { value, ...(options.payParent === true ? { payment } : { handle: this.suspendPaymentContinuation() }),
          add: { status: 'executed', results: [], linkedValues: {}, events: [] } };
      });
    } catch (error) {
      binding.state = 'invalidated';
      this.consumedPaymentContinuations.add(key);
      throw error;
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
  private restorePaymentContinuation(checkpoint: unknown): void {
    const saved = paymentCheckpointRecord(checkpoint);
    const host = saved.host; const pipeline = saved.pipeline as ReturnType<EventPipeline['checkpoint']>;
    const chain = paymentCheckpointRecord(saved.chain);
    const entries = chain.entries as ChainItem[];
    if (!Array.isArray(entries)) throw new TypeError('Payment continuation Chain entries are invalid');
    this.options.host.restore(structuredClone(host));
    this.pipeline.restore(structuredClone(pipeline));
    this.entries = structuredClone(entries);
    this.issued = new Set(chain.issued as readonly string[]);
    this.traces = [...(chain.traces as readonly ChainTrace[])];
    this.outstanding = [...(chain.outstanding as readonly string[])];
    this.cleanupNeeded = chain.cleanupNeeded === true;
    this.priorityHolder = (chain.priorityHolder as PlayerId | null | undefined) ?? null;
    this.focusHolder = (chain.focusHolder as PlayerId | null | undefined) ?? null;
    this.showdown = chain.showdown === true;
    this.origin = (chain.origin as ChainKind | null | undefined) ?? null;
    this.priorityPasses = chain.priorityPasses as number; this.focusPasses = chain.focusPasses as number;
    this.triggerSequence = chain.triggerSequence as number; this.delayedSequence = chain.delayedSequence as number;
    this.phase = chain.phase as string; this.busy = chain.busy as ChainEngine['busy'];
    this.choiceMemory.restore(structuredClone(chain.choiceMemory) as ReturnType<ChoiceMemory['snapshot']>);
    this.finalizeAnswers = new Map([...(chain.finalizeAnswers as Map<string, unknown>)].map(([key, value]) => [key, structuredClone(value)] as const));
    const layers = saved.layers as ReturnType<LayerEngine['registry']['snapshot']>;
    this.layers.registry.clear();
    for (const entry of layers) this.layers.registry.register(entry.effect, entry.duration, entry.timestamp);
    this.layers.setObjects(this.options.host.objects());
  }
  private paymentContinuationAtomic<T>(run: () => T): T {
    this.transactionDepth++;
    try { return run(); }
    catch (error) {
      if (this.paymentContinuationCheckpoint !== null) this.restorePaymentContinuation(this.paymentContinuationCheckpoint);
      throw error;
    } finally { this.transactionDepth--; }
  }
  advance(): void {
    if (this.busy !== 'idle') throw new Error('HOT FEPR is not reentrant');
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
        const ready = item.kind === 'gear' || item.costPlan?.selectedAdditional.some(cost => cost.kind === 'accelerate');
        const state = this.pipeline.commit({ type: ready ? 'ready' : 'exhaust', object: item.object });
        if (state.status !== 'done') throw new Error('Permanent entry state could not be applied');
        const location = item.location ?? { type: 'base' as const, player: item.controller };
        const outcome = this.pipeline.commit({ type: 'move-zone', object: item.object, to: location.type === 'base' ? 'base' : 'battlefield', location });
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
      const result = resolveChainBody(item.body, context, conditionInputs);
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
