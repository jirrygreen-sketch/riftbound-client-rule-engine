# Cost kinds

These helpers reuse `../cost-plan.ts` (CR v1.5 356-357) and
`../payment.ts`. Plans and successful receipts are frozen. The payer executes
an ordered list of actions; **it does not create a transaction**.

- `hidden.ts` wraps `buildHiddenCostPlan` (811.1.b).
- `additional.ts` supports mandatory/optional costs and Accelerate's `[1][C]`
  default (356.2, 805).
- `sacrifice.ts` uses the existing `kill` payment action; no new action is added.
- `xp.ts`, `discard.ts`, `recycle.ts`, and `exhaust.ts` reuse the corresponding
  resource/object payments.
- `index.ts` exports the helpers. Production Finalize registration belongs to
  the coordinating task.

## Instruction behavior and current limits

`cost.modify` delegates ordinary increases, discounts, ordering and zero floors
to the planner. `cost.pay` accepts a locked CostPlan or a plain finalized
payment descriptor. `payments.power: 2` means two `[A]` requirements, allocated
from any of the six domain resources; a domain list retains specific domain
requirements. `0` and `[]` both mean zero Power. Universal **resource sources**
are a different issue from an any-domain **cost requirement** (see request 4).
No printed null characteristic is converted into a numeric printed cost.

A failed `cost.pay` **throws `CostPlanError`**, before or after the first action.
It must never return `negated` after a failed payment: the frozen interpreter
continues linked instructions after `negated` (P0 contract 3.3/3.6), which would
execute unpaid effects in violation of 203.3. The exception stops interpretation
and lets the caller's enclosing transaction discard all actions, events and
links. Tests use the existing `runInstruction` clone/commit boundary around the
real interpreter; they cover insufficient resources, a prevented exhaust after
Energy, and a later prevented/impossible recycle after Energy and exhaust.
Replaced cost actions still count as paid (203.2/357.2.a).

**This is a safe abort, not complete optional-payment control flow.** With the
frozen interfaces an unpaid cost aborts the whole enclosing transaction; it
cannot just roll back the payment and skip its dependent effects while
continuing independent instructions outside that payment body. A caller must
not catch the error inside the transaction and commit partial state. A direct
live `ResolveContext` call has no rollback guarantee. Requests 1-2 below remain
integration prerequisites.

`reduce-equip-cost` is **judge-required**, including on apparently universal
Power requirements. `allowedDomains` alone cannot distinguish an original
`[A]` symbol from a `[C]` identity with the same domains. Treating this modifier
as a generic Power discount incorrectly removes colored costs (821.1.c.3).
Ordinary `reduce` continues to work; no substitute Weaponmaster semantics run.

The actual Weaponmaster expansion's `source`, omitted `id`, numeric modifier
`amount: 1`, and `domain: 'any'` are accepted by the local argument adapter.
It resolves the exact selected Equipment identity through `targets` and
`object`, then raises `judge-required` for the missing authoritative Equip-cost
binding. ObjectSnapshot exposes the card's play costs and keyword names, not
its Equip ability's cost. The Unit's cost, the Equipment's play cost and a
missing cost must never become that ability's cost. Integration tests run the
unchanged expanded cost/payment/attach sub-body with the targeting owner's
locked selection, and prove that missing binding produces no payment or attach.
Full Weaponmaster targeting/execution is not claimed complete.

The reference kernel's `pay` action still deducts Energy/XP only, ignoring Power.
Tests verify the real allocator's exact allocated domains and emitted pay action;
they do not claim to fix Power pool deduction. No test manually refunds resources
or fabricates successful payment results.

## Contract change requests (parent-owned, not implemented here)

1. **Payment transaction/savepoint.** Add a kernel-owned synchronous capability
   such as `withCostTransaction<T>(run: (ctx: ResolveContext) => T): T` and
   forward it through interpreter contexts. Exceptions (including AwaitChoice)
   must roll back state, events, trigger queues, choices and links together.
   Alternatively extend atomic `pay` to carry all ordered standard/nonstandard
   actions and return a complete receipt. The current primitive can only
   propagate exceptions to a caller-owned transaction, never undo a live ctx.
2. **Success-gated payment body (203.3).** Define a payment scope/body in the
   interpreter/IR. Execute the dependent body only after a committed payment;
   catch payment failure only after the scope's transaction has rolled back,
   skip that dependent body, then continue independent outer instructions.
   Preserve existing general `negated`/`linkedTo` semantics; do not change all
   links to success-only. `choice.optional`'s boolean acceptance is insufficient.
3. **Equip binding and original symbols (821.1.c.2-.5).** Add a read-only
   `equipCost(equipment: ObjectRef, host: ObjectRef)` capability yielding a
   trusted Equip CostSpec plus applicable cost modifiers, or an explicit
   missing/blocked result. Preserve Power symbol provenance alongside each
   requirement (`A`, `C`, specific-domain or hybrid), through finalization and
   discounts. Only original `A` requirements are eligible for Weaponmaster's
   reduction. Also retain the equipment identity separately from the triggering
   Unit source so payment revalidates both. Legacy data without provenance
   stays blocked; do not rewrite old profiles/logs or infer symbols from a
   six-domain allowed set.
4. **Universal Power resource** (163.2.b): represent a domainless resource
   separately in PlayerSnapshot/FinalizedCostPlan; never invent a colored source.
5. **Finalize plan consumption:** the production pipeline must consume a full
   CostPlan instead of just its narrower FinalizedCostPlan descriptor. Wire the
   caller only after its transaction and source/target restrictions are verified.
6. **Sacrifice vocabulary:** the closed action set only has `kill`. If sourced
   rulings require a distinct sacrifice action, extend that contract; no such
   distinction is invented here.

The existing Hidden timing/facedown/zone integration gaps in `../README.md`
also remain outside these wrappers.
