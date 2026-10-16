import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { world } from "../../../dist/effects/testing/index.js";
import { constant, gain, instruction, linked, property, registry, repeat, transaction, value } from "./helpers.mjs";

const arithmetic = (operator, ...operands) => ({ kind: "arithmetic", operator, operands });

for (const [operator, operands, expected] of [
  ["add", [2, 3, 4], 9], ["sub", [7, 2], 5], ["subtract", [7, 2], 5],
  ["mul", [2, 3, 4], 24], ["multiply", [2, 3, 4], 24], ["div", [7, 2], 3.5],
  ["divide", [7, 2], 3.5], ["min", [7, 2], 2], ["max", [7, 2], 7], ["neg", [7], -7]
]) {
  test(`native ${operator} agrees with condition.value and the reference evaluator`, () => {
    const kernel = world().build();
    const expression = arithmetic(operator, ...operands.map(constant));
    const outcome = runAbilityBody([
      value("native", expression),
      instruction("legacy", "condition.value", { operator: constant(operator), operands: constant(operands.map(constant)) })
    ], kernel, registry);
    assert.equal(outcome.linkedValues["native.value"], expected);
    assert.equal(outcome.linkedValues["legacy.value"], expected);
    assert.equal(kernel.evaluate(expression), expected);
  });
}

test("native arithmetic composes dynamic links, properties, and counts in primitive arguments", () => {
  const kernel = world().unit("unit", { might: 4 }).deck(["first", "second"]).build();
  const expression = arithmetic("add", linked("first"), arithmetic("mul", property(kernel.ref("unit"), "might"), {
    kind: "count", subject: "objects", filter: { zone: "deck" }
  }));
  const outcome = runAbilityBody([gain("first", 2), instruction("second", "test.gain", { amount: expression })], kernel, registry);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 12);
});

test("a validated structural program runs with arithmetic repeat count and condition", () => {
  const body = [instruction("sequence", "sequence", { body: constant([
    repeat("repeat", 2, [instruction("gain", "test.gain", { amount: arithmetic("add", constant(1), constant(2)) })])
  ]) }, { condition: { kind: "compare", left: arithmetic("neg", constant(-1)), operator: "eq", right: constant(1) } })];
  body[0].args.body.value[0].args.count = arithmetic("sub", constant(3), constant(1));
  const candidate = { canonicalCardId: "test.shared", rulesetVersion: EFFECT_IR_V2_RULESET, status: "executable", sourceText: "synthetic", abilities: [{ kind: "play", body }] };
  const validation = validateCardProgram(candidate);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  const kernel = world().build();
  const outcome = runAbilityBody(validation.value.abilities[0].body, kernel, registry);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 6);
  assert.equal(outcome.linkedValues["sequence/repeat.count"], 2);
});

test("native arithmetic on null printed costs ignores without converting null to zero", () => {
  const kernel = world().unit("unit", { energy: null }).build();
  const expression = arithmetic("add", property(kernel.ref("unit"), "energy"), constant(1));
  const outcome = runAbilityBody([instruction("gain", "test.gain", { amount: expression })], kernel, registry);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject("unit").energy, null);
  assert.throws(() => kernel.evaluate(expression), /null characteristic/);
});

for (const [operator, operands] of [["neg", [1, 2]], ["div", [1, 0]], ["sub", [1]], ["add", []], ["mul", ["2", 3]], ["add", [Number.MAX_VALUE, Number.MAX_VALUE]]]) {
  test(`native ${operator} rejects invalid arithmetic ${JSON.stringify(operands)}`, () => {
    const kernel = world().build();
    const expression = arithmetic(operator, ...operands.map(constant));
    assert.throws(() => runAbilityBody([value("invalid", expression)], kernel, registry));
    assert.throws(() => kernel.evaluate(expression));
    assert.deepEqual(kernel.events, []);
  });
}

const target = { id: "unit", filter: { type: "unit", zone: "board" } };
const damage = instruction("damage", "test.damage", { amount: constant(2) }, { targets: [target] });

test("repeat reselectTargets false revalidates Finalize-locked targets without asking", () => {
  const kernel = world().unit("one").unit("two").build();
  kernel.setTargets("unit", [kernel.ref("one")]);
  const loop = repeat("loop", 2, [damage]);
  loop.args.reselectTargets = constant(false);
  const run = transaction([loop], kernel);
  assert.equal(run.asked, null);
  assert.equal(kernel.getObject("one").damage, 4);
  assert.equal(kernel.getObject("two").damage, 0);
});

for (const flag of [undefined, true]) {
  test(`repeat reselection ${String(flag)} keeps independently scoped per-iteration choices`, () => {
    const kernel = world().unit("one").unit("two").build();
    kernel.setTargets("unit", [kernel.ref("one")]);
    const loop = repeat("loop", 2, [damage]);
    if (flag !== undefined) loop.args.reselectTargets = constant(flag);
    const first = transaction([loop], kernel);
    assert.equal(first.asked.request.id, "loop/0/damage/target%3Aunit");
    assert.equal(kernel.getObject("one").damage, 0);
    const run = transaction([loop], kernel, {
      "loop/0/damage/target%3Aunit": [kernel.ref("one")],
      "loop/1/damage/target%3Aunit": [kernel.ref("two")]
    });
    assert.equal(run.asked, null);
    assert.equal(kernel.getObject("one").damage, 2);
    assert.equal(kernel.getObject("two").damage, 2);
  });
}

for (const flag of [null, "false", 0]) {
  test(`repeat rejects a non-boolean reselection flag ${JSON.stringify(flag)}`, () => {
    const loop = repeat("loop", 2, [gain("gain")]);
    loop.args.reselectTargets = constant(flag);
    const kernel = world().build();
    assert.throws(() => runAbilityBody([loop], kernel, registry), /reselectTargets/);
    assert.equal(kernel.player("A").energy, 0);
  });
}

test("interpreter contexts forward ordered zoneSlice reads to registered primitives", () => {
  const kernel = world().deck(["top", "middle", "bottom"]).build();
  const definition = {
    op: "test.ordered", argsSchema: { parse: args => args },
    execute(context) {
      const refs = context.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
      return { status: "executed", events: [], linkedValues: { refs } };
    }
  };
  const outcome = runAbilityBody([instruction("ordered", definition.op)], kernel, new Map([[definition.op, definition]]));
  assert.deepEqual(outcome.linkedValues["ordered.refs"], [kernel.ref("top"), kernel.ref("middle")]);
});
