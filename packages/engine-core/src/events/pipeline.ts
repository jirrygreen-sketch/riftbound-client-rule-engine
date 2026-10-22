import type { ActionOutcome, ContractGameAction, GameAction, ObjectFilter, ObjectSnapshot, PlayerId, ResolveContext } from '../effects/contract.js';
import { getTimingPoint } from './timing-points.js';
import { matchesTriggerEvent } from './pipeline-match.js';
import { assertTriggerSpec } from './trigger-spec.js';
import type { ActionExecution, NamedTriggerActivation, PipelineClock, PipelineEvent, PipelineHost, RegisteredTrigger, ReplacementCostEvidence, ReplacementMatchContext, ReplacementRegistration, TimingEmission, TriggerRegistration, TriggerRule, TriggerRuleContext, TriggerSnapshot } from './pipeline-types.js';
import { evaluateCondition } from '../effects/interpreter/condition.js';
import { MissingInformation } from '../effects/interpreter/values.js';
import { bindEventHistory } from '../effects/interpreter/expr-ext/event-history.js';
import { matchesObjectPredicates } from '../effects/filters/predicates.js';
import { matchesObjectFilter } from '../layers/filter.js';
import { resolveRuleAmount } from './trigger-rules/index.js';
import { evaluateAcceleratePayment } from '../effects/keywords/Accelerate.js';

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function explicitBatchIdentity(emission: TimingEmission): string | undefined {
  for (const value of [emission.batchId, emission.simultaneousGroup]) {
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new TypeError('Timing batch identity must be a non-empty string');
    }
  }
  // Action producers use batchId for the enclosing atomic action and
  // simultaneousGroup for a named timing wave within it. The enclosing batch
  // identity is authoritative; simultaneousGroup is only a fallback when no
  // action batch was supplied.
  return emission.batchId ?? emission.simultaneousGroup;
}

function relativeQuery(context: ResolveContext, controller: PlayerId): ResolveContext['query'] {
  return filter => {
    const normalized: Record<string, unknown> = { ...filter };
    for (const key of ['controller', 'owner'] as const) {
      if (normalized[key] === 'self') normalized[key] = controller;
    }
    return context.query({}).filter(object => {
      for (const key of ['controller', 'owner'] as const) {
        if (normalized[key] === 'opponent' && object[key] === controller) return false;
      }
      return matchesObjectPredicates({
        ...normalized,
        ...(normalized.controller === 'opponent' ? { controller: 'any' } : {}),
        ...(normalized.owner === 'opponent' ? { owner: 'any' } : {}),
      }, object);
    });
  };
}

/**
 * CR 383.4.c.2 / 359.3.f.3 freezes the Units participating in one Conquer or
 * Hold wave. Their identities stay fixed, while current characteristics come
 * from the host's already-layered query view (CR 708/710). A malformed payload
 * fails the condition closed instead of widening it to every object.
 */
function participatingUnitQuery(
  host: PipelineHost,
  event: PipelineEvent,
  controller: PlayerId,
): ResolveContext['query'] {
  const raw = (event.details as Readonly<Record<string, unknown>> | undefined)?.participatingUnits;
  const refs: { readonly id: string; readonly zoneEntryId: number }[] = [];
  if (raw !== undefined) {
    if (!Array.isArray(raw)) throw new TypeError('participatingUnits must be an array of ObjectRefs');
    for (const candidate of raw) {
      const item = candidate as { readonly id?: unknown; readonly zoneEntryId?: unknown };
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate) ||
          typeof item.id !== 'string' || item.id.length === 0 ||
          !Number.isSafeInteger(item.zoneEntryId) || (item.zoneEntryId as number) < 0) {
        throw new TypeError('participatingUnits must contain exact ObjectRefs');
      }
      refs.push({ id: item.id, zoneEntryId: item.zoneEntryId as number });
    }
  }
  return filter => {
    if (raw === undefined) {
      return host.context(event.source ?? event.object!, controller, event.timingPoint).query(filter);
    }
    const source = host.objects().find(object => object.ref.id === event.source?.ref.id &&
      object.ref.zoneEntryId === event.source?.ref.zoneEntryId) ?? event.source;
    const candidates = refs.flatMap(ref => {
      const object = host.context(source ?? event.object!, controller, event.timingPoint).object(ref);
      return object === null ? [] : [object];
    });
    return candidates.filter(object => matchesObjectFilter(filter, object, {
      anchor: source ?? null,
      controller,
    }));
  };
}

function evaluateTriggerCondition(
  pipeline: { readonly events: readonly PipelineEvent[] },
  host: PipelineHost,
  registration: TriggerRegistration,
  event: PipelineEvent,
  source: ObjectSnapshot,
  controller: PlayerId,
): boolean {
  const condition = registration.spec.condition;
  if (condition === undefined) return true;
  const base = host.context(source, controller, event.timingPoint);
  const frozenQuery = participatingUnitQuery(host, event, controller);
  const context = bindEventHistory(new Proxy(base, { get(target, key) {
    if (key === 'query') return (filter: ObjectFilter) => {
      if ((event.details as Readonly<Record<string, unknown>> | undefined)?.participatingUnits !== undefined) {
        return frozenQuery(filter);
      }
      return relativeQuery(target, controller)(filter);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } }), pipeline);
  return evaluateCondition(condition as unknown as import("@riftbound/card-dsl").Condition, {
    context,
    event,
    linked: key => context.linked(key),
    canLookBack: () => true,
    isIgnored: () => false,
    query: filter => context.query(filter)
  });
}

function namedEventDependency(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some(entry => namedEventDependency(entry, seen));
  const record = value as Record<string, unknown>;
  if ((record.kind === 'linked' || record.kind === 'linked-value') &&
      ['eventTimingPoint', 'eventObject', 'eventDetails', 'eventPlayer'].includes(String(record.key ?? record.instructionId))) return true;
  if (record.event === 'it' || record.kind === 'event-it' ||
      ['played-from-hand', 'playedFromHand', 'played-from-zone', 'playedFromZone',
       'event-printed', 'printed-characteristic', 'event-printed-characteristic'].includes(String(record.kind))) return true;
  if (record.kind === 'relation' && [record.left, record.right].some(role =>
    role === 'object' || role === 'source' || role === 'target' || role === 'it')) return true;
  return Object.values(record).some(entry => namedEventDependency(entry, seen));
}

function namedFilterEventDependency(filter: unknown): boolean {
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) return false;
  const pattern = filter as Record<string, unknown>;
  if (pattern.here !== undefined || pattern.it !== undefined || pattern.fromZone !== undefined || pattern.toZone !== undefined ||
      pattern.amount !== undefined || pattern.details !== undefined) return true;
  for (const role of ['object', 'target'] as const) {
    const nested = pattern[role];
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      const value = nested as Record<string, unknown>;
      if (value.here !== undefined || value.event === 'it' || value.role === 'it' ||
          value.object === 'it' || value.source === 'it') return true;
    }
  }
  return false;
}

function namedActivationRequiresRealEvent(registration: TriggerRegistration): boolean {
  return namedFilterEventDependency(registration.spec.filter) ||
    namedEventDependency(registration.spec.condition) ||
    registration.body.some(instruction => namedEventDependency(instruction.condition) || namedEventDependency(instruction.args));
}

export class EventPipeline {
  readonly clock: PipelineClock = { turn: 1, phase: 1, combat: 0, showdown: 0, chain: 0 };
  private log: PipelineEvent[] = [];
  private triggers = new Map<string, TriggerRegistration>();
  private replacements = new Map<string, ReplacementRegistration>();
  /** Exact entry evidence for one play action; never retained in checkpoints. */
  private playCostEvidence: ReplacementCostEvidence | undefined;
  private consumed = new Map<string, number>();
  private replacementUses = new Set<string>();
  private rules = new Map<string, TriggerRule>();
  private sequence = 0;
  private batchSequence = 0;
  private scanQueue: PipelineEvent[] = [];
  private scanning = false;
  private suspended = 0;
  private namedActivationSequence = 0;
  /** Monotonic lifetime epoch; restore invalidates every pre-restore token. */
  private namedActivationEpoch = 0;
  private namedActivations = new Map<string, { readonly registrationId: string; consumed: boolean }>();
  onTrigger: (snapshot: TriggerSnapshot) => void = () => { throw new Error('Trigger sink is not attached'); };
  onEvent?: (event: PipelineEvent) => void;
  routeAction?: (action: GameAction) => ActionExecution | undefined;
  constructor(readonly host: PipelineHost, readonly turnOrder: readonly PlayerId[], public turnPlayer: PlayerId) {
    if (turnOrder.length < 2 || new Set(turnOrder).size !== turnOrder.length || !turnOrder.includes(turnPlayer)) throw new TypeError('Invalid turn order');
  }
  get events(): readonly PipelineEvent[] { return structuredClone(this.log); }
  /** Stable read-only copies of all currently registered trigger candidates. */
  registeredTriggers(): readonly RegisteredTrigger[] {
    return deepFreeze(structuredClone([...this.triggers.values()]));
  }
  /**
   * Prepare a named activation without emitting a real event or consuming a
   * frequency. The returned token is consumed exactly once by the real Chain
   * transaction that installs its Pending item. Unsupported event-dependent
   * conditions fail closed because CR 383.4.g.2 says no such event occurred.
   */
  activateTrigger(id: string): NamedTriggerActivation | null {
    const registration = this.triggers.get(id);
    if (registration === undefined) return null;
    if (namedActivationRequiresRealEvent(registration)) return null;
    const current = this.host.objects().find(object => object.ref.id === registration.source.ref.id);
    const source = registration.delayed ? registration.source : current;
    if (source === undefined) return null;
    if (registration.boundToIncarnation && source.ref.zoneEntryId !== registration.source.ref.zoneEntryId) return null;
    if (!registration.delayed && !(registration.activeZones ?? ['board']).includes(source.zone)) return null;
    const captured = deepFreeze(structuredClone(source));
    const controller = registration.delayed ? registration.controller : captured.controller;
    const hold = (registration.spec.filter as { readonly event?: string; readonly type?: string; readonly kind?: string }).event ??
      (registration.spec.filter as { readonly type?: string }).type ??
      (registration.spec.filter as { readonly kind?: string }).kind;
    if (hold === 'hold' && !registration.delayed && captured.location?.type !== 'battlefield') return null;
    if (registration.spec.condition !== undefined) {
      const probe = deepFreeze({
        reason: 'named-trigger-activation',
        timingPoint: 'chain-item-finalize', kind: 'named-trigger-activation',
        source: captured, player: controller,
        details: { namedTriggerActivation: true, registrationId: id, emitOriginalEvent: false },
      }) as unknown as PipelineEvent;
      try {
        if (!evaluateTriggerCondition(this, this.host, registration, probe, captured, controller)) return null;
      } catch (error) {
        if (!(error instanceof MissingInformation) || this.host.testTrigger === undefined) return null;
        if (!this.host.testTrigger(registration, probe, captured)) return null;
      }
    }
    const frequencyKey = this.frequencyKey(registration, captured, {
      batchId: `named:${id}:${this.clock.turn}`, eventId: this.sequence + 1,
    } as PipelineEvent);
    const frequencyLimit = registration.maxPerScope ?? (registration.spec.once === undefined ? undefined : 1);
    if (frequencyKey !== null && (this.consumed.get(frequencyKey) ?? 0) >= (frequencyLimit ?? 1)) return null;
    const epoch = this.namedActivationEpoch;
    const transactionId = `named-trigger:${epoch}:${++this.namedActivationSequence}`;
    const transaction = deepFreeze({ version: 'riftbound.named-trigger-activation.v1', id: transactionId, epoch, registrationId: id });
    const token = deepFreeze({
      kind: 'named-trigger-activation' as const,
      registration: structuredClone(registration),
      source: captured,
      controller,
      frequencyKey,
      ...(frequencyLimit === undefined ? {} : { frequencyLimit }),
      transaction,
      consume: () => {
        const key = (transaction as { readonly id: string }).id;
        if (epoch !== this.namedActivationEpoch) return false;
        const state = this.namedActivations.get(key);
        if (state !== undefined) return false;
        const snapshot: TriggerSnapshot = {
          registration: structuredClone(registration), source: structuredClone(captured), controller,
          event: {} as PipelineEvent, frequencyKey, ...(frequencyLimit === undefined ? {} : { frequencyLimit }),
        };
        const consumed = this.consume(snapshot);
        this.namedActivations.set(key, { registrationId: id, consumed });
        return consumed;
      },
    }) as NamedTriggerActivation;
    return token;
  }
  registerTrigger(registration: TriggerRegistration): void {
    getTimingPoint(registration.spec.at);
    assertTriggerSpec(registration.spec);
    if (registration.maxPerScope !== undefined &&
        (!Number.isSafeInteger(registration.maxPerScope) || registration.maxPerScope < 0)) {
      throw new RangeError('Trigger maxPerScope must be a nonnegative safe integer');
    }
    if (this.triggers.has(registration.id)) throw new Error(`Duplicate trigger ${registration.id}`);
    this.triggers.set(registration.id, structuredClone(registration));
  }
  unregisterTrigger(id: string): void { this.triggers.delete(id); }
  /** O(1) lifecycle probe; never snapshots or exposes the mutable registry. */
  hasTriggerRegistration(id: string): boolean { return this.triggers.has(id); }
  registerTriggerRule(rule: TriggerRule): void {
    if (!rule.id || rule.id.trim().length === 0) throw new TypeError('Trigger rule id must be non-empty');
    if (rule.mode !== 'additional' && rule.mode !== 'multiply' && rule.mode !== 'suppress') {
      throw new TypeError('Trigger rule mode must be additional, multiply, or suppress');
    }
    if (rule.amount !== undefined && typeof rule.amount !== 'function' &&
        (!Number.isSafeInteger(rule.amount) || rule.amount < 0)) {
      throw new RangeError('Trigger rule amount must be a nonnegative safe integer or a function');
    }
    if (this.rules.has(rule.id)) throw new Error(`Duplicate trigger rule ${rule.id}`);
    this.rules.set(rule.id, rule);
  }
  unregisterTriggerRule(id: string): void { this.rules.delete(id); }
  /** Alias used by adapters that distinguish multiplicity from suppression. */
  registerMultiplicityRule(rule: TriggerRule): void {
    if (rule.mode !== 'additional' && rule.mode !== 'multiply') throw new TypeError('Multiplicity rule must add or multiply triggers');
    this.registerTriggerRule(rule);
  }
  registerSuppressionRule(rule: TriggerRule): void {
    if (rule.mode !== 'suppress') throw new TypeError('Suppression rule must suppress triggers');
    this.registerTriggerRule(rule);
  }
  registerReplacement(registration: ReplacementRegistration): void {
    if (this.replacements.has(registration.id)) throw new Error(`Duplicate replacement ${registration.id}`);
    this.replacements.set(registration.id, registration);
  }
  unregisterReplacement(id: string): void { this.replacements.delete(id); }
  /** O(1) lifecycle probe; never snapshots or exposes the mutable registry. */
  hasReplacementRegistration(id: string): boolean { return this.replacements.has(id); }
  /**
   * Run one state action with the frozen Finalize plan/receipt visible to this
   * exact play. The caller's atomic boundary owns rollback, so evidence never
   * outlives the action even when it throws.
   */
  withPlayCostEvidence<T>(evidence: ReplacementCostEvidence, run: () => T): T {
    if (this.playCostEvidence !== undefined) throw new Error('Nested play cost evidence is not supported');
    const frozen = deepFreeze(structuredClone(evidence));
    const paid = evaluateAcceleratePayment(frozen);
    this.playCostEvidence = frozen;
    const originalContext = this.host.context;
    const baseContext = originalContext.bind(this.host);
    this.host.context = (source, controller, at) => {
      const context = baseContext(source, controller, at);
      return new Proxy(context, { get(target, key) {
        if (key === 'linked') return (linked: string) =>
          linked === 'accelerate.accelerate-cost-paid' ? paid : target.linked(linked);
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    try { return run(); }
    finally {
      this.host.context = originalContext;
      this.playCostEvidence = undefined;
    }
  }
  private replacementMatchContext(): ReplacementMatchContext {
    const evidence = this.playCostEvidence;
    return evidence === undefined ? {} : { cost: evidence, source: evidence.source };
  }
  private frequencyKey(registration: TriggerRegistration, source: ObjectSnapshot, event: PipelineEvent): string | null {
    const scope = registration.spec.once;
    if (!scope) return null;
    const value = scope === 'per-game' ? 'game' :
      scope === 'per-object' ? `${source.ref.id}:${source.ref.zoneEntryId}` :
      scope === 'per-batch' ? (event.batchId ?? `event:${event.eventId}`) :
      this.clock[scope.slice(4) as keyof PipelineClock];
    return JSON.stringify([registration.id, source.ref, scope, value]);
  }
  consume(snapshot: TriggerSnapshot): boolean {
    if (snapshot.frequencyKey === null) return true;
    const limit = snapshot.frequencyLimit ?? 1;
    const used = this.consumed.get(snapshot.frequencyKey) ?? 0;
    if (used >= limit) return false;
    this.consumed.set(snapshot.frequencyKey, used + 1);
    return true;
  }
  checkpoint() {
    return { log: [...this.log], triggers: new Map(this.triggers), replacements: new Map(this.replacements), rules: new Map(this.rules), consumed: new Map(this.consumed), replacementUses: new Set(this.replacementUses), sequence: this.sequence, batchSequence: this.batchSequence, namedActivationSequence: this.namedActivationSequence, namedActivationEpoch: this.namedActivationEpoch, namedActivations: new Map(this.namedActivations), scanQueue: [...this.scanQueue], clock: { ...this.clock }, turnPlayer: this.turnPlayer };
  }
  restore(state: ReturnType<EventPipeline['checkpoint']>): void {
    // Advance from both the live and checkpoint epoch. A checkpoint captured in
    // an earlier restore lifetime can be reused repeatedly without reviving a
    // handle created after that checkpoint.
    const nextEpoch = Math.max(this.namedActivationEpoch, state.namedActivationEpoch) + 1;
    if (!Number.isSafeInteger(nextEpoch)) throw new RangeError('Named activation epoch exhausted');
    this.namedActivationEpoch = nextEpoch;
    this.log = [...state.log]; this.triggers = new Map(state.triggers); this.replacements = new Map(state.replacements); this.rules = new Map(state.rules); this.consumed = new Map(state.consumed); this.replacementUses = new Set(state.replacementUses); this.sequence = state.sequence; this.batchSequence = state.batchSequence; this.namedActivationSequence = state.namedActivationSequence; this.namedActivations = new Map(state.namedActivations); this.scanQueue = [...state.scanQueue];
    Object.assign(this.clock, state.clock); this.turnPlayer = state.turnPlayer;
  }
  /** Timings from rules modules and committed actions share exactly one scanner. */
  emit(emission: TimingEmission, action?: GameAction): PipelineEvent {
    return this.emitBatch([emission], action)[0]!;
  }
  /** Publish one atomic wave. All emitted timings share one batch identity. */
  emitBatch(emissions: readonly TimingEmission[], action?: GameAction, batchId?: string): readonly PipelineEvent[] {
    if (emissions.length === 0) return [];
    if (batchId !== undefined && (typeof batchId !== 'string' || batchId.length === 0)) {
      throw new TypeError('Timing batch identity must be a non-empty string');
    }
    const explicitBatchIds = new Set<string>();
    const fallbackGroups = new Set<string>();
    for (const emission of emissions) {
      const identity = explicitBatchIdentity(emission);
      if (emission.batchId !== undefined) explicitBatchIds.add(identity!);
      else if (identity !== undefined) fallbackGroups.add(identity);
    }
    if (explicitBatchIds.size > 1) throw new TypeError('Timing emissions in one atomic batch must share a batch identity');
    if (explicitBatchIds.size === 0 && fallbackGroups.size > 1) {
      throw new TypeError('Timing emissions in one atomic batch must share a simultaneous group');
    }
    const sharedBatchId = explicitBatchIds.values().next().value ?? fallbackGroups.values().next().value;
    if (batchId !== undefined && sharedBatchId !== undefined && batchId !== sharedBatchId) {
      throw new TypeError('Explicit batch identity conflicts with emission batch identity');
    }
    const resolvedBatchId = batchId ?? sharedBatchId ?? this.nextBatchId();
    const events: PipelineEvent[] = [];
    for (const [batchIndex, emission] of emissions.entries()) {
      getTimingPoint(emission.timingPoint);
      if (emission.timingPoint === 'turn-start') this.clock.turn++;
      if (emission.timingPoint === 'combat-start') this.clock.combat++;
      if (emission.timingPoint === 'showdown-open') this.clock.showdown++;
      if (['awaken-start', 'beginning-start', 'channel-start', 'draw-start', 'main-start', 'turn-end'].includes(emission.timingPoint)) this.clock.phase++;
      const event = deepFreeze(structuredClone({ type: 'task-resolved' as const, seq: this.sequence + 1, eventId: ++this.sequence, turnNumber: this.clock.turn, activePlayerId: this.turnPlayer, taskId: `pipeline:${this.sequence}`, sourceCardId: emission.source?.cardId ?? emission.object?.cardId ?? '', reason: emission.kind ?? emission.timingPoint, autoResolved: true as const, ...emission, batchId: resolvedBatchId, batchIndex, batchSize: emissions.length, ...(action ? { action } : {}) })) as PipelineEvent;
      events.push(event);
      this.log.push(event);
      this.onEvent?.(event);
      this.scanQueue.push(event);
    }
    this.drain();
    return events;
  }
  private nextBatchId(): string { return `pipeline-batch:${++this.batchSequence}`; }
  private drain(): void {
    if (!this.scanning && !this.suspended) {
      this.scanning = true;
      try {
        let scans = 0;
        while (this.scanQueue.length) {
          if (++scans > 10000) throw new Error('Trigger cascade exceeded the rules-task budget');
          const first = this.scanQueue[0]!;
          let end = 1;
          while (end < this.scanQueue.length && this.scanQueue[end]!.batchId === first.batchId) end++;
          const wave = this.scanQueue.splice(0, end);
          this.scan(wave);
          for (const next of wave) for (const [id, registration] of this.triggers) if (registration.expiresAt === next.timingPoint) this.triggers.delete(id);
        }
      }
      finally { this.scanning = false; }
    }
  }
  private publish(emissions: readonly TimingEmission[], action?: GameAction): PipelineEvent[] {
    const groups = new Map<string, TimingEmission[]>();
    for (const emission of emissions) {
      const group = emission.simultaneousGroup ?? 'action';
      groups.set(group, [...(groups.get(group) ?? []), emission]);
    }
    const events: PipelineEvent[] = [];
    for (const group of groups.values()) {
      this.suspended++;
      try { events.push(...this.emitBatch(group, action)); }
      finally { this.suspended--; }
      this.drain();
    }
    return events;
  }
  /** Structural actions install their Pending item before entry events scan. */
  deferTriggerScan<T>(run: () => T): T {
    let committed = false;
    this.suspended++;
    try { const result = run(); committed = true; return result; }
    finally { this.suspended--; if (committed) this.drain(); }
  }
  private scan(events: readonly PipelineEvent[]): void {
    const hits: TriggerSnapshot[] = [];
    for (const event of events) {
    for (const registration of this.triggers.values()) {
      if (registration.spec.at !== event.timingPoint) continue;
      const current = this.host.objects().find(object => object.ref.id === registration.source.ref.id);
      // Leave timings carry last-known characteristics before the zone transition.
      const leaving = (event.timingPoint.startsWith('object-leaves-') || event.timingPoint === 'object-killed') && event.object?.ref.id === registration.source.ref.id;
      const source = leaving ? event.object : current;
      if (registration.boundToIncarnation && source?.ref.zoneEntryId !== registration.source.ref.zoneEntryId) continue;
      if (!registration.delayed && (!source || !(registration.activeZones ?? ['board']).includes(source.zone))) continue;
      const captured = structuredClone(source ?? registration.source);
      const controller = registration.delayed ? registration.controller : captured.controller;
      if (!matchesTriggerEvent(registration.spec.filter, event, controller, captured)) continue;
      if (registration.spec.condition) {
        try {
          // The pipeline evaluator has the captured source, immutable event,
          // and relative-player context.  A legacy host hook is only a fallback
          // for conditions that genuinely need host-specific information.
          if (!evaluateTriggerCondition(this, this.host, registration, event, captured, controller)) continue;
        } catch (error) {
          if (!(error instanceof MissingInformation) || !this.host.testTrigger) throw error;
          if (!this.host.testTrigger(registration, event, captured)) continue;
        }
      }
      const frequencyKey = this.frequencyKey(registration, captured, event);
      const frequencyLimit = registration.maxPerScope ?? (registration.spec.once === undefined ? undefined : 1);
      if (frequencyKey !== null && (this.consumed.get(frequencyKey) ?? 0) >= (frequencyLimit ?? 1)) continue;
      const context: TriggerRuleContext = { registration, source: captured, controller, event };
      const effect = this.triggerRuleEffect(context);
      if (effect.suppressed) continue;
      // Keep every frequency-matching instance in the collection wave. The
      // controller's legal ordering chooses which instance is finalized, and
      // consume() enforces once/maxPerScope exactly at that point.
      for (let occurrence = 0; occurrence < effect.multiplicity; occurrence++) {
        hits.push({ registration, source: captured, controller, event, frequencyKey, frequencyLimit, occurrence, multiplicity: effect.multiplicity, batchId: event.batchId });
      }
    }
    }
    const start = this.turnOrder.indexOf(this.turnPlayer);
    const order = [...this.turnOrder.slice(start), ...this.turnOrder.slice(0, start)];
    for (const controller of order) {
      let own = hits.filter(hit => hit.controller === controller);
      own = own.filter(hit => {
        if (!hit.registration.optional) return true;
        const occurrence = hit.occurrence ?? 0;
        const answer = this.host.choose<boolean>({ id: `trigger:${hit.event.eventId}:${hit.registration.id}:${occurrence}:optional`, chooser: controller, visibility: 'public', type: 'optional' });
        if (typeof answer !== 'boolean') throw new TypeError('Optional trigger answer must be boolean');
        return answer;
      });
      if (own.length > 1) {
        const remaining = [...own], ordered: TriggerSnapshot[] = [];
        while (remaining.length > 1) {
          const token = (hit: TriggerSnapshot) => own.filter(candidate => candidate.registration.id === hit.registration.id).length > 1
            ? `${hit.registration.id}:${hit.event.eventId}:${hit.occurrence ?? 0}`
            : hit.registration.id;
          const id = this.host.choose<string>({ id: `trigger:${events[0]!.eventId}:${controller}:order:${ordered.length}`, chooser: controller, visibility: 'public', type: 'mode', options: remaining.map(token) });
          const index = remaining.findIndex(hit => token(hit) === id);
          if (index < 0) throw new TypeError('Invalid trigger order');
          ordered.push(remaining.splice(index, 1)[0]!);
        }
        own = [...ordered, ...remaining];
      }
      for (const hit of own) {
        // The sink and the chain's structured clone must both retain the exact
        // immutable event identity used to create the trigger snapshot.
        this.onTrigger(deepFreeze(structuredClone({ ...hit, event: deepFreeze(structuredClone(hit.event)) })));
      }
    }
  }
  private triggerRuleEffect(context: TriggerRuleContext): { readonly suppressed: boolean; readonly multiplicity: number } {
    let multiplicity = 1;
    let multiplicityMode: 'additional' | 'multiply' | undefined;
    const rules = [...this.rules.values()].sort((left, right) => left.id.localeCompare(right.id));
    for (const rule of rules) {
      let ruleSource: ObjectSnapshot | undefined;
      if (rule.source !== undefined) {
        const current = this.host.objects().find(object => object.ref.id === rule.source!.ref.id);
        const source = current ?? context.event.object;
        if (rule.boundToIncarnation && source?.ref.zoneEntryId !== rule.source.ref.zoneEntryId) continue;
        if (!rule.delayed && (!source || !(rule.activeZones ?? ['board']).includes(source.zone))) continue;
        ruleSource = source;
      }
      const ruleContext = { ...context, ...(ruleSource === undefined ? {} : { ruleSource }) };
      if (!rule.matches(ruleContext)) continue;
      if (rule.mode === 'suppress') return { suppressed: true, multiplicity: 0 };
      if (multiplicityMode !== undefined && multiplicityMode !== rule.mode) {
        throw new RangeError('Additional and multiply trigger rules require an authoritative ordering');
      }
      multiplicityMode = rule.mode;
      const amount = resolveRuleAmount(rule, ruleContext);
      multiplicity = rule.mode === 'additional' ? multiplicity + amount : multiplicity * amount;
      if (!Number.isSafeInteger(multiplicity) || multiplicity < 0) throw new RangeError(`Invalid trigger multiplicity after ${rule.id}`);
    }
    return { suppressed: false, multiplicity };
  }
  commit(action: GameAction): ActionOutcome {
    const checkpoint = this.host.checkpoint(), own = this.checkpoint();
    try { return this.apply(action, action, new Set()); }
    catch (error) { this.host.restore(checkpoint); this.restore(own); throw error; }
  }
  commitContract(action: ContractGameAction): ActionOutcome {
    const checkpoint = this.host.checkpoint(), own = this.checkpoint();
    try {
      if (this.host.executeContract === undefined) {
        throw new Error('Contract action execution is unavailable');
      }
      const boundary = this.host.deathBoundary;
      const isDeath = action.type === 'kill' ||
        action.type === 'batch' && action.actions.length > 0 && action.actions.every(leaf => leaf.type === 'kill');
      const execution = boundary === undefined || !isDeath
        ? this.host.executeContract(action)
        : boundary.executeContract(action, context => {
            if (context.batchId.length === 0 || context.emissions.length === 0) return;
            this.emitBatch(context.emissions, undefined, context.batchId);
          });
      if (execution.outcome.status !== 'done') {
        if (execution.emissions.length) throw new Error('Unperformed contract actions cannot emit trigger timings');
        return execution.outcome;
      }
      const events = this.publish(execution.emissions);
      const hostEvents = isDeath && boundary !== undefined ? [] : execution.outcome.events;
      return { ...execution.outcome, events: [...hostEvents, ...events] };
    } catch (error) {
      this.host.restore(checkpoint);
      this.restore(own);
      throw error;
    }
  }
  private affectedPlayer(action: GameAction): PlayerId {
    const ref = 'target' in action ? action.target : 'object' in action ? action.object : undefined;
    return ref ? this.host.objects().find(object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId)?.controller ?? this.turnPlayer : 'player' in action ? action.player : this.turnPlayer;
  }
  private replacementKey(effect: ReplacementRegistration): string {
    const source = effect.source && this.host.objects().find(object => object.ref.id === effect.source!.ref.id);
    return JSON.stringify([this.clock.turn, effect.id, source?.ref ?? null]);
  }
  private apply(action: GameAction, original: GameAction, applied: Set<string>): ActionOutcome {
    let current = action, changed = false;
    while (true) {
      const candidates = [...this.replacements.values()].filter(effect => {
        if (effect.source) {
          const source = this.host.objects().find(object => object.ref.id === effect.source!.ref.id);
          if (!source || !(effect.activeZones ?? ['board']).includes(source.zone)) return false;
        }
        const context = this.replacementMatchContext();
        return !applied.has(effect.id) && !(effect.oncePerTurn && this.replacementUses.has(this.replacementKey(effect))) &&
          effect.matches(current, original, context);
      });
      if (!candidates.length) break;
      const chooser = this.affectedPlayer(current);
      const id = candidates.length === 1 ? candidates[0]!.id : this.host.choose<string>({ id: `replacement:${this.sequence + 1}:${applied.size}`, chooser, visibility: 'public', type: 'mode', options: candidates.map(effect => effect.id) });
      const effect = candidates.find(candidate => candidate.id === id);
      if (!effect) throw new TypeError('Invalid replacement order');
      applied.add(id);
      if (effect.optional) {
        const answer = this.host.choose<boolean>({ id: `replacement:${this.sequence + 1}:${id}:optional`, chooser, visibility: 'public', type: 'optional' });
        if (typeof answer !== 'boolean') throw new TypeError('Invalid replacement answer');
        if (!answer) continue;
      }
      if (effect.oncePerTurn) this.replacementUses.add(this.replacementKey(effect));
      const result = effect.apply(current, original);
      if (result.status === 'prevent') return { status: 'prevented', events: [] };
      changed = true;
      if (result.status === 'rewrite') { current = result.action; continue; }
      const events = result.actions.flatMap(next => [...this.apply(next, original, applied).events]);
      return { status: 'replaced', events };
    }
    const boundary = this.host.deathBoundary;
    const execution = boundary !== undefined && current.type === 'kill'
      ? boundary.execute(current, context => {
          if (context.batchId.length === 0 || context.emissions.length === 0) return;
          this.emitBatch(context.emissions, current, context.batchId);
        })
      : this.routeAction?.(current) ?? this.host.execute(current);
    if (execution.outcome.status !== 'done') {
      if (execution.emissions.length) throw new Error('Unperformed actions cannot emit trigger timings');
      return execution.outcome;
    }
    const events = this.publish(execution.emissions, current);
    const hostEvents = current.type === 'kill' && boundary !== undefined ? [] : execution.outcome.events;
    return changed ? { status: 'replaced', events: [...hostEvents, ...events] } : { ...execution.outcome, events: [...hostEvents, ...events] };
  }
}
