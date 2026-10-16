import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/yasuo-windrider.js";

test("ogn-205-298 Yasuo, Windrider: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-03848f0e530587876003913478c758509f6b05e8b89b33575cb4fd9da70f9cf1"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.score/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /third time|第 N 次/);
  assert.equal(
    program.sourceText,
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "The third time I move in a turn, you score 1 point."
  );
});

test("ogn-205-298 Yasuo, Windrider: Ganking keyword plus a third-move trigger that scores 1 point", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  // CR 810: Ganking is a passive ability keyword; the card only names it
  // (contract §5), the expansion lives in effects/keywords/Ganking.ts.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "ganking" });
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  // CR 383.1.b / 383.2.a: "the [Nth] time" is the trigger condition; 449.1
  // defines the Move that the object-moved timing point reports.
  assert.equal(triggered.trigger.at, "object-moved");
  assert.deepEqual(triggered.trigger.filter, { event: "object-moved", source: "self" });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);

  // "The third time I move in a turn": count this object's Moves this turn.
  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.deepEqual(condition.right, { kind: "constant", value: 3 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "self-moves-this-turn");
  assert.deepEqual(condition.left.filter, {
    object: "self",
    action: "move-location",
    scope: "turn"
  });

  assert.equal(triggered.body.length, 1);
  const [score] = triggered.body;
  assert.equal(score.id, "yasuo-windrider.score-1");
  // CR 470.2: card text "score X points" means Gaining Points, not the
  // battlefield Scoring process.
  assert.equal(score.op, "effect.score");
  assert.deepEqual(score.args.amount, { kind: "constant", value: 1 });
  assert.equal(score.targets, undefined);
  assert.equal(score.picks, undefined);
  assert.equal(score.linkedTo, undefined);
  assert.equal(score.condition, undefined);
});

test.todo(
  "ogn-205-298 Yasuo, Windrider: 'you score 1 point' (CR 470.2, Gaining Points) — " +
    "effects/instructions/ 没有 effect.score 原语（RIFT-9 清单中的 score 尚未实现），待原语落地后补执行场景"
);

test.todo(
  "ogn-205-298 Yasuo, Windrider: [Ganking] expansion execution (810.1.c/144.4.c 战场到战场的 Standard Move 许可) — " +
    "effects/keywords/Ganking.ts 展开成 continuous.movement，但移动系统还没有读取该许可的接口，依赖 RIFT-83 后续"
);

test.todo(
  "ogn-205-298 Yasuo, Windrider: 'The third time I move in a turn' as a per-object Nth-event trigger " +
    "(CR 383.1.b；458 Recall 不计入 Move) — 现有 Expr/Condition 只有集合 count 与 condition.history 计数，" +
    "没有「恰好第 N 次事件只触发一次」的触发形状"
);
