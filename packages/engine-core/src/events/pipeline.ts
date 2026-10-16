import type { ActionOutcome, GameAction, ObjectSnapshot, PlayerId } from '../effects/contract.js';
import { getTimingPoint } from './timing-points.js';
import { matchesTriggerEvent } from './pipeline-match.js';
import { assertTriggerSpec } from './trigger-spec.js';
import type { ActionExecution, PipelineClock, PipelineEvent, PipelineHost, ReplacementRegistration, TimingEmission, TriggerRegistration, TriggerSnapshot } from './pipeline-types.js';

export class EventPipeline {
  readonly clock: PipelineClock = { turn: 1, phase: 1, combat: 0, showdown: 0, chain: 0 };
  private log: PipelineEvent[] = [];
  private triggers = new Map<string, TriggerRegistration>();
  private replacements = new Map<string, ReplacementRegistration>();
  private consumed = new Set<string>();
  private replacementUses = new Set<string>();
  private sequence = 0;
  private scanQueue: PipelineEvent[] = [];
  private scanning = false;
  private suspended = 0;
  onTrigger: (snapshot: TriggerSnapshot) => void = () => { throw new Error('Trigger sink is not attached'); };
  onEvent?: (event: PipelineEvent) => void;
  routeAction?: (action: GameAction) => ActionExecution | undefined;
  constructor(readonly host: PipelineHost, readonly turnOrder: readonly PlayerId[], public turnPlayer: PlayerId) {
    if (turnOrder.length < 2 || new Set(turnOrder).size !== turnOrder.length || !turnOrder.includes(turnPlayer)) throw new TypeError('Invalid turn order');
  }
  get events(): readonly PipelineEvent[] { return structuredClone(this.log); }
  registerTrigger(registration: TriggerRegistration): void {
    getTimingPoint(registration.spec.at);
    assertTriggerSpec(registration.spec);
    if (this.triggers.has(registration.id)) throw new Error(`Duplicate trigger ${registration.id}`);
    this.triggers.set(registration.id, structuredClone(registration));
  }
  unregisterTrigger(id: string): void { this.triggers.delete(id); }
  registerReplacement(registration: ReplacementRegistration): void {
    if (this.replacements.has(registration.id)) throw new Error(`Duplicate replacement ${registration.id}`);
    this.replacements.set(registration.id, registration);
  }
  private frequencyKey(registration: TriggerRegistration, source: ObjectSnapshot): string | null {
    const scope = registration.spec.once;
    if (!scope) return null;
    const value = scope === 'per-game' ? 'game' : scope === 'per-object' ? `${source.ref.id}:${source.ref.zoneEntryId}` : this.clock[scope.slice(4) as keyof PipelineClock];
    return JSON.stringify([registration.id, source.ref, scope, value]);
  }
  consume(snapshot: TriggerSnapshot): boolean {
    if (snapshot.frequencyKey === null) return true;
    if (this.consumed.has(snapshot.frequencyKey)) return false;
    this.consumed.add(snapshot.frequencyKey);
    return true;
  }
  checkpoint() {
    return { log: [...this.log], triggers: new Map(this.triggers), consumed: new Set(this.consumed), replacementUses: new Set(this.replacementUses), sequence: this.sequence, scanQueue: [...this.scanQueue], clock: { ...this.clock }, turnPlayer: this.turnPlayer };
  }
  restore(state: ReturnType<EventPipeline['checkpoint']>): void {
    this.log = state.log; this.triggers = state.triggers; this.consumed = state.consumed; this.replacementUses = state.replacementUses; this.sequence = state.sequence; this.scanQueue = state.scanQueue;
    Object.assign(this.clock, state.clock); this.turnPlayer = state.turnPlayer;
  }
  /** Timings from rules modules and committed actions share exactly one scanner. */
  emit(emission: TimingEmission, action?: GameAction): PipelineEvent {
    getTimingPoint(emission.timingPoint);
    if (emission.timingPoint === 'turn-start') this.clock.turn++;
    if (emission.timingPoint === 'combat-start') this.clock.combat++;
    if (emission.timingPoint === 'showdown-open') this.clock.showdown++;
    if (['awaken-start', 'beginning-start', 'channel-start', 'draw-start', 'main-start', 'turn-end'].includes(emission.timingPoint)) this.clock.phase++;
    const event: PipelineEvent = Object.freeze(structuredClone({ type: 'task-resolved' as const, seq: this.sequence + 1, eventId: ++this.sequence, turnNumber: this.clock.turn, activePlayerId: this.turnPlayer, taskId: `pipeline:${this.sequence}`, sourceCardId: emission.source?.cardId ?? emission.object?.cardId ?? '', reason: emission.kind ?? emission.timingPoint, autoResolved: true as const, ...emission, ...(action ? { action } : {}) }));
    this.log.push(event);
    this.onEvent?.(event);
    this.scanQueue.push(event);
    this.drain();
    return event;
  }
  private drain(): void {
    if (!this.scanning && !this.suspended) {
      this.scanning = true;
      try {
        let scans = 0;
        while (this.scanQueue.length) {
          if (++scans > 10000) throw new Error('Trigger cascade exceeded the rules-task budget');
          const wave = this.scanQueue.splice(0);
          this.scan(wave);
          for (const next of wave) for (const [id, registration] of this.triggers) if (registration.expiresAt === next.timingPoint) this.triggers.delete(id);
        }
      }
      finally { this.scanning = false; }
    }
  }
  private publish(emissions: readonly TimingEmission[], action: GameAction): PipelineEvent[] {
    const groups = new Map<string, TimingEmission[]>();
    for (const emission of emissions) {
      const group = emission.simultaneousGroup ?? 'action';
      groups.set(group, [...(groups.get(group) ?? []), emission]);
    }
    const events: PipelineEvent[] = [];
    for (const group of groups.values()) {
      this.suspended++;
      try { for (const emission of group) events.push(this.emit(emission, action)); }
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
      if (!matchesTriggerEvent(registration.spec.filter, event, controller)) continue;
      if (registration.spec.condition) {
        if (!this.host.testTrigger) throw new Error('Trigger condition adapter required');
        if (!this.host.testTrigger(registration, event, captured)) continue;
      }
      const frequencyKey = this.frequencyKey(registration, captured);
      if (frequencyKey !== null && this.consumed.has(frequencyKey)) continue;
      hits.push({ registration, source: captured, controller, event, frequencyKey });
    }
    }
    const start = this.turnOrder.indexOf(this.turnPlayer);
    const order = [...this.turnOrder.slice(start), ...this.turnOrder.slice(0, start)];
    for (const controller of order) {
      let own = hits.filter(hit => hit.controller === controller);
      own = own.filter(hit => {
        if (!hit.registration.optional) return true;
        const answer = this.host.choose<boolean>({ id: `trigger:${hit.event.eventId}:${hit.registration.id}:optional`, chooser: controller, visibility: 'public', type: 'optional' });
        if (typeof answer !== 'boolean') throw new TypeError('Optional trigger answer must be boolean');
        return answer;
      });
      if (own.length > 1) {
        const remaining = [...own], ordered: TriggerSnapshot[] = [];
        while (remaining.length > 1) {
          const token = (hit: TriggerSnapshot) => own.filter(candidate => candidate.registration.id === hit.registration.id).length > 1 ? `${hit.registration.id}:${hit.event.eventId}` : hit.registration.id;
          const id = this.host.choose<string>({ id: `trigger:${events[0]!.eventId}:${controller}:order:${ordered.length}`, chooser: controller, visibility: 'public', type: 'mode', options: remaining.map(token) });
          const index = remaining.findIndex(hit => token(hit) === id);
          if (index < 0) throw new TypeError('Invalid trigger order');
          ordered.push(remaining.splice(index, 1)[0]!);
        }
        own = [...ordered, ...remaining];
      }
      for (const hit of own) this.onTrigger(structuredClone(hit));
    }
  }
  commit(action: GameAction): ActionOutcome {
    const checkpoint = this.host.checkpoint(), own = this.checkpoint();
    try { return this.apply(action, action, new Set()); }
    catch (error) { this.host.restore(checkpoint); this.restore(own); throw error; }
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
        return !applied.has(effect.id) && !(effect.oncePerTurn && this.replacementUses.has(this.replacementKey(effect))) && effect.matches(current, original);
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
    const execution = this.routeAction?.(current) ?? this.host.execute(current);
    if (execution.outcome.status !== 'done') {
      if (execution.emissions.length) throw new Error('Unperformed actions cannot emit trigger timings');
      return execution.outcome;
    }
    const events = this.publish(execution.emissions, current);
    return changed ? { status: 'replaced', events: [...execution.outcome.events, ...events] } : { ...execution.outcome, events: [...execution.outcome.events, ...events] };
  }
}
