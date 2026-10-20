import type { ChainEngine } from '../chain/engine.js';
import type { ObjectRef, ObjectSnapshot, PlayerId } from '../effects/contract.js';
import type { PipelineHost, TimingEmission, TriggerSnapshot } from '../events/pipeline-types.js';
import { TurnCombatBlockedError } from '../turn/flow.js';
import {
  completeDuelBaseCombatAllocation,
  validateDuelBaseCombatAllocation,
  type DuelBaseCombatCompleteAllocation,
  type DuelBaseCombatOrderedUIDAmount,
  type DuelBaseCombatPlan,
} from './base-combat-allocation.js';
import { emitCombatWave, runCombatTransaction } from './transactions/atomic.js';
import {
  combatDamageEventDetails,
  createCombatDamagePlan,
  type CombatDamageRuntime,
} from './transactions/damage.js';
import {
  commitCombatCleanupHeal,
  commitCombatCleanupRecall,
  type CombatSpecialCleanupRecord,
} from './transactions/cleanup.js';

export interface BattlefieldState {
  readonly id: string;
  readonly controller: PlayerId | null;
  readonly contestedBy: PlayerId | null;
  readonly staged: 'none' | 'showdown' | 'combat';
}
type MutableField = { -readonly [K in keyof BattlefieldState]: BattlefieldState[K] };
type Engagement = {
  field: string;
  step: 'showdown' | 'damage' | 'cleanup' | 'result' | 'control' | 'end';
  scorer?: PlayerId;
  queued?: boolean;
  attacker?: PlayerId;
  defender?: PlayerId;
  combatId?: string;
  damage?: {
    readonly plan: DuelBaseCombatPlan;
    readonly attacker?: DuelBaseCombatCompleteAllocation['attacker'];
    readonly attackerChoice?: readonly DuelBaseCombatOrderedUIDAmount[];
  };
  designatedRoles?: Readonly<Record<string, 'attacker' | 'defender'>>;
  result?: CombatResult;
  recalledUnitKeys?: readonly string[];
  cleanup?: CombatSpecialCleanupRecord;
  /** CR 468.3.d.1 and 468.5 action while the Combat-end wave scans. */
  endState?: 'ordinary' | 'restage';
  controlEstablished?: boolean;
  controlGateReleased?: boolean;
  endEmitted?: boolean;
};

export interface CombatStartResult {
  readonly field: string;
  readonly combatId: string;
  readonly attacker: PlayerId;
  readonly defender: PlayerId;
  readonly focus: PlayerId;
}

export interface CombatDamageResult {
  readonly field: string;
  readonly combatId: string;
  readonly attackerPlayerId: PlayerId;
  readonly defenderPlayerId: PlayerId;
  readonly batchId: string;
}

export type CombatLifecyclePhase = 'showdown' | 'damage' | 'cleanup' | 'result' | 'control' | 'end';

export interface CombatDamageAllocationView {
  readonly combatId: string;
  readonly battlefieldId: string;
  readonly attackerPlayerId: PlayerId;
  readonly defenderPlayerId: PlayerId;
  readonly attackerMight: number;
  readonly defenderMight: number;
  readonly attackerSubmitted: boolean;
}

export interface CombatResult {
  readonly combatId: string;
  readonly battlefieldId: string;
  readonly winnerId: PlayerId | null;
  readonly loserId: PlayerId | null;
  readonly unitResults: readonly { readonly unitId: string; readonly result: 'won' | 'lost' | 'no-result' }[];
  readonly noResult: boolean;
}

/** Batch 5 structural tasks; Priority, Focus, triggers and Chain stay in batch 4. */
export class CombatFlow {
  private fields: MutableField[];
  private engagement: Engagement | null = null;
  private combatSequence = 0;
  private transactionDepth = 0;
  private readonly combatRoles = new Map<string, 'attacker' | 'defender'>();
  private readonly eventsEnabled: boolean;
  private readonly lifecycleEnabled: boolean;
  constructor(
    private readonly chain: ChainEngine,
    private readonly host: PipelineHost,
    fields: readonly { readonly id: string; readonly controller: PlayerId | null }[],
    private readonly conquer: (player: PlayerId, field: string) => void,
    options: { readonly events?: boolean; readonly lifecycle?: boolean } = {},
  ) {
    this.fields = fields.map(field => ({ ...field, contestedBy: null, staged: 'none' }));
    // Full Combat needs the same contract capability that atomically commits
    // simultaneous damage. Production hosts install it by default; reduced or
    // legacy hosts without it keep the explicit fail-closed boundary.
    const contractCapable = typeof host.executeContract === 'function';
    // TurnFlow installs its own checkpointing host over the contract-capable
    // production host. A direct ChainEngine host remains the lower-level seam
    // and keeps its historical explicit-opt-in behavior.
    const productionAssembly = contractCapable && host !== chain.pipeline.host;
    this.eventsEnabled = options.events ?? productionAssembly;
    this.lifecycleEnabled = options.lifecycle ?? productionAssembly;
  }
  get battlefields(): readonly BattlefieldState[] { return structuredClone(this.fields); }
  get active(): boolean { return this.engagement !== null; }
  get current(): Readonly<Engagement> | null { return this.engagement && { ...this.engagement }; }
  get lifecycle(): Readonly<{ phase: CombatLifecyclePhase; field: string; combatId: string;
    attacker: PlayerId; defender: PlayerId }> | null {
    const active = this.engagement;
    if (active?.attacker === undefined || active.defender === undefined || active.combatId === undefined) return null;
    return Object.freeze({ phase: active.step, field: active.field, combatId: active.combatId,
      attacker: active.attacker, defender: active.defender });
  }
  checkpoint() {
    const engagement = this.engagement;
    return {
      fields: structuredClone(this.fields),
      engagement: engagement === null ? null : {
        ...engagement,
        ...(engagement.designatedRoles === undefined ? {} : {
          designatedRoles: { ...engagement.designatedRoles },
        }),
        ...(engagement.damage === undefined ? {} : {
          damage: { ...engagement.damage },
        }),
      },
      combatSequence: this.combatSequence,
      combatRoles: new Map(this.combatRoles),
      transactionDepth: this.transactionDepth,
    };
  }
  restore(snapshot: ReturnType<CombatFlow['checkpoint']>): void {
    this.fields = snapshot.fields;
    this.engagement = snapshot.engagement;
    this.combatSequence = snapshot.combatSequence;
    this.combatRoles.clear();
    for (const [key, role] of snapshot.combatRoles) this.combatRoles.set(key, role);
    this.transactionDepth = snapshot.transactionDepth;
  }
  private withTransaction<T>(run: () => T): T {
    if (this.transactionDepth > 0) return run();
    return runCombatTransaction(this.chain, this, () => {
      const savedDepth = this.transactionDepth;
      this.transactionDepth = savedDepth + 1;
      try { return run(); }
      finally { this.transactionDepth = savedDepth; }
    });
  }
  private refKey(ref: ObjectRef): string { return `${ref.id}:${ref.zoneEntryId}`; }
  private role(object: ObjectSnapshot): 'attacker' | 'defender' | null {
    return object.combatRole ?? this.combatRoles.get(this.refKey(object.ref)) ?? null;
  }
  private withRole(object: ObjectSnapshot, role: 'attacker' | 'defender' | null): ObjectSnapshot {
    return Object.freeze({ ...object, combatRole: role });
  }
  /** Read-only view used by tests and diagnostics; it never grants command authority. */
  snapshot(object: ObjectSnapshot): ObjectSnapshot {
    const role = this.combatRoles.get(this.refKey(object.ref));
    return role === undefined ? object : this.withRole(object, role);
  }
  private layerObjects(): readonly ObjectSnapshot[] {
    return this.host.objects().map(object => {
      const role = this.combatRoles.get(this.refKey(object.ref));
      return role === undefined ? object : this.withRole(object, role);
    });
  }
  private units(field: string): readonly ObjectSnapshot[] {
    this.chain.layers.setObjects(this.layerObjects());
    return this.chain.layers.evaluateAll().filter(object => object.zone === 'board' && object.types.includes('unit') &&
      object.location?.type === 'battlefield' && object.location.id === field)
      .map(object => this.withRole(object, this.role(object)));
  }
  private emit(timingPoint: Parameters<ChainEngine['emit']>[0]['timingPoint'], field: string, player?: string, object?: ObjectSnapshot): void {
    this.chain.emit({ timingPoint, player, object, details: { battlefieldId: field } });
  }
  /**
   * CR 466.2.d.1 gives the Attacker precedence over the ordinary Turn Order
   * used by the shared trigger scanner. Buffer this designation-only wave and
   * flush each controller's already-chosen internal order in rule order.
   */
  private emitDesignationWave(
    attacker: PlayerId,
    defender: PlayerId,
    units: readonly ObjectSnapshot[],
    details: Readonly<Record<string, unknown>>,
    combatId: string,
  ): void {
    const pipeline = this.chain.pipeline;
    const original = pipeline.onTrigger;
    const captured: TriggerSnapshot[] = [];
    pipeline.onTrigger = snapshot => { captured.push(snapshot); };
    try {
      emitCombatWave(this.chain, this, units.map(unit => ({
        timingPoint: this.role(unit) === 'attacker' ? 'attack-declared' as const : 'defense-declared' as const,
        player: unit.controller,
        object: unit,
        details,
      })), combatId);
    } finally {
      pipeline.onTrigger = original;
    }
    const order = [attacker,
      ...pipeline.turnOrder.filter(player => player !== attacker && player !== defender), defender];
    const flushed = new Set<TriggerSnapshot>();
    for (const controller of order) {
      for (const snapshot of captured) {
        if (snapshot.controller !== controller) continue;
        flushed.add(snapshot);
        original(snapshot);
      }
    }
    for (const snapshot of captured) if (!flushed.has(snapshot)) original(snapshot);
  }
  private runSpecialCleanup(): void {
    const active = this.engagement;
    if (active?.combatId === undefined || active.attacker === undefined || active.defender === undefined) {
      throw new TurnCombatBlockedError('combat-cleanup-state', 'Combat Special Cleanup has no Combat identity');
    }
    if (active.cleanup !== undefined) return;
    this.chain.layers.setObjects(this.layerObjects());
    const boardUnits = this.chain.layers.evaluateAll().filter(object => object.zone === 'board' &&
      object.types.includes('unit') && object.damage > 0);
    let healReceipt;
    try {
      healReceipt = commitCombatCleanupHeal(this.host, boardUnits, active.combatId);
    }
    catch (error) {
      throw new TurnCombatBlockedError('combat-cleanup-heal',
        `Combat Special Cleanup could not heal all Board Units: ${error instanceof Error ? error.message : String(error)}`);
    }
    const present = this.units(active.field);
    const attackers = present.some(unit => unit.controller === active.defender) ?
      present.filter(unit => this.role(unit) === 'attacker' && unit.controller === active.attacker) : [];
    let recall;
    try {
      recall = commitCombatCleanupRecall(this.host, attackers, active.combatId, active.field, active.attacker);
    }
    catch (error) {
      throw new TurnCombatBlockedError('combat-cleanup-recall',
        `Combat Special Cleanup could not atomically Recall present Attackers: ${error instanceof Error ? error.message : String(error)}`);
    }
    active.cleanup = Object.freeze({ combatId: active.combatId, healReceipt, recall });
    active.recalledUnitKeys = recall?.unitKeys;
  }
  /** Contested is applied by the actual entry action, before its trigger wave. */
  entered(object: ObjectSnapshot): TimingEmission[] {
    if (object.zone !== 'board' || !object.types.includes('unit') || object.location?.type !== 'battlefield') return [];
    const field = this.fields.find(value => value.id === (object.location as { id: string }).id);
    if (!field) throw new TurnCombatBlockedError('unknown-battlefield', 'Committed entry refers to an unknown Battlefield');
    if (field.controller === object.controller || field.contestedBy !== null) return [];
    field.contestedBy = object.controller;
    return [{ timingPoint: 'contested-applied', player: object.controller, object, details: { battlefieldId: field.id } }];
  }
  private establishRoles(field: string): readonly ObjectSnapshot[] {
    const engagement = this.engagement;
    if (engagement === null || engagement.field !== field || engagement.attacker === undefined) {
      throw new TurnCombatBlockedError('combat-role-state', 'Combat has no committed Attacker designation');
    }
    const attacker = engagement.attacker;
    const defender = engagement.defender;
    if (defender === undefined) throw new TurnCombatBlockedError('combat-role-state', 'Combat has no committed Defender designation');
    const units = this.units(field);
    const byController = new Map<PlayerId, 'attacker' | 'defender'>([[attacker, 'attacker'], [defender, 'defender']]);
    for (const unit of units) {
      const role = byController.get(unit.controller);
      if (role === undefined) throw new TurnCombatBlockedError('combat-role-state', 'A Combat battlefield has a third controller');
      this.combatRoles.set(this.refKey(unit.ref), role);
    }
    return units.map(unit => this.withRole(unit, byController.get(unit.controller)!));
  }
  private markDesignated(units: readonly ObjectSnapshot[]): void {
    const active = this.engagement;
    if (active === null) return;
    const designated = { ...(active.designatedRoles ?? {}) };
    for (const unit of units) designated[this.refKey(unit.ref)] = this.role(unit)!;
    active.designatedRoles = Object.freeze(designated);
  }
  /** Apply 323.2 to units that arrive after the opening designation wave. */
  private refreshRoles(field: string): {
    readonly changed: boolean;
    readonly emissions: readonly TimingEmission[];
  } {
    const engagement = this.engagement;
    if (engagement?.attacker === undefined || engagement.defender === undefined || engagement.combatId === undefined) {
      return { changed: false, emissions: [] };
    }
    let changed = false;
    const designated = { ...(engagement.designatedRoles ?? {}) };
    const emissions: TimingEmission[] = [];
    const byController = new Map<PlayerId, 'attacker' | 'defender'>([
      [engagement.attacker, 'attacker'], [engagement.defender, 'defender'],
    ]);
    const present = new Set<string>();
    for (const unit of this.units(field)) {
      present.add(this.refKey(unit.ref));
      const role = byController.get(unit.controller);
      if (role === undefined) throw new TurnCombatBlockedError('combat-role-state', 'A Combat battlefield has a third controller');
      if (this.combatRoles.get(this.refKey(unit.ref)) !== role) {
        this.combatRoles.set(this.refKey(unit.ref), role); changed = true;
      }
      const key = this.refKey(unit.ref);
      if (designated[key] !== role) {
        designated[key] = role;
        emissions.push({
          timingPoint: role === 'attacker' ? 'attack-declared' : 'defense-declared',
          player: unit.controller,
          object: this.withRole(unit, role),
          details: {
            combatId: engagement.combatId,
            battlefieldId: engagement.field,
            attackerId: engagement.attacker,
            defenderId: engagement.defender,
            source: 'cleanup-designation',
          },
        });
      }
    }
    for (const key of [...this.combatRoles.keys()]) {
      if (!present.has(key)) { this.combatRoles.delete(key); changed = true; }
    }
    engagement.designatedRoles = Object.freeze(designated);
    return { changed, emissions };
  }
  private clearRoles(): void { this.combatRoles.clear(); }
  private openCombat(field: MutableField): CombatStartResult {
    if (!this.eventsEnabled) {
      throw new TurnCombatBlockedError('combat-start-transaction', 'Combat start needs an atomic simultaneous timing wave + roles (CR 466.2)');
    }
    const result = this.withTransaction(() => {
      const attacker = field.contestedBy;
      if (attacker === null) throw new TurnCombatBlockedError('combat-role-state', 'Staged Combat has no Contested player');
      const defenders = [...new Set(this.units(field.id).map(unit => unit.controller))].filter(id => id !== attacker);
      if (defenders.length !== 1) throw new TurnCombatBlockedError('combat-role-state', 'Staged Combat must have exactly one Defender');
      const defender = defenders[0]!;
      const combatId = `combat:${field.id}:${++this.combatSequence}`;
      this.engagement = { field: field.id, step: 'showdown', attacker, defender, combatId };
      field.staged = 'none';
      const units = this.establishRoles(field.id);
      this.markDesignated(units);
      const details = { combatId, battlefieldId: field.id, attackerId: attacker, defenderId: defender };
      this.chain.openShowdown(attacker);
      emitCombatWave(this.chain, this,
        [{ timingPoint: 'combat-start', player: attacker, details }], `${combatId}:start`);
      this.emitDesignationWave(attacker, defender, units, details, `${combatId}:designation`);
      this.chain.requestCleanup('combat-opened');
      return Object.freeze({ field: field.id, combatId, attacker, defender, focus: attacker });
    });
    this.chain.advance();
    return result;
  }
  /** Called inside the Score action's host transaction, before its timing wave. */
  establish(player: PlayerId, fieldId: string): TimingEmission {
    const active = this.engagement;
    if (active?.step !== 'control' || active.field !== fieldId || active.scorer !== player) {
      throw new Error('No pending establishment for this player and Battlefield');
    }
    const field = this.fields.find(value => value.id === fieldId)!;
    field.controller = player; field.contestedBy = null; field.staged = 'none';
    this.chain.layers.setObjects(this.layerObjects());
    for (const object of this.layerObjects()) {
      if (object.combatRole === null || object.combatRole === undefined) continue;
      if (object.location?.type === 'battlefield' && object.location.id === fieldId) continue;
      this.combatRoles.delete(this.refKey(object.ref));
    }
    active.controlEstablished = true;
    active.controlGateReleased = false;
    return { timingPoint: 'control-established', player, details: { battlefieldId: fieldId } };
  }
  establishWithoutScore(player: PlayerId, field: string): void {
    const saved = this.checkpoint();
    const active = this.engagement;
    const event = this.establish(player, field);
    try {
      this.chain.emit(event);
      if (active !== null && active.field === field && active.controlEstablished === true) {
        if (this.chain.items.length === 0) {
          active.controlGateReleased = true;
          active.step = 'end';
        }
      }
    }
    catch (error) { this.restore(saved); throw error; }
  }

  /** Resume CR 468.7 only after the producer-owned 468.5/468.6 FEPR finished. */
  settleControlFepr(): void {
    const active = this.engagement;
    if (active?.controlEstablished !== true ||
        (active.step !== 'control' && active.step !== 'end' && active.step !== 'result') ||
        this.chain.items.length > 0 || this.chain.turnState !== 'neutral-open') return;
    active.controlGateReleased = true;
    active.step = 'end';
    this.finishCombat();
  }

  move(player: PlayerId, ref: ObjectRef, fieldId: string): void {
    const field = this.fields.find(value => value.id === fieldId);
    const object = this.host.objects().find(value => value.ref.id === ref.id && value.ref.zoneEntryId === ref.zoneEntryId);
    if (!field || !object || object.zone !== 'board' || !object.types.includes('unit') || object.controller !== player ||
      object.exhausted || this.active || this.chain.turnState !== 'neutral-open' || !this.chain.canAct(player, 'normal')) {
      throw new Error('Illegal Standard Move');
    }
    // Multi-action costs need the same atomic rules task seam as simultaneous damage.
    // Never exhaust a Unit then risk leaving its failed Move half committed.
    throw new TurnCombatBlockedError('standard-move-transaction', 'Standard Move requires atomic Exhaust + Move with rollback (CR 144.2)');
  }
  /** Called by the real ChainEngine cleanup callback, never by a test fixture. */
  cleanup(): boolean {
    if (this.transactionDepth > 0) {
      throw new TurnCombatBlockedError('combat-cleanup-reentrant', 'Combat cleanup cannot mutate the chain during a Combat transaction');
    }
    let changed = false;
    const active = this.engagement;
    if (active?.field !== undefined) {
      const refreshed = this.withTransaction(() => {
        const result = this.refreshRoles(active.field);
        if (result.emissions.length > 0) {
          emitCombatWave(this.chain, this, result.emissions,
            `${active.combatId}:designation:${this.chain.pipeline.clock.turn}:${this.chain.pipeline.events.length}`);
        }
        return result;
      });
      changed ||= refreshed.changed || refreshed.emissions.length > 0;
    }
    for (const field of this.fields) {
      if (field.id === active?.field) continue;
      const units = this.units(field.id);
      if (this.chain.turnState.endsWith('-open') && field.controller &&
          !units.some(unit => unit.controller === field.controller)) {
        const old = field.controller;
        field.controller = null;
        this.emit('control-lost', field.id, old); changed = true;
      }
      if (field.contestedBy &&
          !units.some(unit => unit.controller === field.contestedBy)) { field.contestedBy = null; changed = true; }
      if (!field.contestedBy) {
        const candidates = [...new Set(units.filter(unit => unit.controller !== field.controller).map(unit => unit.controller))];
        if (candidates.length > 1) throw new TurnCombatBlockedError('contested-origin', 'Multiple occupants need the committed Move/entry origin to determine Contested');
        if (candidates[0]) {
          field.contestedBy = candidates[0];
          this.emit('contested-applied', field.id, candidates[0]); changed = true;
        }
      }
      const controllers = new Set(units.map(unit => unit.controller));
      if (controllers.size > 2) throw new TurnCombatBlockedError('contested-origin', 'A Battlefield cannot stage a multi-player Combat');
      const staged = !field.contestedBy ? 'none' : controllers.size === 2 ? 'combat' : 'showdown';
      if (field.staged !== staged) { field.staged = staged; changed = true; }
    }
    return changed;
  }
  /** Open staged work after Cleanup has exited, before another player command. */
  advance(): void {
    if (this.chain.items.length) return;
    const activeCombat = this.engagement;
    if (activeCombat?.step === 'control' && activeCombat.result?.noResult === true &&
        !activeCombat.controlEstablished && !this.units(activeCombat.field).length) {
      activeCombat.endState = 'ordinary';
      activeCombat.step = 'end';
    }
    if (activeCombat?.step === 'control' && activeCombat.controlEstablished === true) {
      if (this.chain.turnState === 'neutral-open') this.settleControlFepr();
      return;
    }
    if (activeCombat?.endState === 'restage' && activeCombat.step === 'control') {
      activeCombat.step = 'end';
    }
    if (activeCombat?.step === 'end' && this.chain.turnState === 'neutral-open') {
      this.finishCombat();
      return;
    }
    if (activeCombat?.step === 'cleanup' && this.chain.turnState === 'neutral-open' &&
        activeCombat.cleanup === undefined) {
      this.withTransaction(() => {
        const active = this.engagement!;
        this.runSpecialCleanup();
        active.step = 'result';
      });
      return;
    }
    if (activeCombat?.step === 'result' && this.chain.turnState === 'neutral-open') {
      this.withTransaction(() => {
        this.resolveCombatResult();
        this.finishCombat();
      });
      return;
    }
    if (this.engagement) {
      const active = this.engagement;
      if (active.step === 'control' && active.controlEstablished === true) {
        this.settleControlFepr();
        return;
      }
      if (active.step === 'control') {
        if (active.scorer === undefined) {
          const controllers = [...new Set(this.units(active.field).map(unit => unit.controller))];
          if (controllers.length === 1) active.scorer = controllers[0]!;
        }
        if (!active.queued && active.scorer) {
          active.queued = true;
          try { this.withTransaction(() => this.conquer(active.scorer!, active.field)); }
          catch (error) { active.queued = false; throw error; }
        }
        // control-established heads one producer-owned Score wave; only the
        // successful establish action may advance to 468.7.
        if (!active.queued || !active.controlEstablished) return;
        // A no-op producer is not a completed 468.5/468.6 task.
        if (!active.controlGateReleased) return;
        active.step = 'end';
        return;
      }
      if (active.step === 'cleanup') return;
      if (active.step === 'result') return;
      if (active.step === 'end') return;
      if (this.chain.turnState.startsWith('showdown')) {
        const field = this.fields.find(candidate => candidate.id === active.field)!;
        const controllers = new Set(this.units(active.field).map(unit => unit.controller));
        if (active.attacker === undefined && controllers.size === 2 &&
            this.chain.turnState === 'showdown-open') {
          this.convertShowdown(active.field);
          return;
        }
        if (controllers.size === 2) return;
        return;
      }
      if (active.combatId === undefined) {
        const field = this.fields.find(value => value.id === active.field)!;
        const controllers = [...new Set(this.units(active.field).map(unit => unit.controller))];
        if (controllers.length === 1 && field.controller !== controllers[0]) {
          // A non-Combat Showdown uses the same Control/Conquer task contract,
          // but has no 468 Resolution step to preserve.
          active.step = 'control';
          active.scorer = controllers[0]!;
          this.conquer(active.scorer, field.id);
          active.queued = true;
          return;
        }
      }
      // Damage -> cleanup/result/control/end is the only live Combat path.
      // The fallback below is reserved for a staged engagement that has not
      // acquired a combat identity; a committed Combat must never bypass 468.1.
      if (active.combatId === undefined) {
        this.fields.find(value => value.id === active.field)!.staged = 'none';
        this.fields.find(value => value.id === active.field)!.contestedBy = null;
        this.engagement = null;
      }
      return;
    }
    if (this.chain.turnState !== 'neutral-open') return;
    const candidates = this.fields.filter(field => field.staged === 'showdown');
    if (!candidates.length) {
      const combat = this.fields.filter(field => field.staged === 'combat');
      if (combat.length === 1 && this.lifecycleEnabled) {
        this.openCombat(combat[0]!);
        return;
      }
      candidates.push(...combat);
    }
    if (!candidates.length) return;
    const id = candidates.length === 1 ? candidates[0]!.id : this.host.choose<string>({
      id: `engagement:${this.chain.pipeline.clock.turn}:${this.chain.pipeline.events.length}`,
      chooser: this.chain.pipeline.turnPlayer, visibility: 'public', type: 'mode', options: candidates.map(field => field.id),
    });
    const field = candidates.find(value => value.id === id);
    if (!field) throw new TypeError('Invalid staged engagement choice');
    if (field.staged === 'combat') {
      if (this.lifecycleEnabled) this.openCombat(field);
      else throw new TurnCombatBlockedError('combat-start-transaction',
        'Combat start needs an atomic simultaneous timing wave + roles (CR 466.2)');
      return;
    }
    this.chain.openShowdown(field.contestedBy!);
    this.engagement = { field: id, step: 'showdown' };
    this.chain.requestCleanup('showdown-opened');
  }
  /** Start a staged Combat directly; used by the real Cleanup/advance path and production tests. */
  startCombat(fieldId: string): CombatStartResult {
    const field = this.fields.find(candidate => candidate.id === fieldId);
    if (field === undefined || field.staged !== 'combat') {
      throw new TurnCombatBlockedError('combat-not-staged', 'No Combat is staged at this Battlefield');
    }
    if (this.engagement !== null || this.chain.turnState !== 'neutral-open' || this.chain.items.length !== 0) {
      throw new TurnCombatBlockedError('combat-state', 'Combat cannot open in the current state');
    }
    return this.openCombat(field);
  }
  /** A Showdown may convert only while its state is open and still has no Chain items. */
  convertShowdown(fieldId: string): CombatStartResult {
    const field = this.fields.find(candidate => candidate.id === fieldId);
    if (field === undefined || this.engagement?.field !== fieldId ||
        this.engagement.step !== 'showdown' || this.chain.turnState !== 'showdown-open' || this.chain.items.length !== 0) {
      throw new TurnCombatBlockedError('showdown-conversion', 'Showdown cannot convert in the current state');
    }
    if (!this.eventsEnabled) {
      throw new TurnCombatBlockedError('showdown-conversion', 'Showdown conversion needs an atomic Combat start transaction');
    }
    const existingFocus = this.chain.focus;
    if (existingFocus === null) throw new TurnCombatBlockedError('combat-focus', 'Combat Showdown has no Focus holder');
    const attacker = field.contestedBy;
    if (attacker === null) throw new TurnCombatBlockedError('combat-role-state', 'Staged Combat has no Contested player');
    const defenders = [...new Set(this.units(fieldId).map(unit => unit.controller))].filter(id => id !== attacker);
    if (defenders.length !== 1) throw new TurnCombatBlockedError('combat-role-state', 'Staged Combat must have exactly one Defender');
    const defender = defenders[0]!;
    const combatId = `combat:${fieldId}:${++this.combatSequence}`;
    this.engagement = { field: fieldId, step: 'showdown', attacker, defender, combatId };
    field.staged = 'none';
    const units = this.establishRoles(fieldId);
    this.markDesignated(units);
    const details = { combatId, battlefieldId: fieldId, attackerId: attacker, defenderId: defender, focus: existingFocus };
    emitCombatWave(this.chain, this,
      [{ timingPoint: 'combat-start', player: attacker, details }], `${combatId}:start`);
    this.emitDesignationWave(attacker, defender, units, details, `${combatId}:designation`);
    this.chain.requestCleanup('showdown-converted');
    return Object.freeze({ field: fieldId, combatId, attacker, defender, focus: existingFocus });
  }
  private runtime(): CombatDamageRuntime {
    const active = this.engagement;
    if (active === null || active.attacker === undefined || active.defender === undefined ||
        active.combatId === undefined) throw new TurnCombatBlockedError('damage-state', 'No active Combat identity');
    const units = this.units(active.field).map(object => Object.freeze({
      object,
      combatRole: this.role(object),
    }));
    return Object.freeze({
      stateVersion: this.chain.pipeline.events.length,
      fieldId: active.field,
      attackerPlayerId: active.attacker,
      defenderPlayerId: active.defender,
      players: this.chain.pipeline.turnOrder,
      fields: this.fields.map(field => Object.freeze({
        ...field,
        active: field.id === active.field && active.step !== 'result' && active.step !== 'control',
      })),
      units,
      layers: this.chain.layers,
      pipeline: this.chain.pipeline,
      host: this.host,
      replacementCount: (this.chain.pipeline.checkpoint() as {
        readonly replacements?: ReadonlyMap<string, unknown>;
      }).replacements?.size ?? 0,
      zeroDamageSourceIds: Object.freeze(this.units(active.field)
        .filter(unit => unit.stunned).map(unit => unit.ref.id)),
      fullMightLethalTargetIds: Object.freeze(this.units(active.field)
        .filter(unit => unit.stunned).map(unit => unit.ref.id)),
    });
  }
  /** Freeze one live allocation plan after the Combat Showdown has closed. */
  prepareDamage(): DuelBaseCombatPlan {
    return this.withTransaction(() => {
      const active = this.engagement;
      if (active === null || active.step !== 'showdown' || this.chain.turnState !== 'neutral-open') {
        throw new TurnCombatBlockedError('damage-state', 'Combat damage requires a closed Combat Showdown');
      }
      const plan = createCombatDamagePlan(this.runtime());
      active.step = 'damage';
      active.damage = { plan };
      return plan;
    });
  }
  damageView(): CombatDamageAllocationView {
    const active = this.engagement;
    if (active?.step !== 'damage' || active.damage === undefined || active.attacker === undefined ||
        active.defender === undefined || active.combatId === undefined) {
      throw new TurnCombatBlockedError('damage-state', 'No Combat damage allocation is pending');
    }
    const { plan } = active.damage;
    return Object.freeze({
      combatId: active.combatId,
      battlefieldId: active.field,
      attackerPlayerId: active.attacker,
      defenderPlayerId: active.defender,
      attackerMight: plan.attacker.budget,
      defenderMight: plan.defender.budget,
      attackerSubmitted: active.damage.attacker !== undefined,
    });
  }
  /** Validate and retain the Attacker choice without mutating the board. */
  submitAttackerDamage(actor: PlayerId, orderedUIDAmounts: readonly DuelBaseCombatOrderedUIDAmount[]): void {
    this.withTransaction(() => {
      const active = this.engagement;
      if (active?.step !== 'damage' || active.damage === undefined || active.attacker !== actor) {
        throw new TurnCombatBlockedError('damage-choice', 'Only the Attacker may submit the first allocation');
      }
      if (active.damage.attacker !== undefined) {
        throw new TurnCombatBlockedError('damage-choice', 'The Attacker allocation is already committed');
      }
      const allocation = validateDuelBaseCombatAllocation(active.damage.plan, actor, orderedUIDAmounts,
        this.chain.pipeline.events.length);
      const attackerChoice = Object.freeze(allocation.assignments.map(assignment => Object.freeze({
        uid: assignment.uid,
        amount: assignment.amount,
      })));
      active.damage = { plan: active.damage.plan, attacker: allocation, attackerChoice };
    });
  }
  /** The Defender's legal choice completes and atomically deals both sides. */
  submitDefenderDamage(actor: PlayerId, orderedUIDAmounts: readonly DuelBaseCombatOrderedUIDAmount[]): CombatDamageResult {
    try {
      return this.withTransaction(() => {
        const active = this.engagement;
        if (active?.step !== 'damage' || active.damage?.attacker === undefined || active.defender !== actor ||
            active.combatId === undefined) {
          throw new TurnCombatBlockedError('damage-choice', 'Only the Defender may submit the completing allocation');
        }
        const version = this.chain.pipeline.events.length;
        const defender = validateDuelBaseCombatAllocation(active.damage.plan, actor, orderedUIDAmounts, version);
        const complete = completeDuelBaseCombatAllocation(active.damage.attacker, defender, version);
        const details = combatDamageEventDetails(active.damage.plan, active.combatId);
        const batchId = `${active.combatId}:damage`;
        const before = this.units(active.field);
        const sourceFor = (player: PlayerId): ObjectSnapshot => {
          const source = before.find(unit => unit.controller === player && this.role(unit) !== null);
          if (source === undefined) throw new TurnCombatBlockedError('damage-source', 'Combat side has no damage source');
          return source;
        };
        const attackerSource = sourceFor(complete.sideIDs[0]);
        const defenderSource = sourceFor(complete.sideIDs[1]);
        const actions = [
          ...complete.attacker.assignments.map(assignment => {
            const target = before.find(unit => unit.ref.id === assignment.uid);
            if (target === undefined) throw new TurnCombatBlockedError('damage-target', `Allocation names unknown Unit ${assignment.uid}`);
            return { type: 'damage' as const, source: attackerSource.ref, target: target.ref,
              amount: assignment.amount, combat: true };
          }),
          ...complete.defender.assignments.map(assignment => {
            const target = before.find(unit => unit.ref.id === assignment.uid);
            if (target === undefined) throw new TurnCombatBlockedError('damage-target', `Allocation names unknown Unit ${assignment.uid}`);
            return { type: 'damage' as const, source: defenderSource.ref, target: target.ref,
              amount: assignment.amount, combat: true };
          }),
        ];
        emitCombatWave(this.chain, this,
          [{ timingPoint: 'combat-damage-before', player: active.attacker, details }], `${batchId}:before`);
        const execution = this.host.executeContract === undefined ? undefined :
          actions.length === 0
            ? { outcome: { status: 'done' as const, events: [] }, emissions: [] }
            : this.host.executeContract({ type: 'batch', transactionId: batchId, actions });
        if (execution === undefined || execution.outcome.status !== 'done') {
          throw new TurnCombatBlockedError('simultaneous-damage-transaction',
            'Both combat damage allocations could not be committed atomically');
        }
        const damageEmissions = [
          ...complete.attacker.assignments.map(assignment => {
            const target = before.find(unit => unit.ref.id === assignment.uid)!;
            return {
              timingPoint: 'damage-dealt' as const,
              player: complete.sideIDs[0],
              source: attackerSource,
              object: target,
              target,
              amount: assignment.amount,
              batchId,
              simultaneousGroup: batchId,
              details: {
                ...details,
                actionId: batchId,
                batchId,
                combat: true,
                playerId: complete.sideIDs[0],
                sourceId: attackerSource.ref.id,
                targetId: target.ref.id,
                objectId: target.ref.id,
                amount: assignment.amount,
                responsiblePlayerId: complete.sideIDs[0],
                affectedPlayerId: target.controller,
              },
            };
          }),
          ...complete.defender.assignments.map(assignment => {
            const target = before.find(unit => unit.ref.id === assignment.uid)!;
            return {
              timingPoint: 'damage-dealt' as const,
              player: complete.sideIDs[1],
              source: defenderSource,
              object: target,
              target,
              amount: assignment.amount,
              batchId,
              simultaneousGroup: batchId,
              details: {
                ...details,
                actionId: batchId,
                batchId,
                combat: true,
                playerId: complete.sideIDs[1],
                sourceId: defenderSource.ref.id,
                targetId: target.ref.id,
                objectId: target.ref.id,
                amount: assignment.amount,
                responsiblePlayerId: complete.sideIDs[1],
                affectedPlayerId: target.controller,
              },
            };
          }),
        ];
        emitCombatWave(this.chain, this, damageEmissions, batchId);
        emitCombatWave(this.chain, this,
          [{ timingPoint: 'combat-damage-after', player: active.attacker, details }], `${batchId}:after`);
        active.step = 'cleanup';
        this.chain.requestCleanup('combat-damage-dealt');
        return Object.freeze({ field: active.field, combatId: active.combatId, attackerPlayerId: complete.sideIDs[0],
          defenderPlayerId: complete.sideIDs[1], batchId });
      });
    } catch (error) {
      this.rebuildDamagePlanAfterFailure();
      throw error;
    }
  }
  /** Completion consumes the kernel plan before the host batch commits. */
  private rebuildDamagePlanAfterFailure(): void {
    const active = this.engagement;
    if (active?.step !== 'damage' || active.damage?.attackerChoice === undefined) return;
    const version = this.chain.pipeline.events.length;
    const plan = createCombatDamagePlan(this.runtime());
    const attacker = validateDuelBaseCombatAllocation(plan, active.attacker!, active.damage.attackerChoice, version);
    active.damage = { plan, attacker, attackerChoice: active.damage.attackerChoice };
  }
  /** Start the 468 Resolution step after Combat Cleanup has killed lethal Units. */
  resolveCombatResult(): CombatResult {
    const active = this.engagement;
    if (active?.step !== 'result' || active.combatId === undefined) {
      throw new TurnCombatBlockedError('combat-result', 'No Combat is awaiting resolution');
    }
    if (active.result !== undefined) return active.result;
    const units = this.units(active.field);
    const attackerUnits = units.filter(unit => this.role(unit) === 'attacker');
    const defenderUnits = units.filter(unit => this.role(unit) === 'defender');
    const recallKeys = new Set(active.recalledUnitKeys ?? []);
    const recalled = recallKeys.size > 0;
    // CR 468.3/468.3.d.1 measure remaining Units at this Battlefield. A
    // recalled Attacker in its Base remains in the game but is not here.
    const attackerRemaining = attackerUnits.length > 0;
    const defenderRemaining = defenderUnits.length > 0;
    const noResult = recalled || attackerUnits.length > 0 && defenderUnits.length > 0 ||
      attackerUnits.length === 0 && defenderUnits.length === 0;
    const winner = noResult ? null : attackerUnits.length > 0 ? active.attacker! : active.defender!;
    const loser = noResult ? null : winner === active.attacker ? active.defender! : active.attacker!;
    const details: CombatResult = Object.freeze({
      combatId: active.combatId,
      battlefieldId: active.field,
      winnerId: winner,
      loserId: loser,
      unitResults: Object.freeze(units.map(unit => Object.freeze({ unitId: unit.ref.id,
        result: noResult ? 'no-result' : unit.controller === winner ? 'won' : 'lost' }))),
      noResult,
    });
    emitCombatWave(this.chain, this,
      [{ timingPoint: 'combat-result', player: winner ?? undefined, details: { ...details } }],
      `${active.combatId}:result`);
    active.result = details;
    active.step = 'control';
    active.controlEstablished = false;
    active.queued = false;
    if (noResult && attackerRemaining && defenderRemaining) active.endState = 'restage';
    else active.endState = 'ordinary';
    return details;
  }
  private finishCombat(): void {
    const active = this.engagement;
    if (active === null) return;
    if (active.controlEstablished === true && active.controlGateReleased !== true) return;
    const field = this.fields.find(candidate => candidate.id === active.field);
    if (field === undefined) throw new TurnCombatBlockedError('unknown-battlefield', 'Combat references an unknown Battlefield');
    if (active.combatId === undefined) {
      field.contestedBy = null; field.staged = 'none'; this.engagement = null;
      return;
    }
    const controllers = [...new Set(this.units(active.field).map(unit => unit.controller))];
    const result = active.result ?? this.resolveCombatResult();
    if (this.chain.items.length > 0) return;
    if (active.step === 'control') {
      if (active.endState === 'restage') {
        field.contestedBy = active.attacker!;
        field.staged = 'combat';
        active.step = 'end';
        this.finishCombat();
        return;
      }
      const controlEstablished = controllers.length === 1 && field.controller !== controllers[0];
      if (controlEstablished) {
        active.scorer = controllers[0]!;
        active.queued = false;
        active.step = 'control';
      } else {
        field.contestedBy = null;
        field.staged = 'none';
        if (controllers.length === 0) field.controller = null;
        active.step = 'end';
        this.finishCombat();
        return;
      }
      return;
    }
    if (active.step !== 'end') return;
    if (Boolean(active.controlEstablished) && active.controlGateReleased !== true) return;
    if (active.endEmitted !== true) {
      if (active.endState === undefined) active.endState = 'ordinary';
      if (active.endState === 'restage') {
        field.contestedBy = active.attacker!;
        field.staged = 'combat';
      } else {
        field.contestedBy = null;
        if (controllers.length === 0) {
          field.controller = null;
        }
        field.staged = 'none';
      }
      emitCombatWave(this.chain, this,
        [{ timingPoint: 'combat-end', details: { combatId: active.combatId, battlefieldId: active.field } }],
        `${active.combatId}:end`);
      active.endEmitted = true;
    }
    if (active.endState === 'restage') {
      field.contestedBy = active.attacker!;
      field.staged = 'combat';
    }
    if (this.chain.items.length > 0) return;
    if (active.endState === 'restage') {
      // Cleanup runs while the end wave scans and treats the already-decided
      // rematch as state that 468.3.d.1 committed during this same step.
      field.contestedBy = active.attacker!;
      field.staged = 'combat';
    }
    if (this.chain.items.length > 0) return;
    this.clearRoles();
    this.chain.layers.expireAt('combat-end');
    this.engagement = null;
  }
  /** Legacy command entry cannot invent either player's assignment choice. */
  dealDamage(): never {
    throw new TurnCombatBlockedError('simultaneous-damage-transaction',
      'Combat damage requires prepareDamage plus both submitted allocations (CR 467.2.c)');
  }
}
