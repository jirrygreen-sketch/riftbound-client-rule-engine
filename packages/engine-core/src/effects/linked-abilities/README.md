# Linked ability runtime

Rule evidence is CR v1.5 124, 391.5, 393, 394-398 and 428.3. `LinkedAbilityState`
stores the affected references for an explicitly declared component set, keyed
by the source's physical id, zone-entry id, set id and granting origin. Names
and canonical card ids alone never identify a collection. A component capture
accepts an actual `{ count, objects, source }` receipt only when the new refs
are backed by successful actions in the same resolution. Partial successful
banishments survive a negated producer; prevented/replaced objects do not.

`createLinkedAbilityHost` wraps a real `PipelineHost`. Its checkpoint contains
both the original host checkpoint and the linked state, so the ChainEngine's
existing atomic resolution restores collections, transition receipts and
damage history on errors or `AwaitChoice`. It changes no choice or action
result, creates no targets, and supplies no picks.

`reads` bind the interpreter's runtime `{ linked: key }` resolver to a collection.
The returned value is an array of affected objects, without the receipt's
`source` metadata. A live lookup always checks the exact reference and its
captured zone. Leaving and returning cannot revive that reference. Source
re-entry creates another collection. Old source snapshots retain their
collections for already pending abilities (including an ability whose cost
banishes its source). An explicit delayed source window additionally requires
that source's original incarnation to remain in the specified zone; an
affected-object window instead lasts only while its recorded objects remain.
The delayed trigger owner still controls registration and expiration.

`newReference(context, oldRef, zone)` reads one actual transition receipt. It
does not calculate an entry id or find a new object by card/name/id. It returns
null after the resulting object has departed, even if the same card returns.
Following multiple transitions requires explicit receipt handling by the
owner that is entitled to follow them.

`damageHistory` exposes positive, committed damage, with the actual action's
source, target, amount, turn, combat and the payload's action/batch ids. Queries explicitly choose physical
entity or exact incarnation identity and can restrict target, turn, combat
or combat damage. Requested/prevented/zero damage is excluded. This is data
for later expression binding, not an implementation of Dancing Grenade's
unresolved nested replay or bonus semantics.

## Integration Requests (Outside This Workstream's Write Scope)

The existing default assembler does not import this module. EG-CONTRACT has
not supplied a persistent linked-set declaration, and Sarcophagus still has
a placeholder string pick. This change therefore supplies an opt-in runtime
port and tests real original IR segments, not full-card unlock evidence.

Minimum additive owner work:

1. EG-CONTRACT: add a declared linked-set surface that maps to
   `LinkedAbilityBinding` (`setId`, member identities, producer instruction
   paths/result keys/actions/zones, consumer aliases). Granted sets must carry
   the exact grantor incarnation and grant identity. Validate membership
   rather than infer it from an opcode, a card name or an arbitrary receipt.
2. EG-ADAPTER/EG-LIFECYCLE: wrap the default action host with
   `createLinkedAbilityHost`, pass the real pipeline clock, and lower the
   declarations into `bindings`. Keep the wrapper inside the assembler's
   checkpoint/restore boundary. Export through the owner-managed entry point.
3. EG-CONTRACT/EG-FILTER/EG-FINALIZE: provide an explicit persistent collection source for
   a non-target pick (including a one-object selection); it must consume only
   the declared component's live refs. Existing `PickSpec.linked` is restricted
   to a previous instruction in the same body and `selection: all`, so it
   cannot be relabeled as persistent linkage. The IR validator also requires
   every `{ linked: key }` object anchor to name a preceding instruction in the
   same ability (`linked-instruction-not-prior`, `unresolved-instruction`). A
   new persistent selector must be distinct from that legacy contract.
4. EG-CONTRACT/EG-EXPR: expose the typed `damageHistory` query and actual
   `newReference` receipts in expressions/ResolveContext. Keep entity vs
   incarnation explicit. Do not reinterpret old `self`/`source` selectors.

No shared files, card programs, default profiles, schemas or old replay logs
are changed. Cursed Sarcophagus can use this collection once its declaration
and consumer pick are connected. Ashe, Focused, Virtuoso, Death from Below
and Dancing Grenade retain their other delayed/reflexive/replay, targeting,
payment or ruling dependencies and remain judge-required. Damage records are
per actual action, retaining action/batch provenance; this module does not
decide how a future card-specific "times" expression groups simultaneous
damage to multiple targets.

An additive draft for the contract owner (names are proposals, not executable
IR in this patch):

```ts
// CardProgram.linkedAbilities?: readonly LinkedAbilityBinding[]
// ObjectSelector gains { linkedAbility: { setId: string; member: string } }
// Expr gains { kind: "damage-history"; source: ObjectSelector;
//   identity: "entity" | "incarnation"; scope: "turn" | "combat" | "game";
//   measure: "events" | "amount" }
// ResolveContext gains a typed transition-receipt reader for an exact old ref.
```
