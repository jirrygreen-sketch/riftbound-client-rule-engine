import type { Condition } from '@riftbound/card-dsl';
import type { ActionOutcome, ContractGameAction, GameAction, Instruction, ObjectRef, ObjectSnapshot, PlayerId, ResolveContext, Value } from '../effects/contract.js';
import { AwaitChoice } from '../effects/contract.js';
import { CONTRACT_ACTION_CAPABILITY_VERSION } from '../effects/contract.js';
import type { ExecutionOutcome } from '../effects/interpreter.js';
import { resolveChainBody } from './interpreter-adapter.js';
import { buildCostPlan } from '../cost/cost-plan.js';
import { payCostPlan } from '../cost/payment.js';
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
import { finalizeCostPlanInput, finalizeInstructionChoices, hasChoiceMemory, hasFinalizeChoices, modeNodeTargetRequirements } from './finalize/index.js';
import { collectTargetTaxes } from '../target/tax/index.js';
import { boundTargetTaxes, ignoresTargetTax } from '../programs/static-adapters/capabilities.js';

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
export interface ChainItem extends ChainDraft {
  status: 'pending' | 'finalized';
  object: ObjectRef;
  targetPlans: TargetPlan[];
  pickPlans?: readonly OrderedPickPlan[];
  costPlan?: CostPlan;
  payment?: CostPaymentReceipt;
  choicePlan?: ChoicePlan;
  finalizeLinks?: Readonly<Record<string, Value>>;
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
    };
    this.transactionDepth++;
    try { return run(); }
    catch (error) {
      const pendingFinalizeAnswers = error instanceof AwaitChoice ? new Map(this.finalizeAnswers) : undefined;
      this.options.host.restore(host); this.pipeline.restore(events); Object.assign(this, saved);
      this.choiceMemory.restore(saved.choiceMemorySnapshot);
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
    const answerPrefix = this.finalizeAnswerPrefix(item, at);
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
  private finalizeAnswerPrefix(item: ChainDraft, _at: TimingPointId): string {
    const source = item.trigger?.source.ref ?? item.source.ref;
    return [item.id, this.pipeline.clock.turn, item.controller, source.id, source.zoneEntryId].join('\u0000');
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
      const controlPlanRequired = hasFinalizeChoices(item.body);
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
      const answerPrefix = this.finalizeAnswerPrefix(item, 'chain-item-finalize');
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
          for (const requirement of modeNodeTargetRequirements(item.body)) {
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
      const context = this.context(item, 'chain-item-resolve', item.targetPlans, item.choicePlan);
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

/** Never let interpreter-local target choices silently bypass the event pipeline. */
function assertFinalizationSurface(body: readonly Instruction[], controlPlanRequired = false, nested = false): void {
  for (const instruction of body) {
    if (nested && instruction.targets?.length) {
      if (!controlPlanRequired) throw new ChainContractBlockedError('Nested/repeated targets require an interpreter target-selection lifecycle adapter');
    }
    if (instruction.op === 'choice.mode') {
      if (!controlPlanRequired || instruction.args.count === undefined || instruction.args.different === undefined) {
        throw new ChainContractBlockedError('Mode choices require complete Finalize/Resolve choice-plan metadata');
      }
    }
    const expression = instruction.args.body;
    if (instruction.op === 'sequence' && expression && (expression.kind === 'constant' || expression.kind === 'literal') && Array.isArray(expression.value)) {
      assertFinalizationSurface(expression.value as unknown as readonly Instruction[], controlPlanRequired, true);
    }
    if (instruction.op === 'choice.mode' && expression && (expression.kind === 'constant' || expression.kind === 'literal') && Array.isArray(expression.value)) {
      for (const mode of expression.value as unknown as readonly { readonly body?: unknown }[]) {
        if (Array.isArray(mode.body)) assertFinalizationSurface(mode.body as readonly Instruction[], controlPlanRequired, true);
      }
    }
    if (instruction.op === 'repeat' && expression && (expression.kind === 'constant' || expression.kind === 'literal') && Array.isArray(expression.value)) {
      assertFinalizationSurface(expression.value as unknown as readonly Instruction[], controlPlanRequired, true);
    }
  }
}
export class ChainContractBlockedError extends Error {
  readonly status = 'blocked';
  constructor(message: string) { super(message); this.name = 'ChainContractBlockedError'; }
}
