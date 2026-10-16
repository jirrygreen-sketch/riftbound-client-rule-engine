# Cost kinds

Each file in this directory is a thin, documented vocabulary layer over the
frozen CR v1.5 356-357 planner in `../cost-plan.ts` and the transactional
payment executor in `../payment.ts`. It does not add a new cost engine: a kind
can only express what the existing `CostSpec` vocabulary can pay (Energy,
Power, XP, exhaust, discard, recycle, kill, reveal, spend-buff) and returns the
frozen `CostPlan`/`CostPaymentReceipt` values that layer already produces.

- `hidden.ts` wraps the existing `buildHiddenCostPlan` (811.1.b).
- `additional.ts` builds mandatory/optional additional costs, including the
  Accelerate default `[1][C]` (356.2, 805).
- `sacrifice.ts` maps the sacrifice wording to the closed-set `kill` payment
  action for a permanent the paying player controls (356.7, 357.2).
- `xp.ts`, `discard.ts`, `recycle.ts`, and `exhaust.ts` wrap the equivalent
  resource/object payment kinds and the payment receipt.
- `index.ts` is the registration point; import a kind from there.

Every kind locks its plan with `buildCostPlan`/`buildHiddenCostPlan` and pays
with `payCostPlan`, so Finalize locking, zero floors (356.4), receipt freezing,
and late-error rollback are owned by the existing cost layer. Caller duties
that remain outside these helpers are listed in `../README.md`.

## Registration and contract integration requests

These helpers are exported here for the instruction layer and future callers;
the cost plan consumer in the production Finalize pipeline is still owned by
the coordinating integration task. The requests below repeat the open items in
`../README.md` because they are consumed by every kind:

1. **CostPlan consumption in Finalize**: a one-line integration is needed so the
   play pipeline consumes a finalized `CostPlan` (for example the plan linked by
   `cost.modify`) instead of only the narrower `FinalizedCostPlan` play
   descriptor. Until that parent-owned change lands, `cost.modify` output is a
   linked value and `cost.pay` is the executable settlement entry point.
2. **Finalize transaction boundary**: `payCostPlan` must run inside the
   enclosing Finalize transaction; `ResolveContext` alone cannot roll back an
   arbitrary live context.
3. **Universal Power** (163.2.b) still needs a distinct representation in
   `PlayerSnapshot.power`/`FinalizedCostPlan.power`; helpers never substitute
   an arbitrary colored Power for `[A]`.
4. **Sacrifice wording**: the frozen action set has no `sacrifice` action, so
   this directory expresses it as `kill` (356.7 nonstandard cost). If a later
   official ruling distinguishes sacrifice from kill (for example death-only
   triggers), the closed action set needs a parent-owned extension; no such
   ruling is implemented here.
