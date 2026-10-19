import type { ChainEngine } from '../../chain/engine.js';
import type { PipelineEvent, TimingEmission } from '../../events/pipeline-types.js';

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
  const host = chain.pipeline.host.checkpoint();
  const events = chain.pipeline.checkpoint();
  const layers = chain.layers.registry.snapshot();
  const own = owner.checkpoint();
  try {
    return run();
  } catch (error) {
    chain.pipeline.host.restore(host);
    chain.pipeline.restore(events);
    owner.restore(own);
    chain.layers.registry.clear();
    for (const entry of layers) chain.layers.registry.register(entry.effect, entry.duration, entry.timestamp);
    chain.layers.setObjects(chain.pipeline.host.objects());
    throw error;
  }
}

/** Restore the exact host, event and layer state when publishing a derived wave fails. */
export function emitCombatWave(chain: ChainEngine, owner: CombatCheckpointOwner,
  emissions: readonly TimingEmission[], batchId: string): readonly PipelineEvent[] {
  return runCombatTransaction(chain, owner, () => chain.pipeline.emitBatch(emissions, undefined, batchId));
}
