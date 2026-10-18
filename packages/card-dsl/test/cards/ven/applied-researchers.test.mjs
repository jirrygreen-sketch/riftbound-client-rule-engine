// Golden test for Applied Researchers (ven-055-166).
//
// Execution evidence (the real printed 4 Energy payment, the still-inert
// [Empowered] spell discount — verified both before and after a real Empower
// action — and the fail-closed continuous.cost-modification binds) lives in the
// RIFT-673 parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// Original behavior and structure assertions remain in this file; the
// template adds execution evidence without replacing these checks.
import assert from "node:assert/strict";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/applied-researchers.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [empower, energyDiscount, powerDiscount] = program.abilities;

test("applied-researchers: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-ffb7fa0eb6027d1158053512ab5917c1ff4226d11f9110deeade65133c7312b4"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
  assert.equal(
    program.sourceText,
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
      "[Empowered][>] Your spells cost :rb_energy_1::rb_rune_rainbow: less, to a minimum of :rb_energy_1:."
  );
});

test("applied-researchers: judgeReason names the current cost-plan and Empowered gaps", () => {
  // Refreshed 2026-10-18: the spell-play-cost discount consumer merged into
  // cost/discounts/collect.ts, so the reason now names the remaining production
  // bridge instead of a missing consumer channel.
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /CostPlanInput\.discounts/);
  assert.match(program.judgeReason, /collectCostModifications/);
  assert.match(program.judgeReason, /finalizeCostPlan/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /356\.4\.e/);
  assert.match(program.judgeReason, /spell-play-cost/);
  // Keep the shared 673 template's field assertion and distinguish the existing
  // discount consumer from the missing production bridge that populates it.
  assert.match(program.judgeReason, /卡程序 static 到 CostPlanInput\.discounts 的生产桥接尚未接通/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.match(program.judgeReason, /2026-10-18 复核/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("applied-researchers: Empower 3 is declared, and both discount components are Empowered-gated", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 3 });

  for (const ability of [energyDiscount, powerDiscount]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.effect.kind, "continuous.cost-modification");
    assert.equal(ability.effect.amount, -1);
    assert.equal(ability.effect.appliesTo, "spell-play-cost");
    assert.deepEqual(ability.effect.filter, { type: "spell", controller: "self" });
    assert.deepEqual(ability.condition, {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    });
  }
});

test("applied-researchers: the Energy component carries the 356.4.e minimum of 1", () => {
  assert.equal(energyDiscount.effect.resource, "energy");
  assert.equal(energyDiscount.effect.minimum, 1);
  assert.equal(energyDiscount.effect.domain, undefined);
});

test("applied-researchers: the Power component is 1 Power of any Domain without a minimum", () => {
  assert.equal(powerDiscount.effect.resource, "power");
  // 135.2.e.5 / 135.2.e.5.a：:rb_rune_rainbow: 是任意域 Power。
  assert.equal(powerDiscount.effect.domain, "any");
  // 356.4.e 的最低值只属于写出它的那条折扣；Power 分量没有印刷最低值。
  assert.equal(powerDiscount.effect.minimum, undefined);
});

test("applied-researchers: the declared discount components carry the 356.4.e shape", () => {
  // 缺口形状（见 judgeReason 与下方 TODO）：continuous.cost-modification 不是指令
  // （static 效果走 bindStatic）；费用计划侧的折扣消费通道已合入，缺的是卡程序到
  // 该通道的生产桥接（2026-10-18 复核）。
  assert.equal(powerDiscount.effect.resource, "power");
  assert.equal(energyDiscount.effect.resource, "energy");
  assert.equal(energyDiscount.effect.minimum, 1);
});

test("applied-researchers: the merged cost plan applies a caller-supplied discount of exactly this shape", () => {
  // 356.4.a / 356.4.e：折扣由费用计划消费，最低值只约束该折扣自身。这里用与本卡声明的
  // 两个分量（-1 Energy、-1 任意域 Power，Energy 最低 1）相同的 CostDiscount 形状驱动
  // 真实 buildCostPlan，证明缺口在“卡牌 static → 折扣通道”的接线，而不在这个形状本身。
  const kernel = world()
    .player("A", { energy: 10, power: ["Mind", "Order"] })
    .unit("researcher", { types: ["unit"], zone: "board" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("researcher") });

  const plan = buildCostPlan(context, {
    id: "spell-cost",
    cost: {
      kind: "explicit",
      energy: { kind: "constant", value: 3 },
      payments: [
        { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Mind"] }
      ]
    },
    discounts: [
      // 「cost [1] less, to a minimum of [1]」的 Energy 分量（356.4.e 的最低值）。
      { id: "applied-researchers.energy", resource: "energy", amount: { kind: "constant", value: 1 }, minimum: { kind: "constant", value: 1 } },
      // 「and [A] less」的 Power 分量：任意域 = 六域候选集合。
      { id: "applied-researchers.power", resource: "power", amount: { kind: "constant", value: 1 }, domains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
    ]
  });

  // 印刷 3 Energy + 1 Mind Power → 折扣后 2 Energy + 0 Power。
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(
    plan.discounts.map(entry => [entry.id, entry.resource, entry.amount, entry.minimum]),
    [
      ["applied-researchers.energy", "energy", 1, 1],
      ["applied-researchers.power", "power", 1, 0]
    ]
  );

  // 356.4.e：Energy 的最低值只约束这条折扣本身。
  const cheap = world()
    .player("A", { energy: 10, power: ["Mind"] })
    .unit("researcher", { types: ["unit"], zone: "board" })
    .build();
  const cheapPlan = buildCostPlan(cheap.clone({ sourceSnapshot: cheap.getObject("researcher") }), {
    id: "cheap-spell-cost",
    cost: { kind: "explicit", energy: { kind: "constant", value: 1 } },
    discounts: [
      { id: "applied-researchers.energy", resource: "energy", amount: { kind: "constant", value: 1 }, minimum: { kind: "constant", value: 1 } }
    ]
  });
  assert.equal(cheapPlan.total.energy, 1);
  assert.deepEqual(cheapPlan.discounts.map(entry => entry.after), [1]);
});

test.todo(
  "applied-researchers: bind printed 3 Energy through KeywordAbility.params.cost and expandProgram (827.1.c.1)"
);
test.todo(
  "applied-researchers: connect continuous.cost-modification spell-play-cost to CostPlanInput.discounts with its per-discount minimum (356.4.a-e)"
);

test.todo(
  "applied-researchers: integrate the tested live empowered gate with spell Finalize discounts and authoritative binary state (442.1 / 828.1.c)"
);

test("applied-researchers: the merged Empower definition expands through the real program adapter", () => {
  const kernel = world().unit("keyword-host", {
    cardId: program.canonicalCardId, energy: null, power: null
  }).build();
  const { expanded } = expandProgram(program, kernel.getObject("keyword-host"));
  assert.equal(expanded.length, 1);
  const [activation] = expanded;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  // The missing printed-cost bridge must never turn this into a free activation.
  assert.deepEqual(activation.cost, { kind: "empower" });
  assert.deepEqual(activation.restriction, { kind: "empower", condition: {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  } });
  assert.equal(activation.body[0].id, `empower:${program.canonicalCardId}`);
  assert.equal(activation.body[0].op, "effect.empower");
  assert.deepEqual(activation.body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(activation.body[0].condition, activation.restriction.condition);
  assert.equal(activation.body[0].targets, undefined);
  assert.equal(program.status, "judge-required");
});

test("applied-researchers: the source gate evaluates the actual empowered state", () => {
  const kernel = world().unit("gate-host", { energy: null, power: null }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("gate-host") });
  const body = [{ id: "gate", op: "condition.predicate", args: {
    condition: { kind: "constant", value: energyDiscount.condition }
  } }];
  const evaluate = () => {
    const outcome = runAbilityBody(body, context);
    assert.equal(outcome.status, "executed");
    return outcome.results[0].result.linkedValues.value;
  };
  assert.equal(evaluate(), false);
  assert.equal(context.perform({ type: "empower", object: context.ref("gate-host") }).status, "done");
  assert.equal(evaluate(), true);
  assert.equal(context.perform({ type: "disempower", object: context.ref("gate-host") }).status, "done");
  assert.equal(evaluate(), false);
  assert.deepEqual(context.events.map(event => event.action), ["empower", "disempower"]);
});
