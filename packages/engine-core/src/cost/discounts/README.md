# Static and continuous costs

`finalizeCostPlan(ctx, input, sources)` collects active cost declarations and
calls the existing `buildCostPlan`. Import it from `cost/discounts/index.ts`.
`collectCostModifications` exposes the translated `CostPlanInput` separately.
Neither function pays, records a play, consumes an effect, or changes state.

Supply the current layered payment context, active `StaticCostAbility` bindings,
and the layer registry's registrations **after duration expiry**. Static source
references must be current: Board sources and the card being played's own
abilities are eligible. Resolved continuous effects may use their source's LKI.
Source-relative players and conditions are evaluated against each ability's
host, rather than against the card receiving the discount. Counts and static
amounts are locked during collection (CR v1.5 356.4.g).

Signed amounts infer increase/discount; explicit `stage: 'increase' | 'discount'`
uses positive magnitudes. Legacy `cost.modify` Energy/Power deltas are supported.
Component discounts use existing component IDs; `optional-additional` expands to
the selected optional components. Optional-cost decisions must already be made
before collection. Resource alternatives ask the payer separately for each
component. Only the chosen branch applies. `[A]` reductions can remove any Power
requirement; `[A]` increases accept any of the six Domains (163.2).

The existing planner applies increases before reductions, component reductions
before total reductions, each reduction's own minimum, and a zero floor
(356.3–356.6). Supply a complete `discountOrder` to lock the payer's decision;
otherwise observable order decisions use stable public choices. Collection and
planning must run in the caller's Finalize transaction so AwaitChoice/payment
failure rolls back every decision with the chain.

`fromZone` needs `originZone`, captured before entering the Chain. The
target-relation filter `{ type: 'spell', object: 'self' }` needs `targets`, the
actual locked target union. A `per-turn-first-play` window and
`cards-played-this-turn` counts need `finalizedPlaysThisTurn`: authoritative
successful card finalizations for the current turn, including countered cards
(420.4.b), excluding abilities and unsuccessful attempts. The caller records
these only when Finalize commits and resets the view at the real turn boundary.
No history is fabricated from current zones or resolved `play` actions.

Unsupported predicates, usage windows (`once: per-turn` optional consumption),
play destination history, Empower costs, payment receipts and descriptive count
subjects throw `CostPlanError('judge-required')`. Programs keep their original
status; this module does not promote any official card to executable.

The `continuous.cost-modification` primitive registers an arithmetic-layer
effect through `addContinuous`, with a lifetime and future recipient filter.
Its resolved magnitude is captured when the instruction runs. Unknown duration,
resource, or scope is blocked; stale target references are ignored. The existing
layer duration implementation maps `this-turn` to `turn-end`; correcting the
global Expiration Step boundary (317.2.c) requires the layer/turn owner.

Integration requests (outside this task's write scope):

1. `programs/statics.ts` must route cost declarations separately from object
   characteristic effects, including pre-play self abilities. Its current
   `staticTarget`/`layerFor` rejects these declarations.
2. `chain/engine.ts` must call `finalizeCostPlan` after targets and additional
   cost decisions, before payment. Supply layered snapshots, exact targets,
   origin and transactional current-turn card Finalize history. The current
   chain calls `buildCostPlan` directly.
3. Add a transactionally committed per-effect usage receipt for optional
   once-per-turn discounts; first-card history does not implement Orianna's
   optional once-per-turn use. Add play-destination history for Hunters' Circle.
4. The shared `cost/index.ts` export is parent-owned; no shared index is edited.
