import type { GameAction, ObjectRef, ObjectSnapshot, ResolveContext, Value, ZoneId } from '../contract.js';
import type { ActionExecution } from '../../events/pipeline-types.js';
import {
  LinkedAbilityError,
  type LinkedAbilityBinding,
  type LinkedAbilityClock,
  type LinkedAbilityWindow,
  type LinkedDamageQuery,
  type LinkedDamageRecord,
  type LinkedZoneReceipt
} from './types.js';

const refKey = (ref: ObjectRef): string => JSON.stringify([ref.id, ref.zoneEntryId]);
const sameRef = (a: ObjectRef, b: ObjectRef): boolean => a.id === b.id && a.zoneEntryId === b.zoneEntryId;
const copyRef = (ref: ObjectRef): ObjectRef => ({ id: ref.id, zoneEntryId: ref.zoneEntryId });
const qualifiedKey = (path: readonly string[], key: string): string =>
  `${path.map(encodeURIComponent).join('/')}.${key}`;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validRef = (value: unknown): value is ObjectRef => record(value) &&
  typeof value.id === 'string' && value.id.length > 0 &&
  Number.isSafeInteger(value.zoneEntryId) && (value.zoneEntryId as number) >= 0;
const nonempty = (value: string): boolean => typeof value === 'string' && value.length > 0;

interface CollectionEntry {
  readonly ref: ObjectRef;
  readonly zone: ZoneId;
}

interface LinkedAbilityCheckpoint {
  readonly sequence: number;
  readonly collections: Map<string, CollectionEntry[]>;
  readonly zones: LinkedZoneReceipt[];
  readonly damage: LinkedDamageRecord[];
}

/** Match-local state, checkpointed with the same host transaction as the game actions. */
export class LinkedAbilityState {
  private readonly bindings: readonly LinkedAbilityBinding[];
  private collections = new Map<string, CollectionEntry[]>();
  private zones: LinkedZoneReceipt[] = [];
  private damage: LinkedDamageRecord[] = [];
  private sequence = 0;

  constructor(bindings: readonly LinkedAbilityBinding[] = []) {
    const sets = new Set<string>(), aliases = new Set<string>();
    for (const binding of bindings) {
      if (!nonempty(binding.cardId) || !nonempty(binding.setId) || !binding.members.length ||
        binding.members.some(member => !nonempty(member)) || new Set(binding.members).size !== binding.members.length ||
        (binding.grantedBy && (!validRef(binding.grantedBy.source) || !nonempty(binding.grantedBy.grantId)))) {
        throw new LinkedAbilityError('a set requires a card, unique members, and an exact granting origin');
      }
      const grant = binding.grantedBy;
      const set = JSON.stringify([binding.cardId, binding.setId,
        grant ? [grant.source.id, grant.source.zoneEntryId, grant.grantId] : null]);
      if (sets.has(set)) throw new LinkedAbilityError('duplicate set declaration');
      sets.add(set);
      const captures = new Set<string>();
      for (const capture of binding.captures) {
        if (!capture.path.length || capture.path.some(segment => !nonempty(segment)) ||
          !binding.members.includes(capture.path.at(-1)!) || !nonempty(capture.key)) {
          throw new LinkedAbilityError('a capture must name a member and its exact instruction path');
        }
        const key = qualifiedKey(capture.path, capture.key);
        if (captures.has(key)) throw new LinkedAbilityError('duplicate capture declaration');
        captures.add(key);
      }
      for (const read of binding.reads) {
        if (!nonempty(read.key) || !binding.members.includes(read.member)) {
          throw new LinkedAbilityError('a read must belong to a component of its set');
        }
        const alias = JSON.stringify([binding.cardId, read.key]);
        if (aliases.has(alias)) throw new LinkedAbilityError('ambiguous linked object alias');
        aliases.add(alias);
      }
    }
    this.bindings = structuredClone(bindings);
  }

  get cursor(): number { return this.sequence; }

  checkpoint(): LinkedAbilityCheckpoint {
    return structuredClone({ sequence: this.sequence, collections: this.collections, zones: this.zones, damage: this.damage });
  }

  restore(saved: LinkedAbilityCheckpoint): void {
    const copy = structuredClone(saved);
    this.sequence = copy.sequence;
    this.collections = copy.collections;
    this.zones = copy.zones;
    this.damage = copy.damage;
  }

  private collectionKey(source: ObjectSnapshot, binding: LinkedAbilityBinding): string {
    const grant = binding.grantedBy;
    return JSON.stringify([source.ref.id, source.ref.zoneEntryId, binding.cardId, binding.setId,
      grant ? [grant.source.id, grant.source.zoneEntryId, grant.grantId] : null]);
  }

  /** Called only by the host around an actual successful state action. */
  observe(
    action: GameAction, execution: ActionExecution,
    before: readonly ObjectSnapshot[], after: readonly ObjectSnapshot[], clock: LinkedAbilityClock
  ): void {
    if (execution.outcome.status !== 'done' || execution.outcome.receipt?.status === 'rolled-back' ||
      execution.outcome.receipt?.status === 'rejected') return;
    const sequence = ++this.sequence;
    const current = new Map(after.map(object => [object.ref.id, object]));
    for (const previous of before) {
      const next = current.get(previous.ref.id);
      if (next && sameRef(previous.ref, next.ref)) continue;
      // Board-to-Board movement retains its identity (CR 124).
      if (previous.zone === 'board' && next?.zone === 'board') continue;
      this.zones.push({ sequence, action: action.type, from: copyRef(previous.ref),
        to: next ? copyRef(next.ref) : null, fromZone: previous.zone, toZone: next?.zone ?? null });
    }
    if (action.type !== 'damage') return;
    const previous = before.find(object => sameRef(object.ref, action.target));
    const next = current.get(action.target.id);
    if (!previous || !next || !sameRef(next.ref, action.target)) return;
    const marked = next.damage - previous.damage;
    const actual = typeof execution.outcome.result === 'number' ? execution.outcome.result : marked;
    // Neither a requested amount nor a zero/prevented event constitutes damage.
    if (!Number.isSafeInteger(actual) || actual <= 0 || marked <= 0) return;
    const payload = execution.emissions.find(emission => emission.timingPoint === 'damage-dealt')?.details;
    this.damage.push({ sequence, ...clock, source: copyRef(action.source), target: copyRef(action.target),
      amount: actual, combatDamage: action.combat,
      ...(typeof payload?.actionId === 'string' ? { actionId: payload.actionId } : {}),
      ...(typeof payload?.batchId === 'string' ? { batchId: payload.batchId } : {}) });
  }

  /** Accept only a declared producer's receipt, backed by actions in this resolution. */
  capture(source: ObjectSnapshot, key: string, value: Value, since: number): void {
    for (const binding of this.bindings.filter(candidate => candidate.cardId === source.cardId)) {
      for (const capture of binding.captures.filter(candidate => qualifiedKey(candidate.path, candidate.key) === key)) {
        if (!record(value) || !validRef(value.source) || !sameRef(value.source, source.ref) ||
          !Array.isArray(value.objects) || !value.objects.every(validRef) ||
          value.count !== value.objects.length || new Set(value.objects.map(refKey)).size !== value.objects.length) {
          throw new LinkedAbilityError('invalid object receipt from a declared producer');
        }
        const refs = value.objects as unknown as ObjectRef[];
        if (refs.some(ref => !this.zones.some(receipt => receipt.sequence > since && receipt.action === capture.action &&
          receipt.toZone === capture.zone && receipt.to !== null && sameRef(receipt.to, ref)))) {
          throw new LinkedAbilityError('an object receipt requires its actual new-reference action');
        }
        const collectionKey = this.collectionKey(source, binding);
        const entries = this.collections.get(collectionKey) ?? [];
        for (const ref of refs) {
          if (!entries.some(entry => sameRef(entry.ref, ref))) entries.push({ ref: copyRef(ref), zone: capture.zone });
        }
        this.collections.set(collectionKey, entries);
      }
    }
  }

  /** Undefined means no declared alias; [] means the declared set has no live members. */
  read(context: ResolveContext, key: string, window?: LinkedAbilityWindow): ObjectRef[] | undefined {
    const binding = this.bindings.find(candidate => candidate.cardId === context.source.cardId &&
      candidate.reads.some(read => read.key === key));
    if (!binding) return undefined;
    if (window?.kind === 'source') {
      const source = context.object(context.source.ref);
      if (!source || !sameRef(source.ref, context.source.ref) || source.zone !== window.zone) return [];
    }
    return (this.collections.get(this.collectionKey(context.source, binding)) ?? [])
      .filter(entry => {
        const object = context.object(entry.ref);
        return object !== null && sameRef(object.ref, entry.ref) && object.zone === entry.zone;
      })
      .map(entry => copyRef(entry.ref));
  }

  /** A single receipt never follows later unrelated departures or returns by id. */
  newReference(context: ResolveContext, from: ObjectRef, zone: ZoneId): ObjectRef | null {
    const receipt = this.zones.find(item => sameRef(item.from, from));
    if (!receipt?.to || receipt.toZone !== zone) return null;
    const object = context.object(receipt.to);
    if (!object || !sameRef(object.ref, receipt.to) || object.zone !== zone) return null;
    return copyRef(receipt.to);
  }

  zoneReceipts(from?: ObjectRef): readonly LinkedZoneReceipt[] {
    return structuredClone(this.zones.filter(receipt => !from || sameRef(receipt.from, from)));
  }

  damageHistory(query: LinkedDamageQuery): readonly LinkedDamageRecord[] {
    if (query.identity !== 'entity' && query.identity !== 'incarnation') {
      throw new LinkedAbilityError('damage identity must be entity or incarnation');
    }
    const matches = (actual: ObjectRef, selected: ObjectRef | undefined): boolean =>
      selected === undefined || (query.identity === 'entity' ? actual.id === selected.id : sameRef(actual, selected));
    return structuredClone(this.damage.filter(entry => matches(entry.source, query.source) && matches(entry.target, query.target) &&
      (query.turn === undefined || entry.turn === query.turn) && (query.combat === undefined || entry.combat === query.combat) &&
      (query.combatDamage === undefined || entry.combatDamage === query.combatDamage)));
  }
}
