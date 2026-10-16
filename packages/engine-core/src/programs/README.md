# Card program binding

`createProgramBinding({ cardPrograms })` is the engine adapter between the generated
`@riftbound/card-dsl` CardProgram registry and `ChainEngine`.

The adapter resolves a canonical card id, rejects `judge-required` programs, expands
registered keywords, translates EffectIR targets and costs, and produces `ChainDraft`
values for play and activated abilities. `registerProgramTriggers` binds triggered
abilities to the existing `EventPipeline`; optional triggers are therefore asked by
the pipeline before they become chain items. `attachLifecycle` installs and removes
those registrations when a permanent or spell crosses its active zone and invokes the
`bindStatic`/`bindReplacement` callbacks for later layer work.

The card-dsl package does not export `registry.generated` through its public package
exports. Callers must inject the generated registry (or a Map) into this adapter.
That is a contract change request for the shared package: expose a stable generated
program-registry entry point, such as `@riftbound/card-dsl/registry`.

Requirement/restriction records that carry a direct EffectIR `Condition` are copied
to the ChainDraft and checked during Finalize. Descriptive kinds without a condition
adapter, additional costs, mode choices, nested target lifecycles, unknown keywords,
and unsupported filter fields fail closed with
`ProgramBindingError(code: "judge-required")`. Printed `energy: null`/`power: null`
are left to the existing cost engine and are never coerced to zero.
