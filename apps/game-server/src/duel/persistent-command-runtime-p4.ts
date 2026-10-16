/** Compatibility exports; all durable writes use the journal v1 adapter. */
export {
  createDurableDuelRuntime as createPersistentDuelRuntimeP4,
  openDurableDuelRuntime as openPersistentDuelRuntimeP4,
} from './runtime/durable/index.js';
export type {
  DurableDuelRuntime as PersistentDuelRuntimeP4,
  DurableDuelRuntimeOptions as PersistentDuelRuntimeP4Options,
} from './runtime/durable/index.js';
