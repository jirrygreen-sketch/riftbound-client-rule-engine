import type { PlayerId } from '../effects/contract.js';

export type ScoreMethod = 'hold' | 'conquer';

export interface ScoreEntry {
  readonly player: PlayerId;
  readonly battlefieldId: string;
  readonly method: ScoreMethod;
  /** Present when the Score came from a specific Unit's Conquer/Hold ability. */
  readonly objectId?: string;
}

export interface ScoreLedgerState {
  readonly entries: readonly ScoreEntry[];
}

/** Current-turn Scoring history, one battlefield per player (CR 472). */
export class ScoreLedger {
  private entries: ScoreEntry[] = [];

  constructor(entries: readonly ScoreEntry[] = []) {
    this.entries = entries.map(entry => ({ ...entry }));
  }

  snapshot(): ScoreLedgerState { return { entries: this.entries.map(entry => ({ ...entry })) }; }
  restore(state: ScoreLedgerState): void { this.entries = state.entries.map(entry => ({ ...entry })); }
  clear(): void { this.entries = []; }
  has(player: PlayerId, battlefieldId: string): boolean {
    return this.entries.some(entry => entry.player === player && entry.battlefieldId === battlefieldId);
  }
  fields(player: PlayerId): readonly string[] {
    return this.entries.filter(entry => entry.player === player).map(entry => entry.battlefieldId);
  }
  add(entry: ScoreEntry): void {
    if (this.has(entry.player, entry.battlefieldId)) throw new Error('Battlefield already Scored this turn by this player');
    if (!entry.player || !entry.battlefieldId || (entry.method !== 'hold' && entry.method !== 'conquer')) {
      throw new TypeError('Invalid Score ledger entry');
    }
    this.entries.push({ ...entry });
  }
}
