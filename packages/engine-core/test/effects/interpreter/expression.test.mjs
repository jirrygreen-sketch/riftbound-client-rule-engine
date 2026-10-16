import assert from "node:assert/strict";
import test from "node:test";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { world } from "../../../dist/effects/testing/index.js";
import { constant, compare, gain, instruction, linked, property, registry, resultFor, transaction, value } from "./helpers.mjs";

function evaluate(expression, kernel = world().build()) {
  return runAbilityBody([value("read", expression)], kernel, registry).linkedValues["read.value"];
}

for (const literal of [null, false, true, 0, -2, 4.5, "X", [1, null], { energy: null, power: null }]) {
  test(`constant values preserve ${JSON.stringify(literal)}`, () => assert.deepEqual(evaluate(constant(literal)), literal));
}

test("literal alias evaluates without numeric coercion", () => assert.equal(evaluate({ kind: "literal", value: "3" }), "3"));

test("object property reads current characteristics after an earlier game action", () => {
  const kernel = world().unit("unit", { damage: 0 }).build();
  kernel.setTargets("unit", [kernel.ref("unit")]);
  const outcome = runAbilityBody([
    instruction("damage", "test.damage", { amount: constant(3) }), value("read", property(kernel.ref("unit"), "damage"))
  ], kernel, registry);
  assert.equal(outcome.linkedValues["read.value"], 3);
});

test("object-attribute is an alias and preserves null printed cost", () => {
  const kernel = world().unit("unit", { energy: null, power: null }).build();
  assert.equal(evaluate({ kind: "object-attribute", object: kernel.ref("unit"), attribute: "energy" }, kernel), null);
  assert.equal(evaluate(property(kernel.ref("unit"), "power"), kernel), null);
});

test("an object made unavailable before the ability has no implicit look-back", () => {
  const kernel = world().unit("other", { might: 9 }).unit("source").build();
  const ref = kernel.ref("other");
  const source = kernel.clone({ source: kernel.ref("source"), sourceSnapshot: kernel.getObject("source") });
  source.perform({ type: "kill", object: ref });
  const outcome = runAbilityBody([value("read", property(ref, "might"))], source, registry);
  assert.equal(resultFor(outcome, "read").status, "ignored");
  assert.equal(outcome.linkedValues["read.value"], undefined);
});

test("provided source last-known information remains accessible", () => {
  const initial = world().unit("source", { might: 7 }).build();
  const ref = initial.ref("source");
  const kernel = initial.clone({ source: ref, sourceSnapshot: initial.getObject("source") });
  kernel.perform({ type: "kill", object: ref });
  assert.equal(evaluate(property(ref, "might"), kernel), 7);
});

test("look-back reads characteristics immediately before the zone change", () => {
  const kernel = world().unit("unit", { damage: 0 }).build();
  const ref = kernel.ref("unit");
  kernel.setTargets("unit", [ref]);
  const outcome = runAbilityBody([
    instruction("damage", "test.damage", { amount: constant(4) }),
    instruction("kill", "test.kill", { object: constant(ref) }), value("read", property(ref, "damage"))
  ], kernel, registry);
  assert.equal(outcome.linkedValues["read.value"], 4);
});

test("unknown characteristic is ignored without reading prototype fields", () => {
  const kernel = world().unit("unit").build();
  const outcome = runAbilityBody([value("read", property(kernel.ref("unit"), "constructor"))], kernel, registry);
  assert.equal(resultFor(outcome, "read").status, "ignored");
});

test("count expressions count the current query result", () => {
  const kernel = world().unit("first").unit("second", { owner: "B" }).deck("card").build();
  assert.equal(evaluate({ kind: "count", subject: "objects", filter: { zone: "board", controller: "A" } }, kernel), 1);
});

test("count expression is recomputed after prior effects", () => {
  const kernel = world().deck("first").deck("second").build();
  const outcome = runAbilityBody([
    instruction("draw", "test.draw", { amount: constant(1) }), value("count", { kind: "count", subject: "objects", filter: { zone: "deck" } })
  ], kernel, registry);
  assert.equal(outcome.linkedValues["count.value"], 1);
});

test("linked alias and full result object are available", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([gain("gain", 2), value("alias", { kind: "linked", instructionId: "gain", key: "value" }), value("full", { kind: "linked-value", instructionId: "gain" })], kernel, registry);
  assert.equal(outcome.linkedValues["alias.value"], 2);
  assert.deepEqual(outcome.linkedValues["full.value"], { value: 2 });
});

test("linked results do not expose inherited properties", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([gain("gain"), value("read", linked("gain", "constructor"))], kernel, registry);
  assert.equal(resultFor(outcome, "read").status, "ignored");
});

test("a later change does not mutate an already captured linked characteristic", () => {
  const kernel = world().unit("unit").build();
  kernel.setTargets("unit", [kernel.ref("unit")]);
  const outcome = runAbilityBody([
    value("snapshot", property(kernel.ref("unit"), "damage")),
    instruction("damage", "test.damage", { amount: constant(4) }), value("copy", linked("snapshot"))
  ], kernel, registry);
  assert.equal(outcome.linkedValues["copy.value"], 0);
  assert.equal(kernel.getObject("unit").damage, 4);
});

for (const [operator, left, right, expected] of [
  ["eq", 2, 2, true], ["ne", 2, 3, true], ["lt", 2, 3, true], ["lte", 3, 3, true],
  ["gt", 3, 2, true], ["gte", 3, 3, true], ["in", 2, [1, 2], true], ["eq", "2", 2, false],
  ["eq", null, null, true], ["eq", { a: 1, b: 2 }, { b: 2, a: 1 }, true]
]) {
  test(`condition comparison ${operator} ${JSON.stringify(left)} with ${JSON.stringify(right)}`, () => {
    const kernel = world().build();
    runAbilityBody([gain("gain", 1, { condition: compare(constant(left), operator, constant(right)) })], kernel, registry);
    assert.equal(kernel.player("A").energy, expected ? 1 : 0);
  });
}

test("all, any and not conditions are evaluated recursively", () => {
  const condition = { kind: "all", conditions: [
    { kind: "always" }, { kind: "any", conditions: [{ kind: "never" }, { kind: "not", condition: { kind: "never" } }] }
  ] };
  const outcome = runAbilityBody([instruction("predicate", "condition.predicate", { condition: constant(condition) }), gain("gain", 2, { condition: { kind: "expression", value: linked("predicate") } })], world().build(), registry);
  assert.equal(outcome.linkedValues["predicate.value"], true);
  assert.equal(resultFor(outcome, "gain").status, "executed");
});

test("all and any preserve empty set truth values", () => {
  const outcome = runAbilityBody([
    instruction("all", "condition.predicate", { condition: constant({ kind: "all", conditions: [] }) }),
    instruction("any", "condition.predicate", { condition: constant({ kind: "any", conditions: [] }) })
  ], world().build(), registry);
  assert.equal(outcome.linkedValues["all.value"], true);
  assert.equal(outcome.linkedValues["any.value"], false);
});

test("logical predicates short-circuit missing information", () => {
  const kernel = world().build();
  const missing = { kind: "expression", value: linked("missing") };
  const outcome = runAbilityBody([
    gain("all", 1, { condition: { kind: "all", conditions: [{ kind: "never" }, missing] } }),
    gain("any", 2, { condition: { kind: "any", conditions: [{ kind: "always" }, missing] } })
  ], kernel, registry);
  assert.equal(resultFor(outcome, "all").status, "negated");
  assert.equal(kernel.player("A").energy, 2);
});

test("ordered null comparison is ignored instead of treating null as zero", () => {
  const outcome = runAbilityBody([gain("gain", 2, { condition: compare(constant(null), "lt", constant(1)) })], world().build(), registry);
  assert.equal(resultFor(outcome, "gain").status, "ignored");
});

for (const [operator, operands, expected] of [
  ["add", [2, 3, 4], 9], ["subtract", [7, 2], 5], ["multiply", [2, 3, 4], 24],
  ["divide", [9, 2], 4.5], ["min", [2, 0, 4], 0], ["max", [-2, -1], -1]
]) {
  test(`condition.value calculates ${operator} and binds X`, () => {
    const kernel = world().build();
    const outcome = runAbilityBody([
      instruction("calculate", "condition.value", { operator: constant(operator), operands: constant(operands.map(constant)), key: constant("X") }),
      value("read", linked("calculate", "X"))
    ], kernel, registry);
    assert.equal(outcome.linkedValues["read.value"], expected);
  });
}

test("arithmetic operands can include dynamic query counts and links", () => {
  const kernel = world().deck("card").build();
  const outcome = runAbilityBody([gain("gain", 3), instruction("sum", "condition.value", {
    operator: constant("add"), operands: constant([linked("gain"), { kind: "count", subject: "objects", filter: { zone: "deck" } }])
  })], kernel, registry);
  assert.equal(outcome.linkedValues["sum.value"], 4);
});

test("dynamic condition.value comparisons use evaluated X", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([value("X", constant(4)), value("threshold", linked("X"), { operator: constant("gte"), right: constant(3) })], kernel, registry);
  assert.equal(outcome.linkedValues["threshold.value"], true);
});

test("arithmetic never coerces null printed costs to zero", () => {
  const outcome = runAbilityBody([instruction("sum", "condition.value", { operator: constant("add"), operands: constant([constant(null), constant(1)]) })], world().build(), registry);
  assert.equal(resultFor(outcome, "sum").status, "ignored");
});

for (const [operator, operands] of [["divide", [1, 0]], ["subtract", [1]], ["add", []], ["add", ["1", 2]], ["unsupported", [1]]]) {
  test(`invalid arithmetic ${operator} ${JSON.stringify(operands)} fails closed`, () => {
    assert.throws(() => runAbilityBody([instruction("invalid", "condition.value", { operator: constant(operator), operands: constant(operands.map(constant)) })], world().build(), registry));
  });
}

test("history counts committed actions this turn by default", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([gain("first"), gain("second"), instruction("history", "condition.history", { query: constant({ action: "gain-energy" }) })], kernel, registry);
  assert.equal(outcome.linkedValues["history.count"], 2);
  assert.equal(outcome.linkedValues["history.value"], 2);
});

test("history without a player counts actions performed by either player", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([
    instruction("gain", "test.gain", { amount: constant(2), player: constant("B") }),
    instruction("history", "condition.history", { query: constant({ action: "gain-energy", scope: "game" }), operator: constant("gte"), right: constant(1) }),
    gain("after", 3, { condition: { kind: "expression", value: linked("history") } })
  ], kernel, registry);
  assert.equal(kernel.player("A").energy, 3);
  assert.equal(outcome.linkedValues["history.count"], 1);
});

test("history filters the player explicitly when requested", () => {
  const kernel = world().build();
  const outcome = runAbilityBody([gain("gain"), instruction("history", "condition.history", { query: constant({ action: "gain-energy", player: "B", scope: "game" }) })], kernel, registry);
  assert.equal(outcome.linkedValues["history.count"], 0);
});

test("history forwards turn, combat and game scopes unchanged to its authority", () => {
  const kernel = world().build();
  kernel.perform({ type: "gain-energy", player: "A", amount: 1 });
  const queries = [];
  const context = new Proxy(kernel, { get(target, key) {
    if (key === "history") return query => { queries.push(query); return target.history(query); };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const outcome = runAbilityBody(["turn", "combat", "game"].map(scope => instruction(scope, "condition.history", { query: constant({ scope, action: "gain-energy" }) })), context, registry);
  assert.deepEqual(queries.map(query => query.scope), ["turn", "combat", "game"]);
  assert.deepEqual(["turn", "combat", "game"].map(id => outcome.linkedValues[`${id}.count`]), [1, 1, 1]);
});

test("history carries exact object identities and timing point filters", () => {
  const kernel = world().unit("unit").build();
  const ref = kernel.ref("unit");
  const outcome = runAbilityBody([
    instruction("kill", "test.kill", { object: constant(ref) }),
    instruction("history", "condition.history", { query: constant({ scope: "game", action: "kill", object: ref, timingPoint: kernel.timingPoint }) })
  ], kernel, registry);
  assert.equal(outcome.linkedValues["history.count"], 1);
});

test("choice replay does not double count actions in history", () => {
  const kernel = world().build();
  const body = [gain("gain"), instruction("choice", "test.choose-gain"), instruction("history", "condition.history", { query: constant({ action: "gain-energy", scope: "turn" }) })];
  assert.ok(transaction(body, kernel).asked);
  const run = transaction(body, kernel, { "choice/amount": 2 });
  assert.equal(run.outcome.linkedValues["history.count"], 2);
  assert.equal(kernel.events.length, 2);
});

for (const query of [{ scope: "yesterday" }, { action: "invented" }, { timingPoint: "invented" }, { unknown: true }]) {
  test(`unsupported history query ${JSON.stringify(query)} is rejected`, () => {
    assert.throws(() => runAbilityBody([instruction("history", "condition.history", { query: constant(query) })], world().build(), registry), /Unsupported/);
  });
}
