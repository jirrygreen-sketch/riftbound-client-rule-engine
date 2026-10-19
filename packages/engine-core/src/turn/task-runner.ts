import type { ObjectRef, PlayerId } from '../effects/contract.js';
import type { PipelineHost } from '../events/pipeline-types.js';
import { finalPointDecision, winnerAtCleanup } from '../scoring/outcome.js';
import { performBurnOutStep, type BurnOutParticipant } from './burn-out.js';
import type { TurnTaskRecord } from './tasks/model.js';

export interface TurnTaskPort {
  readonly host: PipelineHost;
  readonly players: readonly PlayerId[];
  readonly victoryScore: number;
  readonly currentTurn: () => number;
  readonly battlefield: (id: string) => { readonly ref: ObjectRef } | null;
  readonly clearHidden: (battlefieldId: string) => void;
  readonly scoreAllowed: (player: PlayerId, battlefield: ObjectRef) => boolean;
  readonly scoredEveryBattlefield: (player: PlayerId, candidateBattlefieldId: string) => boolean;
  readonly emit: (record: TurnTaskRecord) => void;
  readonly recordScore: (player: PlayerId, battlefieldId: string, method: 'hold' | 'conquer', object?: ObjectRef) => void;
  readonly scheduleWin: (player: PlayerId) => void;
  /** Runs source-authored IR through the default interpreter at the task timing. */
}

export interface TurnTaskResult {
  readonly status: 'done' | 'rejected';
  readonly reason?: string;
}

/** One structural task at a time. Every action delegates to the authoritative host. */
export class TurnTaskRunner {
  constructor(readonly port: TurnTaskPort) {}

  run(task: TurnTaskRecord): TurnTaskResult {
    switch (task.type) {
      case 'ready': return this.ready(task.object);
      case 'clear-stun': return this.clearStun(task.object);
      case 'clear-rune-pool': return this.clearRunePool(task.player);
      case 'destroy-temporary': return this.destroyTemporary(task.object);
      case 'recall': return this.recall(task.object);
      case 'score': return this.score(task.player, task.battlefieldId, task.method, task.object);
      case 'burn-out': return this.burnOut(task.player, task.continuation, task.amount, task.sequence);
      case 'additional-turn':
        this.port.emit(task);
        return { status: 'done' };
      case 'hidden-cleanup':
        this.port.clearHidden(task.battlefieldId);
        return { status: 'done' };
    }
  }

  private ready(ref: ObjectRef): TurnTaskResult {
    const current = this.port.host.objects().find(object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId);
    if (!current || current.zone !== 'board' || !current.exhausted) return { status: 'done' };
    const outcome = this.port.host.execute({ type: 'ready', object: current.ref });
    return outcome.outcome.status === 'done' ? { status: 'done' } : { status: 'rejected', reason: 'ready-rejected' };
  }

  private clearStun(ref: ObjectRef): TurnTaskResult {
    const current = this.port.host.objects().find(object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId);
    if (!current || !current.stunned) return { status: 'done' };
    // The shared action vocabulary has no "un-stun". This task therefore stays
    // visible and fails closed rather than editing the snapshot behind the
    // state owner's back.
    return { status: 'rejected', reason: 'stun-clear-capability-unavailable' };
  }

  private clearRunePool(player: PlayerId): TurnTaskResult {
    const snapshot = this.port.host.objects().find(object => object.controller === player && object.zone === 'rune-zone');
    void snapshot;
    return { status: 'rejected', reason: 'rune-pool-empty-capability-unavailable' };
  }

  private destroyTemporary(ref: ObjectRef): TurnTaskResult {
    const current = this.port.host.objects().find(object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId);
    if (!current || current.zone !== 'board') return { status: 'done' };
    const outcome = this.port.host.execute({ type: 'kill', object: current.ref });
    return outcome.outcome.status === 'done' ? { status: 'done' } : { status: 'rejected', reason: 'temporary-kill-rejected' };
  }

  private recall(ref: ObjectRef): TurnTaskResult {
    const current = this.port.host.objects().find(object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId);
    if (!current || current.zone !== 'board' || current.location === null) return { status: 'done' };
    if (this.port.host.executeContract === undefined) return { status: 'rejected', reason: 'recall-capability-unavailable' };
    const outcome = this.port.host.executeContract({ type: 'recall', object: current.ref, player: current.controller });
    return outcome.outcome.status === 'done' ? { status: 'done' } : { status: 'rejected', reason: 'recall-rejected' };
  }

  private score(player: PlayerId, battlefieldId: string, method: 'hold' | 'conquer', object?: ObjectRef): TurnTaskResult {
    const battlefield = this.port.battlefield(battlefieldId);
    if (battlefield === null) return { status: 'rejected', reason: 'unknown-battlefield' };
    if (!this.port.scoreAllowed(player, battlefield.ref)) return { status: 'rejected', reason: 'score-restricted' };
    const currentScore = this.port.host.context(this.port.host.objects()[0]!, player, 'score').player(player).score;
    // The task receives the actual participant identity; the port resolves
    // every Battlefield this player already Scored this turn from the ledger.
    const decision = finalPointDecision(currentScore, this.port.victoryScore, this.port.scoredEveryBattlefield(player, battlefieldId));
    const action = method === 'conquer' && decision.drawInstead
      ? { type: 'draw' as const, player, amount: 1 }
      : { type: 'score' as const, player, amount: 1 };
    const outcome = this.port.host.execute(action);
    if (outcome.outcome.status !== 'done') return { status: 'rejected', reason: 'score-action-rejected' };
    this.port.recordScore(player, battlefieldId, method, object);
    const winner = winnerAtCleanup(this.port.players,
      id => this.port.host.context(this.port.host.objects()[0]!, id, 'score').player(id).score,
      this.port.victoryScore);
    if (winner !== null) this.port.scheduleWin(winner);
    return { status: 'done' };
  }

  private burnOut(player: PlayerId, continuation: 'draw' | 'mill', amount: number, sequence: number): TurnTaskResult {
    const participants: BurnOutParticipant[] = this.port.players.map(id => {
      const snapshot = this.port.host.context(this.port.host.objects()[0]!, id, 'score').player(id);
      return { id, deckCount: snapshot.deckCount, trashCount: this.port.host.objects().filter(object => object.owner === id && object.zone === 'trash').length };
    });
    const context = this.port.host.context(this.port.host.objects()[0]!, player, 'score');
    const result = performBurnOutStep({ player, continuation, amount, sequence }, participants, {
      perform: action => context.perform(action),
      trash: owner => this.port.host.objects().filter(object => object.owner === owner && object.zone === 'trash').map(object => object.ref),
    });
    if (result.status === 'rejected') return result;
    const winner = winnerAtCleanup(this.port.players,
      id => context.player(id).score, this.port.victoryScore);
    if (winner !== null) this.port.scheduleWin(winner);
    return { status: 'done' };
  }
}
