import type { ObjectRef, PlayerId } from '../../effects/contract.js';

/** A stable identity for a mode choice across separate Chain activations. */
export interface ChoiceMemoryKey {
  readonly controller: PlayerId;
  readonly source?: ObjectRef;
  readonly abilityId: string;
  readonly choiceId: string;
}

export interface ChoiceMemoryEntry {
  readonly key: ChoiceMemoryKey;
  readonly turn: string | number;
  readonly modes: readonly string[];
}

export interface ChoiceMemorySnapshot {
  readonly turn: string | number | null;
  readonly entries: readonly ChoiceMemoryEntry[];
}

function refKey(ref: ObjectRef | undefined): string {
  return ref === undefined ? '' : `${ref.id}:${ref.zoneEntryId}`;
}

function keyString(key: ChoiceMemoryKey): string {
  return [key.controller, refKey(key.source), key.abilityId, key.choiceId].join('\u0000');
}

function cloneKey(key: ChoiceMemoryKey): ChoiceMemoryKey {
  return Object.freeze({
    controller: key.controller,
    ...(key.source === undefined ? {} : { source: Object.freeze({ ...key.source }) }),
    abilityId: key.abilityId,
    choiceId: key.choiceId,
  });
}

/**
 * Per-turn mode memory used by effects such as "choose one you haven't chosen
 * this turn". The memory is deliberately separate from the card state and can
 * therefore be journaled, replayed, and reset at the turn boundary without
 * changing legacy profiles or object snapshots.
 */
export class ChoiceMemory {
  private turnValue: string | number | null = null;
  private readonly values = new Map<string, ChoiceMemoryEntry>();

  constructor(turn?: string | number) {
    if (turn !== undefined) this.turnValue = turn;
  }

  get turn(): string | number | null { return this.turnValue; }

  /** Starts a new turn and clears all per-turn selections. */
  beginTurn(turn: string | number): void {
    if (Object.is(this.turnValue, turn)) return;
    this.turnValue = turn;
    this.values.clear();
  }

  reset(): void {
    this.turnValue = null;
    this.values.clear();
  }

  has(key: ChoiceMemoryKey, mode: string, turn = this.turnValue): boolean {
    if (turn === null || turn === undefined || !Object.is(turn, this.turnValue)) return false;
    return this.values.get(keyString(key))?.modes.includes(mode) ?? false;
  }

  chosen(key: ChoiceMemoryKey, turn = this.turnValue): readonly string[] {
    if (turn === null || turn === undefined || !Object.is(turn, this.turnValue)) return [];
    return this.values.get(keyString(key))?.modes ?? [];
  }

  available(key: ChoiceMemoryKey, modes: readonly string[], turn = this.turnValue): readonly string[] {
    const selected = new Set(this.chosen(key, turn));
    return modes.filter(mode => !selected.has(mode));
  }

  /** Records a mode only after the enclosing Finalize operation succeeds. */
  record(key: ChoiceMemoryKey, mode: string, turn = this.turnValue): void {
    if (turn === null || turn === undefined) throw new Error('Choice memory requires an active turn');
    if (!Object.is(this.turnValue, turn)) this.beginTurn(turn);
    const id = keyString(key);
    const previous = this.values.get(id);
    const modes = previous?.modes.includes(mode) ? [...previous.modes] : [...(previous?.modes ?? []), mode];
    this.values.set(id, Object.freeze({ key: cloneKey(key), turn, modes: Object.freeze(modes) }));
  }

  recordAll(key: ChoiceMemoryKey, modes: readonly string[], turn = this.turnValue): void {
    for (const mode of modes) this.record(key, mode, turn);
  }

  snapshot(): ChoiceMemorySnapshot {
    return Object.freeze({
      turn: this.turnValue,
      entries: Object.freeze([...this.values.values()].map(entry => Object.freeze({
        key: cloneKey(entry.key),
        turn: entry.turn,
        modes: Object.freeze([...entry.modes]),
      }))),
    });
  }

  restore(snapshot: ChoiceMemorySnapshot): void {
    this.turnValue = snapshot.turn;
    this.values.clear();
    for (const entry of snapshot.entries) {
      if (this.turnValue === null || !Object.is(this.turnValue, entry.turn)) continue;
      this.values.set(keyString(entry.key), Object.freeze({
        key: cloneKey(entry.key),
        turn: entry.turn,
        modes: Object.freeze([...entry.modes]),
      }));
    }
  }

  /** Execute a mutation atomically, including mode-memory writes. */
  atomic<T>(run: () => T): T {
    const before = this.snapshot();
    try { return run(); }
    catch (error) { this.restore(before); throw error; }
  }
}

export function choiceMemoryKey(value: ChoiceMemoryKey): string { return keyString(value); }
