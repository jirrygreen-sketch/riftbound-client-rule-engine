import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/reluctant-leader.js";

const CANONICAL_ID =
  "card.hash-9ca2b329f015cf54a163a35cbad76798217d6fae4e4bc9b00b585281c2cb65cf";
const SOURCE_TEXT = "When you play another unit, give me +2 :rb_might: this turn.";

const [onAnotherUnit] = program.abilities;
const [grantMight] = onAnotherUnit.body;

test("ven-121-166 Reluctant Leader: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-121-166 Reluctant Leader: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 三处缺口：另一对象的触发过滤、临时 Might、触发注册。
  assert.match(program.judgeReason, /matchesTriggerEvent/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("ven-121-166 Reluctant Leader: the trigger describes another played unit, not this card's play", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(onAnotherUnit.kind, "triggered");
  // 383.4.a / 420.4.a：打出完成后触发，时点 card-played。
  assert.equal(onAnotherUnit.trigger.at, "card-played");
  // 383.4.a.4："another object is played" 不是本卡的 Play Effect，所以 filter 描述的是
  // 被献出的单位（type unit + 控制者为你 + 排除宿主自身），而不是 { source: "self" }。
  assert.deepEqual(onAnotherUnit.trigger.filter, {
    event: "card-played",
    filter: {
      type: "unit",
      controller: "controller",
      other: true
    }
  });
  assert.notDeepEqual(onAnotherUnit.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(onAnotherUnit.trigger.condition, undefined);
  assert.equal(onAnotherUnit.optional, false);
});

test("ven-121-166 Reluctant Leader: the body declares a temporary +2 Might, never a Buff counter", () => {
  assert.equal(onAnotherUnit.body.length, 1);
  assert.equal(grantMight.id, "reluctant-leader.give-plus-2");
  // 143.2 / 143.2.a：带回合期限的 Might 修正属算术图层；effect.buff 的文件头明确临时
  // Might 归 continuous.might，本卡不放置 Buff（也没有 effect.buff 指令）。
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args, {
    amount: { kind: "constant", value: 2 },
    duration: { kind: "constant", value: "this-turn" }
  });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
});

test.todo(
  "ven-121-166 Reluctant Leader: the 'you play another unit' trigger fires and filters to another unit " +
    "(CR 383.4.a.4) — events/pipeline-match.ts has no 'another object / exclude the host' key and the " +
    "card-played to card-trigger registration is not wired (RIFT-120)"
);

test.todo(
  "ven-121-166 Reluctant Leader: 'give me +2 :rb_might: this turn' applies and expires at end of turn " +
    "(CR 143.2 / 475-477) — no continuous.might instruction primitive registers through " +
    "ResolveContext.addContinuous (RIFT-91 follow-up); a Buff counter is never a substitute (CR 702/703)"
);
