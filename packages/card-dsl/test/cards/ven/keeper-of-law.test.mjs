import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/keeper-of-law.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { attachProgramLifecycle } from "../../../../engine-core/dist/programs/lifecycle.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL_ID =
  "card.hash-594a92ecf2468e6d6dce94696d391d740b2a698a2ac48085800d89cc1ec137cb";
const SOURCE_TEXT =
  "I cost :rb_energy_2::rb_rune_order: less if you control a battlefield with exactly two units there.";

const [discount] = program.abilities;
const condition = discount.condition;

// 该 condition 是普通 IR，可用已合入的 condition.predicate 真实求值。
const predicate = {
  id: "keeper-of-law.condition",
  op: "condition.predicate",
  args: { condition: { kind: "constant", value: condition } }
};

const battlefields = (count) => {
  const builder = world().player("controller").player("B");
  for (let index = 0; index < count; index++) {
    // 战场是 Board 上的游戏对象（103.3/170.11），控制者由 190.4 决定。
    builder.unit(`battlefield-${index}`, {
      types: ["battlefield"],
      controller: "controller",
      owner: "controller",
      zone: "board",
      location: { type: "battlefield", id: `bf-${index}` },
      might: 0
    });
  }
  return builder.build().clone({ controller: "controller" });
};

test("ven-119-166 Keeper of Law: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-119-166 Keeper of Law: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 费用改写无 CardProgram→费用计划的消费方 + “there” 的地点锚点缺契约表达。
  assert.match(program.judgeReason, /continuous\.cost-modification|cost\.modify/);
  assert.match(program.judgeReason, /356\.4\.b/);
  assert.ok(!/RIFT-89/.test(program.judgeReason), "cost.modify is merged; the reason names the real static-to-cost-plan gap");
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test("ven-119-166 Keeper of Law: one static discount of 2 Energy and 1 Order Power on itself", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(discount.kind, "static");
  // 356.4.b/356.4.c："cost [amount] less" 是折扣，两个费用分量分别声明。
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.equal(discount.effect.appliesTo, "self");
  assert.deepEqual(discount.effect.reductions, [
    { resource: "energy", amount: -2 },
    { resource: "power", domain: "Order", amount: -1 }
  ]);
  // 356.6 的 0 下限由费用计划钳制，不写进卡里；也不写死具体减免后的数值。
  assert.equal(discount.effect.minimum, undefined);
});

test("ven-119-166 Keeper of Law: the 'control a battlefield with exactly two units there' condition shape", () => {
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  // “you control a battlefield”：只写得出战场侧的正向过滤；“with exactly two units
  // there” 的计数与“该战场自身位置”留待契约的地点锚点（见 judgeReason）。
  assert.deepEqual(condition.left.filter, {
    type: "battlefield",
    controller: "controller"
  });
});

test("ven-119-166 golden: the battlefield-side count part evaluates against real board objects", () => {
  // 190.4/190.4.a：控制者为自己；103.3/170.11：战场是可计数的游戏对象。
  const none = battlefields(0);
  assert.equal(
    runAbilityBody([predicate], none).linkedValues["keeper-of-law.condition.value"],
    false
  );
  const one = battlefields(1);
  assert.equal(
    runAbilityBody([predicate], one).linkedValues["keeper-of-law.condition.value"],
    true
  );
  const two = battlefields(2);
  assert.equal(
    runAbilityBody([predicate], two).linkedValues["keeper-of-law.condition.value"],
    true
  );
});

test("ven-119-166 golden: a battlefield controlled by the opponent does not count", () => {
  const base = world()
    .player("controller")
    .player("B")
    .unit("enemy-battlefield", {
      types: ["battlefield"],
      owner: "B",
      controller: "B",
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      might: 0
    })
    .build()
    .clone({ controller: "controller" });
  assert.equal(
    runAbilityBody([predicate], base).linkedValues["keeper-of-law.condition.value"],
    false
  );
});

test("ven-119-166 golden: the declared reductions drop a 5-energy + 1 Order plan to 3 + 0", () => {
  // 已合入的 buildCostPlan 接受同一组折扣（356.4）：这里把卡里声明的 energy/power 两个
  // 分量交给费用计划，证明 5 Energy + 1 Order Power → 3 Energy + 0 Order Power。
  // 这一证据只覆盖“折扣分量本身”，不覆盖“从卡牌 static 效果读入计划”的接线。
  const kernel = world().player("controller").player("B").build();
  const [energy, power] = discount.effect.reductions;
  const plan = buildCostPlan(kernel, {
    id: "keeper-of-law",
    cost: {
      kind: "explicit",
      energy: { kind: "constant", value: 5 },
      power: { kind: "constant", value: ["Order"] }
    },
    domains: ["Order"],
    discounts: [
      {
        id: "keeper-of-law.energy",
        component: "base",
        resource: "energy",
        amount: { kind: "constant", value: Math.abs(energy.amount) }
      },
      {
        id: "keeper-of-law.power",
        component: "base",
        resource: "power",
        amount: { kind: "constant", value: Math.abs(power.amount) },
        domains: [power.domain]
      }
    ]
  });
  const [component] = plan.components;
  assert.equal(component.original.energy, 5);
  assert.equal(component.cost.energy, 3);
  assert.deepEqual(component.cost.power, []);
  assert.deepEqual(
    plan.discounts.map((entry) => [entry.resource, entry.amount, entry.before, entry.after]),
    [
      ["energy", 2, 5, 3],
      ["power", 1, 1, 0]
    ]
  );
});

test("ven-119-166 golden: the production static binder rejects continuous.cost-modification as judge-required", () => {
  // bindStaticToLayers 是已合入的 production 路径：kind 里含 cost-modification 的
  // static 能力进不了任何图层（layerFor 直接抛 judge-required）。这正是折扣数据
  // 到不了 Finalize 费用计划的第一道断点。
  const kernel = world()
    .unit("keeper-of-law", { might: 5, owner: "A", controller: "A", zone: "board" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => {
      throw new Error("unexpected choice");
    },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const registry = new ProgramRegistry([program]);
  const lifecycle = attachProgramLifecycle(engine, registry);
  try {
    // Board 进入：static 绑定在此时运行并按 layerFor 抛 judge-required。
    engine.pipeline.emit({ timingPoint: "object-enters-board", object: kernel.getObject("keeper-of-law") });
    assert.equal(engine.layers.registry.snapshot().length, 0, "no layer entry is registered for the cost modification");
  } finally {
    lifecycle.detach();
  }
});

test.todo(
  "ven-119-166 Keeper of Law: evaluate 'a battlefield with exactly two units there' honestly — the count " +
    "needs the traversed battlefield's own location as the anchor for 'there', which ObjectFilter cannot " +
    "express (contract change request) and layers/engine.ts conditionMatches returns true for every " +
    "compare/count condition (RIFT-359 in progress)"
);
