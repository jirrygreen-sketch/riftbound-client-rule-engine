# Ordered non-target pick bindings

`ChainEngine` captures explicit `zoneSlice` sources during Finalize and keeps
their ordered `ObjectRef { id, zoneEntryId }` list on the internal chain item.
This reads references only: it does not look, reveal, ask the player to choose,
emit `became-target`, or pay target taxes. `ResolveContext.zoneSlice` is the
ordering authority; a set query is never used to reconstruct a deck.

```ts
// On the inspect/reveal instruction: a complete source binding, not a subset choice.
{
  id: "viewed", options: [], ordered: true, selection: "all",
  zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 5 } }
}
// On a later primitive: its pick API consumes the actual inspect choice.
{
  id: "kept", options: [], ordered: true, selection: "all",
  linked: { kind: "linked-value", instructionId: "look", key: "inspected-pick" }
}
// Predict: retain the viewed order, subtracting the actual recycled identities.
{
  id: "rest", options: [], ordered: true, selection: "all",
  linked: { kind: "linked-value", instructionId: "look", key: "inspected-picked" },
  exclude: { kind: "linked-value", instructionId: "recycle", key: "recycled" }
}
```

`zoneSlice.player` is an optional Expr; omission means the ability controller.
`count` is an optional Expr evaluated once during Finalize; omission reads the
whole zone. `from: "bottom"` preserves the slice's top-to-bottom relative order.
Zero and short slices follow the existing zoneSlice contract. Runtime linked
values/selections cannot supply Finalize parameters. Static `options` keep
their old meaning; descriptive strings such as `dynamic:top-3...` are never
parsed as executable behavior.

Use `effect.inspect`'s `choose/chooseCount` for a private subset decision during
Resolve, and `choice.order` or `effect.order` for the player's permutation.
The link bridge uses the interpreter's current instruction scope, including
its handling of missing information. An optional internal interpreter hook
supplies the same binding to ObjectSelector, conditions, and primitives.
It accepts explicit object-list keys,
preserves reference order, and performs exclusions by the complete identity.
It does not reconstruct missing results from another chain item's aliases.
Order responses must be complete permutations of the offered live references.

Shuffles and `order-top` do not change an already captured list. Newly inserted
cards do not fill vacated slots. Departed references, including cards that
leave and return, retain their old incarnation and cannot be rebound by id
(CR v1.5 124). They are passed unchanged to the existing primitives, whose
`object(ref)` checks and actual action receipts determine partial execution,
negation, and linked results (055, 359.3.e.6/.11–14, 432.1.c/.c.1). The bridge
does not classify non-targets as targets or revive them using last-known data.
Predict's private choice, actual Recycle receipt, and ordering of the remaining
cards follow 437.1.a/437.4. Neither the primitives nor the old profiles/replays
are changed.

Finalize/payment failures and `AwaitChoice` during Resolve use the existing
whole-chain transaction. Locked references, payments, events, earlier actions,
links, and the final pass roll back together.

## Boundaries and follow-up contracts

- The extension is opt-in. Cards and keyword expanders using descriptive old
  pick options still need migration in their own workstreams. Their status
  stays `judge-required`; this infrastructure does not make those cards fully
  executable or alter ordinary card text's timing.
- A zoneSlice declared inside `repeat` is explicitly blocked. Fresh captures
  for paid Repeat instances need an iteration-specific source lifecycle from
  the chain/interpreter owners; reusing one capture as if it were freshly read
  would invent behavior. Linked sources inside a resolving repeat use that
  repeat's own result scope.
- Reveal-until, per-player loops, characteristic filtering of a linked set,
  and dynamic play cost/permission plans remain their respective owners'
  tasks. The linked exclusion field supplies stable identity subtraction only.
- Internal plans contain secret identities and must not be copied into a
  public projection. Shared package exports and product integration remain
  parent-owned.

## Cards whose judgeReason names the ordered source gap

The 2026-10-17 scan searched existing `judgeReason` values for ordered/zoneSlice
and inspect/reveal/pick/top references, then reviewed the matched reasons.
The following 44 cards can use the explicit source/link bindings after their
card or keyword workstream migrates them. Other blockers in their reasons
remain in effect; this is a dependency benefit list, not an executable list.

| Set | Cards (source file stems) |
| --- | --- |
| OGN | blind-fury, jeweled-colossus, karma-channeler, mystic-poro, promising-future, reinforce, sai-scout, stacked-deck, teemo-strategist, the-candlelit-sanctum, twisted-fate-gambler |
| RAD | command-attack, consult-the-heavens, drakehound-packmaster, encore, mechanical-bandit, mysterious-chronomancer, scrutinizing-scope, trifarian-captain |
| SFD | apprentice-smith, called-shot, ornn-blacksmith, ravenbloom-conservatory, reksai-swarm-queen, void-burrower, void-hatchling, void-rush |
| UNL | diana-lunari, divining-shells, double-trouble, dramatic-visionary, eclipse, fate-weaver, forgotten-library, ivern-nurturer, jhin-meticulous-killer, rift-herald, scryers-bloom |
| VEN | apprentice-mage, clairvoyance, lightning-rush, pakaa-protector, swain-visionary, wild-claw |

The broad scan also matched `ogn/dazzling-aurora` (needs reveal-until and a stop
predicate), `ogn/whirlwind` (per-player order), `rad/akali-brash` (move ordinal),
and `rad/runeblade-anvil` (already reads the deck top for banish). These are not
counted among the 44 source-binding beneficiaries.
