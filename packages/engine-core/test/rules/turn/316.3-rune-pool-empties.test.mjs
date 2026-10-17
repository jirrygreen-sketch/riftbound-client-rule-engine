// Scenarios `turn-main-phase-priority-and-rune-pool-empty` (CR v1.5 316.3 / 167 /
// 312.2.a / 310.1) and `turn-expiration-empties-rune-pool` (CR v1.5 317.2.d / 167).
//
// Both scenarios need a GameAction that empties each player's Rune Pool. The merged
// new-layer kernel has none: `src/turn/flow.ts` `requireEmptyPools` fails closed with
// `TurnCombatBlockedError` code `empty-rune-pool` before the Main Phase begins and
// before the Ending Special Cleanup runs, rather than paying the pool out or applying
// a negative resource buff as a stand-in. The resource layer's
// `clearAllDuelRunePools` (src/cost/resources.ts) implements the state transform but is
// wired only into the legacy duel runtimes, not into either phase boundary.
//
// The Priority half of the first scenario is executed in
// `312.2.a-turn-player-priority.test.mjs`, which shows the Turn Player holds Priority
// in the Neutral Open Main Phase (312.2.a / 310.1); the pool half remains blocked.
import test from 'node:test';

test.todo('turn-main-phase-priority-and-rune-pool-empty: blocked — missing Rune Pool empty GameAction (module: src/effects/contract.ts `GameAction` + src/turn/flow.ts task order; op: none; timing: 316.3, Main Phase task 1, before the 316.4 at-start-of-Main-Phase effects). Source: src/turn/flow.ts `requireEmptyPools` throws status=blocked code=empty-rune-pool when any player has `energy !== 0 || power.length !== 0`; already-empty pools are not evidence. Priority half executed in test/rules/turn/312.2.a-turn-player-priority.test.mjs.');

test.todo('turn-expiration-empties-rune-pool: blocked — missing Rune Pool empty GameAction (module: src/effects/contract.ts `GameAction`; op: none; timing: 317.2.d, the Ending Special Cleanup insert step 3e). Source: src/turn/flow.ts `scheduleExpiration` calls `requireEmptyPools` and throws status=blocked code=empty-rune-pool. `clearAllDuelRunePools` (src/cost/resources.ts) exists but is only called from src/duel/*.');
