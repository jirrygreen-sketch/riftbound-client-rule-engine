# Facedown Zone plans

This internal module implements immutable transition plans for CR v1.5 107.3,
128.4, 422, 811. It does not mutate a ResolveContext, execute a chain, or submit
a protocol command. Apply a plan only inside the authoritative executor's
transaction, together with source-zone removal, payment, reveal, event delivery
and the Pending handoff. Recheck the current source, battlefield and timing
before applying a saved plan.

`planHide` accepts Hand and Champion sources, checks Hidden permission (including
the keyword's expanded `cost.hidden` static ability), turn/Priority, control and
capacity, and allocates the next zone-entry identity. `prepareHide` additionally
uses `cost/kinds/hidden` and `prepareCostPayment` to lock and assess the universal
one-Power cost without paying it. Hide does not open a chain.

`facedownCapacity` reads the existing normalized restriction query. The named
`facedown-zone-maximum-occupancy` registrations carry signed adjustments to the
default one slot, as authored by Bandle Tree's additional-slot declaration.
Other restrictions are not interpreted as capacity changes. `planFacedownCleanup`
requires a controller-selected exact overflow subset and plans public reveals
and owner-Trash entries; control-loss cards leave at Cleanup (323.6.a).

`planHiddenPlay` grants Reaction from the next global turn onward, checks the
existing Reaction timing table, preserves the originating battlefield for Units
and Gear, and plans a revealed Pending identity. Target options must contain
the complete set allowed by each target's explicit printed restrictions.
The local restriction applies separately to each target (811.1.d.2–4); an
empty local board never permits an off-battlefield target. Explicit printed
exceptions such as Tideturner's other-location target remain blocked until
the target contract can prove them. `buildFacedownPlayCost` delegates to the existing
Hidden cost kind using the actual Pending source context, preserving additional
fees and absent printed values. The Chain owner must still perform TargetPlan
selection and resolution revalidation. Play-effect targeting and any resulting
unit play retain the battlefield obligation (811.1.d.3/.5).

`facedownProjectionObjects` supplies the existing projection v2 input shape.
The parent also lists those entries in each controller's `players[].facedown`,
as required by projection v2's zone membership contract.
Its output contains authoritative private data; only `projectFor` output may
cross the privacy boundary. `projectFacedownZone` additionally removes the
projector's public opaque references so a noncontroller receives only a count.
Under 128.4, a facedown card's controller can see its face, even if its owner is
different. A facedown entry's stored front is not a live characteristic snapshot
and must not be queried as a card with Hidden (811.5.a).

## Contract integration requests

1. `effects/contract.ts` lacks Champion and Facedown ZoneIds, a Hide action,
   an associated battlefield on that action, and a Hidden-origin field on Play.
   The canonical physical-zone model also lacks Facedown. Extend these through
   the contract owner. Champion planning is supported here, but `prepareHide`
   cannot obtain a Champion source through today's ResolveContext.
2. Expose the authoritative atomic rules-task boundary covering cost payment,
   source-zone removal, facedown insertion/reveal, identity allocation and
   ChainEngine Pending insertion. A hide cost receipt alone does not prove a
   completed Hide. The reference kernel's `pay` still ignores Power; tests here
   check the real prepared allocation and receipt, not fictitious deduction.
3. Preserve Hidden origin and next-turn Reaction through Pending/Finalize,
   permanent play effects, TargetPlan resolution and effect-produced unit plays.
   Support an explicit target restriction exception, rather than treating an
   empty local board as evidence that the printed restriction forbids it.
   Until that interface exists, cross-battlefield target exceptions require
   explicit upstream verification and are rejected here; this module cannot
   infer card text.
4. Add this module to parent-owned package exports and wire Cleanup/commands.
   No shared export, contract, default profile or historical replay was changed.

Beneficiaries include Bandle Tree and Hidden cards such as Fight or Flight,
Hidden Blade, Blastcone Fae and Zhonya's Hourglass. Their full card
programs retain their existing judge-required status until all integration and
other ability dependencies are verified.
