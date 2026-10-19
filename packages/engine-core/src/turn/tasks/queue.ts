import type { TurnTaskRecord, TurnTaskState } from './model.js';

function cloneRecord(record: TurnTaskRecord): TurnTaskRecord {
  return structuredClone(record);
}

/** A deterministic queue whose persisted representation contains data only. */
export class TurnTaskQueue {
  private records: TurnTaskRecord[] = [];

  constructor(records: readonly TurnTaskRecord[] = []) {
    this.records = records.map(cloneRecord);
  }

  get size(): number { return this.records.length; }
  peek(): TurnTaskRecord | undefined { return this.records[0] === undefined ? undefined : cloneRecord(this.records[0]); }
  snapshot(): TurnTaskState { return { records: this.records.map(cloneRecord) }; }
  restore(state: TurnTaskState): void { this.records = state.records.map(cloneRecord); }
  append(...records: readonly TurnTaskRecord[]): void { this.records.push(...records.map(cloneRecord)); }
  prepend(...records: readonly TurnTaskRecord[]): void { this.records.unshift(...records.map(cloneRecord)); }
  shift(): TurnTaskRecord | undefined {
    const record = this.records.shift();
    return record === undefined ? undefined : cloneRecord(record);
  }
  replaceHead(...records: readonly TurnTaskRecord[]): void {
    if (this.records.length !== 0) this.records.shift();
    this.records.unshift(...records.map(cloneRecord));
  }
}
