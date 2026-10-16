import type { ChainEngine } from '../chain/engine.js';
import type { ObjectRef, ObjectSnapshot, PlayerId } from '../effects/contract.js';
import type { PipelineHost } from '../events/pipeline-types.js';
import type { TimingEmission } from '../events/pipeline-types.js';
import { TurnCombatBlockedError } from '../turn/flow.js';

export interface BattlefieldState {
  readonly id: string;
  readonly controller: PlayerId | null;
  readonly contestedBy: PlayerId | null;
  readonly staged: 'none' | 'showdown' | 'combat';
}
type MutableField = { -readonly [K in keyof BattlefieldState]: BattlefieldState[K] };
type Engagement = {
  field: string;
  step: 'showdown' | 'control';
  scorer?: PlayerId;
  queued?: boolean;
};

/** Batch 5 structural tasks; Priority, Focus, triggers and Chain stay in batch 4. */
export class CombatFlow {
  private fields: MutableField[];
  private engagement: Engagement | null = null;
  constructor(
    private readonly chain: ChainEngine,
    private readonly host: PipelineHost,
    fields: readonly { readonly id: string; readonly controller: PlayerId | null }[],
    private readonly conquer: (player: PlayerId, field: string) => void,
  ) {
    this.fields = fields.map(field => ({ ...field, contestedBy: null, staged: 'none' }));
  }
  get battlefields(): readonly BattlefieldState[] { return structuredClone(this.fields); }
  get active(): boolean { return this.engagement !== null; }
  get current(): Readonly<Engagement> | null { return this.engagement && { ...this.engagement }; }
  checkpoint() {
    return { fields: structuredClone(this.fields), engagement: this.engagement && { ...this.engagement } };
  }
  restore(snapshot: ReturnType<CombatFlow['checkpoint']>): void {
    this.fields = snapshot.fields; this.engagement = snapshot.engagement;
  }
  private units(field: string): readonly ObjectSnapshot[] {
    this.chain.layers.setObjects(this.host.objects());
    return this.chain.layers.evaluateAll().filter(object => object.zone === 'board' && object.types.includes('unit') &&
      object.location?.type === 'battlefield' && object.location.id === field);
  }
  private emit(timingPoint: Parameters<ChainEngine['emit']>[0]['timingPoint'], field: string, player?: string, object?: ObjectSnapshot): void {
    this.chain.emit({ timingPoint, player, object, details: { battlefieldId: field } });
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
  /** Called inside the Score action's host transaction, before its timing wave. */
  establish(player: PlayerId, fieldId: string): TimingEmission {
    if (this.engagement?.step !== 'control' || this.engagement.field !== fieldId || this.engagement.scorer !== player) {
      throw new Error('No pending establishment for this player and Battlefield');
    }
    const field = this.fields.find(value => value.id === fieldId)!;
    field.controller = player; field.contestedBy = null; field.staged = 'none'; this.engagement = null;
    return { timingPoint: 'control-established', player, details: { battlefieldId: fieldId } };
  }
  establishWithoutScore(player: PlayerId, field: string): void {
    const saved = this.checkpoint();
    const event = this.establish(player, field);
    try { this.chain.emit(event); }
    catch (error) { this.restore(saved); throw error; }
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
    let changed = false;
    const active = this.engagement;
    for (const field of this.fields) {
      if (field.id === active?.field) continue;
      const units = this.units(field.id);
      if (this.chain.turnState.endsWith('-open') && field.controller && !units.some(unit => unit.controller === field.controller)) {
        const old = field.controller;
        field.controller = null;
        this.emit('control-lost', field.id, old); changed = true;
      }
      if (field.contestedBy && !units.some(unit => unit.controller === field.contestedBy)) { field.contestedBy = null; changed = true; }
      if (!field.contestedBy) {
        const candidates = [...new Set(units.filter(unit => unit.controller !== field.controller).map(unit => unit.controller))];
        if (candidates.length > 1) throw new TurnCombatBlockedError('contested-origin', 'Multiple occupants need the committed Move/entry origin to determine Contested');
        if (candidates[0]) {
          field.contestedBy = candidates[0];
          this.emit('contested-applied', field.id, candidates[0]); changed = true;
        }
      }
      const staged = !field.contestedBy ? 'none' : new Set(units.map(unit => unit.controller)).size === 2 ? 'combat' : 'showdown';
      if (field.staged !== staged) { field.staged = staged; changed = true; }
    }
    return changed;
  }
  /** Open staged work after Cleanup has exited, before another player command. */
  advance(): void {
    if (this.chain.items.length) return;
    if (this.engagement) {
      const active = this.engagement;
      if (active.step === 'control') {
        if (!active.queued && active.scorer) { this.conquer(active.scorer, active.field); active.queued = true; }
        return;
      }
      if (this.chain.turnState.startsWith('showdown')) {
        if (new Set(this.units(active.field).map(unit => unit.controller)).size === 2) {
          throw new TurnCombatBlockedError('showdown-conversion', 'Batch 4 needs an atomic Combat start + designation task preserving existing Focus');
        }
        return;
      }
      const controllers = [...new Set(this.units(active.field).map(unit => unit.controller))];
      const field = this.fields.find(value => value.id === active.field)!;
      if (controllers.length === 1 && field.controller !== controllers[0]) {
        // Control + Conquer form one structural Score wave. Do not allow a
        // control trigger to Resolve between establishment and the Score.
        active.step = 'control'; active.scorer = controllers[0]!;
        this.conquer(active.scorer, field.id); active.queued = true;
        return;
      }
      field.contestedBy = null; field.staged = 'none'; this.engagement = null;
      return;
    }
    if (this.chain.turnState !== 'neutral-open') return;
    const candidates = this.fields.filter(field => field.staged === 'showdown');
    if (!candidates.length) candidates.push(...this.fields.filter(field => field.staged === 'combat'));
    if (!candidates.length) return;
    const id = candidates.length === 1 ? candidates[0]!.id : this.host.choose<string>({
      id: `engagement:${this.chain.pipeline.clock.turn}:${this.chain.pipeline.events.length}`,
      chooser: this.chain.pipeline.turnPlayer, visibility: 'public', type: 'mode', options: candidates.map(field => field.id),
    });
    const field = candidates.find(value => value.id === id);
    if (!field) throw new TypeError('Invalid staged engagement choice');
    if (field.staged === 'combat') {
      // start-combat and start-showdown are simultaneous and must order their
      // trigger wave before attack/defense. Public batch 4 emit() cannot do this.
      throw new TurnCombatBlockedError('combat-start-transaction', 'Combat start needs an atomic simultaneous timing wave + roles (CR 466.2)');
    }
    this.chain.openShowdown(field.contestedBy!);
    this.engagement = { field: id, step: 'showdown' };
    this.chain.requestCleanup('showdown-opened');
  }
  dealDamage(): never {
    throw new TurnCombatBlockedError('simultaneous-damage-transaction', 'Batch 4 needs commitBatch with deferred trigger scan and rollback across both sides (CR 467.2.c.1.a / 467.3)');
  }
}
