# Ability grant integration boundary

CR v1.5 478.3, 479.3 and 801.3 govern ability/keyword grants. CR 765–767
govern ignoring a keyword only for a specified player and procedure.

`continuous.grant-ability` registers validated complete `Ability` IR, without
interpreting its cost or body. `continuous.ignore-ability` registers `ignores`,
`operation` and `players`; it does not remove keyword characteristics. Both use
the existing continuous registry, duration resolver and chain transactions.
Selectors accept `target`, `pick`, `objects`, `filter` or `choose`; literal
expressions in the original card IR are accepted without an adapter rewrite.

`resolveAbilityGrants(source, printed, registry, context, scope?)` is a pure
query of current registrations and the owner's current layered object view.
It returns complete abilities, effective keywords and registration identities.
It rebinds authored passive filters to the live source (location/controller),
preserves independent full-ability instances and uses the shared keyword
expander for keyword stacking, printed parameters and independent instance ids.
An ignored keyword keeps its characteristic but contributes no expansion to
the requested operation/player query.

`bindGrantedAbility(engine, source, entry, binder)` uses the existing static,
replacement and trigger routes and returns their removal handle. The caller
must supply the lifecycle's existing static binder. Activated/play abilities
remain the responsibility of their existing program consumers. A trigger host
currently needs a non-null card id because the existing trigger adapter reads
the program through that id. Unknown ability bodies/costs are not implemented
or made executable by structural validation.

## Required owner changes (not included in this workstream)

1. **EG-STATIC / EG-ADAPTER:** map `continuous.grant-ability` and
   `continuous.ignore-ability` to the ability layer in `programs/statics.ts`.
   Preserve symbolic filters for re-evaluation and normalize authored
   `appliesTo` forms such as `units-here` and `friendly-legends` through the
   unified filter adapter. Use this single static route for derived statics.
2. **EG-ADAPTER / EG-LAYERS:** assemble effective keyword/ability evaluation
   in the default `chain/engine.ts` and `turn/phase-layers.ts` paths. The
   existing `KeywordGrantLayerEngine` still requires explicit injection and
   still rejects non-static expansions. Do not bind printed keyword
   expansions a second time after effective expansion. Mixed legacy
   keyword grant/removal effects and keywords inside complete-ability grants
   must enter the same ordered ability-layer contribution stream. This query
   cannot recover earlier layer ordering from an already reduced keyword
   snapshot; keep such mixed programs blocked until that owner route exists.
3. **EG-LIFECYCLE / EG-TRIGGERS:** reconcile the returned entries before the
   relevant trigger scan; retain leave-event/LKI subscriptions until that
   scan completes. Remove handles when an entry becomes inactive. Include
   handle bookkeeping and replacement registration changes in checkpoints;
   pipeline/layer restoration must not leave a stale lifecycle cache. Connect
   the complete effective abilities to `activationAbilities`,
   `describeActivate` and inspection. These modules only provide queries and
   binding/removal handles, not a second event scanner or resolver.
4. **EG-CONTRACT / EG-ADAPTER:** provide a deterministic resolution identity
   to continuous registrations. The helper now falls back to the stable
   instruction path plus the target's incarnation, so repeated instruction
   paths do not collide and no process-global counter is needed. A caller that
   resolves the same instruction path repeatedly against the same incarnation
   must still supply an explicit `settlementId`. Minimal additive seam:

   ```ts
   interface ResolveContext {
     readonly settlementId?: string; // captured/restored by ChainEngine
   }
   ```

   The adapter can instead supply the existing `settlementId` primitive
   argument; either solution must preserve old profiles and replay logs.
5. **EG-CONTRACT / EG-TRIGGERS:** expose a trigger-registration adapter that
   accepts an explicit ability list and the real source, including sources
   whose `cardId` is null. Do not fabricate a replacement object snapshot to
   route token-granted triggers through `ProgramRegistry.get`.
6. **EG-COMBATPRIORITY:** query scoped effective abilities during damage
   assignment for the acting player. Merely registering `ignores: ["Tank"]`
   does not implement Tank's assignment rules or ignore those rules for
   unrelated players/actions. Freeze resolved relative-player scopes when
   their source may leave; passive scopes continue following the live source.

The raw Dominus and Last Stand IR is exercised in `test/engine-gaps/grants.test.mjs`.
Their default chain execution is distinct from the explicitly connected
effective-activation/trigger consumers in those tests. Both official programs
remain `judge-required`; no card-program or legacy replay/profile file changes
are part of this implementation.
