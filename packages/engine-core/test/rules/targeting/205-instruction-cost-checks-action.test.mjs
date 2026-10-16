// Scenario: targeting-instruction-cost-checks-action (CR v1.5 205, 359.3.e.14.b)
//
// "[4][C], if you do, kill a unit here" inside a triggered ability: the leading
// payment is a game action, not a cost, and a replaced payment must stop the
// linked instruction.
import test from 'node:test';

// No merged instruction performs a payment inside an ability body: the
// registered effects/instructions set has no cost.pay / cost.modify primitive
// in this branch (effect.resources only adds Energy and Power), so the leading
// "[4][C]" cannot be written. Even with one, the scenario needs the payment
// action to be replacable: the reference kernel's replacement hooks are
// consulted by ctx.perform for game actions, while the chain pays its Finalize
// cost plan through payCostPlan, which never routes through a replacement.
// Both halves are missing, so the scenario stays a todo rather than being
// approximated with an invented payment instruction.
test.todo('targeting-instruction-cost-checks-action: blocked on an in-body payment instruction + a replaceable payment action (205) — no merged cost.pay op and no replacement hook on the Finalize payment path');
