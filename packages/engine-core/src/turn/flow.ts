import { ChainEngine, type ChainDraft } from '../chain/engine.js';
import type { GameAction, ObjectRef, ObjectSnapshot, PlayerId, PlayerSnapshot } from '../effects/contract.js';
import type { PipelineHost, TimingEmission } from '../events/pipeline-types.js';
import { CombatFlow, type BattlefieldState } from '../combat/flow.js';
import { TurnPhaseLayers } from './phase-layers.js';
import { ScoreLedger } from '../scoring/ledger.js';
import { scorePermission } from '../scoring/restrictions.js';
import { finalPointDecision, validateVictoryScore, winnerAtCleanup } from '../scoring/outcome.js';
import { TurnQueue } from './turn-queue.js';
import { performBurnOutStep, type BurnOutParticipant } from './burn-out.js';
import {
  cleanupLostControl,
  createHiddenState,
  findHiddenCard,
  clearHiddenProvenance,
  hideWithCost,
  playedFromHidden,
  playFromHidden,
  restoreHiddenState,
  setBattlefieldController,
  setFacedownCapacity,
  setTurn,
  type HiddenState,
} from '../zones/hidden/index.js';
import { bindResolveContext } from '../events/action-adapter.js';
import { executeContractAction as executeBridgeContractAction } from '../events/contract-actions/bridge.js';
import { inheritTurnTaskCapability, registerTurnTaskCapability } from '../effects/instructions/effect.additional-turn.js';
import { matchesObjectFilter } from '../layers/filter.js';
import { describeDraftHasHiddenPermission, describeDraftHiddenAbilities, withHiddenSource } from '../programs/play.js';
import type { StandardMoveFormationInput } from '../combat/flow.js';
import type { StandardMoveBatchResult } from './movement.js';

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
  readonly describePlay?: (action: Extract<GameAction, { type: 'play' }>, source: ObjectSnapshot,
    hiddenSource?: { hidden(): HiddenState }) => ChainDraft;
  readonly hiddenState?: HiddenState;
  readonly facedownCapacity?: (battlefieldId: string) => number;
  readonly taskCapabilities?: { readonly clearStun?: (object: ObjectRef) => void };
}

type Task = () => void;

interface ActiveScoreBase {
  readonly player: PlayerId;
  readonly field: string;
  readonly finalDraw: boolean;
  readonly units: readonly ObjectRef[];
  /** One committed Hold/Conquer operation has one rule identity. */
  readonly batchId: string;
}
type ActiveScore =
  | (ActiveScoreBase & { readonly method: 'hold' })
  | (ActiveScoreBase & {
    readonly method: 'conquer';
    /** Captured before Establish Control; absence is not representable. */
    readonly battlefieldControllerBefore: PlayerId | null;
  });

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
  private readonly scoreLedger = new ScoreLedger();
  private running = false;
  private executingTask = false;
  private scoring: ActiveScore | null = null;
  private readonly turnQueue: TurnQueue;
  private burnOutSequence = 0;
  private scoreWaveSequence = 0;
  private emptyingRunePool = false;
  private hiddenState: HiddenState;
  private hiddenControllers = new Map<string, PlayerId | null>();
  readonly victoryScore: number;

  constructor(readonly options: TurnFlowOptions) {
    this.victoryScore = validateVictoryScore(options.victoryScore ?? 8);
    if (options.turnOrder.length !== 2 || new Set(options.turnOrder).size !== 2) throw new TypeError('This driver supports 1v1 only');
    if (options.battlefields.length !== 2 || new Set(options.battlefields.map(field => field.id)).size !== 2 ||
      options.battlefields.some(field => !field.id || field.controller !== null && !options.turnOrder.includes(field.controller))) {
      throw new TypeError('Duel requires two distinct battlefields with known controllers');
    }
    for (const id of options.turnOrder) this.turns.set(id, 0);
    this.turnQueue = new TurnQueue(options.turnOrder);
    this.hiddenState = options.hiddenState === undefined
      ? createHiddenState(options.battlefields.map(field => ({ battlefieldId: field.id, controller: field.controller })), 0)
      : restoreHiddenState(options.hiddenState);
    for (const field of options.battlefields) this.hiddenControllers.set(field.id, field.controller);
    this.layers = new TurnPhaseLayers(options.host.objects());
    const host: PipelineHost = {
      checkpoint: () => ({ host: options.host.checkpoint(), rules: this.checkpoint() }),
      restore: checkpoint => {
        const saved = checkpoint as { host: unknown; rules: ReturnType<TurnFlow['checkpoint']> };
        options.host.restore(saved.host); this.restore(saved.rules);
      },
      objects: () => this.objectsWithBattlefieldControllers(),
      context: (source, controller, at) => {
        const base = options.host.context(source, controller, at);
        const context = new Proxy(base, { get: (target, key) => {
          if (key === 'object') return (ref: ObjectRef) => {
            this.layers.setObjects(this.objectsWithBattlefieldControllers());
            return this.layers.evaluate(ref);
          };
          if (key === 'query') return (filter: import('@riftbound/card-dsl').ObjectFilter) => {
            this.layers.setObjects(this.objectsWithBattlefieldControllers());
            return this.layers.evaluateAll().filter(object => matchesObjectFilter(filter, object, {
              anchor: source, controller,
            }));
          };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
        registerTurnTaskCapability(context.source, {
          version: 'riftbound.turn-task.v1',
          scheduleAdditionalTurn: (owner, sourceInstructionId) => {
            this.turnQueue.enqueueAdditional(owner, sourceInstructionId);
          },
        });
        inheritTurnTaskCapability(context.source, context);
        return context;
      },
      choose: request => options.host.choose(request),
      testTrigger: options.host.testTrigger ? (registration, event, source) => options.host.testTrigger!(registration, event, source) : undefined,
      executeContract: action => this.executeContractAction(action),
      execute: action => {
        const before = 'object' in action ? options.host.objects().find(object => object.ref.id === action.object.id) : undefined;
        const actionObjectRef = 'object' in action ? action.object : undefined;
        const concealed = before !== undefined && actionObjectRef !== undefined && findHiddenCard(this.hiddenState, before.ref) !== null &&
          (['discard', 'recycle', 'banish', 'return-to-hand', 'kill'].includes(action.type) ||
            action.type === 'move-zone' && action.to === 'trash');
        const actionCheckpoint = concealed ? options.host.checkpoint() : undefined;
        let revealExecution: ReturnType<typeof options.host.execute> | undefined;
        if (concealed) {
          revealExecution = options.host.execute({ type: 'reveal', object: actionObjectRef! });
          if (revealExecution.outcome.status !== 'done') {
            options.host.restore(actionCheckpoint);
            return revealExecution;
          }
        }
        let execution: ReturnType<typeof options.host.execute>;
        try {
          execution = options.host.execute(action);
        } catch (error) {
          if (concealed) options.host.restore(actionCheckpoint);
          throw error;
        }
        if (concealed && execution.outcome.status !== 'done' && execution.outcome.status !== 'replaced') {
          options.host.restore(actionCheckpoint);
          return execution;
        }
        if (revealExecution !== undefined) execution = {
          outcome: { ...execution.outcome, events: [...revealExecution.outcome.events, ...execution.outcome.events] },
          emissions: [...revealExecution.emissions, ...execution.emissions],
        };
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
        // The initial point action or any replacement action executes while a
        // Score task is active. Completing (or replacing/preventing) it still
        // completes the Score and publishes one Hold/Conquer wave (383.4.c.2.c,
        // 383.4.d.2.c). Later actions from a multi-action replacement do not
        // publish a second Score wave.
        if (score && !this.scoreLedger.has(score.player, score.field) &&
            execution.outcome.status !== 'impossible') {
          this.scoreLedger.add({
            player: score.player, battlefieldId: score.field, method: score.method,
            ...(score.units.length === 1 ? { objectId: score.units[0]!.id } : {}),
          });
          const details = score.method === 'conquer'
            ? { battlefieldId: score.field, battlefieldControllerBefore: score.battlefieldControllerBefore }
            : { battlefieldId: score.field };
          const participatingUnits = score.units.map(unit => ({ id: unit.id, zoneEntryId: unit.zoneEntryId }));
          if (score.method === 'conquer') emissions.unshift(this.combat.establish(score.player, score.field));
          if (score.finalDraw) emissions.push({ timingPoint: 'final-point', player: score.player, details });
          for (const unit of score.units) {
            const object = options.host.objects().find(candidate => candidate.ref.id === unit.id &&
              candidate.ref.zoneEntryId === unit.zoneEntryId);
            emissions.push({ timingPoint: score.method, object, source: object, it: object, player: score.player,
              details: { ...details, objectId: unit.id, playerId: score.player } });
          }
          const battlefieldObject = this.battlefieldObject(score.field);
          emissions.push({ timingPoint: 'score', player: score.player, details: { ...details, participatingUnits },
            // The aggregate Scoring action still refers to the Battlefield,
            // including when the current harness represents that location
            // only through details.battlefieldId rather than a board object.
            ...(battlefieldObject === null ? {} : { object: battlefieldObject }),
          });
          // One committed action publishes the whole Score trigger wave atomically.
          return { ...execution, emissions: emissions.map(event => ({ ...event, batchId: score.batchId,
            simultaneousGroup: score.batchId })) };
        }
        return { ...execution, emissions };
      },
    };
    this.chain = new ChainEngine({
      turnOrder: options.turnOrder, turnPlayer: options.turnOrder[0], phase: 'not-started', layers: this.layers,
      host, cleanup: engine => this.cleanup(engine), describePlay: options.describePlay === undefined ? undefined :
        (action, source) => withHiddenSource(this, () => options.describePlay!(action, source, this)),
    });
    // Batch 4's initial clock is 1; this driver emits the first turn-start itself.
    this.chain.pipeline.clock.turn = 0;
    this.combat = new CombatFlow(this.chain, host, options.battlefields,
      (player, field) => this.scheduleScore(player, field, 'conquer'));
  }
  get phase(): TurnPhase { return this.phaseValue; }
  get turn(): number { return this.turnValue; }
  get turnPlayer(): PlayerId { return this.chain.pipeline.turnPlayer; }
  get winner(): PlayerId | null { return this.winnerValue; }
  get battlefields(): readonly BattlefieldState[] { return this.combat.battlefields; }
  scored(player: PlayerId): readonly string[] { return this.scoreLedger.fields(player); }
  get queuedAdditionalTurns() { return this.turnQueue.snapshot().additional; }
  hidden(): HiddenState { return restoreHiddenState(this.hiddenState); }
  /** Authoritative objects with TurnFlow's facedown projection bit applied. */
  objects(): readonly ObjectSnapshot[] { return this.objectsWithBattlefieldControllers(); }

  private checkpoint() {
    return { phase: this.phaseValue, turn: this.turnValue, winner: this.winnerValue, special: this.special,
      turns: new Map(this.turns), ledger: this.scoreLedger.snapshot(), turnQueue: this.turnQueue.snapshot(),
      combat: this.combat?.checkpoint(), tasks: [...this.tasks], scoring: this.scoring,
      burnOutSequence: this.burnOutSequence, scoreWaveSequence: this.scoreWaveSequence,
      emptyingRunePool: this.emptyingRunePool,
      hidden: this.hiddenState, hiddenControllers: new Map(this.hiddenControllers) };
  }
  private restore(saved: ReturnType<TurnFlow['checkpoint']>): void {
    this.phaseValue = saved.phase; this.turnValue = saved.turn; this.winnerValue = saved.winner; this.special = saved.special;
    this.turns = saved.turns; this.scoreLedger.restore(saved.ledger); this.turnQueue.restore(saved.turnQueue);
    this.tasks = saved.tasks; this.burnOutSequence = saved.burnOutSequence;
    this.scoreWaveSequence = saved.scoreWaveSequence ?? 0;
    this.emptyingRunePool = saved.emptyingRunePool; this.hiddenState = restoreHiddenState(saved.hidden);
    this.hiddenControllers = saved.hiddenControllers;
    if (saved.combat) this.combat.restore(saved.combat);
  }

  start(): void {
    if (this.phaseValue !== 'not-started') throw new Error('Turn flow has already started');
    this.scheduleTurn(this.turnQueue.current());
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
        this.clearPlayedFromHidden();
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
    if (this.combat.current?.step === 'damage') {
      throw new TurnCombatBlockedError('pass-not-allowed-during-damage-assignment',
        'Pass is not allowed while Combat damage is being assigned (CR v1.5 467.2.c-d)');
    }
    if (!this.chain.items.length && !this.combat.active) { this.endTurn(player); return; }
    this.chain.pass(player);
    this.advance();
  }
  execute(draft: ChainDraft): void {
    if (!this.chain.items.length && !this.combat.active) this.advance();
    if (this.winnerValue || this.phase !== 'main' || this.tasks.length) throw new Error('Discretionary action is not available');
    const hidden = findHiddenCard(this.hiddenState, draft.source.ref);
    if (hidden === null) {
      this.chain.execute(draft);
      this.advance();
      return;
    }
    const checkpoint = this.options.host.checkpoint();
    const chainCheckpoint = this.chain.pipeline.checkpoint();
    const previousHidden = restoreHiddenState(this.hiddenState);
    try {
      const source = this.options.host.objects().find(object => object.ref.id === hidden.ref.id &&
        object.ref.zoneEntryId === hidden.ref.zoneEntryId);
      if (source === undefined) throw new TurnCombatBlockedError('hidden-source', 'Hidden source is not current');
      if (source.controller !== draft.controller || hidden.controller !== draft.controller) {
        throw new TurnCombatBlockedError('hidden-control', 'Hidden card must remain controlled by its player');
      }
      const hiddenField = this.battlefields.find(field => field.id === hidden.battlefieldId);
      const hiddenBattlefield = this.options.host.objects().find(object => object.zone === 'board' &&
        object.types.some(type => type.toLowerCase() === 'battlefield') &&
        (object.ref.id === hidden.battlefieldId || object.location?.type === 'battlefield' && object.location.id === hidden.battlefieldId));
      const controller = hiddenField === undefined ? hiddenBattlefield?.controller ?? null : hiddenField.controller;
      if (controller !== draft.controller) {
        throw new TurnCombatBlockedError('hidden-control', 'Hidden card must remain at a Battlefield controlled by its player');
      }
      if ((hidden.kind === 'unit' || hidden.kind === 'gear') &&
          (draft.location?.type !== 'battlefield' || draft.location.id !== hidden.battlefieldId)) {
        throw new TurnCombatBlockedError('hidden-destination', 'A Hidden permanent must be played to its controlled source Battlefield');
      }
      if (this.hiddenState.turn === hidden.hiddenTurn) {
        throw new TurnCombatBlockedError('not-unlocked', 'A Hidden card gains Reaction beginning on the next turn');
      }
      const declared = this.options.describePlay === undefined ? draft : withHiddenSource(this,
        () => this.options.describePlay!({ type: 'play', object: source.ref, player: draft.controller,
          ...(draft.location === undefined ? {} : { location: draft.location }) }, source, this));
      if (declared.targets !== undefined && declared.targets.length > 0) {
        const context = bindResolveContext(this.options.host.context(source, draft.controller, 'main-start'), {
          source, controller: draft.controller, timingPoint: 'main-start',
        });
        for (const target of declared.targets) {
          const required = (target.requirement.min ?? (target.requirement.selection === 'one' ? 1 : 0)) > 0;
          const scoped = context.query(target.requirement.filter).filter(object => {
            const location = target.requirement.location as unknown;
            if (location === undefined) return true;
            if (location === null) return object.location === null;
            if (typeof location !== 'object' || Array.isArray(location)) return true;
            const record = location as Readonly<Record<string, unknown>>;
            if (record.type === 'battlefield' && typeof record.id === 'string') {
              return object.location?.type === 'battlefield' && object.location.id === record.id;
            }
            if (record.type === 'base' && typeof record.player === 'string') {
              return object.location?.type === 'base' && object.location.player === record.player;
            }
            return true;
          });
          if (required && scoped.every(object => object.zone !== 'board' || object.faceDown)) {
            throw new TurnCombatBlockedError('hidden-target', 'No legal target exists at the Hidden source Battlefield');
          }
        }
      }
      const played = playFromHidden(this.hiddenState, {
        object: source.ref,
        source,
        player: draft.controller,
        turn: this.hiddenState.turn,
        ...(draft.location?.type === 'battlefield' ? { destinationBattlefieldId: draft.location.id } : {}),
      });
      this.hiddenState = played.state;
      const trusted = withHiddenSource(this, () => this.options.describePlay!(
        { type: 'play', object: source.ref, player: draft.controller,
          ...(draft.location === undefined ? {} : { location: draft.location }) }, source));
      const hiddenSource = { ...source, zone: 'board' as const, faceDown: true,
        location: { type: 'battlefield' as const, id: hidden.battlefieldId },
        facedownLocation: { type: 'battlefield' as const, id: hidden.battlefieldId } };
      this.chain.execute({ ...trusted, source: hiddenSource, speed: 'reaction' });
      const hiddenZone = Object.values(this.hiddenState.zones).find(zone =>
        zone.cards.some(card => card.ref.id === source.ref.id && card.ref.zoneEntryId === source.ref.zoneEntryId));
      if (hiddenZone !== undefined) this.hiddenState = restoreHiddenState({ ...this.hiddenState,
        zones: { ...this.hiddenState.zones, [hiddenZone.battlefieldId]: { ...hiddenZone,
          cards: hiddenZone.cards.filter(card => card.ref.id !== source.ref.id) } } });
      const current = this.options.host.objects().find(object => object.ref.id === source.ref.id);
      if (current !== undefined) this.hiddenState = this.rebindHidden(this.hiddenState, source.ref, current.ref);
      this.advance();
    } catch (error) {
      this.options.host.restore(checkpoint);
      this.chain.pipeline.restore(chainCheckpoint);
      this.hiddenState = previousHidden;
      throw error;
    }
  }
  /** Execute one Hide as a single state transaction; it never opens a Chain (CR 811.1.c.2). */
  hide(action: Extract<import('../effects/contract.js').ContractGameAction, { type: 'hide' }>):
    import('../effects/contract.js').ActionOutcome & {
      readonly plan?: import('../cost/plan-types.js').CostPlan;
      readonly costReceipt?: import('../cost/plan-types.js').CostPaymentReceipt;
    } {
    if (this.winnerValue || this.phase !== 'main' || this.tasks.length || this.chain.items.length ||
        this.combat.active || action.player !== this.turnPlayer || this.chain.turnState !== 'neutral-open') {
      throw new TurnCombatBlockedError('hidden-timing', 'Hide requires the turn player\'s Open State');
    }
    const checkpoint = this.options.host.checkpoint();
    const chainCheckpoint = this.chain.pipeline.checkpoint();
    const previousHidden = restoreHiddenState(this.hiddenState);
    try {
      const source = this.options.host.objects().find(object =>
        object.ref.id === action.object.id && object.ref.zoneEntryId === action.object.zoneEntryId);
      if (source === undefined) throw new TurnCombatBlockedError('hidden-source', 'Hidden source is not current');
      const field = this.battlefields.find(value => value.id === action.location.id);
      const battlefieldObject = this.options.host.objects().find(object =>
        object.ref.id === action.location.id || object.location?.type === 'battlefield' && object.location.id === action.location.id);
      const controller = field?.controller ?? battlefieldObject?.controller ?? null;
      if (field === undefined || controller !== action.player) {
        throw new TurnCombatBlockedError('hidden-battlefield', 'Hide destination must be a controlled Battlefield');
      }
      if (this.options.describePlay === undefined) {
        throw new TurnCombatBlockedError('hidden-permission', 'Hide requires a trusted card-program permission');
      }
      const described = withHiddenSource(this, () =>
        this.options.describePlay!({ type: 'play', object: source.ref, player: action.player }, source));
      if (!describeDraftHasHiddenPermission(described)) {
        throw new TurnCombatBlockedError('hidden-permission', 'The source does not have an executable Hidden permission');
      }
      const origin = source.zone as string;
      if (origin !== 'hand' && origin !== 'champion-zone' && origin !== 'champion') {
        throw new TurnCombatBlockedError('hidden-origin', 'Hidden must begin in Hand or the Champion Zone');
      }
      const hiddenAbilities = describeDraftHiddenAbilities(described);
      const state = setBattlefieldController(setTurn(this.hiddenState, this.turnValue),
        action.location.id, controller).state;
      const choose = <T>(request: import('../effects/contract.js').ChoiceRequest<T>) => this.options.host.choose(request);
      const context = bindResolveContext(this.options.host.context(source, action.player, 'main-start'), {
        source, controller: action.player, timingPoint: 'main-start', choose,
      });
      const paid = hideWithCost(state, {
        card: source, source, player: action.player, battlefieldId: action.location.id,
        abilities: hiddenAbilities,
        turn: this.turnValue, openState: true, ctx: context,
        costId: `hide:${source.ref.id}:${source.ref.zoneEntryId}:${this.turnValue}`,
        ...(action.cost === undefined ? {} : { ignoreAllCosts: false }),
      });
      const moved = this.options.host.execute({ type: 'move-zone', object: source.ref, to: 'battlefield',
        location: action.location });
      if (moved.outcome.status !== 'done') throw new TurnCombatBlockedError('hidden-move', 'Hide move produced no state transition');
      const own = this.options.host.objects().find(object => object.ref.id === source.ref.id);
      if (own === undefined) throw new TurnCombatBlockedError('hidden-move', 'Hidden card disappeared after Hide');
      // A zone move creates a new canonical incarnation. Rebind the validated
      // sidecar so its private zone and the live object name the same identity.
      this.hiddenState = this.rebindHidden(paid.state, source.ref, own.ref);
      this.chain.pipeline.emit({
        timingPoint: 'card-hidden',
        // Trigger matching may observe the private card; the public projection
        // is responsible for suppressing its identity from other players.
        object: Object.freeze({ ...own,
          might: null, energy: null, power: null, zone: 'board', faceDown: true,
          location: { type: 'battlefield' as const, id: action.location.id },
          facedownLocation: { type: 'battlefield' as const, id: action.location.id } }),
        player: action.player, details: { battlefieldId: action.location.id },
      });
      return { status: 'done', events: [...moved.outcome.events], plan: paid.plan, costReceipt: paid.receipt,
        receipt: { status: 'committed', actions: [{ type: 'hide', status: 'done' }] } };
    } catch (error) {
      this.options.host.restore(checkpoint);
      this.chain.pipeline.restore(chainCheckpoint);
      this.hiddenState = previousHidden;
      throw error;
    }
  }
  private executeContractAction(action: import('../effects/contract.js').ContractGameAction):
    import('../events/pipeline-types.js').ActionExecution {
    const leaves = action.type === 'batch' ? action.actions.flatMap(leaf =>
      leaf.type === 'batch' ? leaf.actions : [leaf]) : [action];
    if (action.type === 'hide' || leaves.some(leaf => leaf.type === 'hide')) {
      const execution = executeBridgeContractAction(action, {
        checkpoint: () => ({ host: this.options.host.checkpoint(), rules: this.checkpoint() }),
        restore: saved => {
          const checkpoint = saved as { readonly host: unknown; readonly rules: ReturnType<TurnFlow['checkpoint']> };
          this.options.host.restore(checkpoint.host);
          this.restore(checkpoint.rules);
        },
        objects: () => this.objects(),
        perform: leaf => this.options.host.execute(leaf).outcome,
        performContract: leaf => leaf.type === 'hide' ? this.hide(leaf) :
          this.options.host.executeContract?.(leaf)?.outcome ?? {
            status: 'impossible', events: [], receipt: { status: 'rejected', actions: [{ type: leaf.type, status: 'impossible' }] },
          },
      }, { transactionId: action.type === 'hide'
        ? `hide:${action.object.id}:${action.object.zoneEntryId}:${this.turnValue}`
        : `hide-batch:${this.turnValue}:${this.chain.pipeline.events.length}` });
      return { outcome: execution.outcome, emissions: [] };
    }
    if (this.options.host.executeContract === undefined) {
      throw new TurnCombatBlockedError('contract-actions', 'Contract action execution is unavailable');
    }
    return this.options.host.executeContract(action);
  }
  move(player: PlayerId, object: ObjectRef, field: string): StandardMoveBatchResult {
    if (!this.chain.items.length && !this.combat.active) this.advance();
    if (this.phase !== 'main' || this.tasks.length || this.winnerValue) throw new Error('Standard Move requires Main Phase');
    const result = this.combat.move(player, object, field);
    this.advance();
    return result;
  }
  /** Internal formation entry used by the public v2 move command. */
  moveFormation(input: StandardMoveFormationInput): StandardMoveBatchResult {
    if (this.chain.items.length || this.combat.active) {
      throw new TurnCombatBlockedError('standard-move-timing', 'Standard Move requires an idle Chain and no Combat');
    }
    if (this.phase !== 'main' || this.tasks.length || this.winnerValue) {
      throw new TurnCombatBlockedError('standard-move-timing', 'Standard Move requires Main Phase');
    }
    const result = this.combat.moveFormation(input);
    this.advance();
    return result;
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
  private scheduleTurn(queued: { readonly player: PlayerId }): void {
    const player = queued.player;
    this.tasks.push(() => {
      const previousPlayer = this.chain.pipeline.turnPlayer;
      this.chain.pipeline.turnPlayer = player;
      try { this.emit('turn-start', player); }
      catch (error) {
        this.chain.pipeline.turnPlayer = previousPlayer;
        throw error;
      }
      this.turnValue++;
      this.hiddenState = setTurn(this.hiddenState, this.turnValue);
      this.turns.set(player, this.turns.get(player)! + 1);
      this.scoreLedger.clear();
    });
    this.enter('awaken', player);
    this.tasks.push(() => {
      const objects = this.options.host.objects().filter(object => object.controller === player && object.exhausted &&
        (object.zone === 'board' || object.zone === 'rune-zone'));
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
    this.tasks.push(() => this.emptyAllRunePools());
    this.enter('main', player);
  }
  private insert(tasks: Task[]): void { this.tasks.splice(this.executingTask ? 1 : 0, 0, ...tasks); }
  private commit(action: GameAction): void {
    const outcome = this.chain.commit(action);
    if (outcome.status === 'impossible') throw new TurnCombatBlockedError('impossible-rules-action', `Required action is impossible: ${action.type}`);
  }
  private draw(player: PlayerId): void {
    let steps = 0;
    while (!this.winnerValue) {
      if (++steps > 100) throw new TurnCombatBlockedError('burn-out-nontermination', 'Burn Out did not reach a draw or winner');
      if (this.options.player(player).deckCount > 0) {
        this.commit({ type: 'draw', player, amount: 1 });
        return;
      }
      this.performBurnOut(player, this.burnOutSequence++);
    }
  }
  /** Exposes the complete per-battlefield ledger for production consumers. */
  scoreLedgerSnapshot(player: PlayerId): readonly import('../scoring/ledger.js').ScoreEntry[] {
    return this.scoreLedger.snapshot().entries.filter(entry => entry.player === player).map(entry => ({ ...entry }));
  }
  private emptyAllRunePools(): void {
    for (const player of this.options.turnOrder) this.emptyRunePool(player);
  }
  private emptyRunePool(player: PlayerId): void {
    const snapshot = this.options.player(player);
    if (snapshot.energy === 0 && snapshot.power.length === 0) return;
    this.emptyingRunePool = true;
    try {
      const namedPower: import('../effects/contract.js').Domain[] = [];
      let universalPower = 0;
      for (const source of snapshot.power) {
        if (source === 'universal' || source === 'any' || source === 'universal-power') universalPower++;
        else if (['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'].includes(source)) namedPower.push(source);
        else throw new TurnCombatBlockedError('empty-rune-pool', `Unknown Power source in Rune Pool: ${String(source)}`);
      }
      const outcome = this.chain.commit({ type: 'pay', player,
        plan: { finalized: true, energy: snapshot.energy, power: namedPower,
          ...(universalPower === 0 ? {} : { universalPower }) } });
      if (outcome.status !== 'done') {
        throw new TurnCombatBlockedError('empty-rune-pool', 'Rune Pool could not be emptied by the state owner');
      }
    } finally { this.emptyingRunePool = false; }
  }
  private performBurnOut(player: PlayerId, sequence: number): void {
    const participants: BurnOutParticipant[] = this.options.turnOrder.map(id => {
      const state = this.options.player(id);
      return { id, deckCount: state.deckCount,
        trashCount: this.options.host.objects().filter(object => object.owner === id && object.zone === 'trash').length };
    });
    const result = performBurnOutStep({ player, continuation: 'draw', amount: 1, sequence }, participants, {
      perform: action => action.type === 'score' && sequence > 0
        ? this.performUnreplaceablePoint(action.player, action.amount)
        : this.chain.commit(action),
      trash: owner => this.options.host.objects()
        .filter(object => object.owner === owner && object.zone === 'trash').map(object => object.ref),
    });
    if (result.status === 'rejected') {
      throw new TurnCombatBlockedError(result.reason ?? 'burn-out-rejected',
        `Burn Out task was rejected: ${result.reason ?? 'unspecified'}`);
    }
    if (sequence > 0) this.rewardWinnerAtCleanup();
  }
  private performUnreplaceablePoint(player: PlayerId, amount: number): ReturnType<typeof this.chain.commit> {
    const hostCheckpoint = this.options.host.checkpoint();
    const pipelineCheckpoint = this.chain.pipeline.checkpoint();
    try {
      const execution = this.options.host.execute({ type: 'score', player, amount });
      if (execution.outcome.status !== 'done') return execution.outcome;
      const batchId = `burn-out:${this.turnValue}:${this.burnOutSequence}`;
      this.chain.pipeline.emitBatch(execution.emissions.map(event => ({
        ...event,
        ...(event.timingPoint === 'score' ? { timingPoint: 'points-gained' as const } : {}),
        batchId,
        simultaneousGroup: batchId,
      })), undefined, batchId);
      this.chain.requestCleanup('burn-out-point');
      return { ...execution.outcome, events: [...execution.outcome.events] };
    } catch (error) {
      this.options.host.restore(hostCheckpoint);
      this.chain.pipeline.restore(pipelineCheckpoint);
      throw error;
    }
  }
  private scheduleExpiration(): void {
    this.emptyAllRunePools();
    const resolved = this.chain.trace.filter(event => event.step === 'resolved').length;
    this.special = 'ending';
    this.chain.requestCleanup('ending-special');
    this.insert([() => {
      if (this.chain.trace.filter(event => event.step === 'resolved').length !== resolved) {
        this.scheduleExpiration();
      } else {
        this.scheduleTurn(this.turnQueue.next());
      }
    }]);
  }
  private scheduleScore(player: PlayerId, field: string, method: 'hold' | 'conquer'): void {
    if (this.scoreLedger.has(player, field)) {
      if (method === 'conquer') this.insert([() => this.combat.establishWithoutScore(player, field)]);
      return;
    }
    // No score is awarded until the source process has actually established control.
    if (method === 'hold' && (this.combat.battlefields.find(value => value.id === field)?.controller !== player ||
      this.phase !== 'beginning' || this.turnPlayer !== player) || method === 'conquer' &&
      (this.combat.current?.step !== 'control' || this.combat.current.field !== field || this.combat.current.scorer !== player)) throw new Error('Invalid scoring timing');
    const battlefieldControllerBefore = method === 'conquer'
      ? this.captureBattlefieldControllerBefore(field, player)
      : undefined;
    const scoredFields = new Set([...this.scoreLedger.fields(player), field]);
    const finalDraw = method === 'conquer' && finalPointDecision(this.options.player(player).score,
      this.victoryScore, this.battlefields.every(value => scoredFields.has(value.id))).drawInstead;
    this.insert([() => {
      const battlefield = this.battlefieldObject(field);
      if (battlefield !== null && !scorePermission({
        registry: this.layers.registry,
        player,
        battlefield,
      }).allowed) {
        if (method === 'conquer') this.combat.establishWithoutScore(player, field);
        return;
      }
      const units = this.battlefieldUnits(field, player).map(unit => unit.ref);
      const batchId = `score-wave:${this.turnValue}:${++this.scoreWaveSequence}`;
      this.scoring = battlefieldControllerBefore === undefined
        ? { player, field, method: 'hold', finalDraw, units, batchId }
        : { player, field, method: 'conquer', finalDraw, units, battlefieldControllerBefore, batchId };
      try {
        if (finalDraw) this.draw(player);
        else this.commit({ type: 'score', player, amount: 1 });
        if (!this.scoreLedger.has(player, field)) throw new TurnCombatBlockedError('replaced-scoring', 'Replaced point gains require a structural Score task contract');
      } finally { this.scoring = null; }
    }]);
  }
  /**
   * CR 170.11.b / 468.5: the Conquer event reports the authoritative controller
   * immediately before the real Establish Control step. Capture it while the
   * Score task is scheduled, before combat.establish can mutate the battlefield.
   */
  /** Internal production seam used by score scheduling; kept closed outside TurnFlow. */
  private captureBattlefieldControllerBefore(field: string, scorer: PlayerId): PlayerId | null {
    const battlefield = this.battlefields.find(candidate => candidate.id === field);
    if (battlefield === undefined) {
      throw new TurnCombatBlockedError('conquer-before-state-unavailable',
        `Conquer requires an existing battlefield ${field}`);
    }
    if (this.combat.current?.step !== 'control' || this.combat.current.field !== field ||
        this.combat.current.scorer !== scorer) {
      throw new TurnCombatBlockedError('conquer-before-state-unavailable',
        'Conquer before-state requires the pending control task for this battlefield and scorer');
    }
    const controller = battlefield.controller;
    if (controller !== null && !this.options.turnOrder.includes(controller)) {
      throw new TurnCombatBlockedError('conquer-before-state-unavailable',
        `Conquer battlefield has an unknown controller ${controller}`);
    }
    if (controller === scorer) {
      throw new TurnCombatBlockedError('conquer-before-state-unavailable',
        'Conquer requires a control change; current controller already equals the scorer');
    }
    return controller;
  }
  private cleanup(_engine: ChainEngine): boolean {
    this.rewardWinnerAtCleanup();
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
    changed = this.cleanupRecallAndHidden() || changed;
    if (this.special === 'ending') {
      // Only this invocation is special. Fixed-point repeats are normal cleanups.
      this.special = null;
      for (const object of this.options.host.objects()) if (object.zone === 'board' && object.types.includes('unit') && object.damage > 0) {
        this.commit({ type: 'heal', object: object.ref, amount: object.damage }); changed = true;
      }
      for (const object of this.options.host.objects()) {
        if (object.zone !== 'board' || !object.types.includes('unit') || !object.stunned ||
            object.controller !== this.turnPlayer) continue;
        if (this.options.taskCapabilities?.clearStun === undefined) {
          // Step 3d is state-owner work. Without an explicit unstun capability,
          // leave the Stunned bit untouched rather than mutate a snapshot or
          // silently claim that the status expired.
          continue;
        }
        this.options.taskCapabilities.clearStun(object.ref);
        changed = true;
      }
      changed = this.layers.expireTurn(this.turnPlayer).length > 0 || changed;
      this.emptyAllRunePools();
    }
    return this.combat ? this.combat.cleanup() || changed : changed;
  }
  private rewardWinnerAtCleanup(): void {
    if (this.winnerValue !== null) return;
    const winner = winnerAtCleanup(this.options.turnOrder,
      player => this.options.player(player).score, this.victoryScore);
    if (winner === null) return;
    this.commit({ type: 'win', player: winner });
    this.winnerValue = winner;
  }
  private battlefieldObject(id: string): ObjectSnapshot | null {
    return this.objectsWithBattlefieldControllers().find(object => object.zone === 'board' &&
      object.types.some(type => type.toLowerCase() === 'battlefield') &&
      (object.ref.id === id || object.location?.type === 'battlefield' && object.location.id === id)) ?? null;
  }
  private battlefieldUnits(field: string, player: PlayerId): readonly ObjectSnapshot[] {
    this.layers.setObjects(this.objectsWithBattlefieldControllers());
    return this.layers.evaluateAll().filter(object => object.zone === 'board' &&
      object.types.includes('unit') && object.controller === player &&
      object.location?.type === 'battlefield' && object.location.id === field);
  }
  /** Project non-null Battlefield control into the trigger/query host view. */
  private objectsWithBattlefieldControllers(): readonly ObjectSnapshot[] {
    const controllers = new Map(this.combat.battlefields.map(field => [field.id, field.controller] as const));
    return this.options.host.objects().map(object => {
      const hidden = findHiddenCard(this.hiddenState, object.ref);
      if (hidden !== null) return Object.freeze({ ...object, cardId: null, name: 'Hidden card', types: [], tags: [],
        keywords: [], might: null, energy: null, power: null, zone: 'board' as const,
        location: { type: 'battlefield' as const, id: hidden.battlefieldId }, faceDown: true,
        facedownLocation: { type: 'battlefield' as const, id: hidden.battlefieldId } });
      if (playedFromHidden(this.hiddenState, object.ref) !== null) {
        return Object.freeze({ ...object, faceDown: false, facedownLocation: null });
      }
      if (object.zone !== 'board' || !object.types.some(type => type.toLowerCase() === 'battlefield')) return object;
      const battlefieldId = object.location?.type === 'battlefield' ? object.location.id : object.ref.id;
      if (!controllers.has(battlefieldId)) return object;
      const controller = controllers.get(battlefieldId);
      if (controller === null || controller === undefined) return object;
      return controller === object.controller ? object : Object.freeze({ ...object, controller });
    });
  }
  private refKey(object: ObjectRef): string { return `${object.id}:${object.zoneEntryId}`; }
  private rebindHidden(state: HiddenState, before: ObjectRef, after: ObjectRef): HiddenState {
    const oldKey = this.refKey(before);
    const zones = Object.fromEntries(Object.entries(state.zones).map(([id, zone]) => [id, {
      ...zone,
      cards: zone.cards.map(card => this.refKey(card.ref) === oldKey ? { ...card, ref: after } : card),
    }]));
    const playedFromHidden = Object.fromEntries(Object.entries(state.playedFromHidden).map(([key, card]) =>
      key === oldKey ? [this.refKey(after), { ...card, ref: after }] : [key, card]));
    return restoreHiddenState({ ...state, zones, playedFromHidden });
  }
  private clearPlayedFromHidden(): void {
    let next = this.hiddenState;
    for (const card of Object.values(next.playedFromHidden)) next = clearHiddenProvenance(next, card.ref);
    this.hiddenState = next;
  }
  private cleanupRecallAndHidden(): boolean {
    let changed = false;
    const currentHiddenZones = Object.fromEntries(Object.entries(this.hiddenState.zones).map(([id, zone]) => [id, {
      ...zone,
      cards: zone.cards.filter(card => this.options.host.objects().some(object =>
        object.ref.id === card.ref.id && object.ref.zoneEntryId === card.ref.zoneEntryId && object.zone === 'board')),
    }]));
    if (Object.values(currentHiddenZones).some((zone, index) => zone.cards.length !==
        Object.values(this.hiddenState.zones)[index]!.cards.length)) {
      this.hiddenState = restoreHiddenState({ ...this.hiddenState, zones: currentHiddenZones });
      changed = true;
    }
    for (const field of this.options.battlefields) {
      const controller = this.battlefields.find(value => value.id === field.id)?.controller ?? null;
      this.hiddenState = setBattlefieldController(this.hiddenState, field.id, controller).state;
      this.hiddenControllers.set(field.id, controller);
      const capacity = this.options.facedownCapacity?.(field.id);
      const zone = this.hiddenState.zones[field.id];
      if (capacity !== undefined && zone !== undefined && capacity < zone.cards.length) {
        const result = setFacedownCapacity(this.hiddenState, field.id, capacity,
          (cards, count) => controller === null ? [] : this.options.host.choose<readonly ObjectRef[]>({
            id: `cleanup:facedown-capacity:${this.turnValue}:${field.id}`,
            type: 'select-objects', chooser: controller, visibility: 'public',
            options: cards.map(card => card.ref), min: count, max: count,
          }));
        this.hiddenState = result.state;
        for (const card of result.discarded) this.discardHidden(card.ref, field.id);
        changed ||= result.discarded.length > 0;
      }
    }
    const lost = cleanupLostControl(this.hiddenState,
      Object.fromEntries(this.hiddenControllers));
    this.hiddenState = lost.state;
    for (const card of lost.discarded) this.discardHidden(card.ref, card.battlefieldId);
    changed ||= lost.discarded.length > 0;

    for (const object of this.options.host.objects()) {
      if (object.zone !== 'board' || object.location === null) continue;
      const location = object.location;
      const field = location.type === 'battlefield'
        ? this.battlefields.find(candidate => candidate.id === location.id)
        : undefined;
      if (object.faceDown && (field === undefined || field.controller !== object.controller)) {
        this.discardHidden(object.ref, location.type === 'battlefield' ? location.id : 'base');
        changed = true;
        continue;
      }
      if (findHiddenCard(this.hiddenState, object.ref) !== null) continue;
      const recalled = location.type === 'base'
        ? location.player !== object.controller && object.attachedTo === null
        : !object.types.includes('unit') && object.attachedTo === null &&
          !object.keywords.some(keyword => keyword.id.toLowerCase() === 'deploy') &&
          !object.types.some(type => type.toLowerCase() === 'battlefield');
      if (recalled) {
        this.recall(object);
        changed = true;
      }
    }
    return changed;
  }
  private recall(object: ObjectSnapshot): void {
    if (this.options.host.executeContract === undefined) {
      throw new TurnCombatBlockedError('recall-action', 'Cleanup Recall needs executeContract');
    }
    const outcome = this.chain.pipeline.commitContract({
      type: 'recall', object: object.ref, player: object.controller,
    });
    if (outcome.status !== 'done') {
      throw new TurnCombatBlockedError('recall-action', 'Cleanup Recall was rejected');
    }
  }
  private discardHidden(object: ObjectRef, battlefieldId: string): void {
    const candidate = this.options.host.objects().find(value => value.ref.id === object.id &&
      value.ref.zoneEntryId === object.zoneEntryId);
    const current = candidate?.zone === 'board' ? candidate : undefined;
    if (current === undefined) return;
    // CR 422.4: a facedown card changing zones is revealed to all players
    // before it moves. Both commits stay inside the surrounding Chain cleanup
    // transaction, so a failed Reveal or Move-Zone rolls both back atomically.
    const revealed = this.chain.commit({ type: 'reveal', object: current.ref });
    if (revealed.status !== 'done') {
      throw new TurnCombatBlockedError('hidden-cleanup-state',
        'Hidden cleanup Reveal was rejected');
    }
    const moved = this.chain.commit({ type: 'move-zone', object: current.ref, to: 'trash' });
    if (moved.status !== 'done') {
      throw new TurnCombatBlockedError('hidden-cleanup-state',
        'Hidden cleanup Move-Zone was rejected');
    }
    void battlefieldId;
  }
}
