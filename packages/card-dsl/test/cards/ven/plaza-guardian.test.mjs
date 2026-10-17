import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/plaza-guardian.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createTargetTaxAdapter } from "../../../../engine-core/dist/target/tax/adapter.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";

const CANONICAL_ID =
  "card.hash-8d3c1fb92524f486e6dc9126c50fabcfa804299c7b5069e2e43ba6329df29f27";
const SOURCE_TEXT =
  "I cost :rb_energy_1: less for each gear you control.\n" +
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)";

const [costReduction, deflect] = program.abilities;
const discount = costReduction.effect.amount;

/**
 * 与程序相同的表达式，只把契约层的控制器占位符换成参考内核里真实存在的值：
 * filter 的 `controller: "self"` 在契约里由选择管线解析为能力控制者，参考内核按字面值
 * 比较过滤器（见 effects/testing/README.md 第 3 节与 ogn/patched-porobot、ven/sacred-protector
 * 的同类 golden），所以测试显式给出 "A"。表达式结构本身不做任何改写。
 */
const discountForKernel = () => ({
  ...discount,
  operands: discount.operands.map(operand => ({
    ...operand,
    filter: { ...operand.filter, controller: "A" }
  }))
});

/** 以真实解释器执行折扣点数表达式（356.4.g：应用时取值）。 */
const evaluateDiscount = kernel =>
  resolveChainBody(
    [
      {
        id: "plaza-guardian.discount",
        op: "condition.value",
        args: { value: discountForKernel(), key: { kind: "constant", value: "discount" } }
      }
    ],
    kernel
  );

test("ven-064-166 Plaza Guardian: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-064-166 Plaza Guardian: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /discounts/);
  assert.match(program.judgeReason, /target\/tax\/collect\.ts/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
});

test("ven-064-166 Plaza Guardian: the printed discount is a static cost modification scoped to itself", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(costReduction.kind, "static");
  assert.equal(costReduction.effect.kind, "continuous.cost-modification");
  // 356.4/356.4.b：这是折扣；356.6 的 0 下限由费用计划钳制，不写进卡里。
  assert.equal(costReduction.effect.resource, "energy");
  assert.equal(costReduction.effect.appliesTo, "self");
  assert.deepEqual(costReduction.condition, { kind: "always" });
});

test("ven-064-166 Plaza Guardian: the discount is -1 energy per gear the controller has", () => {
  assert.equal(discount.kind, "arithmetic");
  assert.equal(discount.operator, "neg");
  assert.equal(discount.operands.length, 1);
  const [count] = discount.operands;
  assert.equal(count.kind, "count");
  // 355.9.a.1：“gear” 指 Board 上的 gear；“you control” 用控制器占位符。
  assert.deepEqual(count.filter, { type: "gear", controller: "self", zone: "board" });
});

test("ven-064-166 Plaza Guardian: [Deflect] is declared without a value (809.1.b.3)", () => {
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflect.value, undefined);
});

test("ven-064-166 golden: each gear the controller has reduces the cost by one energy", () => {
  for (const [gears, expected] of [[0, 0], [1, -1], [3, -3]]) {
    const builder = world().player("A");
    for (let index = 0; index < gears; index++) {
      builder.unit(`gear-${index}`, {
        types: ["gear"],
        // 参考内核里的能力控制者是 "A"（与上面的占位符替换一致）。
        controller: "A",
        zone: "board"
      });
    }
    const outcome = evaluateDiscount(builder.build());
    assert.equal(outcome.status, "executed", `gears=${gears}`);
    const value = outcome.linkedValues["plaza-guardian.discount.discount"];
    // -0 与 0 数值相等，用 == 0 同时覆盖两种情况，避免把“没有 gear”当成异常。
    assert.equal(value == 0 && expected === 0 ? 0 : value, expected, `gears=${gears}`);
  }
});

test("ven-064-166 golden: gear controlled by the opponent or outside the board is not counted", () => {
  const outcome = evaluateDiscount(
    world()
      .player("A")
      .unit("own-gear", { types: ["gear"], controller: "A" })
      .unit("enemy-gear", { types: ["gear"], owner: "B", controller: "B" })
      .hand("held-gear", { types: ["gear"], controller: "A" })
      .build()
  );
  assert.equal(outcome.linkedValues["plaza-guardian.discount.discount"], -1);
});

test("ven-064-166 golden: units are not gear and do not reduce the cost", () => {
  const outcome = evaluateDiscount(
    world().player("A").unit("ally", { controller: "A", type: "unit" }).build()
  );
  assert.equal(outcome.linkedValues["plaza-guardian.discount.discount"] == 0, true);
});

test.todo(
  "ven-064-166 Plaza Guardian: read the static continuous.cost-modification into the Finalize cost plan " +
    "(356.4 / 356.4.b / 356.4.g; cost.modify + 费用计划接线，programs/statics.ts) and assert a 10-energy printed cost drops " +
    "by the number of controlled gear"
);

test("ven-064-166 Plaza Guardian golden: finalizing a choice of this permanent appends the Deflect tax request", () => {
  // 809.1.d 路由选中的目标：Deflect 1 是给选择者的强制追加费用，真实 target 管线
  // （TargetTaxSpec → appendTargetTax）必须收到该请求。链级把税记成 Energy 而非
  // 809.1.c.1 的任意域 Power，且没有 Deflect 关键词 → taxAdapter 的自动接线，
  // 这两个缺口仍让整卡保持 judge-required（见 judgeReason 第 2 条）。
  const kernel = world().player("A", { power: ["Mind"] })
    .unit("plaza-guardian", { types: ["unit"], owner: "B", controller: "B", might: 8 })
    .build();
  const ref = kernel.ref("plaza-guardian");
  const requests = [];
  const taxAdapter = createTargetTaxAdapter(kernel, { id: "opposing-spell", cost: { kind: "explicit" } }, { kind: "spell" });
  const taxEffect = expandProgram(program, kernel.getObject("plaza-guardian")).expanded
    .find(ability => ability.kind === "static" && ability.effect.kind === "target.tax").effect;
  const plan = finalizeTargetPlan(kernel, {
    id: "spell-target",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  }, {
    selected: [ref],
    tax: { kind: "deflect", amount: taxEffect.value.value },
    taxAdapter: {
      appendTargetTax: request => {
        requests.push(request);
        return taxAdapter.appendTargetTax(request);
      }
    }
  });

  assert.deepEqual(plan.selected, [ref]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "deflect");
  assert.equal(requests[0].amount, 1);
  assert.equal(requests[0].payer, "A");
  assert.deepEqual(requests[0].target, ref);
  assert.equal(taxAdapter.costPlan.total.energy, 0);
  assert.deepEqual(taxAdapter.costPlan.total.power, [{
    amount: 1, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
  }]);
});

test("ven-064-166 Plaza Guardian golden: an unpayable Deflect tax rejects the choice", () => {
  // 809.1.d：付不出追加费用的目标不能被锁定；unpayable 结果在通知前抛出。
  const kernel = world().player("A", { energy: 100, power: [] })
    .unit("plaza-guardian", { types: ["unit"], owner: "B", controller: "B", might: 8 })
    .build();
  const taxAdapter = createTargetTaxAdapter(kernel, { id: "opposing-spell", cost: { kind: "explicit" } }, { kind: "spell" });
  assert.throws(
    () =>
      finalizeTargetPlan(
        kernel,
        { id: "spell-target", filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" },
        {
          selected: [kernel.ref("plaza-guardian")],
          tax: { kind: "deflect", amount: 1 },
          taxAdapter: {
            appendTargetTax: request => taxAdapter.appendTargetTax(request)
          }
        }
      ),
    error => error.code === "target-tax-unpayable"
  );
});
