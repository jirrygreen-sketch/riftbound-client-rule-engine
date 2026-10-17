import assert from "node:assert/strict";
import test from "node:test";
import { fixture, resolveAll, c, trigger } from "./helpers.mjs";

test("real card-played trigger receives provenance/printed facts and finalized additional-cost decisions", () => {
  const f = fixture({
    energy: 4,
    cards: [{ id: "played", types: ["spell"], energy: 0, power: [] }]
  });
  trigger(f, "watch", {
    spec: {
      at: "card-played",
      filter: {},
      condition: {
        kind: "all",
        conditions: [
          { kind: "played-from-hand", object: "object" },
          { kind: "event-printed", object: "object", characteristic: "power", operator: "gte", right: c(0) }
        ]
      }
    },
    cost: {
      id: "watch-cost",
      cost: { energy: c(0), power: c([]) },
      optionalAdditional: [{ id: "boost", kind: "additional", cost: { energy: c(1) }, selected: true }]
    },
    body: [{
      id: "draw-after-payment",
      op: "effect.draw",
      args: { amount: c(1) },
      condition: { kind: "result", result: "cost.additional", id: "boost" }
    }]
  });

  f.engine.execute(f.card("played", {
    body: [],
    cost: { id: "played-cost", cost: { energy: c(0), power: c([]) } }
  }));
  resolveAll(f.engine);

  assert.equal(f.kernel.events.filter(event => event.action === "draw").length, 1);
  assert.equal(f.kernel.player("A").deckCount, 3);
});
