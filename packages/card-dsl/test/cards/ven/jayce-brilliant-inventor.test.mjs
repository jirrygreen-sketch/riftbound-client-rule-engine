import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/jayce-brilliant-inventor.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { finalizePick } from "../../../../engine-core/dist/target/target-plan.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

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

/** 参考内核里的宿主：把 source 指向本卡，让 exclude: "self" 解析到被测试对象。 */
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
  assert.match(program.judgeReason, /per-turn/);
  assert.match(program.judgeReason, /PickSpec/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|90|91|120|257|258|87)/);
  assert.match(program.judgeReason, /filter 型 PickSpec 的生产解析管线/);
  assert.match(program.judgeReason, /Unsupported filter field isToken/);
  assert.match(program.judgeReason, /finalizeOrderedPickPlans/);
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

const GEAR_CARD_ID = "card.hash-0000000000000000000000000000000000000000000000000000000000000001";

/** 只保留指定触发能力的 executable 探针程序（canonicalCardId 不变）。 */
function probeProgram(abilities) {
  return {
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities
  };
}

const playMeProbe = probeProgram([playMe]);
/** 带注册程序、无触发能力的普通 gear：打出动作本身必须可用。 */
const realGearProbe = {
  canonicalCardId: GEAR_CARD_ID,
  rulesetVersion: program.rulesetVersion,
  status: "executable",
  abilities: [],
  sourceText: "probe gear"
};

test("ven-068-166 probe: the play-me trigger registers and fires through the production binding", () => {
  const binding = createProgramBinding({ cardPrograms: [playMeProbe] });
  const errors = [];
  const requests = [];
  const f = fixture({
    cards: [
      { id: "jayce", cardId: CANONICAL_ID, types: ["unit"], energy: 6, might: 6 },
      { id: "gear-token", cardId: GEAR_CARD_ID, types: ["gear"], isToken: true, energy: 0 },
      { id: "real-gear", cardId: GEAR_CARD_ID, types: ["gear"], energy: 1 }
    ],
    describePlay: binding.describePlay,
    choose: request => {
      requests.push(request);
      return true;
    }
  });
  // 参考内核返回副本，状态修改必须经 kernel.perform。
  f.kernel.perform({ type: "exhaust", object: f.kernel.ref("source") });
  f.kernel.perform({ type: "exhaust", object: f.kernel.ref("enemy") });
  binding.attachLifecycle(f.engine, error => errors.push(error));
  f.engine.commit({ type: "play", object: f.kernel.ref("jayce"), player: "A" });
  f.engine.advance();
  resolveAll(f.engine);
  assert.deepEqual(errors, []);
  const triggerItems = f.engine.trace.filter(
    event => event.step === "pending" && String(event.item).startsWith("trigger:")
  );
  assert.equal(triggerItems.length, 1, "the play-me trigger fires on Jayce's own play");
  assert.ok(
    requests.some(request => request.type === "optional"),
    "the play-me trigger asked the optional 'you may' question"
  );
  // PickSpec has no production resolver (RIFT-358): ctx.picks stays empty and the
  // optional body readies nothing — the honest partial state until that lands.
  assert.equal(f.kernel.getObject("source").exhausted, true);
  assert.equal(f.kernel.getObject("enemy").exhausted, true);
});

test("ven-068-166 probe: the gear-half trigger filter fails to bind on isToken", () => {
  const binding = createProgramBinding({
    cardPrograms: [probeProgram([playMe, firstGear]), realGearProbe]
  });
  const errors = [];
  const f = fixture({
    cards: [
      { id: "jayce", cardId: CANONICAL_ID, types: ["unit"], energy: 6, might: 6 },
      { id: "real-gear", cardId: GEAR_CARD_ID, types: ["gear"], energy: 1 }
    ],
    describePlay: binding.describePlay,
    choose: () => true
  });
  binding.attachLifecycle(f.engine, error => errors.push(error));
  // Jayce 进入 board 时注册触发：gear 半的 isToken 过滤器在这里失败。
  f.engine.commit({ type: "play", object: f.kernel.ref("jayce"), player: "A" });
  f.engine.advance();
  resolveAll(f.engine);
  assert.ok(errors.length >= 2, "attachment retries on later emissions and keeps failing");
  assert.equal(
    errors.filter(error => /Unsupported filter field isToken/.test(error.message)).length,
    errors.length,
    "every attachment attempt fails on the same isToken field"
  );
  // 打出普通 gear 本身可用，但 gear 半注册失败使整张卡的触发注册中止：
  // 连 play-me 半也没有进链（triggerRegistrations 的 flatMap 在 gear 半抛错）。
  f.engine.commit({ type: "play", object: f.kernel.ref("real-gear"), player: "A" });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(
    f.engine.trace.filter(
      event => event.step === "pending" && String(event.item).startsWith("trigger:")
    ).length,
    0,
    "the whole card's trigger registration aborts; neither half reaches the chain"
  );
  assert.ok(f.kernel.getObject("real-gear"), "the gear play itself succeeds");
});

test("ven-068-166 probe: the production chain never finalizes the filter-based pick, so the optional ready resolves to nothing", () => {
  // chain/engine.ts Finalize calls finalizeOrderedPickPlans, which only accepts
  // zoneSlice/linked source picks; finalizePick itself has no production caller.
  const selection = playReady.picks[0];
  assert.equal(selection.selection, "one");
  assert.deepEqual(selection.filter, { exclude: "self", states: "exhausted" });
  assert.equal(selection.options.length, 1, "options is a descriptive placeholder, not the live candidate set");

  const kernel = jayceWorld();
  const kernelWithSource = kernel.clone({ sourceSnapshot: kernel.getObject("jayce") });
  // A caller that supplies the locked pick gets a real ready (the primitive is
  // merged); the production chain never does, so this must stay judge-required.
  kernelWithSource.setPicks("jayce-brilliant-inventor.exhausted-other", [kernelWithSource.ref("exhausted-ally")]);
  const plan = finalizePick(kernelWithSource, {
    id: selection.id,
    options: [kernelWithSource.ref("exhausted-ally")],
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(plan.selected, [kernelWithSource.ref("exhausted-ally")]);

  // Without a caller, ctx.picks(id) is empty and effect.ready resolves as
  // ignored/mistargeted instead of readying anything.
  const bare = jayceWorld();
  bare.setAnswers({ "jayce-brilliant-inventor.play-me.may-ready/optional": true });
  const outcome = runAbilityBody(playMe.body, bare);
  assert.equal(outcome.status, "partial");
  // The ready instruction and its choice.optional wrapper both end ignored: the
  // pick resolves empty, so nothing is readied.
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["jayce-brilliant-inventor.play-me.may-ready.ready-other", "ignored"],
    ["jayce-brilliant-inventor.play-me.may-ready", "ignored"]
  ]);
  assert.equal(bare.getObject("exhausted-ally").exhausted, true);
});
