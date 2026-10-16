import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/bird.js";
// card-dsl 不依赖 engine-core（方向相反），golden 执行按 workspace 布局直接加载已构建的 engine-core。
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
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
  assert.equal(program.sourceText, SOURCE_TEXT);
  // judge-required 必须写清缺什么接线、依据哪条规则、依赖哪个任务（README 第 2 节）。
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /Energy/);
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

test("unl-t02 Bird: the merged TargetPlan tax path appends the Deflect tax for the choosing opponent", () => {
  // 809.1.d：Deflect 是强制附加费用，选择该永久物的玩家在 Finalize 支付；
  // 这里执行已合入的 TargetPlan 追加路径：选 Bird 会追加一笔 tax 请求。
  const kernel = world()
    .unit("bird", { might: 1, tags: ["Bird"], isToken: true, keywords: [{ id: "deflect", value: 1 }] })
    .build();
  const requests = [];
  const plan = finalizeTargetPlan(
    kernel,
    { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
    {
      selected: [kernel.ref("bird")],
      tax: { kind: "deflect", amount: 1 },
      taxAdapter: {
        appendTargetTax: (request) => {
          requests.push(request);
          return { status: "appended" };
        }
      }
    }
  );

  assert.deepEqual(plan.selected, [kernel.ref("bird")]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "deflect");
  assert.equal(requests[0].amount, 1);
  assert.equal(requests[0].payer, "A");
  assert.deepEqual(requests[0].target, kernel.ref("bird"));
});

test("unl-t02 Bird: an unpayable Deflect tax makes the choice illegal (809.1.d)", () => {
  const kernel = world().unit("bird", { might: 1, tags: ["Bird"], isToken: true }).build();
  assert.throws(
    () =>
      finalizeTargetPlan(
        kernel,
        { id: "spell-target", filter: { type: "unit" }, min: 1, max: 1, selection: "one" },
        {
          selected: [kernel.ref("bird")],
          tax: { kind: "deflect", amount: 1 },
          taxAdapter: { appendTargetTax: () => ({ status: "unpayable", reason: "no power available" }) }
        }
      ),
    (error) => error.code === "target-tax-unpayable"
  );
});

test.todo(
  "bird: 生产侧的「持续效果 → TargetPlan 税」派生——没有生产方从永久物的 target.tax 持续效果生成税请求，" +
    "TargetPlan 只在调用方显式传入 tax 时才追加（契约 3.8 第 4 条把目标锁定通知归引擎批 4；RIFT-90）"
);

test.todo(
  "bird: 809.1.c.1 要求追加费用用任意域 Power（rainbow）支付——已合入的税→费用换算按 Energy 记账" +
    "（chain/engine.ts 的 mandatoryAdditional 用 energy 常量），需要费用计划的任意域 Power 支付路径（RIFT-89）"
);
