import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "@riftbound/card-dsl";
import accelerate from "../../../dist/effects/keywords/Accelerate.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import effectReady from "../../../dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../dist/effects/testing/index.js";

const HOST = { canonicalCardId: "test-accelerate-unit" };

function program(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Accelerate]"
  };
}

// CR v1.5 805.1 / 805.1.a：Accelerate 是单位上的可选附加费用关键词。
test("Accelerate keyword definition declares a non-valued keyword with v1.5 rule refs", () => {
  assert.equal(accelerate.keyword, "Accelerate");
  assert.equal(accelerate.valued, false);
  assert.ok(accelerate.ruleRefs.includes("805.1"));
  assert.ok(accelerate.ruleRefs.includes("805.1.b"));
  assert.ok(accelerate.ruleRefs.includes("805.2"));
  assert.ok(accelerate.ruleRefs.includes("805.6"));
});

// CR v1.5 805.4：多个 Accelerate 实例冗余。
test("Accelerate stacking is single per 805.4", () => {
  assert.equal(accelerate.stacking, "single");
});

test("Accelerate expands to an accelerate.cost static ability plus an enter-ready replacement", () => {
  const abilities = accelerate.expand({ host: HOST });
  assert.equal(abilities.length, 2);
  const [costAbility, replacement] = abilities;
  assert.equal(costAbility.kind, "static");
  assert.equal(costAbility.effect.kind, "accelerate.cost");
  assert.equal(costAbility.effect.appliesTo, "self");
  assert.equal(replacement.kind, "replacement");
  assert.equal(replacement.replaces.event, "object-enters-board");
  assert.equal(replacement.replaces.filter.exhausted, true);
});

// 805.1.b：固定费用 [1][C]，与卡牌数值无关。
test("Accelerate cost ability declares the fixed 1-energy 1-power optional cost (805.1.b)", () => {
  const abilities = accelerate.expand({ host: HOST });
  const cost = abilities[0].effect.cost;
  assert.equal(cost.kind, "additional-cost");
  assert.equal(cost.optional, true);
  const payments = cost.payments;
  assert.equal(payments.length, 2);
  assert.equal(payments[0].kind, "energy");
  assert.deepEqual(payments[0].amount, { kind: "constant", value: 1 });
  assert.equal(payments[1].kind, "power");
  assert.deepEqual(payments[1].amount, { kind: "constant", value: 1 });
});

test("Accelerate expansion result passes validateCardProgram", () => {
  const abilities = accelerate.expand({ host: HOST });
  const result = validateCardProgram(program(abilities));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("Accelerate replacement body uses the merged effect.ready primitive", () => {
  const abilities = accelerate.expand({ host: HOST });
  const replacement = abilities[1];
  assert.equal(replacement.with.length, 1);
  assert.equal(replacement.with[0].op, "effect.ready");
  assert.equal(replacement.with[0].id, "accelerate.enter-ready");
});

// 805.6：付费后单位以就绪状态进场。展开中用到的 effect.ready 原语已合入，
// 用参考测试内核实际执行一遍：横置单位被重置为就绪。
test("effect.ready readies an exhausted unit through the reference kernel (805.6)", () => {
  const kernel = world().unit("unit", { exhausted: true }).build();
  const ref = kernel.ref("unit");
  assert.equal(kernel.getObject("unit").exhausted, true);
  const run = runInstruction(effectReady, { objects: ref }, { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.equal(kernel.getObject("unit").exhausted, false);
});

// 805.4：同一单位多次声明 Accelerate 只算一次——每个声明展开相同结构。
test("Accelerate expansion is idempotent so single stacking merges duplicates (805.4)", () => {
  const first = accelerate.expand({ host: HOST });
  const second = accelerate.expand({ host: HOST });
  assert.deepEqual(first, second);
});

test("Accelerate is registered in the generated keyword registry", () => {
  const registered = keywordDefinitionsById.get("Accelerate");
  assert.ok(registered);
  assert.equal(registered.keyword, "Accelerate");
});
