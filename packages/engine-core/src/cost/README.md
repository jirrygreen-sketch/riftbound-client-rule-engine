# Cost plans

`buildCostPlan(ctx, input)` locks a cost using only `ResolveContext` reads and
choices. `prepareCostPayment(ctx, plan, options)` allocates current resources and
returns the ordered `GameAction` list without performing it. `assessCostPayment`
and `canPayCostPlan` expose that same check without mutating state. `payCostPlan`
prepares and performs the list, returning an immutable receipt; Finalize callers
may provide `CostPaymentOptions.transaction` to wrap the complete sequence in
their own atomic savepoint. Import these APIs from `cost/index.ts`.

The stages follow architecture section 5.1 and CR v1.5 356–357: base, ordered base
modifications (including Flow), selected optional additional costs, mandatory
additional costs, increases, component discounts, total discounts, total rewrite,
payment. Component discounts apply when their component is added (356.4.c).
`discountOrder` orders discounts within those constraints. Each discount has its
own minimum. A Power discount can supply `powerOrder`, a permutation of requirement
indices; otherwise an ambiguous reduction asks the controller which requirement
to reduce. Domain-specific reductions of unresolved hybrid symbols remain
`judge-required`.

The original `printed` fields preserve `null`. A missing printed Energy cost has
no normal payable base and raises `missing-printed-cost` unless an explicit base
modification supplies one. Printed binding uses the migrated `bindDuelPrintedCost`.
The appended `planDuelRunePayment` reuses the migrated validator and max-flow
allocator; existing resource and printed-cost exports retain their behavior.

## Input vocabulary

`CostPlanInput.cost` accepts the existing DSL `CostSpec`:

- `kind: 'printed'` reads the trusted `printed` catalog projection, or the source
  snapshot when no catalog projection is supplied.
- An explicit cost, optionally `kind: 'activated'` or `'explicit'`, uses `energy`
  and `power` expressions and/or `payments`. A Power expression can evaluate to a
  domain list, or to an integer `[C]` amount. Numeric `[C]` needs `domains` or the
  trusted catalog domains; `domains: []` explicitly means domainless `[A]`.
- Resource payments use `kind: 'energy' | 'power' | 'xp'` and `amount` (or `value`)
  expressions. A Power payment can specify `allowedDomains`; absent that, it is
  `[C]`. Zero Power requirements are omitted.
- Object payments use `kind: 'exhaust' | 'discard' | 'recycle' | 'kill' | 'reveal'
  or `'spend-buff'`. Select `object` (an exact `ObjectRef` or `'self'`), `objects`,
  or a `choice: PickSpec`. `CostSpec.discard` is also a `PickSpec`. Cost object
  choices are non-targeting, private choices. Supplied picks/answers are checked
  against the exact option identities and bounds. Nonstandard `amount` requires
  that many objects, except `spend-buff`, where it is the Buff amount per object.
- The `cost.` prefix is accepted on payment kinds. Unknown fields, kinds and
  unsupported semantics raise `judge-required`; they never become zero costs.

The remaining input fields describe base choices, ordered alternate/Flow/ignore
modifications, additional costs, increases, discounts and `ignoreAllCosts`.
Additional components need unique IDs. Repeat instances are separate Boolean
choices and each can be paid once. Accelerate defaults to `[1][C]`; multiple
Accelerate entries are rejected as redundant. Chosen optional costs remain marked
paid in the receipt even when reduced to zero (356.4.f.1).

When a target-aware Base Cost descriptor supplies only Energy, exact printed
Power must come from the selected card's numeric program or trusted catalog.
If the selected program has no Play cost and the trusted catalog explicitly says
`power: null`, the effect-play owner may preserve zero Power. The cost layer
does not derive an amount from the runtime Domain
list; a nonempty Domain list or missing catalog row remains `judge-required`.

`buildHiddenCostPlan` provides only the costs specified in 811.1.b: hiding costs
`[A]`; playing from Hidden ignores base Energy and Power, retaining later fees.
The caller must already have verified the Hide/play permission. This helper does
not move a card, grant Reaction, create a facedown zone, or install Flow's delayed
banishment replacement.

## Payment and transaction boundary

The first action is one combined Energy/Power `pay`, with exact allocated domains.
It is followed by nonstandard actions and `spend-xp`. `nonstandardOrder` must be an
exact permutation of their IDs; it cannot omit or duplicate a cost (357.2).
The source/controller and object identities are checked. Object/resource
requirements are checked before performing anything, and checked again in order.
Resources are read at payment time so the enclosing payment window can activate
legal Reaction Add abilities after planning (357.1.a).

**Call `payCostPlan` inside the enclosing Finalize transaction, or provide its
`transaction` callback.** A `done` or
`replaced` outcome counts as paid (203.2 / 357.2.a). `impossible` or `prevented`
throws `CostPlanError('cannot-pay-cost', ...)`, including the failed action and
outcome. The enclosing transaction must abort all preceding actions and emitted
events on any exception, including `AwaitChoice`; catching this error and
committing a partial Finalize is invalid (203.3 / 358.5). ResolveContext has no
snapshot/rollback capability, so this module cannot roll back an arbitrary live
context itself. Tests use the existing reference kernel's actual transactional
`runInstruction` wrapper to verify late failure rollback. No undo/refund actions
are produced; a later counter cannot alter the paid receipt (426.1.c).

The caller also owns once-only Finalize execution, TargetPlan/restriction checks
(including 357.3), timing and event-trigger scheduling. The planner does not
invent those capabilities.

## Contract integration requests

1. Define the production Finalize transaction boundary for the ordered action
   sequence and `CostPlanError` propagation. Alternatively, extend the existing
   atomic `pay` action's plan to carry the entire ordered sequence and receipt.
   The frozen `ResolveContext` alone cannot guarantee rollback across several
   `perform` calls.
2. `PlayerSnapshot.power` and `FinalizedCostPlan.power` contain only six-domain
   values. They cannot express the universal Power source supported by migrated
   `resources.ts` (163.2.b). Preserve a universal source distinctly when extending
   those contracts; do not substitute an arbitrary colored Power.
3. The current zones/actions omit Champion/facedown zones, Hide, and the turn and
   battlefield-control information needed for Hidden legality and next-turn
   unlocking. These need parent-owned contracts/integration for full `cost.hidden`.

The reference test kernel's `pay` currently deducts Energy and XP only, ignoring
its Power/exhaust/recycle fields. These tests verify the exact Power action and
allocation, and separately verify real resource deduction through
`payDuelRuneCost`; they do not claim that reference-kernel Power deduction has
been fixed. Nonstandard costs are emitted as the existing individual actions.
