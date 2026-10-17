import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/swain-visionary.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
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
  assert.match(program.judgeReason, /RIFT-357|RIFT-358/);
  assert.match(program.judgeReason, /objectFilter/);
  assert.ok(!/RIFT-87/.test(program.judgeReason));
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
  // 参考内核对 count 表达式做的是现场对象查询（evaluate → ctx.query）,合取结构
  // 仍可被真实解释器求值：棋盘上没有已打出的牌时三条子条件全为 0 ⇒ 条件为假。
  const kernel = world().player("A").build();
  const outcome = resolveChainBody(predicateBody(conditionForKernel()), kernel);
  assert.equal(outcome.status, "executed");
  // 没有任何已打出的牌时三条查询均为 0 ⇒ 条件为假（不得误判为真）。
  assert.equal(outcome.linkedValues["swain-visionary.conquer-condition.value"], false);
});

test("ven-065-166 golden: the merged history primitive evaluates the three-clause filters (HistoryQuery objectFilter)", () => {
  // 该 golden 显式使用已合入的 condition.history 原语（interpreter/history.ts）验证
  // objectFilter/isToken 维度；它不执行卡内原始条件——原始条件走 count 表达式的
  // 现场集合查询，见下一个反例。play 动作由内核真实执行并连 object 快照写入
  // history（timingPoint card-played）。
  const playedHistoryQuery = (objectFilter, filterPlayer = "A") => ({
    id: "swain-visionary.conquer-condition",
    op: "condition.history",
    args: {
      query: {
        kind: "constant",
        value: { scope: "turn", action: "play", player: filterPlayer, objectFilter }
      },
      operator: { kind: "constant", value: "gte" },
      right: { kind: "constant", value: 1 }
    }
  });

  const kernel = world()
    .player("A")
    .card("played-unit", { owner: "A", zone: "hand", types: ["unit"], isToken: false })
    .card("played-gear", { owner: "A", zone: "hand", types: ["gear"], isToken: false })
    .card("played-spell", { owner: "A", zone: "hand", types: ["spell"] })
    .build();
  for (const id of ["played-unit", "played-gear", "played-spell"]) {
    const outcome = kernel.perform({
      type: "play",
      player: "A",
      object: kernel.ref(id),
      cost: { finalized: true, energy: 0, power: [] }
    });
    assert.equal(outcome.status, "done", "play " + id);
  }
  for (const objectFilter of [
    { type: "unit", isToken: false },
    { type: "gear", isToken: false },
    { type: "spell" }
  ]) {
    const gate = runAbilityBody([playedHistoryQuery(objectFilter)], kernel);
    assert.equal(gate.status, "executed", JSON.stringify(objectFilter));
    assert.equal(gate.linkedValues["swain-visionary.conquer-condition.count"], 1);
    assert.equal(gate.linkedValues["swain-visionary.conquer-condition.value"], true);
  }

  // 反例：单位记录换成 token 后 isToken: false 过滤把它排除，三件套不齐。
  const tokenKernel = world()
    .player("A")
    .card("token-unit", { owner: "A", zone: "hand", types: ["unit"], isToken: true })
    .card("played-gear", { owner: "A", zone: "hand", types: ["gear"], isToken: false })
    .card("played-spell", { owner: "A", zone: "hand", types: ["spell"] })
    .build();
  for (const id of ["token-unit", "played-gear", "played-spell"]) {
    const outcome = tokenKernel.perform({
      type: "play",
      player: "A",
      object: tokenKernel.ref(id),
      cost: { finalized: true, energy: 0, power: [] }
    });
    assert.equal(outcome.status, "done", "play " + id);
  }
  const tokenUnitGate = runAbilityBody(
    [playedHistoryQuery({ type: "unit", isToken: false })],
    tokenKernel
  );
  assert.equal(tokenUnitGate.linkedValues["swain-visionary.conquer-condition.count"], 0);
  assert.equal(tokenUnitGate.linkedValues["swain-visionary.conquer-condition.value"], false);
});

test("ven-065-166 golden: the card's original condition does not read play history (fails closed)", () => {
  // 用卡内原始条件（含 controller:"controller" 占位符，不做内核替换）执行，复现
  // 触发管线的现场求值路径：count 表达式走集合查询、不读历史。占位符在集合查询
  // 里不匹配任何真实 playerId，所以打牌前后都 fail-closed 为假。把占位符换成
  // 真实 playerId 后，三类牌留在手里、playHistory=0 时条件就返回 true（集合查询
  // 命中当前手牌）——这条「错误 true」证明即使换掉占位符，求值也不读「本回合
  // 打出过」这一历史事实；打出到棋盘后它同样为 true，但那是棋盘现状与历史巧合，
  // 不是历史判定。两条路径都不读历史，因此条件不可执行。
  const kernel = world()
    .player("A")
    .card("hand-unit", { owner: "A", zone: "hand", types: ["unit"], isToken: false })
    .card("hand-gear", { owner: "A", zone: "hand", types: ["gear"], isToken: false })
    .card("hand-spell", { owner: "A", zone: "hand", types: ["spell"] })
    .build();
  for (const id of ["hand-unit", "hand-gear", "hand-spell"]) {
    const outcome = kernel.perform({
      type: "play",
      player: "A",
      object: kernel.ref(id),
      cost: { finalized: true, energy: 0, power: [] }
    });
    assert.equal(outcome.status, "done", "play " + id);
  }
  assert.equal(kernel.history({ scope: "turn", action: "play", player: "A" }), 3);
  assert.equal(kernel.getObject("hand-unit").zone, "board");
  assert.equal(kernel.getObject("hand-gear").zone, "board");
  assert.equal(kernel.getObject("hand-spell").zone, "board");
  const playedOutcome = runAbilityBody(predicateBody(conquer.trigger.condition), kernel);
  assert.equal(playedOutcome.status, "executed");
  assert.equal(playedOutcome.linkedValues["swain-visionary.conquer-condition.value"], false);

  // 对照反例：同样的牌留在手里（playHistory = 0），条件应表达「本回合打出过」而
  // 返回 false——占位符路径 fail-closed 为假，换真值后集合查询命中手牌返回 true，
  // 两条路径都不读历史。
  const handKernel = world()
    .player("A")
    .card("hand-unit", { owner: "A", zone: "hand", types: ["unit"], isToken: false })
    .card("hand-gear", { owner: "A", zone: "hand", types: ["gear"], isToken: false })
    .card("hand-spell", { owner: "A", zone: "hand", types: ["spell"] })
    .build();
  assert.equal(handKernel.history({ scope: "turn", action: "play", player: "A" }), 0);
  const withPlaceholder = runAbilityBody(predicateBody(conquer.trigger.condition), handKernel);
  assert.equal(withPlaceholder.status, "executed");
  assert.equal(withPlaceholder.linkedValues["swain-visionary.conquer-condition.value"], false);
  const withRealController = runAbilityBody(predicateBody(conditionForKernel()), handKernel);
  assert.equal(withRealController.status, "executed");
  assert.equal(withRealController.linkedValues["swain-visionary.conquer-condition.value"], true);
});

test.todo(
  "ven-065-166 Swain, Visionary: [Vision]'s Predict needs the ordered top-deck source for effect.inspect " +
    "(817.1.b / 437.1) plus the ordered picks prerequisite (RIFT-357 / RIFT-358, in flight)"
);
test.todo(
  "ven-065-166 Swain, Visionary: evaluate 'played a non-token unit, a non-token gear, and a spell this turn' " +
    "at trigger time (CR 383.2.a.1) — the trigger pipeline evaluates spec.condition as a live set query " +
    "(host.testTrigger → kernel.test), not from play history; no merged path evaluates the three-clause " +
    "'played … this turn' condition (HistoryQuery/condition.history is merged as an independent primitive " +
    "but is not wired into the card's count condition)"
);
