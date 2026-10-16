import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/swain-visionary.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4f54fa53d7952e0ddc5664e048b84ba9749234c943d017b1e5038773e2f42b74";
const SOURCE_TEXT =
  "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
  "When I conquer, if you've played a non-token unit, a non-token gear, and a spell this turn, " +
  "you score 1 point.";

const [vision, conquer] = program.abilities;
const [unitPlayed, gearPlayed, spellPlayed] = conquer.trigger.condition.conditions;
const [score] = conquer.body;

/** 与程序相同的条件，只把契约层的控制器占位符换成参考内核里真实存在的值。 */
const conditionForKernel = () => ({
  ...conquer.trigger.condition,
  conditions: conquer.trigger.condition.conditions.map(clause => ({
    ...clause,
    left: {
      ...clause.left,
      filter: { ...clause.left.filter, controller: "A" }
    }
  }))
});

const predicateBody = condition => [
  {
    id: "swain-visionary.conquer-condition",
    op: "condition.predicate",
    args: { condition: { kind: "constant", value: condition } }
  }
];

test("ven-065-166 Swain, Visionary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-065-166 Swain: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Vision/);
  assert.match(program.judgeReason, /817\.1\.b/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /RIFT-87/);
});

test("ven-065-166 Swain: [Vision] is declared without a value (817.1.b)", () => {
  assert.deepEqual(vision, { kind: "keyword", keyword: "vision" });
  assert.equal(vision.value, undefined);
});

test("ven-065-166 Swain: 'When I conquer' is a mandatory self conquer trigger", () => {
  assert.equal(conquer.kind, "triggered");
  assert.equal(conquer.trigger.at, "conquer");
  assert.deepEqual(conquer.trigger.filter, { event: "conquer", filter: { source: "self" } });
  // 383.4.c.2.c：即使征服得分被替代，该触发仍进链，因此不把得分成功写成条件。
  assert.equal(conquer.trigger.once, undefined);
  assert.equal(conquer.optional, false);
});

test("ven-065-166 Swain: the extra clause is a trigger condition over three played categories", () => {
  const condition = conquer.trigger.condition;
  // 383.2.a.1：紧跟 Condition 的 if 从句属于触发条件本身，不是 body 指令的条件。
  assert.equal(condition.kind, "all");
  assert.equal(condition.conditions.length, 3);
  assert.deepEqual(condition.conditions.map(clause => clause.operator), ["gte", "gte", "gte"]);
  assert.deepEqual(condition.conditions.map(clause => clause.right), [
    { kind: "constant", value: 1 },
    { kind: "constant", value: 1 },
    { kind: "constant", value: 1 }
  ]);
  // 本回合已打出的非 token 单位 / 非 token gear / 法术（185.1.a 的 token 否定）。
  assert.deepEqual(unitPlayed.left.filter, {
    type: "unit",
    controller: "controller",
    isToken: false
  });
  assert.deepEqual(gearPlayed.left.filter, {
    type: "gear",
    controller: "controller",
    isToken: false
  });
  assert.deepEqual(spellPlayed.left.filter, { type: "spell", controller: "controller" });
});

test("ven-065-166 Swain: the body scores exactly 1 with one unlinked instruction", () => {
  assert.equal(conquer.body.length, 1);
  assert.equal(score.id, "swain-visionary.score-1");
  assert.equal(score.op, "effect.score");
  assert.deepEqual(score.args.amount, { kind: "constant", value: 1 });
  assert.equal(score.targets, undefined);
  assert.equal(score.picks, undefined);
  assert.equal(score.linkedTo, undefined);
});

test("ven-065-166 golden: the conquer body really scores 1 for the ability controller", () => {
  const kernel = world().player("A").build();
  const outcome = resolveChainBody(conquer.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(outcome.linkedValues["swain-visionary.score-1.scored"], [
    { player: "A", amount: 1 }
  ]);
});

test("ven-065-166 golden: the body does not score when a non-controller runs it", () => {
  const kernel = world().player("A").player("B").build();
  Object.defineProperty(kernel, "controller", { value: "B" });
  const outcome = resolveChainBody(conquer.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").score, 1);
  assert.equal(kernel.player("A").score, 0);
});

test("ven-065-166 golden: the trigger condition shape is the conjunction of the three clauses", () => {
  // 条件求值本身需要按特征分类的本回合历史（见 judgeReason 第 2 条），这里只用真实
  // 解释器证明结构可求值：三个子条件的 count 查询在没有任何已打出记录时全为 0。
  const kernel = world().player("A").build();
  const outcome = resolveChainBody(predicateBody(conditionForKernel()), kernel);
  assert.equal(outcome.status, "executed");
  // 没有任何已打出的牌时三条 history 均为 0 ⇒ 条件为假（不得误判为真）。
  assert.equal(outcome.linkedValues["swain-visionary.conquer-condition.value"], false);
});

test.todo(
  "ven-065-166 Swain, Visionary: [Vision]'s Predict needs the ordered top-deck source for effect.inspect " +
    "(817.1.b / 437.1; RIFT-83 / RIFT-64) plus the CardProgram → trigger registration adapter (RIFT-120)"
);
test.todo(
  "ven-065-166 Swain, Visionary: evaluate 'played a non-token unit, a non-token gear, and a spell this turn' " +
    "at trigger time (CR 383.2.a.1) from an object-filtered per-turn play history — HistoryQuery exposes only " +
    "scope/action/timingPoint/player/object (RIFT-87; contract 3.8 objectFilter not merged)"
);
