// Scenario execution evidence: ../templates/static-666.test.mjs (one row per card plus condition boundaries).
// This file retains validation, identity, and key IR structure checks; whole-card status stays judge-required until all consumers exist.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/rhasa-the-sunderer.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-026fc6f43de0b92460fc9a27186ea0fb19fcaa6b9a6bfbb64fb1901c9425c852";
const SOURCE_TEXT = "I cost :rb_energy_1: less for each card in your trash.";

const [staticAbility] = program.abilities;

test("rhasa-the-sunderer: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("rhasa-the-sunderer: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rhasa-the-sunderer: one static energy cost modification scoped to itself", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.cost-modification");
  // CR 356.4/356.4.b: 这是折扣；356.6 的 0 下限由费用计划钳制，不写进卡里。
  assert.equal(staticAbility.effect.resource, "energy");
  assert.equal(staticAbility.effect.appliesTo, "self");
  assert.deepEqual(staticAbility.condition, { kind: "always" });
});

test("rhasa-the-sunderer: the reduction is -1 energy per card in the controller's trash", () => {
  const amount = staticAbility.effect.amount;
  assert.equal(amount.kind, "arithmetic");
  assert.equal(amount.operator, "neg");
  assert.equal(amount.operands.length, 1);

  const [count] = amount.operands;
  assert.equal(count.kind, "count");
  // CR 108.2.a: Trash 是每名玩家各自的区域；“your trash” 用符号牌主占位符 self。
  assert.deepEqual(count.filter, { zone: "trash", owner: "self" });
});

test("rhasa-the-sunderer golden: the amount expression evaluates to minus the trash size", () => {
  const kernel = world()
    .card("t1", { zone: "trash", owner: "self" })
    .card("t2", { zone: "trash", owner: "self" })
    .card("t3", { zone: "trash", owner: "self" })
    .card("enemy", { zone: "trash", owner: "B" })
    .build();

  const outcome = resolveChainBody(
    [
      {
        id: "rhasa-the-sunderer.reduction",
        op: "condition.value",
        args: { value: staticAbility.effect.amount, key: { kind: "constant", value: "reduction" } }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  // 只有牌主的 3 张牌计入；对手的 Trash 不计。
  assert.equal(outcome.linkedValues["rhasa-the-sunderer.reduction.reduction"], -3);
});

test("rhasa-the-sunderer golden: an empty trash leaves the printed cost unchanged", () => {
  const kernel = world().card("enemy", { zone: "trash", owner: "B" }).build();
  const outcome = resolveChainBody(
    [
      {
        id: "rhasa-the-sunderer.reduction",
        op: "condition.value",
        args: { value: staticAbility.effect.amount, key: { kind: "constant", value: "reduction" } }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  // `neg` on 0 yields -0；折扣额本身由费用计划的非负校验规范化（`count` 要求非负整数），
  // 所以这里断言数值为 0、卡本身没有把“没有增幅”错写成 0 以外的值。
  assert.equal(outcome.linkedValues["rhasa-the-sunderer.reduction.reduction"] == 0, true);
  assert.equal(Number.isFinite(outcome.linkedValues["rhasa-the-sunderer.reduction.reduction"]), true);
});

test("rhasa-the-sunderer golden: the same reduction drops a 10-energy printed cost by the trash size", () => {
  const withTrash = world()
    .player("self")
    .card("t1", { zone: "trash", owner: "self" })
    .card("t2", { zone: "trash", owner: "self" })
    .card("t3", { zone: "trash", owner: "self" })
    .build();

  // 已合入的费用计划接受同一表达式（去掉 neg，因为它只吃非负折扣额）作为 Energy
  // 折扣（356.4），并可证明 10 → 7。expression 本身由上面的解释器用例覆盖。
  const discount = staticAbility.effect.amount.operands[0];
  const plan = buildCostPlan(withTrash, {
    id: "rhasa-the-sunderer",
    cost: { energy: { kind: "constant", value: 10 } },
    discounts: [
      {
        id: "rhasa-the-sunderer.trash",
        component: "base",
        resource: "energy",
        amount: discount
      }
    ]
  });
  assert.deepEqual(plan.components.map((component) => [component.original.energy, component.cost.energy]), [
    [10, 7]
  ]);

  const withoutTrash = world().player("self").build();
  const unchanged = buildCostPlan(withoutTrash, {
    id: "rhasa-the-sunderer",
    cost: { energy: { kind: "constant", value: 10 } },
    discounts: [
      {
        id: "rhasa-the-sunderer.trash",
        component: "base",
        resource: "energy",
        amount: discount
      }
    ]
  });
  assert.deepEqual(unchanged.components.map((component) => component.cost.energy), [10]);
});

test.todo(
  "rhasa-the-sunderer: read the static continuous.cost-modification from the card program into the " +
    "Finalize cost plan (356.4; the static binder must produce a CostDiscount and resolve owner=\"self\") and assert the " +
    "actual payment of 7 energy"
);

test.todo(
  "rhasa-the-sunderer: 356.6 energy floor when the trash holds 10 or more cards (cost 0, never negative)"
);
