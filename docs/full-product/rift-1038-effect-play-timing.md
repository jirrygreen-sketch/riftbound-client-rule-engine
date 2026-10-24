# RIFT-1038: Effect-Played Card and Token Chain Timing

Research date: 2026-10-24 UTC. Worktree branch:
`task/RIFT-1038-eg-effect-play-chain-item-timing`. The target is Core Rules
v1.5, published 2026-10-09 and effective 2026-10-16:

- https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
- Local extracted text: `/root/swarm-rift/shared/rules/CR-v1.5.txt`, SHA-256
  `bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2`.
- Radiance rulings, effective 2026-10-16:
  https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
  Local snapshot SHA-256
  `dfba4f3ecf6956c32c19327330eaca96d317bedbf2c211c80a8fe1f1dccb569f`.
  The later Core Rules text controls any conflict, per the article itself.
- The cached Spiritforged errata snapshot (SHA-256
  `dca55c2d013473ffca82fb649a70d16d4b4356c22f74bd5a71b3aa3a9a4c94af`)
  names neither `SFD-019/221` nor `SFD-070/221`; it changes neither card.

The card texts used below come from the local ignored
`packages/card-data/data/deck-catalog.json` observation:

- Assembly Rig, `sfd-019-221`, canonical
  `card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569`:
  `:rb_energy_1::rb_rune_fury:, Recycle a unit from your trash, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base.`
- Wages of Pain, `sfd-070-221`, canonical
  `card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c`:
  `[Hidden] ... [Action] ... Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted.`

## Rule conclusion

A card or token that an effect instructs a player to Play becomes its own
Pending Chain item. While the creating effect is resolving, its remaining Play
steps wait until that parent Resolve finishes. The exact conclusion follows:

1. CR 354.1-354.2 (`CR-v1.5.txt:1613-1616`) moves the Played object to the
   Chain and makes that item Pending. CR 329-329.3
   (`CR-v1.5.txt:1465-1472`) applies the same Pending-to-Finalized lifecycle to
   cards, tokens, and abilities.
2. CR 420.3.a-b (`CR-v1.5.txt:3168-3174`) makes an effect-instructed Play a
   Limited Action using the normal Play steps. CR 350.1-350.2
   (`CR-v1.5.txt:1601-1605`) confirms that a token is Played by following those
   steps. CR 185.2.a (`CR-v1.5.txt:945-949`) applies card-Play procedure and
   the creating effect's modifications to a token.
3. CR 354.3 (`CR-v1.5.txt:1618-1619`) says that if another card effect or
   ability is currently resolving, finish that Resolve before proceeding with
   any further steps of the Play. This is why the newly Pending item does not
   Finalize inside its parent's Resolve.
4. After the parent finishes, CR 337.1 and 337.1.b
   (`CR-v1.5.txt:1511-1515`) finalize the oldest Pending item. Finalizing does
   not itself pass Priority (337.1.a).
5. A Unit or Gear resolves immediately after Finalize under CR 337.2
   (`CR-v1.5.txt:1516-1518`); it does not receive an intervening Priority pass.
   An Ability that Adds resources is also immediate under CR 401.2
   (`CR-v1.5.txt:2913-2915`).
6. A spell remains a Finalized item and other players may Play Reactions under
   CR 359.3.b-c (`CR-v1.5.txt:2012-2017`). An ordinary ability similarly reaches
   the Reaction/Resolve sequence under CR 407.3-4
   (`CR-v1.5.txt:2962-2968`). CR 337.4 and 338-340
   (`CR-v1.5.txt:1520-1557`) provide the Priority/Pass cycle; Priority comes
   from the next appropriate Chain item rather than from Finalize itself.
7. The official Radiance Chronobreak answer gives an example with Pending items
   finalized oldest-to-newest, Units resolving immediately, and their Play
   effects finalizing in order. It applies CR 303.2.a to the distinct case in
   which actions would begin simultaneously. A single `Play a token` instruction
   creates one item at a time, so CR 303.2.a
   (`CR-v1.5.txt:1233-1236`) does not choose an order here and must not be read
   as a universal FIFO/LIFO rule. The normal FEPR sequence controls this case.

Thus the required timelines are:

```text
parent Pending -> parent Finalize -> parent Resolve starts
  -> child token Pending (created on Chain)
  -> parent Resolve completes / parent is removed
  -> child Finalize
  -> child Unit/Gear Resolve immediately                  (337.2)
```

or, for a spell or ordinary ability:

```text
parent Pending -> parent Finalize -> parent Resolve starts
  -> child Pending -> parent Resolve completes
  -> child Finalize -> Priority / Reaction window -> child Resolve
```

No separate ruling is needed for these two cases. `assemblyRig` remains
`judge-required` only because the card owner has not yet independently reviewed
and accepted its executable status after this engine repair. No unknown behavior
is being inferred.

## Two applicable interactions

### Assembly Rig: activated ability plays a Mech Unit token

The activation is Pending, Finalizes by selecting and paying one recycled Trash
unit, one Energy, one Fury Power, and exhausting the Rig, then reaches its
ordinary response window. Its Resolve evaluates `effect.token` with `mode:
"play"`. The token primitive creates the 187.4 Mech on the Chain and performs
the real Play action. The resulting Play is a second Pending item:

```text
activation Pending/Finalize
activation Resolve -> Mech enters Chain + token-Play Pending
activation Resolve ends
Mech token Finalize -> Unit Resolve immediately -> enters Base exhausted
```

There is no Priority pass between the Mech's own Finalize and Resolve. Its
printed Energy and Power remain absent (`null`), while the Play cost is the
rule-level zero for tokens (CR 185.3.a.1, `CR-v1.5.txt:961-964`). The token is a
new object created on the Chain, so this interaction has no prior-zone LKI;
location and entry state come from the creating effect (184.1/184.2).

### Wages of Pain: spell plays an exhausted Gold Gear token

Wages is Pending and Finalizes its battlefield-Unit target. During Resolve it
deals damage, then creates Gold on the Chain and performs the real Play. Gold is
its own Pending item while Wages still Resolves. When Wages finishes, Gold
Finalizes and then, because it is Gear, resolves immediately under 337.2. The
spell's earlier Priority/Reaction window already occurred before the parent
Resolve; it is not reused as a window after Gold's finalization. Gold enters
the controller's Base exhausted because the creating effect stipulated that
entry state (184.1 / 185.2.d).

## Implementation boundary

`ChainEngine` already appends a registered-program Play through
`routeAction`. The missing path was the lifecycle fallback in
`packages/engine-core/src/programs/lifecycle.ts:501-510`: a token with no
registered CardProgram was delegated directly to the host while a parent was
Resolving. That host action moved the token from Chain to Board synchronously.

The engine-only repair is in `packages/engine-core/src/chain/engine.ts`:

- Count only the actual instruction-body Resolve frame.
- While that parent frame is active, `advance()` does not reenter FEPR.
- If lifecycle delegates an exact Chain token with no registered program to the
  host, append its ordinary zero/token Play as a Pending `ChainDraft` instead.
  The Play is derived from the authoritative token incarnation and the normal
  Play destination; it is not a hand-written Board move.
- After the parent Resolve frame returns, the unchanged FEPR loop Finalizes the
  oldest Pending token. Unit/Gear still follow the existing immediate Resolve;
  spells and ordinary abilities keep the existing Priority path.

Registered token programs (including Gold) continue through their normal
`describePlay` path. A token program that exists but cannot produce a valid
draft still fails closed instead of being replaced with this no-program
fallback. Top-level Unit and Gear Plays still bypass the parent-Resolve
suspension.

## Production regression

`packages/engine-core/test/engine-gaps/m1-effect-play-chain-timing.test.mjs`
uses `createProgramBinding`, `ChainEngine`, the real lifecycle attachment, the
actual token primitive/interpreter, event pipeline, and ordinary Priority
passes. It verifies:

- Assembly Rig's original activated ability and token IR: parent Finalize ->
  parent Resolve -> child Pending -> parent resolved -> child Finalize -> child
  Unit Resolve; the final Mech is 3 Might, tagged Mech, exhausted at Base, with
  null printed costs.
- Wages of Pain's original play body: parent Resolve damages the target and
  creates Pending Gold; after parent completion, Gold Finalizes and resolves as
  exhausted Gear at Base.
- Event ordering `chain-item-pending`, `chain-item-finalize`, and
  `chain-item-resolve` for both parent and child, rather than trace-only
  bookkeeping.

Existing RIFT-1005/RIFT-1007 tests continue to cover Gold's entered-exhausted
stipulation and Hidden destination behavior. Existing chain tests continue to
cover top-level Unit/Gear immediate resolution and spell Priority passes.

The final package-card suite comparison used a clean archive of HEAD
`8c0245df`, a normal frozen-lockfile install, and the same `heavy
pnpm --filter @riftbound/card-dsl test` command (all `not ok` lines include
TODO-marked expected failures). The logs contain 565 baseline and 567 current
`not ok` lines. Title-set comparison found no new title other than these two
obsolete Assembly Rig assertions:

- `test/cards/sfd/assembly-rig.test.mjs:442-449` asserts that Board entry
  precedes the parent Resolve and that no independent Pending item exists.
- `assembly-rig.test.mjs:458-463` asserts that no token Finalize or Resolve
  exists.

Both expectations encoded the repaired defect. This task's replacement
regression asserts the corrected rule order. The card-dsl files are outside
this write scope, so they remain for their owning task instead of being edited
here.

## Non-goals and review notes

- This task does not change card status. `assembly-rig.ts` stays
  `judge-required`; the parent card owner must independently review and relabel
  it after this engine fix.
- It does not invent simultaneous ordering. That remains the existing
  CR 303.2.a/turn-order and trigger-order paths.
- It does not change replay versions, profiles, or historical logs.
- It does not add completion claims for unsupported official cards.
