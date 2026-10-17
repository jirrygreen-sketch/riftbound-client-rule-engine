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
//
// The Priority half is observable through the Chain trace step `priority-granted` and
// through `chain.priority`/`turnState`. The scenario's `priority.gained` event itself
// has no TimingPointId in `src/events/timing-points.ts` (the file registers no priority
// entry at all), so the committed-timing form of that assertion cannot be written yet.
// Heal has the same shape: `heal` is missing from `ACTION_TIMINGS` in
// `src/events/action-adapter.ts`, so a Heal commits no timing at all even though
// turn.yaml scenarios (317.2.b) expect a `unit.healed` timing.
import test from 'node:test';

test.todo('turn-main-phase-priority-and-rune-pool-empty: blocked — missing Rune Pool empty GameAction (module: src/effects/contract.ts `GameAction` + src/turn/flow.ts task order; op: none; timing: 316.3, Main Phase task 1, before the 316.4 at-start-of-Main-Phase effects). Source: src/turn/flow.ts `requireEmptyPools` throws status=blocked code=empty-rune-pool when any player has `energy !== 0 || power.length !== 0`; already-empty pools are not evidence. Priority half executed in test/rules/turn/312.2.a-turn-player-priority.test.mjs.');

test.todo('turn-expiration-empties-rune-pool: blocked — missing Rune Pool empty GameAction (module: src/effects/contract.ts `GameAction`; op: none; timing: 317.2.d, the Ending Special Cleanup insert step 3e). Source: src/turn/flow.ts `scheduleExpiration` calls `requireEmptyPools` and throws status=blocked code=empty-rune-pool. `clearAllDuelRunePools` (src/cost/resources.ts) exists but is only called from src/duel/*.');

test.todo('turn-main-phase-priority-and-rune-pool-empty / turn-expiration-empties-rune-pool: missing committed timings for the adjacent assertions — `priority-gained` is not a TimingPointId (only a Chain trace step) and `heal` is absent from ACTION_TIMINGS, so the scenarios\' `priority.gained` and `unit.healed` event entries cannot be asserted as committed timings (module: src/events/timing-points.ts + src/events/action-adapter.ts; op: none; timing: 312.2.a / 317.2.b). Shared-contract change request.');
