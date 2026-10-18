import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/baccai-reaper.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID =
  "card.hash-49effe3e8a2c9466ade25946a0f4067d8c9dbdadf4c04be9e0216bff858d3c3c";
const SOURCE_TEXT =
  "When I attack, you may pay :rb_rune_fury: to give me [Assault 2] this turn. " +
  "(+2 :rb_might: while I'm an attacker.)";

const [ability] = program.abilities;
const [optional] = ability.body;
const [pay, grant] = optional.args.body.value;
const OPTIONAL_ID = "baccai-reaper.opt-in/optional";

/** The program as the production registry sees it (status still judge-required). */
const executableView = { ...program, status: "executable", judgeReason: undefined };

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
  // The refreshed reason names the measured gaps and no merged task number as a dependency.
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /registerProgramTriggers/);
  assert.match(program.judgeReason, /receipt/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.ok(!/RIFT-89|RIFT-120|RIFT-257|RIFT-258/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-009-166 Baccai Reaper: attack trigger scoped to self (383.4.e)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.e.1 的 "When I attack ..." 形态；时点为 attack-declared。
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

test("ven-009-166 Baccai Reaper: 'you may pay ... to ...' is one choice.optional body (contract 3.9)", () => {
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
  kernel.setAnswers({ [OPTIONAL_ID]: false });
  const outcome = runAbilityBody(ability.body, kernel);
  assert.equal(outcome.results[0].path.join("/"), "baccai-reaper.opt-in");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(optional.args.body.value.length, 2);
});

test("ven-009-166 Baccai Reaper golden: accepting pays 1 Fury Power and grants [Assault 2] this turn", () => {
  const kernel = world().player("A", { power: ["Fury"] }).unit("baccai-reaper", {
    might: 4,
    combatRole: "attacker",
    location: { type: "battlefield", id: "bf-1" }
  }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("baccai-reaper") });
  context.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = runAbilityBody(ability.body, context);

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

  const layers = new KeywordGrantLayerEngine(context.objects, {
    context: source => bindResolveContext(context, { source, controller: source.controller })
  });
  for (const entry of context.continuousEffects) {
    layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
  }
  const snapshot = layers.snapshot({ id: "baccai-reaper", zoneEntryId: 1 });
  assert.deepEqual(snapshot.keywords, [{ id: "Assault", value: 2 }]);
  assert.equal(snapshot.might, 6);
});

test("ven-009-166 Baccai Reaper golden: the payment fails closed with an empty Power pool and no grant runs", () => {
  const kernel = world().player("A", { power: [] }).unit("baccai-reaper", { might: 4 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("baccai-reaper") });
  context.setAnswers({ [OPTIONAL_ID]: true });

  assert.throws(
    () => runAbilityBody(ability.body, context),
    (error) => error instanceof Error && /insufficient matching Power/i.test(error.message)
  );
  assert.deepEqual(context.player("A").power, []);
  assert.equal(context.continuousEffects.length, 0);
  assert.equal(context.getObject("baccai-reaper").keywords.length, 0);
});

test("ven-009-166 Baccai Reaper evidence: the attack trigger really registers against the pipeline", () => {
  // Registration is no longer the gap: the CardProgram adapter accepts this
  // subscription. The missing piece is the attack-declared emitter (466.2).
  const registry = new ProgramRegistry([executableView]);
  const { engine, kernel } = fixture({
    cards: [{ id: "reaper", cardId: CARD_ID, types: ["unit"], might: 4, energy: 3, power: ["Fury"] }]
  });
  const registrations = triggerRegistrations(registry, kernel.getObject("reaper"));
  assert.deepEqual(
    registrations.map((registration) => [registration.spec.at, registration.spec.filter]),
    [["attack-declared", { event: "attack-declared", object: { objectId: "reaper" } }]]
  );
  assert.equal(engine.pipeline.events.filter((event) => event.timingPoint === "attack-declared").length, 0);
});

test("ven-009-166 Baccai Reaper evidence: the reference kernel never debits the Power pool", () => {
  // Measured: the pay action debits energy/xp only, so a single Fury Power can
  // pay twice and both runs report paid:true while the pool stays ["Fury"].
  const kernel = world().player("A", { power: ["Fury"] }).unit("baccai-reaper", { might: 4 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("baccai-reaper") });
  context.setAnswers({ [OPTIONAL_ID]: true });
  const first = runAbilityBody(ability.body, context);
  assert.equal(first.results.find((entry) => entry.id === "baccai-reaper.pay-fury").result.linkedValues.payment.paid, true);
  assert.deepEqual(context.player("A").power, ["Fury"]);
  const second = runAbilityBody(ability.body, context);
  assert.equal(second.results.find((entry) => entry.id === "baccai-reaper.pay-fury").result.linkedValues.payment.paid, true);
  assert.deepEqual(context.player("A").power, ["Fury"]);
});

test.todo(
  "ven-009-166 Baccai Reaper: the Power pool debit cannot be verified on the reference kernel - " +
    "test-kernel.ts's pay action debits only energy/xp and leaves PlayerSnapshot.power untouched, " +
    "so holding one Fury pays twice; the recurring-debit boundary needs an engine-core Power-integration task"
);

test.todo(
  "ven-009-166 Baccai Reaper: emit attack-declared from the actual Combat designation change so the " +
    "registered trigger can enter the chain - CombatFlow.advance() still throws " +
    "TurnCombatBlockedError('combat-start-transaction') (CR 466.2)"
);

test.todo(
  "ven-009-166 Baccai Reaper: route the granted [Assault 2] through the default CardProgram lifecycle " +
    "so its production layers consume the attacker Might bonus; the isolated KeywordGrantLayerEngine " +
    "adapter covers designation/combatRole aliasing, but attachProgramLifecycle still installs LayerEngine"
);

