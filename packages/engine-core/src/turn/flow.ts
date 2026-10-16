import { ChainEngine, type ChainDraft } from '../chain/engine.js';
import type { GameAction, ObjectRef, ObjectSnapshot, PlayerId, PlayerSnapshot } from '../effects/contract.js';
import type { PipelineHost, TimingEmission } from '../events/pipeline-types.js';
import { CombatFlow, type BattlefieldState } from '../combat/flow.js';
import { TurnPhaseLayers } from './phase-layers.js';

export class TurnCombatBlockedError extends Error {
  readonly status = 'blocked';
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TurnCombatBlockedError';
  }
}

export type TurnPhase = 'not-started' | 'awaken' | 'beginning' | 'channel' | 'draw' | 'main' | 'ending';
export interface TurnFlowOptions {
  readonly host: PipelineHost;
  readonly player: (id: PlayerId) => PlayerSnapshot;
  readonly turnOrder: readonly [PlayerId, PlayerId];
  readonly battlefields: readonly { readonly id: string; readonly controller: PlayerId | null }[];
  readonly victoryScore?: number;
  readonly describePlay?: (action: Extract<GameAction, { type: 'play' }>, source: ObjectSnapshot) => ChainDraft;
}

type Task = () => void;

/**
 * New CR 1.5 turn driver over batch 4 HOT FEPR. Legacy duel profiles are untouched.
 * Queue entries are single committed operations. AwaitChoice leaves the current
 * entry in place, so resuming never repeats an earlier Ready, Draw or timing.
 */
export class TurnFlow {
  readonly chain: ChainEngine;
  readonly layers: TurnPhaseLayers;
  readonly combat: CombatFlow;
  private tasks: Task[] = [];
  private phaseValue: TurnPhase = 'not-started';
  private turnValue = 0;
  private winnerValue: PlayerId | null = null;
  private special: 'ending' | null = null;
  private turns = new Map<PlayerId, number>();
  private scoreLedger = new Map<PlayerId, Set<string>>();
  private running = false;
  private executingTask = false;
  private scoring: { player: string; field: string; method: 'hold' | 'conquer'; finalDraw: boolean } | null = null;
  readonly victoryScore: number;

  constructor(readonly options: TurnFlowOptions) {
    this.victoryScore = options.victoryScore ?? 8;
    if (!Number.isSafeInteger(this.victoryScore) || this.victoryScore < 1) throw new TypeError('Invalid victory score');
    if (options.turnOrder.length !== 2 || new Set(options.turnOrder).size !== 2) throw new TypeError('This driver supports 1v1 only');
    if (options.battlefields.length !== 2 || new Set(options.battlefields.map(field => field.id)).size !== 2 ||
      options.battlefields.some(field => !field.id || field.controller !== null && !options.turnOrder.includes(field.controller))) {
      throw new TypeError('Duel requires two distinct battlefields with known controllers');
    }
    for (const id of options.turnOrder) { this.turns.set(id, 0); this.scoreLedger.set(id, new Set()); }
    this.layers = new TurnPhaseLayers(options.host.objects());
    const host: PipelineHost = {
      checkpoint: () => ({ host: options.host.checkpoint(), rules: this.checkpoint() }),
      restore: checkpoint => {
        const saved = checkpoint as { host: unknown; rules: ReturnType<TurnFlow['checkpoint']> };
        options.host.restore(saved.host); this.restore(saved.rules);
      },
      objects: () => options.host.objects(),
      context: (source, controller, at) => options.host.context(source, controller, at),
      choose: request => options.host.choose(request),
      testTrigger: options.host.testTrigger ? (registration, event, source) => options.host.testTrigger!(registration, event, source) : undefined,
      execute: action => {
        if (this.scoring && (!('player' in action) || action.player !== this.scoring.player ||
          action.type !== (this.scoring.finalDraw ? 'draw' : 'score'))) {
          // Throw inside ChainEngine.commit's transaction, before a replacement
          // could leave some other primitive committed without the Score facts.
          throw new TurnCombatBlockedError('replaced-scoring', 'Structural Score replacement requires a rules-task contract');
        }
        const before = 'object' in action ? options.host.objects().find(object => object.ref.id === action.object.id) : undefined;
        const execution = options.host.execute(action);
        if (execution.outcome.status !== 'done') return execution;
        // Gaining points and Scoring a Battlefield are distinct (CR 470.1).
        const emissions: TimingEmission[] = execution.emissions.map(event => action.type === 'score' && event.timingPoint === 'score'
          ? { ...event, timingPoint: 'points-gained' } : event);
        const after = before && options.host.objects().find(object => object.ref.id === before.ref.id);
        if (action.type === 'ready' && before?.zone === 'rune-zone' && before.exhausted && after && !after.exhausted) {
          emissions.push({ timingPoint: 'object-readied', object: after, player: after.controller });
        }
        if (action.type === 'move-location' && before?.location && after?.location &&
          JSON.stringify(before.location) !== JSON.stringify(after.location)) {
          emissions.push({ timingPoint: before.location.type === 'base' ? 'object-leaves-base' : 'object-leaves-battlefield',
            object: before, player: before.controller, details: { location: before.location } });
          emissions.push({ timingPoint: after.location.type === 'base' ? 'object-enters-base' : 'object-enters-battlefield',
            object: after, player: after.controller, details: { location: after.location } });
          emissions.push(...this.combat.entered(after));
        } else if (after?.zone === 'board' && before?.zone !== 'board') {
          emissions.push(...this.combat.entered(after));
        }
        const score = this.scoring;
        if (score && 'player' in action && action.player === score.player &&
          (score.finalDraw ? action.type === 'draw' : action.type === 'score')) {
          this.scoreLedger.get(score.player)!.add(score.field);
          const details = { battlefieldId: score.field };
          if (score.method === 'conquer') emissions.unshift(this.combat.establish(score.player, score.field));
          if (score.finalDraw) emissions.push({ timingPoint: 'final-point', player: score.player, details });
          emissions.push({ timingPoint: score.method, player: score.player, details }, { timingPoint: 'score', player: score.player, details });
          // One committed action publishes the whole Score trigger wave atomically.
          return { ...execution, emissions: emissions.map(event => ({ ...event, simultaneousGroup: 'battlefield-score' })) };
        }
        return { ...execution, emissions };
      },
    };
    this.chain = new ChainEngine({
      turnOrder: options.turnOrder, turnPlayer: options.turnOrder[0], phase: 'not-started', layers: this.layers,
      host, cleanup: engine => this.cleanup(engine), describePlay: options.describePlay,
    });
    // Batch 4's initial clock is 1; this driver emits the first turn-start itself.
    this.chain.pipeline.clock.turn = 0;
    this.combat = new CombatFlow(this.chain, options.host, options.battlefields,
      (player, field) => this.scheduleScore(player, field, 'conquer'));
  }
  get phase(): TurnPhase { return this.phaseValue; }
  get turn(): number { return this.turnValue; }
  get turnPlayer(): PlayerId { return this.chain.pipeline.turnPlayer; }
  get winner(): PlayerId | null { return this.winnerValue; }
  get battlefields(): readonly BattlefieldState[] { return this.combat.battlefields; }
  scored(player: PlayerId): readonly string[] { return [...(this.scoreLedger.get(player) ?? [])]; }

  private checkpoint() {
    return { phase: this.phaseValue, turn: this.turnValue, winner: this.winnerValue, special: this.special,
      turns: new Map(this.turns), ledger: new Map([...this.scoreLedger].map(([id, fields]) => [id, new Set(fields)])),
      combat: this.combat?.checkpoint(), tasks: [...this.tasks] };
  }
  private restore(saved: ReturnType<TurnFlow['checkpoint']>): void {
    this.phaseValue = saved.phase; this.turnValue = saved.turn; this.winnerValue = saved.winner; this.special = saved.special;
    this.turns = saved.turns; this.scoreLedger = saved.ledger; this.tasks = saved.tasks;
    if (saved.combat) this.combat.restore(saved.combat);
  }

  start(): void {
    if (this.phaseValue !== 'not-started') throw new Error('Turn flow has already started');
    this.scheduleTurn(this.options.turnOrder[0]);
    this.advance();
  }
  /** Continue rules tasks after a choice answer or a fully resolved chain. */
  advance(): void {
    if (this.running) throw new Error('Turn flow is not reentrant');
    this.running = true;
    try {
      let budget = 0;
      while (!this.winnerValue) {
        if (++budget > 1000) throw new Error('Turn task budget exceeded');
        // Batch 4 pass() already advances after Resolve. Calling advance again
        // on a finalized chain would re-grant its controller's Priority and
        // undo the preceding player's Pass.
        if (this.chain.items.length && this.chain.items.every(item => item.status === 'finalized')) return;
        this.chain.advance();
        if (this.chain.items.length) return;
        this.combat.advance();
        if (this.chain.items.length) return;
        if (this.combat.active) {
          this.chain.advance();
          if (this.combat.current?.step !== 'control' || this.chain.items.length || !this.tasks.length) return;
        }
        const task = this.tasks[0];
        if (!task) return;
        this.executingTask = true;
        try { task(); } finally { this.executingTask = false; }
        this.tasks.shift();
      }
    } finally { this.running = false; }
  }
  pass(player: PlayerId): void {
    if (this.winnerValue) throw new Error('Game is over');
    if (!this.chain.items.length && !this.combat.active) { this.endTurn(player); return; }
    this.chain.pass(player);
    this.advance();
  }
  execute(draft: ChainDraft): void {
    if (!this.chain.items.length && !this.combat.active) this.advance();
    if (this.winnerValue || this.phase !== 'main' || this.tasks.length) throw new Error('Discretionary action is not available');
    this.chain.execute(draft);
    this.advance();
  }
  move(player: PlayerId, object: ObjectRef, field: string): void {
    if (!this.chain.items.length && !this.combat.active) this.advance();
    if (this.phase !== 'main' || this.tasks.length || this.winnerValue) throw new Error('Standard Move requires Main Phase');
    this.combat.move(player, object, field);
    this.advance();
  }
  endTurn(player: PlayerId): void {
    if (!this.chain.items.length && !this.combat.active) this.advance();
    if (this.phase !== 'main' || this.tasks.length || player !== this.turnPlayer || this.combat.active ||
      this.chain.items.length || !this.chain.canAct(player, 'normal') || this.winnerValue) throw new Error('Cannot end turn now');
    this.tasks.push(
      () => this.emit('main-end', player),
      () => { this.chain.setPhase('ending'); this.phaseValue = 'ending'; },
      () => this.emit('turn-end', player),
      () => this.scheduleExpiration(),
    );
    this.advance();
  }
  private emit(timingPoint: TimingEmission['timingPoint'], player: PlayerId): void {
    this.chain.emit({ timingPoint, player });
  }
  private enter(phase: Exclude<TurnPhase, 'not-started' | 'ending'>, player: PlayerId): void {
    this.tasks.push(() => { this.chain.setPhase(phase); this.phaseValue = phase; }, () => this.emit(`${phase}-start`, player));
  }
  private leave(phase: Exclude<TurnPhase, 'not-started' | 'ending' | 'main'>, player: PlayerId): void {
    this.tasks.push(() => this.emit(`${phase}-end`, player));
  }
  private scheduleTurn(player: PlayerId): void {
    this.tasks.push(() => {
      const previousPlayer = this.chain.pipeline.turnPlayer;
      this.chain.pipeline.turnPlayer = player;
      try { this.emit('turn-start', player); }
      catch (error) {
        this.chain.pipeline.turnPlayer = previousPlayer;
        throw error;
      }
      this.turnValue++;
      this.turns.set(player, this.turns.get(player)! + 1);
      for (const ledger of this.scoreLedger.values()) ledger.clear();
    });
    this.enter('awaken', player);
    this.tasks.push(() => {
      const objects = this.options.host.objects().filter(object => object.controller === player && object.exhausted &&
        (object.zone === 'board' || object.zone === 'rune-zone'));
      if (objects.some(object => object.stunned)) throw new TurnCombatBlockedError('stun-readiness', 'Ready/Stun consumption requires a primitive contract adapter');
      this.insert(objects.map(object => () => this.commit({ type: 'ready', object: object.ref })));
    });
    this.leave('awaken', player);
    this.enter('beginning', player);
    this.tasks.push(() => this.insert(this.battlefields.filter(field => field.controller === player).map(field =>
      () => this.scheduleScore(player, field.id, 'hold'))));
    this.leave('beginning', player);
    this.enter('channel', player);
    this.tasks.push(() => {
      const amount = Math.min(this.options.player(player).runeDeckCount,
        player === this.options.turnOrder[1] && this.turns.get(player) === 1 ? 3 : 2);
      if (amount) this.commit({ type: 'channel-rune', player, amount });
    });
    this.leave('channel', player);
    this.enter('draw', player);
    this.tasks.push(() => this.draw(player));
    this.leave('draw', player);
    // CR 316.2-316.4: pools empty before Main Phase start effects.
    this.tasks.push(() => this.requireEmptyPools());
    this.enter('main', player);
  }
  private insert(tasks: Task[]): void { this.tasks.splice(this.executingTask ? 1 : 0, 0, ...tasks); }
  private commit(action: GameAction): void {
    const outcome = this.chain.commit(action);
    if (outcome.status === 'impossible') throw new TurnCombatBlockedError('impossible-rules-action', `Required action is impossible: ${action.type}`);
  }
  private draw(player: PlayerId): void {
    if (this.options.player(player).deckCount === 0) throw new TurnCombatBlockedError('burn-out', 'Burn Out needs an atomic rules task with repeated unreplaceable point gains (CR 432)');
    this.commit({ type: 'draw', player, amount: 1 });
  }
  private requireEmptyPools(): void {
    if (this.options.turnOrder.some(id => { const player = this.options.player(id); return player.energy !== 0 || player.power.length !== 0; })) {
      throw new TurnCombatBlockedError('empty-rune-pool', 'GameAction has no Rune Pool empty operation (CR 316.3 / 317.2.d)');
    }
  }
  private scheduleExpiration(): void {
    this.requireEmptyPools();
    const resolved = this.chain.trace.filter(event => event.step === 'resolved').length;
    this.special = 'ending';
    this.chain.requestCleanup('ending-special');
    this.insert([() => {
      if (this.chain.trace.filter(event => event.step === 'resolved').length !== resolved) {
        this.scheduleExpiration();
      } else {
        this.scheduleTurn(this.options.turnOrder[(this.options.turnOrder.indexOf(this.turnPlayer) + 1) % 2]!);
      }
    }]);
  }
  private scheduleScore(player: PlayerId, field: string, method: 'hold' | 'conquer'): void {
    const ledger = this.scoreLedger.get(player)!;
    if (ledger.has(field)) {
      if (method === 'conquer') this.insert([() => this.combat.establishWithoutScore(player, field)]);
      return;
    }
    // No score is awarded until the source process has actually established control.
    if (method === 'hold' && (this.combat.battlefields.find(value => value.id === field)?.controller !== player ||
      this.phase !== 'beginning' || this.turnPlayer !== player) || method === 'conquer' &&
      (this.combat.current?.step !== 'control' || this.combat.current.field !== field || this.combat.current.scorer !== player)) throw new Error('Invalid scoring timing');
    const finalDraw = method === 'conquer' && this.options.player(player).score >= this.victoryScore - 1 &&
      !this.battlefields.every(value => value.id === field || ledger.has(value.id));
    if (finalDraw && this.options.player(player).deckCount === 0) throw new TurnCombatBlockedError('burn-out', 'Final Point draw would require Burn Out');
    this.insert([() => {
      this.scoring = { player, field, method, finalDraw };
      try {
        if (finalDraw) this.draw(player);
        else this.commit({ type: 'score', player, amount: 1 });
        if (!this.scoreLedger.get(player)!.has(field)) throw new TurnCombatBlockedError('replaced-scoring', 'Replaced point gains require a structural Score task contract');
      } finally { this.scoring = null; }
    }]);
  }
  private cleanup(engine: ChainEngine): boolean {
    const leader = this.options.turnOrder.find(id => this.options.player(id).score >= this.victoryScore &&
      this.options.turnOrder.every(other => id === other || this.options.player(id).score > this.options.player(other).score));
    if (leader && !this.winnerValue) {
      this.commit({ type: 'win', player: leader });
      this.winnerValue = leader;
      return false;
    }
    if (this.winnerValue) return false;
    let changed = false;
    this.layers.setObjects(this.options.host.objects());
    const objects = this.layers.evaluateAll();
    // CR 323.4: zero Might alone is not lethal damage (142.4).
    for (const object of objects) if (object.zone === 'board' && object.types.includes('unit') &&
      object.might !== null && object.damage > 0 && object.damage >= Math.max(0, object.might)) {
      const before = object.ref;
      this.commit({ type: 'kill', object: before });
      changed ||= !this.options.host.objects().some(current => current.zone === 'board' &&
        current.ref.id === before.id && current.ref.zoneEntryId === before.zoneEntryId);
    }
    for (const object of this.options.host.objects()) if (object.zone === 'board') {
      if (object.faceDown) throw new TurnCombatBlockedError('hidden-cleanup-state', 'Hidden cleanup needs an explicit Hidden state separate from faceDown');
      if (object.location?.type === 'battlefield' && !object.types.includes('unit') && object.attachedTo === null &&
        !object.keywords.some(keyword => keyword.id.toLowerCase() === 'deploy') ||
        object.location?.type === 'base' && object.location.player !== object.controller && object.attachedTo === null) {
        throw new TurnCombatBlockedError('recall-action', 'Cleanup Recall needs an action distinct from Move (CR 323.6 / 458)');
      }
    }
    if (this.special === 'ending') {
      // Only this invocation is special. Fixed-point repeats are normal cleanups.
      this.special = null;
      for (const object of this.options.host.objects()) if (object.zone === 'board' && object.types.includes('unit') && object.damage > 0) {
        this.commit({ type: 'heal', object: object.ref, amount: object.damage }); changed = true;
      }
      changed = this.layers.expireTurn(this.turnPlayer).length > 0 || changed;
    }
    return this.combat ? this.combat.cleanup() || changed : changed;
  }
}
