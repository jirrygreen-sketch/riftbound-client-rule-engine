import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/reflection.js";
// card-dsl 不依赖 engine-core（方向相反），golden 执行按 workspace 布局直接加载已构建的 engine-core。
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-7538c2135b030e4e91c01e4952055324c62e0182b94d2d0bf0c272f7f55e2373";
const SOURCE_TEXT =
  "(I become a copy of something when played. I don't get that card's play effects.)";

test("unl-t06 Reflection: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-t06 Reflection: no-ability token identity and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  // 135.2.d.1/.d.3：整段原文都在圆括号内，是 reminder text（不产生能力），因此按
  // README 第 2 节是 no-ability——经卡面确认没有能力文本，不是“还没实现”的占位状态。
  assert.equal(program.status, "no-ability");
  assert.equal(program.judgeReason, undefined);
  assert.deepEqual(program.abilities, []);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-t06 Reflection: the whole printed text is reminder text (parentheses only)", () => {
  // 本印刷是本地目录里唯一「整段 ability 都在圆括号内」的实例；这决定 no-ability 的判定。
  assert.match(program.sourceText, /^\(.*\)$/s);
  assert.match(program.sourceText, /I don't get that card's play effects/);
});

test("unl-t06 Reflection golden: the merged token definition carries CR 187.6's 0 Might domainless unit", () => {
  // 187.6 的 Reflection 定义（无领域、0 Might 的单位 token）由 effect.token 的冻结定义表
  // 承载；「becomes a copy …」的复制指令属于**创建它的效果**（446.3），不在本 token 上，
  // 因此这里只执行创建本身，验证定义、token 身份与费用不变量。
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "reflection" },
      amount: { kind: "constant", value: 1 },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["create-token"]);
  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Reflection");
  assert.equal(created[0].types.includes("unit"), true);
  assert.deepEqual(created[0].tags, []);
  assert.equal(created[0].might, 0);
  assert.equal(created[0].isToken, true);
  // 185.3.a / 185.3.b：token 没有费用与领域；energy/power 保持 null，绝不改写成 0。
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  assert.equal(run.linked.token.amount, 1);
  assert.equal(run.linked.token.objects.length, 1);
});

test("unl-t06 Reflection: the copy instruction belongs to the creating effect, not to this token", () => {
  // 446.3：以 copy 方式创建的对象“直接以被复制对象的印刷特征创建”，没有自己的印刷特征；
  // 复制由创建它的卡（如 unl-199-219 Deceiver、unl-200-219 Mirror Image）的正文给出。
  // 本测试固定这一边界：本 token 程序的 abilities 必须为空。
  assert.deepEqual(program.abilities, []);
});

test.todo(
  "reflection: 创建型 copy 的生产路径——effect.copy 的 create 模式与 effect.token 都可用，但「创建后立即成为副本、" +
    "且不获得被复制牌的 Play Effect（383.4.a / 446.3）」需要创建它的效果（unl-199-219 / unl-200-219 一类）落地；" +
    "本 token 自己没有待实现能力"
);
