// Public duel surface: the implemented internal duel kernels (board, setup, resources, scoring)
// are exported. No DuelGame factory exists yet, so this entry intentionally does not pretend a
// playable ruleset is available through @riftbound/engine-core/duel.
export * from './battlefields.js';
export * from './setup.js';
export * from './resources.js';
export * from './scoring.js';
export * from './printed-costs.js';
export * from './movement.js';
export * from './match-state.js';
export * from './draw-burnout.js';
export * from './unit-lifecycle.js';
export * from './canonical-session.js';
export * from './canonical-transaction.js';
export * from './turn-start.js';
export * from './turn-flow.js';
export * from './base-combat-allocation.js';
export * from './ending.js';
// Explicit V2 core only; the existing V1 command session/public wire remains unchanged.
export * from './core-v2.js';
export type { DuelPhysicalZone, DuelPhysicalZoneTransition, DuelChainPhysicalCard } from './permanent-state.js';
export * from './canonical-session-v2.js';
// Internal trusted turn execution; no production source registry/server adapter is exported here.
export * from './phase-source-authority-v2.js';
export * from './turn-executor-v2.js';
// Explicit V2 public allowlist projector (schemaVersion 2 wire match).
export * from './projection-v2.js';
// Exact V3 permanent projection over an admitted V2 state; no V3 command expansion.
export * from './projection-v3.js';
// Private closure proof APIs for server-owned composition; JSON never grants authority.
export * from './phase-source-closure-v2.js';
export * from './phase-closure-boundaries-v2.js';
export * from './phase-closure-evidence-v2.js';
// Trusted action composition. These factories still require independent services.
export * from './cost-resolver-v2.js';
export * from './cardplay-unit-v2.js';
export * from './cardplay-spell-v2.js';
export * from './chain-v2.js';
export * from './combat-choice-v2.js';
export * from './combat-damage-executor-v2.js';
export * from './conquer-v2.js';
export * from './standard-move-executor-v2.js';
export * from './engagement-executor-v2.js';
export * from './derived-might-v2.js';
export * from './optional-play-choice-v1.js';
// Opt-in process-local TokenPlay; public adapters still require whole-source closure.
export * from './token-play-v2.js';
export * from './token-play-v3.js';
export * from './optional-play-choice-v2.js';
export * from './cardplay-unit-chain-v4.js';

export * from './point-damage-effect-executor-v1.js';

export * from './cardplay-gear-v1.js';
