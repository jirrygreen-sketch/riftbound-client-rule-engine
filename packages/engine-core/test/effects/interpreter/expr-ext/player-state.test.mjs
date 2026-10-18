import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExtendedExpression, resolvePlayerSelector } from "../../../../dist/effects/interpreter/expr-ext/index.js";
import { MissingInformation } from "../../../../dist/effects/interpreter/values.js";
import { world } from "../../../../dist/effects/testing/index.js";
import { environment, property } from "./helpers.mjs";

function setup() {
  return world().player("A", { score: 3, xp: 2, energy: 5 }).player("B", { score: 7 })
    .unit("source", { owner: "B", controller: "A" }).unit("other", { owner: "B" })
    .hand("hand").deck(["top", "second"]).card("trash", { zone: "trash" }).rune(["r1", "r2", "r3"])
    .hand("enemy-hand", { owner: "B" }).deck("enemy-deck", { owner: "B" }).build();
}

for (const [name, expected] of [
  ["points", 3], ["score", 3], ["xp", 2], ["energy", 5], ["handSize", 1], ["handCount", 1],
  ["deckSize", 2], ["deckCount", 2], ["runeDeckSize", 3], ["runeDeckCount", 3], ["trashSize", 1], ["trashCount", 1]
]) {
  test(`reads ${name} through ResolveContext without writing state`, () => {
    const kernel = setup();
    const before = kernel.snapshot();
    assert.equal(evaluateExtendedExpression(property(name), environment(kernel)), expected);
    assert.deepEqual(kernel.snapshot(), before);
  });
}

test("points follows the selected current controller, keeping owner distinct", () => {
  const kernel = setup();
  const context = kernel.clone({ source: kernel.ref("source"), sourceSnapshot: kernel.getObject("source") });
  const env = environment(context);
  const currentController = property("points", { controllerOf: "self" });
  assert.equal(evaluateExtendedExpression(currentController, env), 3);
  assert.equal(evaluateExtendedExpression(property("points", { ownerOf: "self" }), env), 7);
  assert.equal(context.perform({ type: "take-control", object: context.ref("source"), player: "B" }).status, "done");
  assert.equal(evaluateExtendedExpression(currentController, env), 7);
  assert.equal(evaluateExtendedExpression(property("points"), env), 3);
});

test("zone counts recompute after draw, discard, mill, recycle, and channel actions", () => {
  const kernel = setup();
  const env = environment(kernel);
  const counts = () => ["handCount", "deckCount", "trashCount", "runeDeckCount"].map(name => evaluateExtendedExpression(property(name), env));
  assert.deepEqual(counts(), [1, 2, 1, 3]);
  assert.equal(kernel.perform({ type: "draw", player: "A", amount: 1 }).status, "done");
  assert.deepEqual(counts(), [2, 1, 1, 3]);
  assert.equal(kernel.perform({ type: "discard", object: kernel.ref("hand") }).status, "done");
  assert.deepEqual(counts(), [1, 1, 2, 3]);
  assert.equal(kernel.perform({ type: "mill", player: "A", amount: 1 }).status, "done");
  assert.deepEqual(counts(), [1, 0, 3, 3]);
  assert.equal(kernel.perform({ type: "recycle", object: kernel.ref("trash") }).status, "done");
  assert.deepEqual(counts(), [1, 1, 2, 3]);
  assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: 1 }).status, "done");
  assert.deepEqual(counts(), [1, 1, 2, 2]);
});

test("player selectors resolve explicit players, picks, targets, and linked objects", () => {
  const kernel = setup();
  kernel.setPicks("player", ["B"]);
  kernel.setTargets("unit", [kernel.ref("other")]);
  kernel.link("prior", { object: kernel.ref("other") });
  for (const selector of [{ id: "B" }, { pick: "player" }, { controllerOf: { target: "unit" } }, { ownerOf: { linked: "prior" } }]) {
    assert.equal(evaluateExtendedExpression(property("points", selector), environment(kernel)), 7);
  }
});

test("empty zones and zero points remain zero", () => {
  const kernel = world().player("A").build();
  for (const name of ["points", "handCount", "deckCount", "trashCount", "runeDeckCount"]) {
    assert.equal(evaluateExtendedExpression(property(name), environment(kernel)), 0);
  }
});

test("arithmetic mixes player facts, object counts, prior links, and live actions", () => {
  const kernel = setup();
  kernel.link("prior.amount", 2);
  const expr = { kind: "arithmetic", operator: "add", operands: [
    property("points"), { kind: "count", subject: "objects", filter: { zone: "hand", owner: "A" } },
    { kind: "linked-value", instructionId: "prior", key: "amount" }
  ] };
  assert.equal(evaluateExtendedExpression(expr, environment(kernel)), 6);
  assert.equal(kernel.perform({ type: "score", player: "A", amount: 1 }).status, "done");
  assert.equal(evaluateExtendedExpression(expr, environment(kernel)), 7);
});

test("new arithmetic leaves preserve null printed costs", () => {
  const kernel = world().unit("source", { energy: null, power: null }).build();
  const env = environment(kernel);
  for (const name of ["energy", "power"]) {
    const expr = { kind: "object-property", object: "source", property: name };
    assert.equal(evaluateExtendedExpression(expr, env), null);
    assert.throws(() => evaluateExtendedExpression({ kind: "arithmetic", operator: "add", operands: [property("points"), expr] }, env), MissingInformation);
  }
});

test("stale, ignored, ambiguous, or non-player selections fail closed", () => {
  const kernel = setup();
  const env = environment(kernel);
  kernel.setPicks("empty", []);
  kernel.setPicks("mode", ["draw"]);
  kernel.setPicks("two", ["A", "B"]);
  kernel.setPicks("object", [kernel.ref("source")]);
  for (const pick of ["empty", "mode", "two", "object"]) {
    assert.throws(() => evaluateExtendedExpression(property("points", { pick }), env));
  }
  kernel.setTargets("unit", [kernel.ref("other")]);
  assert.throws(() => evaluateExtendedExpression(property("points", { controllerOf: { target: "unit" } }), environment(kernel, { isIgnored: () => true })), MissingInformation);
  assert.equal(kernel.perform({ type: "kill", object: kernel.ref("other") }).status, "done");
  assert.throws(() => evaluateExtendedExpression(property("points", { controllerOf: { target: "unit" } }), env), MissingInformation);
  kernel.setTargets("many", [kernel.ref("source"), kernel.ref("other")]);
  assert.throws(() => evaluateExtendedExpression(property("points", { ownerOf: { target: "many" } }), env), MissingInformation);
});

test("malformed selectors, unknown players and unavailable player facts do not produce zero", () => {
  const env = environment(setup());
  for (const selector of [null, "opponent", {}, { id: "" }, { id: "A", pick: "p" }, { unknown: "A" }]) {
    assert.throws(() => resolvePlayerSelector(selector, env));
  }
  assert.throws(() => evaluateExtendedExpression(property("points", { id: "missing" }), env));
  assert.throws(() => evaluateExtendedExpression(property("constructor"), env), MissingInformation);
});
