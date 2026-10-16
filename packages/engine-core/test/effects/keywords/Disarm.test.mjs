import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";

import disarm, { DISARM_DEFAULT_VALUE } from "../../../dist/effects/keywords/Disarm.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { isTimingPointId } from "../../../dist/events/timing-points.js";

const HOST = Object.freeze({ canonicalCardId: "rad-097-167" });

const program = abilities => ({
  canonicalCardId: HOST.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "[Disarm]"
});

const expanded = value => value === undefined
  ? disarm.expand({ host: HOST })
  : disarm.expand({ host: HOST, value });

test("Disarm metadata identifies a valued, summed keyword", () => {
  assert.equal(disarm.keyword, "Disarm");
  assert.equal(disarm.valued, true);
  assert.equal(disarm.stacking, "sum");
  for (const ref of ["831", "831.1.b", "831.1.c.3", "831.1.d", "831.1.d.1", "831.2", "831.3"]) {
    assert.ok(disarm.ruleRefs.includes(ref), `missing rule ref ${ref}`);
  }
});

test("Disarm without a printed value defaults to Disarm 1", () => {
  const [ability] = expanded();
  assert.equal(DISARM_DEFAULT_VALUE, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.body[0].args.amount.value, -1);
});

test("Disarm expands to one mandatory attack-declared trigger", () => {
  const [ability] = expanded(2);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "attack-declared");
  assert.equal(isTimingPointId(ability.trigger.at), true);
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
});

test("Disarm body applies a temporary negative Might to one enemy unit here", () => {
  const [ability] = expanded(3);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args, {
    amount: { kind: "constant", value: -3 },
    duration: { kind: "constant", value: "this-turn" },
    target: { kind: "constant", value: "disarm.enemy-unit" }
  });
  assert.deepEqual(instruction.targets, [{
    id: "disarm.enemy-unit",
    filter: { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("Disarm expansion validates as an EffectIR CardProgram", () => {
  for (const value of [undefined, 0, 1, 2, 99]) {
    const result = validateCardProgram(program(expanded(value)));
    assert.equal(result.ok, true, `${value}: ${JSON.stringify(result.issues)}`);
    assert.deepEqual(result.issues, []);
  }
});

test("Disarm stacking sums multiple instances into one expansion", () => {
  assert.equal(disarm.stacking, "sum");
  const printed = expanded(1)[0].body[0].args.amount.value;
  const granted = expanded(2)[0].body[0].args.amount.value;
  const merged = expanded((printed * -1) + (granted * -1));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].body[0].args.amount.value, -3);
});

test("Disarm preserves the explicit zero value and large finite values", () => {
  assert.equal(expanded(0)[0].body[0].args.amount.value, 0);
  assert.equal(expanded(999)[0].body[0].args.amount.value, -999);
  assert.equal(expanded(Number.MAX_SAFE_INTEGER)[0].body[0].args.amount.value, -Number.MAX_SAFE_INTEGER);
});

test("Disarm has exactly one trigger even when its total value is large", () => {
  for (const value of [1, 2, 4, 16]) {
    const abilities = expanded(value);
    assert.equal(abilities.length, 1);
    assert.equal(abilities[0].body.length, 1);
    assert.equal(abilities[0].body[0].op, "continuous.might");
  }
});

test("Disarm is available from the generated keyword registry", () => {
  assert.equal(keywordDefinitionsById.get("Disarm"), disarm);
});
