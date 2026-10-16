// Scenario: targeting-mass-affect-targets-zone-only (CR v1.5 355.10.d, 355.10.b)
//
// "Kill all units at a battlefield" targets the Battlefield; the units are
// selected programmatically from their characteristics and are not targets.
import test from 'node:test';

// The merged effect.kill can only read ctx.targets(spec) / ctx.picks(spec).
// Implementing the scenario's shape needs either "the Battlefield is the only
// target, then every matching unit is killed by characteristics" or a
// non-target set selection for effect.kill (355.10.d: the units are selected
// programmatically, so they never become targets and 383.4.b must not fire).
// Selecting the units as targets instead would assert the opposite of the
// rule, which the task card forbids, so this stays a todo.
test.todo('targeting-mass-affect-targets-zone-only: blocked on a characteristic-selected (non-target) collection kill (355.10.d) — effect.kill has only target/picks/self and no query form, so units cannot be affected without making them targets');
