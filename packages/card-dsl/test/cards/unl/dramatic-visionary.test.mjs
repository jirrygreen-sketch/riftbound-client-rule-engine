import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/dramatic-visionary.js";
// card-dsl 不依赖 engine-core（方向相反），golden 执行按 workspace 布局直接加载已构建的 engine-core。
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-9638bc0d7af1a05e5d627ef7b87dd78c4c9702d56c4e121fffe661393fbd3456";
const SOURCE_TEXT =
  "[Deathknell][>] [Predict 2]. (When I die, look at the top two cards of your Main Deck. " +
  "Recycle any of them and put the rest back in any order.)";

const [keyword, triggered] = program.abilities;
const [bindController, look, recycle, putBack] = triggered.body;

/**
 * Predict 2 的查看范围必须按 zoneSlice 的真实牌库顺序提供（契约 3.6）；参考内核用
 * setPicks 提供该有序集合，与已合入示例 apprentice-mage / stacked-deck 的写法一致，
 * 不用无序 query 近似牌库顶。
 */
const PREDICT_CHOICE_ID = "dramatic-visionary.predict-look/dramatic-visionary.predict";
/** effect.order 的排序请求 id（原语固定形状：effect.order:<destination>:<player>）。 */
const PUT_BACK_ORDER_ID = "dramatic-visionary.predict-put-back/effect.order%3Atop%3AA";

const deckWorld = (ids) => {
  const kernel = world().deck(ids, { owner: "A" }).build();
  const viewed = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  kernel.setPicks("dramatic-visionary.predict-top-2", viewed);
  return { kernel, viewed };
};

test("unl-062-219 Dramatic Visionary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-062-219 Dramatic Visionary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // judge-required 必须写清缺哪个操作/哪条规则/依赖哪个任务（README 第 2 节）。
  assert.match(program.judgeReason, /Deathknell/);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /808\.1\.d\.1/);
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /RIFT-82/);
});

test("unl-062-219 Dramatic Visionary: [Deathknell] keyword plus the object-killed effect body", () => {
  assert.equal(program.abilities.length, 2);
  // 808.1：关键词只声明，展开由关键词注册表负责（契约 3.7 / README 第 5 节）。
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(keyword.value, undefined);

  // 808.1.c / 808.1.d："When I die" = 宿主被消灭（object-killed）。
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.trigger.condition, undefined);
  // [Predict 2] 是效果正文，不是可选项。
  assert.equal(triggered.optional, false);
});

test("unl-062-219 Dramatic Visionary: your Main Deck is the controller's deck, read from a bound link value", () => {
  assert.equal(bindController.id, "dramatic-visionary.bind-controller");
  assert.equal(bindController.op, "condition.value");
  // 190.6.d 的隐含 you = 能力控制者；用契约 3.6 的符号选择器 “source”，不写运行时 ObjectRef。
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindController.args.key, { kind: "constant", value: "controller" });
  assert.equal(bindController.linkedTo, undefined);

  assert.deepEqual(look.args.player, {
    kind: "linked-value",
    instructionId: "dramatic-visionary.bind-controller",
    key: "controller"
  });
  assert.equal(look.linkedTo, "dramatic-visionary.bind-controller");
});

test("unl-062-219 Dramatic Visionary: Predict 2 is inspect(top, 2) -> recycle(chosen) -> order(top, 2 - recycled)", () => {
  assert.deepEqual(triggered.body.map((instruction) => instruction.id), [
    "dramatic-visionary.bind-controller",
    "dramatic-visionary.predict-look",
    "dramatic-visionary.predict-recycle",
    "dramatic-visionary.predict-put-back"
  ]);

  // 437.1 / 437.1.a：看牌库顶两张，回收其中任意张（0..2）。top scope 必须由上游提供有序 picks。
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "dramatic-visionary.predict-top-2"
  });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount.value, { min: 0, max: 2 });
  assert.deepEqual(look.args.choosePicksKey, { kind: "constant", value: "predict-recycle" });
  assert.equal(look.targets, undefined);

  // 417.1：被选中的牌回收（回到底部）；未选中时 0 张，仍按 executed 结算。
  assert.equal(recycle.op, "effect.recycle");
  assert.equal(recycle.linkedTo, "dramatic-visionary.predict-look");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "dramatic-visionary.predict-look",
    key: "predict-recycle"
  });

  // 437.1.a："put the rest back in any order" —— 张数是 2 - 实际回收张数，不写死。
  assert.equal(putBack.op, "effect.order");
  assert.equal(putBack.linkedTo, "dramatic-visionary.predict-recycle");
  assert.deepEqual(putBack.args.destination, { kind: "constant", value: "top" });
  assert.deepEqual(putBack.args.chooseOrder, { kind: "constant", value: true });
  assert.deepEqual(putBack.args.count, {
    kind: "arithmetic",
    operator: "sub",
    operands: [
      { kind: "constant", value: 2 },
      {
        kind: "linked-value",
        instructionId: "dramatic-visionary.predict-recycle",
        key: "recycledCount"
      }
    ]
  });
});

test("unl-062-219 Dramatic Visionary golden: recycling one looked-at card puts the rest back in the chosen order", () => {
  const { kernel, viewed } = deckWorld(["top", "second", "third"]);
  kernel.setAnswers({
    [PREDICT_CHOICE_ID]: [viewed[0]],
    [PUT_BACK_ORDER_ID]: [viewed[1]]
  });

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["dramatic-visionary.bind-controller", "executed"],
      ["dramatic-visionary.predict-look", "executed"],
      ["dramatic-visionary.predict-recycle", "executed"],
      ["dramatic-visionary.predict-put-back", "executed"]
    ]
  );
  // look 只披露给查看者，不改变区域（128.3 / 437.1）：查看结束前两张牌仍在牌库。
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-look.inspected"], 2);
  assert.equal(outcome.linkedValues["dramatic-visionary.bind-controller.controller"], "A");
  // 417.1：被选中的 top 回收到牌库底部；放回张数 = 2 - 1 = 1。
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "second",
    "third",
    "top"
  ]);
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-recycle.recycledCount"], 1);
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-put-back.ordered"], 1);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("unl-062-219 Dramatic Visionary golden: recycling nothing puts both cards back in the chosen order", () => {
  const { kernel, viewed } = deckWorld(["top", "second", "third"]);
  kernel.setAnswers({
    [PREDICT_CHOICE_ID]: [],
    // 437.1.a 的 “any order”：玩家给出的顺序原样生效。
    [PUT_BACK_ORDER_ID]: [viewed[1], viewed[0]]
  });

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-recycle.recycledCount"], 0);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "second",
    "top",
    "third"
  ]);
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-put-back.ordered"], 2);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("unl-062-219 Dramatic Visionary golden: recycling both leaves nothing to put back", () => {
  const { kernel, viewed } = deckWorld(["top", "second", "third"]);
  kernel.setAnswers({ [PREDICT_CHOICE_ID]: viewed });

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-recycle.recycledCount"], 2);
  // count = 2 - 2 = 0：不产生动作，仍链接 0（437.4 的边界）。
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-put-back.ordered"], 0);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "third",
    "top",
    "second"
  ]);
});

test("unl-062-219 Dramatic Visionary golden: a short deck predicts as many as possible without Burn Out (437.4/437.4.a)", () => {
  const { kernel } = deckWorld(["only"]);
  kernel.setAnswers({ [PREDICT_CHOICE_ID]: [] });

  const outcome = resolveChainBody(triggered.body, kernel);
  // 437.4：牌库只有一张时看一张、放回一张；437.4.a：不因此 Burn Out。
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-look.inspected"], 1);
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-put-back.ordered"], 1);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), ["only"]);
  assert.equal(kernel.player("A").handSize, 0);
});

test("unl-062-219 Dramatic Visionary golden: an empty deck looks at nothing and the body still completes", () => {
  const kernel = world().build();
  kernel.setPicks("dramatic-visionary.predict-top-2", []);

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-look.inspected"], 0);
  assert.equal(outcome.linkedValues["dramatic-visionary.predict-put-back.ordered"], 0);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("unl-062-219 Dramatic Visionary: a non-zero top scope without an ordered pick set is blocked, never a set query", () => {
  // 契约 3.6 / effect.inspect：非零 top 查看必须由上游提供有序 picks；缺有序来源时明确
  // negated(impossible)，不截取无序 query 近似牌库顶。
  const { kernel } = deckWorld(["top", "second"]);
  const bound = { ...bindController, args: { ...bindController.args } };
  const withoutOrderedRange = {
    ...look,
    args: Object.fromEntries(
      Object.entries(look.args).filter(([key]) => key !== "picksSpecId")
    )
  };
  const outcome = resolveChainBody([bound, withoutOrderedRange], kernel);
  assert.equal(outcome.status, "partial");
  const result = outcome.results.find((entry) => entry.id === look.id).result;
  assert.equal(result.status, "negated");
  assert.equal(result.reason, "impossible");
  // 没有任何牌被查看或移动。
  assert.equal(kernel.player("A").deckSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "dramatic-visionary: [Deathknell] keyword expansion (订阅 object-killed、808.1.d.1 死亡被替代时把触发移出链、" +
    "808.1.d.3 / 429.1.a.1.b 换区前记录最后已知信息并作为 Pending Item 入链) —— effects/keywords/Deathknell.ts 的" +
    "展开体引用未合入的 trigger.leave 原语，依赖 RIFT-82"
);

test.todo(
  "dramatic-visionary: CardProgram -> trigger 管线——没有订阅方把 808.1.c 的 object-killed 触发注册进时点/链" +
    "（契约 3.5；引擎批 4 / RIFT-120 接线）"
);

test.todo(
  "dramatic-visionary: 生产侧有序牌库顶 picks 生命周期——链 Finalize 只锁定 instruction.targets，" +
    "没有按 zoneSlice 顺序提供 effect.inspect top scope 的 picksSpecId（同 stacked-deck 的缺口）"
);
