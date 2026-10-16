/** Historical import names now resolve to the single journal v1 adapter.
 * Old command/session shapes are replayed by legacy-replay-e2cbcdf only. */
export {
  DurableDuelRuntime as PersistentDuelCommandRuntimeV3,
  DurableDuelRuntime as PersistentCommandRuntimeV3,
  DurableRuntimeError as PersistentDuelCommandRuntimeV3Error,
  createDurableDuelRuntime as createPersistentDuelCommandRuntimeV3,
  createDurableDuelRuntime as createPersistentCommandRuntimeV3,
  openDurableDuelRuntime as openPersistentDuelCommandRuntimeV3,
  openDurableDuelRuntime as openPersistentCommandRuntimeV3,
} from './runtime/durable/index.js';
export type {
  DurableDuelRuntimeOptions as PersistentDuelCommandRuntimeV3Options,
  DurableDuelRuntimeOptions as OpenPersistentDuelCommandRuntimeV3Options,
  DurableRuntimeResult as PersistentDuelCommandRuntimeV3Result,
} from './runtime/durable/index.js';
// Kept only for import compatibility until batch G removes profile constants.
export const PERSISTENT_DUEL_PROJECTION_PROFILE_V3 = 'P3' as const;
export type PersistentDuelProjectionProfileV3 = typeof PERSISTENT_DUEL_PROJECTION_PROFILE_V3;
export type PersistentDuelCommandRuntimeV3Data = { readonly journal: import('@riftbound/protocol').Journal };
