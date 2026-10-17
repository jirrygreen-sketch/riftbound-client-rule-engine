import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/swain-visionary.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
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
  assert.match(program.judgeReason, /subject/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /objectFilter/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /finalizeOrderedPickPlans/);
  assert.ok(!/RIFT-87|RIFT-357|RIFT-358|RIFT-359/.test(program.judgeReason));
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
  // 现场集合查询，见下面按正确规则断言的 TODO。play 动作由内核真实执行并连 object 快照写入
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
  // 三类牌在手中不等于本回合打出过；已合入的历史原语必须全部返回假。
  assert.equal(kernel.history({ scope: "turn", action: "play", player: "A" }), 0);
  for (const objectFilter of [
    { type: "unit", isToken: false },
    { type: "gear", isToken: false },
    { type: "spell" }
  ]) {
    const gate = runAbilityBody([playedHistoryQuery(objectFilter)], kernel);
    assert.equal(gate.status, "executed", JSON.stringify(objectFilter));
    assert.equal(gate.linkedValues["swain-visionary.conquer-condition.count"], 0);
    assert.equal(gate.linkedValues["swain-visionary.conquer-condition.value"], false);
  }
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

test("ven-065-166 TODO: the original condition is true after all three categories were played this turn", {
  todo: "CR 383.2.a.1: count cards actually played this turn — expr.ts ignores subject and queries the live object set"
}, () => {
  // 原始条件和规则预期都保留；依赖接通后此用例应通过，再移除 TODO。
  // 不能将当前的 false 作为打出过三类牌之后的正确结果。
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
  assert.equal(playedOutcome.linkedValues["swain-visionary.conquer-condition.value"], true);
});

test("ven-065-166 TODO: the original condition is false when all three categories remain unplayed in hand", {
  todo: "CR 383.2.a.1: count cards played this turn instead of matching the current object set (subject is not consumed by expr.ts)"
}, () => {
  // 直接执行卡内原始条件。将测试玩家命名为 controller，让原条件的控制者键能命中，
  // 从而单独复现现场集合查询误算手牌的问题，不改写条件，也不伪造历史。
  const base = world()
    .player("controller")
    .card("hand-unit", { owner: "controller", zone: "hand", types: ["unit"], isToken: false })
    .card("hand-gear", { owner: "controller", zone: "hand", types: ["gear"], isToken: false })
    .card("hand-spell", { owner: "controller", zone: "hand", types: ["spell"] })
    .build();
  const kernel = base.clone({ controller: "controller" });
  for (const id of ["hand-unit", "hand-gear", "hand-spell"]) {
    assert.equal(kernel.getObject(id).zone, "hand");
  }
  assert.equal(kernel.history({ scope: "turn", action: "play", player: "controller" }), 0);
  const outcome = runAbilityBody(predicateBody(conquer.trigger.condition), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["swain-visionary.conquer-condition.value"], false);
});

test("ven-065-166 Swain gap: the Vision expansion carries no ordered top-deck pick", () => {
  // Executed evidence for judgeReason point 1: keywords/Vision.ts runs
  // effect.inspect with scope top + picksSpecId, but its body declares no
  // zoneSlice-bearing PickSpec, so the chain locks zero ordered picks.
  const kernel = world().player("A").deck(["top-card", "second"], { owner: "A" })
    .unit("swain", { cardId: CANONICAL_ID }).build();
  const expanded = expandProgram(program, kernel.getObject("swain"));
  const vision = expanded.expanded.find(entry => entry.trigger?.at === "object-enters-board");
  assert.equal(vision.body[0].op, "effect.inspect");
  assert.equal(vision.body[0].args.scope, undefined);
  assert.equal(vision.body[0].args.amount.value, 1);
  assert.equal(vision.body[0].picks ?? null, null);
  assert.deepEqual(finalizeOrderedPickPlans(kernel, vision.body), []);
});

test("ven-065-166 Swain gap: the count condition ignores its subject and reads the live object set", () => {
  // Executed evidence for judgeReason point 2: expr.ts's count only calls
  // query(filter) and never consumes subject, so cards still in hand satisfy
  // the "played this turn" clauses (two-units-in-hand => unit clause true).
  const base = world()
    .player("controller")
    .card("hand-unit", { owner: "controller", zone: "hand", types: ["unit"], isToken: false })
    .card("hand-gear", { owner: "controller", zone: "hand", types: ["gear"], isToken: false })
    .card("hand-spell", { owner: "controller", zone: "hand", types: ["spell"] })
    .build();
  const kernel = base.clone({ controller: "controller" });
  assert.equal(kernel.history({ scope: "turn", action: "play", player: "controller" }), 0);
  const outcome = resolveChainBody(predicateBody(conquer.trigger.condition), kernel);
  // The three in-hand cards make every clause's live query non-zero, so the
  // conjunction is true although nothing has been played this turn.
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["swain-visionary.conquer-condition.value"], true);
});

test("ven-065-166 Swain gap: the conquer identity anchor rejects the real scoring payload", () => {
  // Executed evidence for judgeReason point 3: turn/flow.ts emits conquer with
  // only player + details.battlefieldId; translateTriggerFilter binds
  // source: "self" to pattern.object, so the real payload does not match.
  const pattern = translateTriggerFilter(conquer.trigger.filter, "swain-instance", "conquer");
  const event = {
    type: "task-resolved", seq: 1, eventId: 1, turnNumber: 1, activePlayerId: "A",
    taskId: "pipeline:1", sourceCardId: "", reason: "conquer", autoResolved: true,
    timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" }
  };
  assert.deepEqual(pattern, { event: "conquer", object: { objectId: "swain-instance" } });
  assert.equal(matchesTriggerEvent(pattern, event, "A"), false);
  assert.equal(
    matchesTriggerEvent(pattern, { ...event, object: { ref: { id: "swain-instance", zoneEntryId: 1 } } }, "A"),
    true
  );
});
