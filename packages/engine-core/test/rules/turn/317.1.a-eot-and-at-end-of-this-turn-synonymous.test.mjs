// Scenario `turn-eot-and-at-end-of-this-turn-synonymous` (CR v1.5 317.1.a /
// 359.3.e.16).
//
// The scenario grants a Unit the text “Kill me at end of turn.” and requires the
// granted ability to trigger in the current turn's Ending Step. Registering a trigger
// from a test harness would test the harness rather than the rules, and the merged
// kernel has no way to create that trigger from a resolved ability: contract 3.6 lists
// `ResolveContext.registerDelayedTrigger`, but
// `src/effects/instructions/registry.generated.ts` registers no instruction that calls
// it (`packages/card-dsl/src/cards/sfd/hostile-takeover.ts` records the same gap for
// its owner). The 317.1.a Ending-Step timing also has no committed event pair for the
// before/after window that the scenario's “no trigger in later turns” assertion needs.
import test from 'node:test';

test.todo('turn-eot-and-at-end-of-this-turn-synonymous: blocked — missing registered delayed-trigger instruction and the 317.1.a Ending-Step before/after timing pair (module: src/effects/instructions/ + src/events/timing-points.ts; op: trigger.delayed; timing: 317.1 Ending Step). Source: ResolveContext.registerDelayedTrigger exists in the contract 3.6 but no instruction registry entry invokes it; see packages/card-dsl/src/cards/sfd/hostile-takeover.ts.');
