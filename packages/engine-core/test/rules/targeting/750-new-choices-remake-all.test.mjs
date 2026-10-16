// Scenario: targeting-new-choices-remake-all (CR v1.5 750, 752, 753, 755)
//
// "Gain control of a spell on the chain. You may make new choices for it."
// must be able to remake every choice (targets, modes, locations) and ignore
// the newly incurred play costs.
import test from 'node:test';

// The target layer supports rebuilding a plan against the current legal set
// with reselected: true (finalizeTargetPlan/reselectTargetPlan), but no merged
// chain instruction performs 751-755: gaining control of a finalized chain
// item, driving the remake of all of its choices, and suppressing the repeated
// play costs. The chain engine's target plans are locked at Finalize and no
// op/instruction ("make new choices") is merged.
test.todo('targeting-new-choices-remake-all: blocked on the 750-755 "make new choices" instruction — no merged op for chain-item control change, whole-choice remake, and 755 cost suppression');
