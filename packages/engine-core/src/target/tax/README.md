# Target taxes

`createTargetTaxAdapter(context, costInput, { kind: 'spell' | 'ability' })`
creates one cost accumulator for one pending spell or ability. Its
`appendTargetTax` implements the existing RIFT-90 hook. Use
`adapter.queryTargetCandidates(requirement)` and
`adapter.finalizeTargetPlan(requirement, options)` to derive taxes from current
target snapshots, filter individually unaffordable choices and reject a combined
unaffordable selection before any target notifications. Read `adapter.costPlan`
and pass it to the existing `payCostPlan` inside the enclosing Finalize
transaction, or use `finalizeTargetTax` from `chain/finalize/target-tax.ts` to
select and pay through that same cost pipeline.

Deflect reads current `ObjectSnapshot.keywords`, including granted keywords.
It sums every instance (default 1, explicit zero preserved), applies only when
an opponent chooses a Board permanent, and adds mandatory any-domain Power for
each choice, including separate target requirements and reselections. Resource
allocation includes the base cost and all previous taxes; plentiful Energy
cannot substitute for Power. Resolve does not collect or refund taxes.
Rules: CR v1.5 355.16, 356.2.a.2, 356.4, 809.1–809.3.

Finalize callers may pass `ignoreDeflect: true` (or the `ignoreTax` alias) for
the bounded payment procedure described by CR 764–767 / 809.1.c. This skips
value-based Deflect instances while retaining explicit card-text `target.tax`
costs. `chain/finalize/target-tax.ts` provides the parent-facing consumer that
finalizes every target against one accumulated adapter and pays its complete
CostPlan only after all selections are affordable.
The consumer uses an explicit request transaction, the context transaction, or
the payment transaction (in that order), covering initial cost choices as well
as targets and payment. Without one, the caller must already be inside its own
atomic Finalize operation. `pay: false` returns a plan without paying it.
Omitted base costs use the spell's printed cost; abilities without a supplied
base cost add only their target taxes. Missing printed costs stay missing.
`adapter.reselectTargetPlan` prices each new choice against all previous ones;
`adapter.resolveTargetPlan` only rechecks legality and retains the paid plan.

The explicit RIFT-90 hook rolls back additions belonging to the failed
TargetPlan. The high-level Finalize method also restores its previous cost plan
on any selection/notification exception. Game state and external notification
effects remain the enclosing Finalize transaction's responsibility. Calls for
one TargetPlan must be contiguous; discard this per-item adapter if the
enclosing Finalize transaction aborts. Payment must use the same controller and
source zone entry as the adapter's context.

## Static declarations and IR

Existing `Deflect.expand` output remains unchanged:

```ts
{ kind: 'static', effect: { kind: 'target.tax', value: { kind: 'constant', value: 1 } } }
```

The additive `TargetTaxEffect` type also permits:

```ts
{
  kind: 'static',
  effect: {
    kind: 'target.tax',
    cost: { energy: { kind: 'constant', value: 2 } },
    appliesTo: 'spells',
    stage: 'increase'
  }
}
```

`cost` replaces `value`; both together are invalid. `appliesTo` defaults to
`spells-and-abilities`; `stage` defaults to `mandatory-additional`. The cost
planner applies increases and discounts in its existing rules order, preserving
null printed costs and alternate/base cost handling. Explicit resource costs
are supported; printed or object payment taxes stay `judge-required` until their
static-host binding contract exists. Dynamic expressions read the tax host's
characteristics, while the choosing controller pays.

Callers may supply `effects: BoundTargetTax[]`, with each entry containing
`{ id, target: ObjectRef, effect: TargetTaxEffect }`. This is the **complete**
already-active static tax set, including expanded Deflect, instead of deriving
Deflect from snapshot keywords. Empty effects explicitly means no active taxes.
This avoids charging the same keyword and its expansion twice. Bound effects
apply to the exact target zone entry and only on the Board. Deflect taxes only
opposing choosers; an explicit card-text cost applies to all choosers for which
the caller supplied the binding. The parent static binder must resolve filters, conditions, ability
suppression and lifetimes before supplying these bindings. No live card
program's status changes merely because this module exists.

## Parent integration requests

- `chain/engine.ts` currently overrides the RIFT-90 adapter with its own tax
  collector and converts the received amount to **Energy**. Replace that path
  with `finalizeTargetTax({ context, kind, cost, targets, effects,
  ignoreDeflect })` in its existing atomic operation, then use the returned
  `targetPlans`, `costPlan`, and `payment`. Supply the actual spell/ability
  kind; a unit can be the source of an ability. Preserve the Chain owner's
  legality, event, and trigger callbacks on each target option. Route the change
  through the coordinator-owned version boundary so profiles 1–9 and their
  existing strict replay logs retain their historical behavior; do not upgrade
  a default profile or rewrite a log.
- `programs/statics.ts` currently has no `target.tax` mapping. Route active
  declarations to the bound tax set, including conditional and granted Deflect,
  or use current layered keyword snapshots. This module deliberately requires
  one complete representation, so partial static expansions must not hide
  other granted Deflect instances.
- The static/Finalize owners must derive the trusted, temporary
  `ignoreDeflect` flag from active ignore declarations and their exact window.
  `ven/decree-of-insight` declares `continuous.ignore-target-tax` during
  `paying-this-spells-cost`; Heisho's `continuous.ignore-abilities` also depends
  on the complete spell/ability selection and location. Neither declaration is
  interpreted as an unconditional ignore by this module. Do not persist the
  flag across spells, reselections in a new procedure, or players.
- `PlayerSnapshot.power` and the current `cost/payment.ts` consumer expose only
  six-domain sources. EG-CONTRACT already added optional
  `FinalizedCostPlan.universalPower` / `powerSources` provenance, but there is no
  corresponding live Universal resource field on `PlayerSnapshot`. The minimal
  additive request to EG-CONTRACT/EG-POWER is `universalPower?: number` there
  (or the EG-POWER owner's agreed resource-source query), followed by snapshot,
  allocator and payment-host consumption. This task does not change that shared
  contract. Any-domain Deflect requirements continue to use all six allowed
  Domains without inventing a colored source or requiring a Universal source.
- `test/engine-gaps/tax.test.mjs` expands original Pouty Poro and Bird programs
  with the production program inspector, then feeds their unchanged tax IR
  into the Finalize consumer. Real `pay` actions consume Energy and colored
  Power in the reference host. The same any-domain requirement is also passed
  to the real resource allocator with a Universal (`any`) source. Requirements
  never create or recolor Power sources.
- The Fiora test binds its original conditional static through
  `createEngineStaticBinder` and `KeywordGrantLayerEngine`, then consumes the
  current layered Deflect. That layer engine is explicitly injected in the
  test; default assembly remains the layer owner's integration responsibility.

The new Chain consumer is not yet called by default `ChainEngine` assembly.
These are module integration tests, not evidence that the complete original
judge-required cards are playable. No static binder, runtime profile, replay
schema or card status is changed by this scoped task.

## Cards mentioning this dependency

2026-10-18: the following 52 cards are the EG-TAX dependency list in
`docs/plans/engine-gaps.json`. They include grants, Bird tokens and ignore
declarations. They retain every other blocker and still require parent
integration and the separate card-program phase. The inventory records zero
cards fully unlocked by EG-TAX alone.

- `ogn/`: `commander-ledros`, `deadbloom-predator`, `fiora-victorious`, `pouty-poro`, `qiyana-victorious`, `spirits-refuge`, `volibear-furious`.
- `rad/`: `dune-devourer`, `hunting-dog`, `ki-burst`, `skystrike-squadron`, `storm-raptor`, `watchful-curator`.
- `sfd/`: `breakneck-mech`, `draven-audacious`, `irelia-fervent`, `jax-unmatched`, `kato-the-arm`, `navori-scout`, `ornn-forge-god`, `petricite-monument`, `sivir-ambitious`, `tianna-crownguard`.
- `unl/`: `allay-eager-admirer`, `bird`, `carrion-dredger`, `flurry-of-feathers`, `frisky-hunter`, `galio-indefatigable`, `gutter-palace`, `jhin-murderous-artist`, `master-yi-tempered`, `mosstomper`, `poppy-paragon`, `rengar-unseen`, `trapping-grounds`, `ultrasoft-poro`, `vex-apathetic`, `vi-hotheaded`, `walking-roost`.
- `ven/`: `baccai-sandspinner`, `decree-of-insight`, `grumpy-rockbear`, `heisho-shell-of-the-world`, `jayce-hammer-in-hand`, `kayle-justified`, `nasus-ascended`, `plaza-guardian`, `renekton-brute`, `serene-ascetic`, `solari-sunhawk`, `steel-paws`.
