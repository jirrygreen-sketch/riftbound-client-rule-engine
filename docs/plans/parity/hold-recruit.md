# Hold → Recruit parity (server batch E)

This note is the retirement record for `apps/game-server/src/duel/hold-recruit-executor-v1.ts`.
The old service has one reviewed printing, `ogn-275-298` (Altar to Unity), whose
printed ability is:

> When you hold here, play a 1 :rb_might: Recruit unit token in your base.

The old executor is deliberately narrow. It accepts a source only when the
source is the current-turn player's controlled Battlefield, the card program is
the exact Altar program, and production source inspection returns the same
source and zone epoch. It then creates a pending Recruit stage, requires an
exact entry proof, and publishes the stage only after the native journal observes
the one Recruit birth commit. A later token-decision query is accepted only for
that journal birth, its exact program reference, and the current object/binding.

## Existing service scenarios

The three scenarios below are the complete observable surface covered by the
old tests in `apps/game-server/tests/duel/hold-recruit-executor-v1.test.ts`.

| Scenario | Command sequence | Old observable result |
| --- | --- | --- |
| Pending without entry proof | Load the two real 56-card decks; resolve both mulligans; open Alice's Main Phase; make `ogn-275-298` controlled and uncontested; inspect Hold; call `resolveNativeHandlers` without `resolveRecruitEntry`. | Source inspection is pending; the resolver returns `pending`; no unit is added; the audit contains no settled entry. |
| Typed entry proof and token decision | Repeat setup; bind the Hold context; provide an exact proof containing match/version/event/source/token/base and `costs: "none"`; call `resolveNativeHandlers`; journal the one Recruit birth; query the Recruit with the exact birth reference. | Resolver returns `applied`; exactly one domainless 1-Might Recruit token is created in Alice's base with `energy: null`, `power: null`, no printed card id, and `tags: ["Recruit"]`; the bound token decision returns `resolved`/`inactive`; a foreign program reference returns `null`. |
| Staged retry after poisoned adoption | Repeat the typed-proof setup; call `resolveNativeHandlers` twice before the outer journal adoption; then publish the first staged descendant and query the birth. | Both calls return `applied` with the same descendant; `uidFactory` runs once; the audit remains pending until adoption; after the journal observes the birth, the audit settles exactly once. |

The first and third scenarios also prove the service's failure and retry
boundaries: no proof means no Recruit birth, and an unchanged journal/source
census makes an unpublished stage retryable without allocating a second token.

## New-kernel result

`apps/game-server/tests/parity/hold-recruit/hold-recruit-parity.test.ts` builds a
real `core-1.5` `createMatch` over the engine's action host and attaches the
engine `createProgramBinding` to its `ChainEngine`. The actual Altar card program
is inspected through that binding. It is currently `judge-required`, so the
registry correctly refuses to bind it before any Hold command can be replayed.
The three old command sequences are therefore retained as explicit `test.todo`
parity cases rather than being approximated with a seat-specific base or a fake
entry callback.

The blocking program is
`packages/card-dsl/src/cards/ogn/altar-to-unity.ts`. Its Hold trigger and Recruit
shape are present, but its `effect.token` location is the placeholder
`{ type: "base", player: "controller" }`. The generic token primitive currently
accepts only a concrete `PlayerId`; resolving that placeholder requires a
controller-relative `LocationRef` contract/primitive. Hard-coding Alice or Bob
would change the printed behavior and is prohibited.

## Rules basis

- CR v1.5 **383.4.d**, **383.4.d.1**, and **383.4.d.2.b** define a Hold Effect and
  put abilities that reference the Holding player on the Chain after the Hold.
- CR v1.5 **471.2**, **473.2**, and **473.2.b** define Hold scoring and the
  Battlefield Hold trigger timing.
- CR v1.5 **190.6.a** and **190.6.d** make the controlled Battlefield's
  Controller responsible for its ability and make “you” in that ability mean
  that Controller.
- CR v1.5 **440.2.c** says “play a 1 [M] Recruit token” creates the token on the
  Chain through the Play action.
- CR v1.5 **187.1** defines Recruit as a domainless Unit token with 1 Might and
  the Recruit tag. CR v1.5 **185.3.a** and **185.3.b** establish that tokens have
  no printed costs or domains; the model therefore keeps `energy: null` and
  `power: null` rather than inventing printed zero values.

## Deletion preconditions

The old executor may be deleted only when every item below is demonstrated by
new-kernel tests and the old three scenarios are converted from TODO to passing
parity assertions:

1. `effect.token` (or an equivalent core primitive) resolves the ability
   controller's base from the Hold source, with no hard-coded seat.
2. `Altar to Unity` is `executable`; its Hold registration reaches the new
   EventPipeline at the `hold` timing point and enqueues a normal triggered
   Chain item.
3. The new Play path creates the Recruit on the Chain, moves it to the correct
   controller base, preserves exhausted entry, and retains `energy: null`,
   `power: null`, no physical printing id, domainless state, 1 Might, and the
   Recruit tag.
4. The new journal/replay evidence replaces the old entry-proof callback:
   exact source incarnation, match clock, event identity, token birth, and
   controller-relative destination are all checked by the kernel.
5. The pending stage and poisoned-adoption retry have atomic, idempotent
   behavior: one token UID, one birth commit, one eventual settlement, and no
   duplicate trigger or score event.
6. The parity suite compares event kind/order, zones, score, and costs for all
   three command sequences against the old service; the comparison uses real
   primitive actions and card-program execution, not direct frame/zone/resource
   mutation or fixture callbacks.
7. The focused server suite and downstream integration suite pass after the
   conversion, while the old service tests remain as regression evidence until
   the deletion commit.

Until these conditions hold, the old service remains a required compatibility
boundary and the parity status is **blocked by a declared card-program gap**.
