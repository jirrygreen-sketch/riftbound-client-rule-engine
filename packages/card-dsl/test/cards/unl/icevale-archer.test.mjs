// Golden test for Icevale Archer (unl-065-219).
//
// Execution evidence for this card's behaviour lives in the RIFT-705
// parameterized template golden:
// test/cards/templates/triggered-attack-declared-continuous-mig-705.test.mjs.
// The card stays judge-required: the "a unit here" sameLocationAs body target is
// rejected by the production filter translator (so the ability registers no
// trigger), attack-declared has no producer (CR 466.2), and the leading
// optional 1-energy cost has no carrier in the frozen IR (RIFT-89).
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/icevale-archer.js";
import { isTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

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
  // 缺口必须具体：攻击时点没有发出方、效果的卡牌接线、前导可选费用。
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-89/);
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
  // The merged continuous.might primitive reads its recipients from the
  // evaluated objects selection; writing args.target with an Expr made the
  // interpreter hand the Expr node itself to ctx.targets(), which always
  // returned an empty set and ignored the modification.
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "icevale-archer.unit-here" }
  });
  assert.equal(instruction.args.target, undefined);
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

test("unl-065-219 Icevale Archer golden: the merged continuous.might op applies -1 this turn", () => {
  const base = world()
    .unit("icevale-archer", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("target", { might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("icevale-archer") });
  kernel.setTargets(unitHere.id, [kernel.ref("target")]);
  // The declared target is locked by Finalize (ctx.targets), so the merged
  // primitive needs no set query here: the body, its args and its target come
  // from the card unchanged.
  const outcome = runAbilityBody([instruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, -1);
  assert.equal(kernel.continuousEffects[0].effect.layer, "arithmetic");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("target")).might, 3);
  assert.equal(layers.evaluate(kernel.ref("target")).buffs, 0, "a Might modification is not a Buff counter (702-704)");
  assert.equal(layers.evaluate(kernel.ref("icevale-archer")).might, 2);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("target")).might, 4);
});

test("unl-065-219 Icevale Archer golden: no locked recipient leaves the modification unregistered", () => {
  // The declared TargetSpec requires exactly one member. With no locked target
  // there is no recipient at all, and the primitive must ignore the instruction
  // rather than fall back to the source or to any other Board unit
  // (359.3.e.6). "a unit here" itself is a Finalize target-lock filter
  // (sameLocationAs), which the production translator rejects for this card —
  // see the judgeReason and the RIFT-705 template golden.
  const base = world()
    .unit("icevale-archer", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("elsewhere", { owner: "B", might: 4, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("icevale-archer") });
  const outcome = runAbilityBody([instruction], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.continuousEffects, []);
  assert.equal(createLayerEngine(kernel.objects, kernel.continuousEffects).evaluate(kernel.ref("elsewhere")).might, 4);
});

