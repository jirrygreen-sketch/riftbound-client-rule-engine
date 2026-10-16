# RIFT-89 scenario coverage

Run `pnpm --filter @riftbound/engine-core build` followed by
`node --test packages/engine-core/test/cost/cost-plan.test.mjs` from the root.
Existing printed-cost/resource tests remain in this directory unchanged.

The new tests exercise cost planning/payment through the frozen ResolveContext
and reference kernel. The following are **cost-layer slices** of `costs.yaml`,
not claims of full official card, chain, turn, keyword-effect or scenario-harness
execution. Scenario IDs appear verbatim in test names.

| M1 primitive / behavior | Scenario IDs |
| --- | --- |
| `cost.printed`, Energy payment | `costs-basic-energy-payment`, `costs-basic-energy-insufficient` |
| `cost.pay`, Power allocation | `costs-basic-power-domain-match`, `costs-basic-power-wrong-domain`, `costs-power-universal-any-domain`, `costs-symbol-c-own-domain`, `costs-symbol-c-domainless-becomes-a`, `costs-symbol-c-multidomain-either`, `costs-symbol-a-any-domain-payment` |
| `cost.activated`, base choices | `costs-activated-multi-base-choice`, `costs-ability-base-cost-check-ignores-alteration` |
| Mandatory additional costs | `costs-mandatory-additional-kill`, `costs-mandatory-additional-impossible`, `costs-deflect-mandatory-power`, `costs-deflect-unpaid-fails` |
| Optional Accelerate cost/receipt | `costs-accelerate-optional-pay`, `costs-accelerate-declined-exhausted`, `costs-accelerate-power-domain-match` |
| Optional Repeat cost/receipt | `costs-repeat-second-execution`, `costs-repeat-declined-single`, `costs-repeat-each-cost-once` |
| Printed versus actual cost | `costs-printed-cost-check-ignores-discount`, `costs-printed-cost-target-repeat-ignored`, `costs-printed-null-not-zero` |
| `cost.modify`, increases/discounts | `costs-increase-then-discount-order`, `costs-component-discount-before-total`, `costs-discount-floor-zero`, `costs-discount-minimum-per-discount`, `costs-optional-additional-reduced-to-zero`, `costs-variable-discount-checked-at-finalize` |
| `cost.modify`, alternate/ignore | `costs-alternate-replaces-base`, `costs-ignore-base-but-accelerate-still-added`, `costs-ignore-energy-only-power-remains`, `costs-ignore-all-costs-includes-nonstandard` |
| Payment receipt/lifetime | `costs-countered-no-refund`, `costs-replaced-cost-action-still-paid`, `costs-finalize-action-check-after-control-change` |
| Payment sequencing/current pool | `costs-nonstandard-costs-any-order`, `costs-mana-ability-during-payment` |

Additional tests cover `cost.exhaust`, `cost.recycle`, `cost.hidden` (hide `[A]`,
play ignoring base), XP, Buffs, discard picks, exact zone-entry identity,
choice suspension/replay, immutable plans/receipts, max-flow overlap, explicit
Power allocation, Power-discount choices and late-error rollback. Those behaviors
have no dedicated IDs in `costs.yaml`. The resource-kernel test channels and
recycles a real Rune for Power, pays it through `payDuelRuneCost`, then clears the
pool and verifies subsequent payment rejection.

## Scenarios requiring other owners or unresolved semantics

| Scenario IDs | Remaining authority |
| --- | --- |
| `costs-triggered-upfront-cost`, `costs-triggered-upfront-declined` | Trigger/chain owner: whether a trigger is finalized or declined; the cost arithmetic itself is generic. |
| `costs-instruction-cost-resolution`, `costs-instruction-cost-not-paid-no-effect` | Interpreter owner: linked instruction execution, not just payment. |
| `costs-noncost-payment-replacement-skips-check` | Interpreter owner: CR 205's non-cost payment and action-occurrence checks. It must not reuse the cost-paid receipt as an action-occurrence flag. |
| `costs-countered-still-counts-as-played-for-cost-checks` | Chain/history owner: Finalize history versus resolution. |
| `costs-applied-cost-per-unit-moved`, `costs-applied-cost-unpaid-blocks-action` | Movement/applied-cost transaction owner; the planner does not execute the linked move. |
| `costs-cannot-pay-to-make-illegal-outcome` | TargetPlan/Finalize legality owner; ResolveContext has no future-target legality query. |
| `costs-pool-empties-between-phases` | Turn owner supplies the phase boundary. Actual resource pool clearing/rejection is covered by the migrated resource-kernel test. |
| `costs-overpayment-allowed` | Scenario itself is UNCERTAIN; retain the existing exact-payment resource semantics pending a ruling. |
| `costs-replaced-cost-and-if-you-paid-clause` | Scenario itself is UNCERTAIN about linked instruction semantics; the frozen architecture explicitly requires a replaced cost to be recorded paid, which is tested. |
| `costs-payment-triggers-timing` | Scenario itself is UNCERTAIN; events come unchanged from `perform`, with no invented timing points or trigger scheduling. |

See `src/cost/README.md` for the production transaction, universal-Power and
Hidden contract integration requests. Full M1 scenario execution remains partial
at those boundaries; no unsupported behavior is silently enabled.
