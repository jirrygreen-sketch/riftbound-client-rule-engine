import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExtendedExpression, resolveLayerEffectExpressions } from "../../../../dist/effects/interpreter/expr-ext/index.js";
import { MissingInformation } from "../../../../dist/effects/interpreter/values.js";
import { LayerEngine } from "../../../../dist/layers/engine.js";
import { world } from "../../../../dist/effects/testing/index.js";
import { environment, property } from "./helpers.mjs";

// Exercise the scoped materialization hook with the real layer engine. The
// default static binder still needs the coordinator's integration (README).
function layeredMight(context, effect, target = "source") {
  const layers = new LayerEngine(context.objects);
  layers.addContinuous({
    id: "dynamic", layer: "arithmetic", source: context.ref("source"), filter: { objectId: target },
    effect: resolveLayerEffectExpressions(effect, environment(context))
  }, { type: "permanent" });
  return layers.snapshot(context.ref(target)).might;
}

test("layer materialization re-reads points after gain and control changes without accumulating Might", () => {
  const kernel = world().player("A", { score: 3 }).player("B", { score: 1 }).unit("source", { might: 3 }).build();
  const effect = { kind: "continuous.might", mode: "add", amount: property("points", { controllerOf: "self" }) };
  const original = structuredClone(effect);
  assert.equal(layeredMight(kernel, effect), 6);
  assert.equal(layeredMight(kernel, effect), 6);
  assert.equal(kernel.perform({ type: "score", player: "A", amount: 2 }).status, "done");
  assert.equal(layeredMight(kernel, effect), 8);
  assert.equal(kernel.perform({ type: "take-control", object: kernel.ref("source"), player: "B" }).status, "done");
  assert.equal(layeredMight(kernel, effect), 4);
  assert.equal(kernel.getObject("source").might, 3);
  assert.deepEqual(effect, original);
});

test("layer materialization re-counts objects after kill and zone re-entry", () => {
  const kernel = world().unit("source", { might: 2 }).unit("ally").build();
  const effect = { kind: "continuous.might", amount: { kind: "count", subject: "objects", filter: { zone: "board", controller: "A" } } };
  assert.equal(layeredMight(kernel, effect), 4);
  assert.equal(kernel.perform({ type: "kill", object: kernel.ref("ally") }).status, "done");
  assert.equal(layeredMight(kernel, effect), 3);
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("ally"), to: "base", player: "A" }).status, "done");
  assert.equal(layeredMight(kernel, effect), 4);
});

test("layer arithmetic re-reads zone counts after draw, discard, and mill", () => {
  const kernel = world().unit("source", { might: 2 }).deck(["first", "second"]).build();
  const effect = { kind: "continuous.might", amount: { kind: "arithmetic", operator: "add", operands: [property("handCount"), property("trashCount")] } };
  assert.equal(layeredMight(kernel, effect), 2);
  assert.equal(kernel.perform({ type: "draw", player: "A", amount: 1 }).status, "done");
  assert.equal(layeredMight(kernel, effect), 3);
  assert.equal(kernel.perform({ type: "discard", object: kernel.ref("first") }).status, "done");
  assert.equal(layeredMight(kernel, effect), 3);
  assert.equal(kernel.perform({ type: "mill", player: "A", amount: 1 }).status, "done");
  assert.equal(layeredMight(kernel, effect), 4);
});

test("the existing value expression slot retains its type and feeds set-Might", () => {
  const kernel = world().player("A", { score: 4 }).unit("source", { might: 2 }).build();
  const effect = { kind: "set-might", value: property("points") };
  const resolved = resolveLayerEffectExpressions(effect, environment(kernel));
  assert.deepEqual(resolved.value, { kind: "constant", value: 4 });
  assert.equal(layeredMight(kernel, effect), 4);
  assert.equal(kernel.perform({ type: "score", player: "A", amount: 1 }).status, "done");
  assert.equal(layeredMight(kernel, effect), 5);
});

test("layer materialization preserves constants as data and never substitutes zero for null costs", () => {
  const kernel = world().unit("source", { energy: null, power: null }).build();
  const env = environment(kernel);
  const literal = { kind: "constant", value: { kind: "player-property", property: "points" } };
  assert.deepEqual(resolveLayerEffectExpressions({ kind: "data", value: literal }, env).value, literal);
  const nullCost = { kind: "object-property", object: "source", property: "energy" };
  assert.equal(resolveLayerEffectExpressions({ kind: "data", amount: nullCost }, env).amount, null);
  assert.throws(() => resolveLayerEffectExpressions({ kind: "continuous.might", amount: {
    kind: "arithmetic", operator: "add", operands: [property("points"), nullCost]
  } }, env), MissingInformation);
});

test("captured linked values stay fixed while uncaptured dynamic expressions change", () => {
  const kernel = world().player("A", { score: 2 }).unit("source").build();
  const env = environment(kernel);
  kernel.link("show.value", evaluateExtendedExpression(property("points"), env));
  assert.equal(kernel.perform({ type: "score", player: "A", amount: 1 }).status, "done");
  const fixed = { kind: "continuous.might", amount: { kind: "linked-value", instructionId: "show", key: "value" } };
  assert.equal(resolveLayerEffectExpressions(fixed, env).amount, 2);
  assert.equal(resolveLayerEffectExpressions({ kind: "continuous.might", amount: property("points") }, env).amount, 3);
});
