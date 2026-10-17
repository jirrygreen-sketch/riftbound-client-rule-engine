import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/baccai-reaper.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-49effe3e8a2c9466ade25946a0f4067d8c9dbdadf4c04be9e0216bff858d3c3c";
const SOURCE_TEXT =
  "When I attack, you may pay :rb_rune_fury: to give me [Assault 2] this turn. " +
  "(+2 :rb_might: while I'm an attacker.)";

const [ability] = program.abilities;
const [optional] = ability.body;
const [pay, grant] = optional.args.body.value;
const OPTIONAL_ID = "baccai-reaper.opt-in/optional";

test("ven-009-166 Baccai Reaper: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-009-166 Baccai Reaper: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /receipt/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-009-166 Baccai Reaper: attack trigger scoped to self (383.4.e)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.e.1 的 "When I attack …" 形态；时点为 attack-declared。
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 触发本身是强制的（印文没有「may 放弃触发」），"may" 只修饰支付与授予。
  assert.equal(ability.optional, false);
});

test("ven-009-166 Baccai Reaper: 'you may pay … to …' is one choice.optional body (contract 3.9)", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["baccai-reaper.opt-in"]);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  // 契约 3.9：被选指令包在 body 里，而不是 choice + linkedTo 消费者。
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.targets, undefined);
  assert.equal(optional.picks, undefined);
  assert.deepEqual(optional.args.body.value.map(instruction => instruction.id), [
    "baccai-reaper.pay-fury",
    "baccai-reaper.grant-assault"
  ]);

  // 135.2.e.4 / 204.1.b：印刷的 :rb_rune_fury: 是 1 个 Fury Power。
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.payments, { kind: "constant", value: { power: ["Fury"] } });
  assert.equal(pay.linkedTo, undefined);

  // 807.1.b/807.1.c：Assault 2 = attacker 条件下 +2 Might；授予带本回合期限。
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grant.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // 053.1 的 "me" 是宿主自身，不是目标（355.10.g）。
  assert.deepEqual(grant.args.objects, { kind: "constant", value: { kind: "source" } });
  assert.equal(grant.targets, undefined);
  // 支付成功才授予：grant 直接依赖前一条支付指令（契约 3.2）。
  assert.equal(grant.linkedTo, "baccai-reaper.pay-fury");
});

test("ven-009-166 Baccai Reaper golden: declining the payment skips both the payment and the grant", () => {
  const kernel = world().unit("baccai-reaper", { might: 4 }).build();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = runAbilityBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map(entry => entry.id), ["baccai-reaper.opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  // 拒绝时既没有支付也没有关键词授予（契约 3.9 的拒绝路径）。
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.continuousEffects, []);
  assert.equal(kernel.getObject("baccai-reaper").keywords.length, 0);
});

test("ven-009-166 Baccai Reaper golden: the optional wrapper keeps a single stable replay request id", () => {
  const kernel = world().unit("baccai-reaper", { might: 4 }).build();
  // 契约 3.9 / 解释器 README：choice.optional 的稳定请求 id 是「执行路径 + 本地 id」；
  // 接受与否由这一次询问决定（拒绝路径见上一个用例）。
  kernel.setAnswers({ [OPTIONAL_ID]: false });
  const outcome = runAbilityBody(ability.body, kernel);
  assert.equal(outcome.results[0].path.join("/"), "baccai-reaper.opt-in");
  assert.equal(outcome.results[0].result.reason, "skipped");
  // 支付与授予都在这一个 body 里，因此拒绝时两条指令都不会被尝试。
  assert.equal(optional.args.body.value.length, 2);
});

test("ven-009-166 Baccai Reaper golden: accepting pays 1 Fury Power and grants [Assault 2] this turn (RIFT-258)", () => {
  // cost.pay + continuous.grant-keyword 已随 RIFT-258 合入；生产触发接线（RIFT-120）
  // 仍是 judge-required 缺口。本 golden 用真实解释器 + 测试内核执行卡内的 choice.optional body。
  const kernel = world().player("A", { power: ["Fury"] }).unit("baccai-reaper", { might: 4 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("baccai-reaper") });
  context.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = runAbilityBody(ability.body, context);

  // choice.optional 先把被选 body 跑完（pay → grant），再以 executed 收束自身。
  assert.deepEqual(outcome.results.map((entry) => entry.id), [
    "baccai-reaper.pay-fury",
    "baccai-reaper.grant-assault",
    "baccai-reaper.opt-in"
  ]);
  for (const entry of outcome.results) {
    assert.equal(entry.result.status, "executed");
  }
  // 支付 receipt：1 点 Fury Power 已付（204.1.b），事件里有 pay 动作。
  const payResult = outcome.results.find((entry) => entry.id === "baccai-reaper.pay-fury");
  const receipt = payResult.result.linkedValues.payment;
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.power.power, [
    { requirementIndex: 0, from: "Fury", amount: 1 }
  ]);
  assert.ok(outcome.events.some((event) => event.action === "pay"));
  // [Assault 2]：ability 层的关键词授予，end-of-turn 到期。
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.effect.keyword, "Assault");
  assert.equal(context.continuousEffects[0].effect.effect.keywordValue, 2);
  assert.deepEqual(context.continuousEffects[0].duration, { type: "end-of-turn" });

  const layers = createLayerEngine(context.objects, context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  })));
  assert.deepEqual(layers.evaluate({ id: "baccai-reaper", zoneEntryId: 1 }).keywords, [
    { id: "Assault", value: 2 }
  ]);
});

test.todo(
  "ven-009-166 Baccai Reaper: resolve the attack trigger's payment step in the production pipeline — " +
    "cost.pay and continuous.grant-keyword are merged (see the accept golden), but the RIFT-89 " +
    "cost-plan/trigger wiring still has no CardProgram execution entry for the optional payment"
);
test.todo(
  "ven-009-166 Baccai Reaper: the attack trigger must enter the chain when this unit first gains the " +
    "Attacker designation — attack-declared is only in the closed enum and keyword expansions; no " +
    "merged emitter and no CardProgram TriggerRegistration (RIFT-120)"
);
