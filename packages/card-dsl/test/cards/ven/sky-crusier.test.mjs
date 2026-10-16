import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/sky-crusier.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import damageDefinition from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [damage] = ability.body;

test("sky-crusier: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-d2def5066902e970298a380b5ed4f78dba819d6944f7212828d31b3876d8f1a2"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Discard a gear, :rb_energy_1:, :rb_exhaust:: Deal 4 to a unit at a battlefield."
  );
});

test("sky-crusier: judgeReason names the discard-cost selection gap and its dependencies", () => {
  assert.match(program.judgeReason, /423\.1\.a/);
  assert.match(program.judgeReason, /ObjectRef/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-102/);
  assert.match(program.judgeReason, /effect\.discard/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sky-crusier: one activated ability at action speed", () => {
  assert.equal(program.abilities.length, 1);
  // 145.1/145.2/376：单位起动能力默认在控制者 Main Phase 的 Open State 执行。
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.restriction, undefined);
});

test("sky-crusier: the printed cost is 1 Energy plus discard-a-gear plus exhausting the source", () => {
  assert.equal(ability.cost.kind, "activated");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.equal(ability.cost.power, undefined);
  assert.equal(ability.cost.payments.length, 2);

  const [discardPayment, exhaustPayment] = ability.cost.payments;
  // 423.1/423.1.a：弃牌是费用，选择的牌由执行动作的玩家决定（结算期选择，不是目标）。
  assert.equal(discardPayment.kind, "discard");
  assert.equal(discardPayment.choice.id, "sky-crusier.gear");
  assert.deepEqual(discardPayment.choice.options, ["gear-in-controller-hand"]);
  assert.equal(discardPayment.choice.min, 1);
  assert.equal(discardPayment.choice.max, 1);
  assert.equal(discardPayment.choice.selection, "one");
  assert.deepEqual(discardPayment.choice.filter, { type: "gear", zone: "hand" });
  // ":rb_exhaust:" 是横置本单位的费用。
  assert.deepEqual(exhaustPayment, { kind: "exhaust" });
});

test("sky-crusier: the discard cost cannot be built with a placeholder candidate, so the card stays judged", () => {
  const kernel = world().unit("sky-crusier", { energy: 4 }).hand("gear-card", { types: ["gear"] }).build();
  assert.throws(
    () => buildCostPlan(kernel, { id: "sky-crusier", cost: ability.cost }),
    error => {
      assert.equal(error.name, "CostPlanError");
      assert.equal(error.reason, "invalid-cost-plan");
      assert.match(error.message, /exact object reference/);
      return true;
    }
  );
});

test("sky-crusier: body deals exactly 4 to one unit at a battlefield", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(damage.id, "sky-crusier.damage");
  assert.equal(damage.op, "effect.damage");
  assert.deepEqual(damage.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(damage.args.target, {
    kind: "constant",
    value: "sky-crusier.battlefield-unit"
  });
  assert.equal(damage.linkedTo, undefined);
  assert.deepEqual(damage.targets, [
    {
      id: "sky-crusier.battlefield-unit",
      filter: { type: "unit", location: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sky-crusier: the declared location filter accepts battlefield units and rejects base units", () => {
  const kernel = world()
    .unit("at-battlefield", { might: 5, controller: "B" })
    .base("at-base", { might: 5, controller: "B" })
    .build();
  const [target] = damage.targets;
  assert.equal(matchesObjectFilter(target.filter, kernel.getObject("at-battlefield")), true);
  assert.equal(matchesObjectFilter(target.filter, kernel.getObject("at-base")), false);
});

test("sky-crusier: the damage body really deals 4 to the locked battlefield unit", () => {
  const kernel = world()
    .unit("sky-crusier", { might: 3 })
    .unit("victim", { might: 5, controller: "B" })
    .build();
  // effect.damage 的 argsSchema 要求 target 是 TargetSpec id 字符串，而静态 IR 里
  // 它是 constant 表达式（解释器先求值再交给原语；chain adapter 的 LITERAL_FIELDS
  // 也是这么解码的）。这里显式代入该求值结果，其余 args 保持程序原文。
  const run = runInstruction(damageDefinition, {
    ...damage.args,
    target: damage.args.target.value
  }, {
    world: kernel,
    targets: { "sky-crusier.battlefield-unit": [kernel.ref("victim")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("victim").damage, 4);
  assert.equal(run.linked.dealt, 4);
  assert.equal(run.linked.dealtCount, 1);
});

test("sky-crusier: a target that left its zone before resolution makes the damage ignored", () => {
  const kernel = world()
    .unit("sky-crusier", { might: 3 })
    .unit("victim", { might: 5, controller: "B" })
    .build();
  const stale = kernel.ref("victim");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets("sky-crusier.battlefield-unit", [stale]);
  // 参考内核按值比较 filter（不认生产匹配器的 location 拼法），因此这里用等价的
  // board 过滤器执行，验证的仍然是"目标已离区 → ignored（359.3.e.7）"这一契约行为。
  const body = [
    {
      ...damage,
      targets: [
        { ...damage.targets[0], filter: { type: "unit", zone: "board" } }
      ]
    }
  ];
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

test.todo(
  "sky-crusier: charge/validate the 1 Energy + discard-a-gear + exhaust cost at Finalize " +
    "(423.3 requires the discard to be completable) once cost choices accept a runtime hand " +
    "selection instead of exact pre-listed ObjectRefs (RIFT-89 cost plan, RIFT-102 selector follow-up)"
);
