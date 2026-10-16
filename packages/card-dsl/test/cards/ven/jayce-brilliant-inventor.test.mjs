import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/jayce-brilliant-inventor.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-68f65f2c819cd1b15484ed93f4ae25ec20c4d71f4e4bd05d3a48672d492f5408";
const SOURCE_TEXT =
  "When you play me or the first time you play a non-token gear each turn, you may ready " +
  "something besides me that's exhausted.";

const [playMe, firstGear] = program.abilities;
const playChoice = playMe.body[0];
const gearChoice = firstGear.body[0];
const playReady = playChoice.args.body.value[0];
const gearReady = gearChoice.args.body.value[0];

/** 参考内核里的宿主：把 source 指向本卡，让 exclude: "source" 解析到被测试对象。 */
function jayceWorld() {
  const kernel = world()
    .unit("jayce", { exhausted: false })
    .unit("exhausted-ally", { exhausted: true })
    .unit("enemy-unit", { owner: "B", controller: "B", exhausted: true })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("jayce") });
}

test("ven-068-166 Jayce, Brilliant Inventor: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-068-166 Jayce: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /per-turn/);
  assert.match(program.judgeReason, /PickSpec/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("ven-068-166 Jayce: the printed 'or' becomes two independent card-played triggers", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(playMe.kind, "triggered");
  assert.equal(playMe.trigger.at, "card-played");
  // 383.4.a："When you play me" 是 Play Effect，来源为自身。
  assert.deepEqual(playMe.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playMe.trigger.once, undefined);
  assert.equal(playMe.optional, true);

  assert.equal(firstGear.kind, "triggered");
  assert.equal(firstGear.trigger.at, "card-played");
  // 「the first time you play a non-token gear each turn」：185.1.a 的 token 否定。
  assert.deepEqual(firstGear.trigger.filter, {
    event: "card-played",
    filter: { type: "gear", isToken: false, controller: "self" }
  });
  // 383.1.b：Nth-Time 触发用 per-turn 许可表达。
  assert.equal(firstGear.trigger.once, "per-turn");
  assert.equal(firstGear.optional, true);
});

test("ven-068-166 Jayce: both halves wrap the ready in choice.optional (contract 3.9)", () => {
  assert.equal(playChoice.op, "choice.optional");
  assert.equal(gearChoice.op, "choice.optional");
  assert.equal(playChoice.args.body.kind, "constant");
  assert.equal(gearChoice.args.body.kind, "constant");
  assert.equal(playChoice.linkedTo, undefined);
  assert.equal(gearChoice.linkedTo, undefined);
  // 三个省缺：被选择执行的指令包在 body 里，而不是靠 choice + linkedTo 串联。
  assert.deepEqual(playChoice.args.body.value.map(instruction => instruction.id), [
    "jayce-brilliant-inventor.play-me.may-ready.ready-other"
  ]);
  assert.deepEqual(gearChoice.args.body.value.map(instruction => instruction.id), [
    "jayce-brilliant-inventor.first-gear.may-ready.ready-other"
  ]);
  assert.deepEqual(playChoice.args.prompt, {
    kind: "constant",
    value: "Ready something besides me that's exhausted?"
  });
});

test("ven-068-166 Jayce: 'something besides me that's exhausted' is a non-target pick", () => {
  for (const [label, ready] of [["play-me", playReady], ["first-gear", gearReady]]) {
    assert.equal(ready.op, "effect.ready", label);
    assert.deepEqual(ready.args, {
      objects: { kind: "constant", value: { kind: "pick", id: "jayce-brilliant-inventor.exhausted-other" } }
    }, label);
    // picks 不是目标：不得触发“成为目标”相关效果（契约 3.4）。
    assert.equal(ready.targets, undefined, label);
    assert.equal(ready.picks.length, 1, label);
    const [pick] = ready.picks;
    assert.equal(pick.id, "jayce-brilliant-inventor.exhausted-other", label);
    assert.deepEqual(pick.options, ["exhausted-object-other-than-jayce"], label);
    // 053.1/053.2 的 “besides me” 用自身排除；415.2 的 exhausted 状态。
    assert.deepEqual(pick.filter, { exclude: "self", states: "exhausted" }, label);
    assert.equal(pick.min, 1, label);
    assert.equal(pick.max, 1, label);
    assert.equal(pick.selection, "one", label);
  }
});

test("ven-068-166 golden: accepting the play trigger readies the locked exhausted object", () => {
  const kernel = jayceWorld();
  kernel.setAnswers({ "jayce-brilliant-inventor.play-me.may-ready/optional": true });
  kernel.setPicks("jayce-brilliant-inventor.exhausted-other", [kernel.ref("exhausted-ally")]);

  const outcome = runAbilityBody(playMe.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("exhausted-ally").exhausted, false);
  // 053.1/053.2："something besides me" 不得选中本卡自身。
  assert.equal(kernel.getObject("jayce").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("ven-068-166 golden: declining the play trigger readies nothing (403.1)", () => {
  const kernel = jayceWorld();
  kernel.setAnswers({ "jayce-brilliant-inventor.play-me.may-ready/optional": false });

  const outcome = runAbilityBody(playMe.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["jayce-brilliant-inventor.play-me.may-ready", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("exhausted-ally").exhausted, true);
  assert.deepEqual(kernel.events, []);
});

test("ven-068-166 golden: accepting the first-gear trigger uses the same ready body", () => {
  const kernel = jayceWorld();
  kernel.setAnswers({ "jayce-brilliant-inventor.first-gear.may-ready/optional": true });
  kernel.setPicks("jayce-brilliant-inventor.exhausted-other", [kernel.ref("exhausted-ally")]);

  const outcome = runAbilityBody(firstGear.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("exhausted-ally").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("ven-068-166 golden: an already-ready locked object is not readied again (416.1.b/416.1.c)", () => {
  const kernel = jayceWorld();
  kernel.setAnswers({ "jayce-brilliant-inventor.play-me.may-ready/optional": true });
  kernel.setPicks("jayce-brilliant-inventor.exhausted-other", [kernel.ref("exhausted-ally")]);
  // 先把目标重置好：后续同一指令不得再产生一次重置事件。
  kernel.perform({ type: "ready", object: kernel.ref("exhausted-ally") });
  const before = kernel.events.length;

  const outcome = runAbilityBody(playMe.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.events.length, before);
});

test.todo(
  "ven-068-166 Jayce, Brilliant Inventor: subscribe both card-played triggers and resolve the {source: \"self\"} " +
    "anchor (383.4.a) — no merged module turns a CardProgram triggered ability into a TriggerRegistration (RIFT-120)"
);
test.todo(
  "ven-068-166 Jayce, Brilliant Inventor: the per-turn Nth-Time window (383.1.b) for 'the first time you play a " +
    "non-token gear each turn' needs the trigger registration pipeline to consume TriggerSpec.once (RIFT-120)"
);
test.todo(
  "ven-068-166 Jayce, Brilliant Inventor: 'something besides me that's exhausted' is a non-target pick " +
    "(355.10.d/355.10.d.1) — the Finalize selection pipeline that resolves the PickSpec filter and binds ctx.picks " +
    "is unmerged (RIFT-90 / batch 5)"
);
