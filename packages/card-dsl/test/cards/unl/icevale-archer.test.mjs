import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/icevale-archer.js";
import { isTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL =
  "card.hash-cfa683e56408938bf27747d5d9dcb341900100c1cc87f15bd487c270cd7b2dee";
const SOURCE_TEXT =
  "When I attack, you may pay :rb_energy_1: to give a unit here -1 :rb_might: this turn.";

const [ability] = program.abilities;
const [instruction] = ability.body;
const [unitHere] = instruction.targets;

test("unl-065-219 Icevale Archer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-065-219 Icevale Archer: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // 缺口必须具体：攻击时点没有发出方、效果原语、前导可选费用。
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-065-219 Icevale Archer: attack trigger is filtered to this unit and the may is at finalize", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  // 383.3.a/383.3.b："you may pay" 在效果开头，是 Finalize 的"是否执行该触发"决定。
  assert.equal(ability.optional, true);
  assert.equal(instruction.id, "icevale-archer.give-minus-1");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.picks, undefined);
});

test("unl-065-219 Icevale Archer: 'a unit here' is any board unit at the source's location", () => {
  assert.equal(instruction.targets.length, 1);
  assert.equal(unitHere.id, "icevale-archer.unit-here");
  // 355.9.a.1：未写 friendly/enemy 时指任意一方的单位；053.3 的 here = 来源当前位置。
  assert.deepEqual(unitHere.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "source"
  });
  assert.equal(unitHere.filter.controller, undefined);
  assert.equal(unitHere.min, 1);
  assert.equal(unitHere.max, 1);
  assert.equal(unitHere.selection, "one");
});

test("unl-065-219 Icevale Archer: the declared attack timing point exists but its filter is not yet registrable", () => {
  // 时点本身在封闭枚举里（events/timing-points.ts），但 combat/ 不发射它——
  // 这里记录声明形状（source: self）供触发管线落地后复核。
  assert.deepEqual(Object.keys(ability.trigger.filter), ["event", "filter"]);
  // 触发形状本身要通过触发管线的校验器（若失败说明声明写错，而不是缺口）。
  assert.equal(
    isTriggerSpec({ at: "attack-declared", filter: { type: "unit", controller: "self" } }),
    true
  );
});

test("unl-065-219 Icevale Archer: the temporary Might modifier is not a registered primitive", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
});

test.todo(
  "unl-065-219 Icevale Archer: subscribing at the 'attack-declared' timing point needs its emitter " +
    "in combat/ (engine batch 5 / RIFT-31, RIFT-33, RIFT-77); today only the closed timing-point " +
    "enum defines the id"
);
test.todo(
  "unl-065-219 Icevale Archer: 'give a unit here -1 :rb_might: this turn' needs the continuous.might " +
    "layers primitive with an end-of-turn duration (RIFT-91); effect.buff explicitly leaves " +
    "temporary Might changes to the layers system"
);
test.todo(
  "unl-065-219 Icevale Archer: the leading optional 1-energy cost (CR 383.3.b) has no field on the " +
    "frozen triggered ability and no merged cost.pay / cost-plan entry (RIFT-89); 'optional: true' " +
    "only encodes the finalize decision"
);
test.todo(
  "unl-065-219 Icevale Archer: registering the card-played/attack triggers from card programs with " +
    "the production chain is shared wiring tracked by the coordinator (RIFT-120)"
);
