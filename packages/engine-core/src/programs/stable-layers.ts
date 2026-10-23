import type { ChainEngine } from '../chain/engine.js';

/**
 * Run `read` inside the engine's RIFT-999 stable layered-view window. Program
 * adapters also accept structural engines (tests, partial adapters) that have
 * no such window; those simply read fresh, exactly as before RIFT-999.
 */
export function withStableLayersOf<T>(engine: ChainEngine, read: () => T): T {
  const structural = engine as Partial<Pick<ChainEngine, 'withStableLayers'>>;
  return typeof structural.withStableLayers === 'function' ? engine.withStableLayers(read) : read();
}
