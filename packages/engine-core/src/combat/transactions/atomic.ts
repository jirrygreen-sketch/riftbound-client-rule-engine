import type { ChainEngine } from '../../chain/engine.js';
import type { PipelineEvent, TimingEmission } from '../../events/pipeline-types.js';

interface AtomicChainEngine {
  atomic(run: () => unknown): unknown;
}

export interface CombatCheckpointOwner {
  checkpoint(): unknown;
  restore(checkpoint: unknown): void;
}

/**
 * Combat owns state that is not represented by a GameAction yet. This outer
 * boundary restores the host, event pipeline, layer registry and CombatFlow's
 * own role/engagement ledger together when a deferred scan or event fails.
 */
export function runCombatTransaction<T>(chain: ChainEngine, owner: CombatCheckpointOwner, run: () => T): T {
  const atomic = (chain as unknown as AtomicChainEngine).atomic;
  if (typeof atomic !== 'function') {
    throw new TypeError('Combat transaction requires the ChainEngine atomic boundary');
  }
  return atomic.call(chain, () => {
    const own = owner.checkpoint();
    try { return run(); }
    catch (error) { owner.restore(own); throw error; }
  }) as T;
}

/** Restore the exact host, event and layer state when publishing a derived wave fails. */
export function emitCombatWave(chain: ChainEngine, owner: CombatCheckpointOwner,
  emissions: readonly TimingEmission[], batchId: string): readonly PipelineEvent[] {
  return runCombatTransaction(chain, owner, () => chain.pipeline.emitBatch(emissions, undefined, batchId));
}
