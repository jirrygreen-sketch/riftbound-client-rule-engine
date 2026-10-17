// Scenarios `turn-eot-text-lost-when-object-changes-zone` (CR v1.5 124.1 / 317.1)
// and `turn-eot-delayed-trigger-not-generated-after-ending-step` (CR v1.5
// 359.3.e.16).
//
// Both scenarios grant text to a Unit with an “at the end of turn” ability and then
// require the ability to stop existing or to never be generated. That needs two
// pieces the merged kernel does not have: a registered instruction for creating a
// delayed trigger (`ResolveContext.registerDelayedTrigger` exists in contract 3.6,
// but `effects/instructions/registry.generated.ts` has no such op — the card
// programs for `sfd/hostile-takeover.ts` record this as `judge-required` for exactly
// this reason), and a committed timing/snapshot pair for the temporary text and its
// ability grant. Approximating it with a hand-registered pipeline trigger would test
// the test harness instead of the rule, so this file keeps the gap explicit.
import test from 'node:test';

test.todo('turn-eot-text-lost-when-object-changes-zone: blocked — no registered delayed-trigger instruction and no temporary-text/ability-grant timing (module: src/effects/instructions/ (missing op `trigger.delayed`) + src/events/timing-points.ts; op: trigger.delayed; timing: 317.1 Ending Step for the end-of-turn trigger, 124.1 for losing the temporary modification on a non-board zone change). Source: `ResolveContext.registerDelayedTrigger` is in docs/plans/2026-10-15-p0-contract.md 3.6 but absent from the instruction registry; packages/card-dsl/src/cards/sfd/hostile-takeover.ts documents the same gap.');

test.todo('turn-eot-delayed-trigger-not-generated-after-ending-step: blocked — needs the same missing `trigger.delayed` instruction plus an Ending-Step timing boundary that can prove the window already closed (CR 359.3.e.16; module: src/effects/instructions/ (op `trigger.delayed`) + src/turn/flow.ts Ending Step task order; op: trigger.delayed; timing: 317.1 Ending Step). Do not approximate by registering the trigger from the test harness: the rule under test is whether the engine refuses to create the delayed trigger at all.');
