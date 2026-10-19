import type { ObjectRef, PlayerId } from '../../effects/contract.js';
import { ScoreLedger, type ScoreMethod } from '../../scoring/ledger.js';
import { finalPointDecision, winnerAtCleanup } from '../../scoring/outcome.js';
import type { PipelineHost } from '../../events/pipeline-types.js';
import type { TurnTaskRecord } from './model.js';

export interface TurnTaskHost {
  readonly host: PipelineHost;
  readonly players: readonly PlayerId[];
  readonly victoryScore: number;
  readonly ledger: ScoreLedger;
  readonly battlefield: (id: string) => import('../../effects/contract.js').ObjectSnapshot | null;
  readonly battlefields: () => readonly string[];
  readonly scoreAllowed: (player: PlayerId, battlefield: import('../../effects/contract.js').ObjectSnapshot) => boolean;
  readonly scheduleWin: (player: PlayerId) => void;
  readonly rememberRecord: (record: TurnTaskRecord) => void;
  readonly scheduleAdditionalTurn: (owner: PlayerId, sourceInstructionId: string) => void;
}

/** The shared state-operation surface used by TurnFlow for structural tasks. */
export interface TurnTaskOperations {
  ready(object: ObjectRef): void;
  clearStun(object: ObjectRef): void;
  emptyRunePool(player: PlayerId): void;
  destroyTemporary(object: ObjectRef): void;
  recall(object: ObjectRef): void;
  clearHidden(battlefieldId: string): void;
}

export function runScoreTask(
  task: Extract<TurnTaskRecord, { type: 'score' }>,
  environment: TurnTaskHost,
): { readonly status: 'done' | 'rejected'; readonly reason?: string } {
  const field = environment.battlefield(task.battlefieldId);
  if (field === null) return { status: 'rejected', reason: 'unknown-battlefield' };
  if (!environment.scoreAllowed(task.player, field)) {
    return { status: 'rejected', reason: 'score-restricted' };
  }
  const player = environment.host.objects()[0];
  if (player === undefined) return { status: 'rejected', reason: 'no-source-object' };
  const score = environment.host.context(player, task.player, 'score').player(task.player).score;
  const scoredFields = new Set([...environment.ledger.fields(task.player), task.battlefieldId]);
  const allFields = environment.battlefields();
  const everyBattlefield = allFields.length > 0 && allFields.every(id => scoredFields.has(id));
  const decision = finalPointDecision(score, environment.victoryScore, everyBattlefield);
  const action = decision.drawInstead
    ? { type: 'draw', player: task.player, amount: 1 }
    : { type: 'score', player: task.player, amount: 1 };
  const execution = environment.host.execute(action);
  if (execution.outcome.status === 'replaced' && action.type === 'score') {
    // CR 383.4.c.2.c / 383.4.d.2.c: replacing the point does not prevent the
    // Battlefield from being Scored. The Score ledger and trigger wave still
    // complete, while no point is recorded.
    environment.ledger.add({ player: task.player, battlefieldId: task.battlefieldId, method: task.method as ScoreMethod,
      ...(task.object === undefined ? {} : { objectId: task.object.id }) });
    environment.rememberRecord(task);
    return { status: 'done' };
  }
  if (execution.outcome.status === 'replaced' && action.type === 'draw') {
    environment.ledger.add({ player: task.player, battlefieldId: task.battlefieldId, method: task.method as ScoreMethod,
      ...(task.object === undefined ? {} : { objectId: task.object.id }) });
    environment.rememberRecord(task);
    return { status: 'done' };
  }
  if (execution.outcome.status !== 'done') return { status: 'rejected', reason: 'score-action-rejected' };
  environment.ledger.add({ player: task.player, battlefieldId: task.battlefieldId, method: task.method as ScoreMethod,
    ...(task.object === undefined ? {} : { objectId: task.object.id }) });
  environment.rememberRecord(task);
  const winner = winnerAtCleanup(environment.players, id =>
    environment.host.context(player, id, 'score').player(id).score, environment.victoryScore);
  if (winner !== null) environment.scheduleWin(winner);
  return { status: 'done' };
}

const SCORE_WAVE = Symbol('turn-score-wave');
export function markScoreWave<T extends object>(events: readonly T[]): readonly T[] {
  return events.map(event => Object.assign({}, event, { [SCORE_WAVE]: true }));
}

export function executeTurnTask(record: TurnTaskRecord, environment: TurnTaskHost, operations: TurnTaskOperations):
  { readonly status: 'done' | 'rejected'; readonly reason?: string } {
  switch (record.type) {
    case 'ready': operations.ready(record.object); return { status: 'done' };
    case 'clear-stun': operations.clearStun(record.object); return { status: 'done' };
    case 'clear-rune-pool': operations.emptyRunePool(record.player); return { status: 'done' };
    case 'destroy-temporary': operations.destroyTemporary(record.object); return { status: 'done' };
    case 'recall': operations.recall(record.object); return { status: 'done' };
    case 'hidden-cleanup': operations.clearHidden(record.battlefieldId); return { status: 'done' };
    case 'score': return runScoreTask(record, environment);
    case 'burn-out': return { status: 'rejected', reason: 'burn-out-delegates-to-flow' };
    case 'additional-turn':
      environment.scheduleAdditionalTurn(record.player, record.sourceInstructionId);
      environment.rememberRecord(record);
      return { status: 'done' };
  }
}
