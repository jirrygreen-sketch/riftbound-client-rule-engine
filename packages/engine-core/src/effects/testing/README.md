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
