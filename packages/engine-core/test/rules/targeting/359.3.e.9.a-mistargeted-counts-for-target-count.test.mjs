// Scenario: targeting-mistargeted-counts-for-target-count (CR v1.5 359.3.e.9.a)
//
// Repulse ("Counter an enemy spell or ability that chooses it and no other
// friendly unit") must count every target the chain item chose in the zone the
// instruction names, including targets that were mistargeted but stayed on the
// board.
import test from 'node:test';

// Counting "how many targets of this chain item are friendly units at
// battlefields" needs a chain-item referent that exposes the item's locked
// TargetPlans to a target filter. The merged chain exposes targetPlans on its
// items, but no target requirement can read another chain item's plans, and
// TargetRequirement has no "chosen targets of" referent. Budgeting the count
// from a hand-built number would fabricate the scenario's evidence.
test.todo('targeting-mistargeted-counts-for-target-count: blocked on a chain-item target-count referent (359.3.e.9.a) — no merged ObjectFilter/TargetRequirement reads another chain item\'s locked target plans');
