import test from "node:test";
import assert from "node:assert/strict";
import { fixture, trigger } from "../chain/helpers.mjs";
import { bindReplacement } from "../../dist/replacement/index.js";

const constant = value => ({ kind: "constant", value });
const deps = f => ({
  host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: () => f.kernel },
  pipeline: f.engine.pipeline
});

test("as-it-enters counter replacement adds the counter to the entering unit", () => {
  const f = fixture({ cards: [{ id: "banner", types: ["unit"] }] });
  trigger(f, "entered", { source: f.kernel.getObject("banner"), spec: { filter: { objectId: "banner" } } });
  bindReplacement(
    {
      replaces: {},
      with: [{
        id: "ev",
        op: "replacement.event",
        args: {
          event: constant({ event: "object-enters-board", filter: { self: true } }),
          instead: [{ id: "mark", op: "effect.counter", args: { target: { kind: "constant", value: { kind: "source" } }, counter: constant("fervor"), amount: constant(2) } }]
        }
      }]
    },
    f.kernel.ref("banner"),
    deps(f)
  );
  f.engine.execute(f.card("banner", { kind: "unit", body: [] }));
  const entered = f.kernel.getObject("banner");
  assert.equal(entered.zone, "board");
  const counters = f.kernel.stateForTest().objects.find(object => object.ref.id === "banner").counters;
  assert.deepEqual(counters, [["fervor", 2]]);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-exhausted"), false);
});

test("damage replacement anchors to the affected player for the chooser", () => {
  const choices = [];
  const f = fixture({ choose: request => { if (request.type === "mode") { choices.push(request.chooser); return "prevent"; } } });
  // Bind damage-to-player replacement on the enemy player's behalf (host is
  // the shared source base; the pattern anchors damage by affected player).
  bindReplacement(
    {
      replaces: {},
      with: [{
        id: "ev",
        op: "replacement.event",
        args: {
          event: constant({ event: "damage", player: "opponent" }),
          instead: []
        }
      }]
    },
    f.kernel.ref("source"),
    deps(f)
  );
  const outcome = f.engine.commit({ type: "damage", source: f.kernel.ref("source"), target: f.kernel.ref("enemy"), amount: 2, combat: false });
  assert.equal(outcome.status, "prevented");
  assert.equal(f.kernel.getObject("enemy").damage, 0);
});
