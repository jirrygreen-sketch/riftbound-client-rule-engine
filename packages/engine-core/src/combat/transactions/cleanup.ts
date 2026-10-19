import type {
  ActionReceipt,
  ContractGameAction,
  GameEvent,
  ObjectSnapshot,
  PlayerId,
} from '../../effects/contract.js';
import type { PipelineHost } from '../../events/pipeline-types.js';

export interface CombatRecallEvidence {
  readonly combatId: string;
  readonly battlefieldId: string;
  readonly transactionId: string;
  readonly receipt: ActionReceipt;
  readonly unitKeys: readonly string[];
  readonly events: readonly GameEvent[];
}

export interface CombatSpecialCleanupRecord {
  readonly combatId: string;
  readonly healReceipt?: ActionReceipt;
  readonly recall?: CombatRecallEvidence;
}

function assertCommitted(execution: ReturnType<NonNullable<PipelineHost['executeContract']>>, transactionId: string): ActionReceipt {
  const receipt = execution.outcome.receipt;
  if (execution.outcome.status !== 'done' || receipt?.status !== 'committed' || receipt.transactionId !== transactionId) {
    throw new Error(`Combat contract batch ${transactionId} did not commit atomically`);
  }
  return receipt;
}

export function objectKey(object: Pick<ObjectSnapshot, 'ref'>): string {
  return `${object.ref.id}:${object.ref.zoneEntryId}`;
}

/**
 * CR 468.1.a.1: Heal every Board Unit as one host-owned contract batch after
 * the ordinary Cleanup has killed lethal Units. The batch preserves the exact
 * Heal primitive and verifies every intended object after commit.
 */
export function commitCombatCleanupHeal(
  host: PipelineHost,
  units: readonly ObjectSnapshot[],
  combatId: string,
): ActionReceipt | undefined {
  if (units.length === 0) return undefined;
  if (host.executeContract === undefined) {
    throw new Error('Combat Special Cleanup requires the Heal contract consumer');
  }
  const transactionId = `${combatId}:heal-all`;
  const action: ContractGameAction = {
    type: 'batch',
    transactionId,
    actions: units.map(unit => ({ type: 'heal', object: unit.ref, amount: unit.damage })),
  };
  const execution = host.executeContract(action);
  const receipt = assertCommitted(execution, transactionId);
  for (const unit of units) {
    const after = host.objects().find(candidate => objectKey(candidate) === objectKey(unit));
    if (after === undefined || after.zone !== 'board' || after.damage !== 0) {
      throw new Error(`Combat Special Cleanup Heal did not clear ${objectKey(unit)}`);
    }
  }
  return receipt;
}

/**
 * CR 468.1.a.2 / 457-460: Recall all present Attackers through RecallAction.
 * The host batch preserves controller Base and exact incarnation. The bridge
 * currently does not publish Recall leaf observations from a mixed batch, so
 * evidence records the committed receipt and the independently verified unit
 * identities for this Combat without inventing a Move timing.
 */
export function commitCombatCleanupRecall(
  host: PipelineHost,
  attackers: readonly ObjectSnapshot[],
  combatId: string,
  battlefieldId: string,
  player: PlayerId,
): CombatRecallEvidence | undefined {
  if (attackers.length === 0) return undefined;
  if (host.executeContract === undefined) {
    throw new Error('Combat Special Cleanup requires the RecallAction contract consumer');
  }
  const transactionId = `${combatId}:recall`;
  const action: ContractGameAction = {
    type: 'batch',
    transactionId,
    actions: attackers.map(unit => ({ type: 'recall', object: unit.ref, player })),
  };
  const before = attackers.map(unit => {
    const current = host.objects().find(candidate => objectKey(candidate) === objectKey(unit));
    if (current === undefined) throw new Error(`Combat Special Cleanup Recall source ${objectKey(unit)} is not live`);
    return structuredClone(current);
  });
  const execution = host.executeContract(action);
  const receipt = assertCommitted(execution, transactionId);
  const after = before.map(unit => host.objects().find(candidate => objectKey(candidate) === objectKey(unit)));
  for (const [index, unit] of before.entries()) {
    const current = after[index];
    if (current === undefined || current.zone !== 'board' || current.controller !== player ||
        current.location?.type !== 'base' || current.location.player !== player) {
      throw new Error(`Combat Special Cleanup Recall did not preserve ${objectKey(unit)} at the controller Base`);
    }
    const { location: _beforeLocation, combatRole: _beforeRole, ...beforeState } = unit;
    const { location: _afterLocation, combatRole: _afterRole, ...afterState } = current;
    const comparable = (state: Record<string, unknown>) => JSON.stringify(state, (_key, value) =>
      value instanceof Map ? [...value.entries()] : value);
    if (comparable(beforeState) !== comparable(afterState)) {
      throw new Error(`Combat Special Cleanup Recall changed persistent state on ${objectKey(unit)}`);
    }
  }
  return Object.freeze({
    combatId,
    battlefieldId,
    transactionId,
    receipt,
    unitKeys: Object.freeze(before.map(objectKey)),
    events: Object.freeze(execution.outcome.events.map(event => Object.freeze({
      ...structuredClone(event),
      details: Object.freeze({
        ...('details' in event && event.details !== null && typeof event.details === 'object' ? event.details : {}),
        combatId,
        battlefieldId,
        transactionId,
        recall: true,
      }),
    }))),
  });
}
