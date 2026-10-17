# Target taxes

`createTargetTaxAdapter(context, costInput, { kind: 'spell' | 'ability' })`
creates one cost accumulator for one pending spell or ability. Its
`appendTargetTax` implements the existing RIFT-90 hook. Use
`adapter.queryTargetCandidates(requirement)` and
`adapter.finalizeTargetPlan(requirement, options)` to derive taxes from current
target snapshots, filter individually unaffordable choices and reject a combined
unaffordable selection before any target notifications. Read `adapter.costPlan`
and pass it to the existing `payCostPlan` inside the enclosing Finalize
transaction. This module never performs payment.

Deflect reads current `ObjectSnapshot.keywords`, including granted keywords.
It sums every instance (default 1, explicit zero preserved), applies only when
an opponent chooses a Board permanent, and adds mandatory any-domain Power for
each choice, including separate target requirements and reselections. Resource
allocation includes the base cost and all previous taxes; plentiful Energy
cannot substitute for Power. Resolve does not collect or refund taxes.
Rules: CR v1.5 355.16, 356.2.a.2, 356.4, 809.1–809.3.

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
  with this per-item adapter and consume its complete CostPlan. Supply the
  actual spell/ability kind; a unit can be the source of an ability.
- `programs/statics.ts` currently has no `target.tax` mapping. Route active
  declarations to the bound tax set, including conditional and granted Deflect,
  or use current layered keyword snapshots. This module deliberately requires
  one complete representation, so partial static expansions must not hide
  other granted Deflect instances.
- The existing `PlayerSnapshot.power` / `FinalizedCostPlan.power` contracts only
  represent six-domain sources. Domainless Power **sources** remain a separate
  parent-owned cost contract issue. Any-domain Deflect **requirements** here
  accept all six represented domains without inventing a colored source.
- The reference effect kernel currently ignores Power in `perform(pay)`.
  Target-tax tests exercise the real cost planner/payment allocator and inspect
  exact payment actions; they do not claim end-to-end Power deduction.

No Chain, static binder, runtime profile, replay schema or card status is changed
by this scoped task.

## Cards mentioning this dependency

2026-10-17: `rg` located Deflect/target.tax references and the compiled
CardPrograms were checked for the same text in `judgeReason`. There are
52 matches below, including cards that grant Deflect, create Bird tokens,
or ignore Deflect. They retain every other blocker and still require parent
integration; this is a dependency list, not an executable-card claim.

- `ogn/`: `commander-ledros`, `deadbloom-predator`, `fiora-victorious`, `pouty-poro`, `qiyana-victorious`, `spirits-refuge`, `volibear-furious`.
- `rad/`: `dune-devourer`, `hunting-dog`, `skystrike-squadron`, `storm-raptor`, `watchful-curator`.
- `sfd/`: `breakneck-mech`, `draven-audacious`, `irelia-fervent`, `jax-unmatched`, `kato-the-arm`, `navori-scout`, `ornn-forge-god`, `petricite-monument`, `sivir-ambitious`, `tianna-crownguard`.
- `unl/`: `allay-eager-admirer`, `bird`, `carrion-dredger`, `flurry-of-feathers`, `frisky-hunter`, `galio-indefatigable`, `gutter-palace`, `jhin-murderous-artist`, `master-yi-tempered`, `mosstomper`, `poppy-paragon`, `rengar-unseen`, `trapping-grounds`, `ultrasoft-poro`, `vex-apathetic`, `vi-hotheaded`, `walking-roost`.
- `ven/`: `baccai-sandspinner`, `decree-of-insight`, `grumpy-rockbear`, `heisho-shell-of-the-world`, `jayce-hammer-in-hand`, `kayle-justified`, `nasus-ascended`, `plaza-guardian`, `public-execution`, `renekton-brute`, `serene-ascetic`, `solari-sunhawk`, `steel-paws`.
