# Primitive tests

Primitive tests use the deterministic reference kernel instead of the production
rules engine. Build a two-player world, define only the objects the primitive
needs, and call `runInstruction`; the kernel owns zones, references, actions,
replacement hooks, and choice replay.

A complete `effect.draw` example:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { InstructionDef, PlayerId } from "../contract.js";
import { runInstruction, world } from "./index.js";

const draw: InstructionDef<{ player: PlayerId; amount: number }> = {
  op: "effect.draw",
  argsSchema: { parse: value => value as { player: PlayerId; amount: number } },
  execute(ctx, args) {
    const outcome = ctx.perform({ type: "draw", player: args.player, amount: args.amount });
    if (outcome.status !== "done") {
      return { status: "negated", reason: outcome.status === "replaced" ? "replaced" : "impossible", events: [...outcome.events] };
    }
    ctx.link("drawn", outcome.result ?? 0);
    return { status: "executed", events: [...outcome.events], linkedValues: { drawn: outcome.result ?? 0 } };
  }
};

test("draw resolves through the reference kernel", () => {
  const testWorld = world().deck("top").deck("second").build();
  const run = runInstruction(draw, { player: "A", amount: 1 }, { world: testWorld });
  assert.equal(run.result?.status, "executed");
  assert.equal(testWorld.player("A").handSize, 1);
});
```

Use an answer map for `choose`. Without an answer, `runInstruction` returns
`asked` and leaves the supplied world untouched; passing that answer replays the
whole primitive transaction.

Read the top N cards with `ctx.zoneSlice(player, "deck", "top", N)`, never
`query`: **读牌库顶 N 张必须用 zoneSlice，不要用 query**. `query` is a set query
and does not guarantee zone order. Use `"bottom"` for the last N cards; the
selected cards retain their relative top-to-bottom order (not reversed). Omit N
to read the whole zone; zero returns none, and an oversized count returns all
available cards. Counts must be nonnegative safe integers. Other zones such as
Hand and Trash retain entry order. Returned snapshots do not mutate the world.
For an explicit deck order, use
`world().deck(["top", "middle", "bottom"], { owner: "A" }).build()`; an array
adds that ordered block above existing cards. The existing single-card
`.deck("id")` form still stacks each new card on top. `.rune(["top", "bottom"])`
uses the same convention for a Rune Deck.

打出 token = `create-token(to: chain)` + `play`. The creation result is the new
`ObjectRef`. Chain creation leaves a Pending item available through
`world.pendingItems`; `play` consumes it, applies any supplied finalized cost,
and places the token at the requested location (default: the playing player's
Base). Board creation uses `to: "board"` and a location; omitting `to` preserves
the existing Board creation form. This test kernel models the handoff without
advancing production priority or Finalize steps. Pending items and generated
identities participate in choice rollback.

Successful `reveal`, `look`, and `show-off` actions return the actual displayed
or viewed `ObjectRef[]` in zone order. `look` drops stale references and
duplicates; if none remain, the action is impossible. For requests spanning
zones, each zone preserves its order; groups follow player creation order and
the kernel's zone order. These actions leave objects in their existing zones.

For P0 contract 3.8, set a combat designation with
`world().unit("unit", { combatRole: "attacker" }).build()` (or `"defender"`).
The default is `null`. A new zone entry clears the designation; last-known
snapshots retain it. This reference kernel does not advance combat or turns.

`history({ action: "play", player: "A", exclude: "self", objectFilter: { type: "unit" } })`
counts committed actions on other cards. `"self"` and `"source"` bind to
`ctx.source`; `{ target: id }`, `{ pick: id }` and `{ linked: key }` use the
corresponding context bindings (linked values may be one ref or an array).
Exclusions compare physical object ids across zone entries, so a separate copy
of the same printing is still counted. The existing `object` query remains an
exact `ObjectRef` match, including its zone entry id.

`objectFilter` reads the action object's snapshot **before** the action, so
later moves or control changes cannot change past counts. It shares `query`'s
type/tag membership and exact snapshot-property filters. Actions without an
`object` ref do not match an object filter. Prevented actions and suspended
transactions do not enter committed history. The interpreter's instruction
context already delegates `history` unchanged; its query parser now accepts
and forwards `exclude` and `objectFilter`.

ResolveContext implementation audit for this addition:

| Implementation / adapter | Compatibility |
| --- | --- |
| `effects/testing/test-kernel.ts`: `TestWorld` | Defaults combatRole and implements both history fields. |
| `effects/interpreter.ts`: `instructionContext` | Forwards snapshots and the whole history query; covered by the v1.1 regression. |
| `test/target/target-plan.test.mjs`: local `world` mock | Existing snapshots and history stub remain valid because the additions are optional. No edits needed. |
| `test/effects/interpreter/expression.test.mjs` and `test/effects/contract-v11.test.mjs`: history-observing proxies | Bind all other methods to TestWorld and forward history queries unchanged. |

The remaining ResolveContext references are consumers or types, including
`runInstruction`, which clones TestWorld rather than constructing a new adapter.

The compile-only compatibility fixture can be checked from the repository root:

```sh
pnpm --filter @riftbound/engine-core exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler test/effects/contract-v11.types.ts
```
