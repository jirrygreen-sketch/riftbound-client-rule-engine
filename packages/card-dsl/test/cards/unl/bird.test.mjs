import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/bird.js";
// card-dsl 不依赖 engine-core（方向相反），golden 执行按 workspace 布局直接加载已构建的 engine-core。
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan, prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { DUEL_DOMAINS } from "../../../../engine-core/dist/cost/resources.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-68b515e1903e6d629eeb25b886b6f90bb791121e70c5ea72793220dd7f70e70d";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)";

const [keyword] = program.abilities;

test("unl-t02 Bird: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-t02 Bird: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /RIFT-360/);
  assert.match(program.judgeReason, /Energy/);
  assert.match(program.judgeReason, /plan\.power/);
  // Current-gap refresh: name the concrete missing mappings and consumers.
  assert.match(program.judgeReason, /target\.tax has no layer mapping/);
  assert.match(program.judgeReason, /engine-runtime\/host\.ts/);
  assert.match(program.judgeReason, /809\.2/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // judge-required 必须写清缺什么接线、依据哪条规则、依赖哪个任务（README 第 2 节）。
});

test("unl-t02 Bird: exactly one unvalued Deflect keyword ability", () => {
  // 809.1.b.3：省略的 X 按 1 处理，因此卡文件省略 value，由 KeywordDef 提供默认值。
  // CR 187.7 的「1 [M] Bird token 具有 Deflect」由创建它的效果与 token 定义承载（187），
  // 不在本 token 上重复声明。
  assert.equal(program.abilities.length, 1);
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "deflect");
  assert.equal(keyword.value, undefined);
});

test("unl-t02 Bird: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Deflect");
  assert.ok(registered, "effects/keywords/Deflect.ts must be in the generated registry");
  // 契约 3.7：卡文件的 keyword id 对齐注册表条目。
  assert.equal(keyword.keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("809.1.c"));
  assert.ok(registered.ruleRefs.includes("809.1.c.1"));
  // 809.2：多个来源授予的 Deflect 数值相加。
  assert.equal(registered.stacking, "sum");
});

test("unl-t02 Bird: the expansion is static target.tax 1 (809.1.b.3's presumed X)", () => {
  const [expansion] = deflect.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
  // 809.2：显式传入 2 时值相加（多来源授予的求和由关键词层负责）。
  const [valued] = deflect.expand({ value: 2, host: { canonicalCardId: program.canonicalCardId } });
  assert.deepEqual(valued.effect.value, { kind: "constant", value: 2 });
});

test("unl-t02 Bird: the expanded target.tax grant still has no layer mapping in the production binder (809.1.c)", () => {
  // Evidence for the remaining gap: the merged static binder refuses the
  // expansion, so no Deflect tax can be derived from the permanent at all.
  const f = fixture({ cards: [
    { id: "bird", cardId: CANONICAL_ID, types: ["unit"], energy: 0, power: [], might: 1, zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("bird"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.throws(() => createEngineStaticBinder(f.engine).bindStatic(expansion, f.kernel.getObject("bird")),
    /target\.tax has no layer mapping/);
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("Bird: the reference kernel's pay action still ignores the prepared Power allocation (809.1.c.1)", () => {
  // Evidence for the remaining gap: preparing a payment plans Power, but the
  // merged kernel payment only consumes energy/xp, so a Deflect Power cost is
  // never actually deducted at the action boundary.
  const kernel = world().player("A", { energy: 2, power: ["Fury"] }).build();
  const plan = buildCostPlan(kernel, {
    id: "bird:power-consumption", domains: [], cost: {},
    mandatoryAdditional: [{ id: "bird:tax", cost: { power: { kind: "constant", value: 1 } } }]
  });
  const prepared = prepareCostPayment(kernel, plan);
  assert.deepEqual(prepared.power.power, [{ requirementIndex: 0, from: "Fury", amount: 1 }]);
  for (const entry of prepared.actions) {
    assert.equal(kernel.perform(entry.action).status, "done");
  }
  // The Power is still in the pool: the merged kernel pay action only subtracts
  // energy/xp, which is exactly why the card cannot claim the tax is enforced.
  assert.deepEqual(kernel.player("A").power, ["Fury"]);
});

test.todo("bird: derive Deflect on each enemy target choice and append unrestricted-domain Power to Finalize costs (CR 809.1.c.1/809.1.d; RIFT-360)");

for (const domain of ["Fury", "Order"]) {
  test(`Bird: the cost allocator prepares the Deflect Power component using ${domain} (809.1.c.1)`, () => {
    const kernel = world().player("A", { energy: 2, power: [domain] }).build();
    const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
    // This checks actual allocation and the kernel action, not resource
    // consumption. Automatic target-tax derivation is RIFT-360.
    const plan = buildCostPlan(kernel, {
      id: "bird:deflect", domains: [], cost: { energy: { kind: "constant", value: 2 } },
      mandatoryAdditional: [{ id: "bird:tax", cost: { power: expansion.effect.value } }]
    });
    assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
    const before = kernel.snapshot();
    const prepared = prepareCostPayment(kernel, plan);
    assert.deepEqual(prepared.power.power, [{ requirementIndex: 0, from: domain, amount: 1 }]);
    assert.deepEqual(prepared.actions, [{
      id: "bird:deflect:resources",
      action: { type: "pay", player: "A", plan: { finalized: true, energy: 2, power: [domain] } }
    }]);
    assert.deepEqual(kernel.snapshot(), before, "preparing a payment does not spend resources");
  });
}

test.todo("bird: execute Deflect Power payment against a kernel that consumes the prepared Power action, then verify the resource delta (CR 809.1.c.1; RIFT-360 integration)");

test("Bird: Energy cannot substitute for the required Deflect Power (809.1.c.1)", () => {
  const kernel = world().player("A", { energy: 10, power: [] }).build();
  const plan = buildCostPlan(kernel, {
    id: "bird:unpayable", domains: [], cost: {},
    mandatoryAdditional: [{ id: "bird:tax", cost: { power: { kind: "constant", value: 1 } } }]
  });
  assert.throws(() => payCostPlan(kernel, plan), error => error.reason === "cannot-pay-cost");
  assert.equal(kernel.player("A").energy, 10);
});
