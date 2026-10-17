import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-order-disciple.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import mill from "../../../../engine-core/dist/effects/instructions/effect.mill.js";
import continuousMight from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-52a663e5dda4322708485527cce1866c32eed631d3d1ad01e401569b5f72e267";
const SOURCE_TEXT =
  "When I move, you may [Burn 1] to give me +1 :rb_might: this turn. (To Burn 1, put the top card " +
  "of your Main Deck into your trash.)";

const [ability] = program.abilities;
const [optional] = ability.body;
const [payBurn, mightModify] = optional.args.body.value;
const OPTIONAL_ID = "shadow-order-disciple.may-burn-and-grant/optional";

const discipleWorld = () => {
  const base = world()
    .player("A")
    .deck(["burn-top", "next-card"])
    .unit("disciple", {
      might: 2,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  return base.clone({
    controller: "A",
    sourceSnapshot: base.getObject("disciple")
  });
};

test("ven-095-166 Shadow Order Disciple: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-095-166 Shadow Order Disciple: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /burn/);
  assert.match(program.judgeReason, /might-modify|Might 修正|Might/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /continuous\.might 原语（RIFT-91/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /383\.3\.a/);
  assert.match(program.judgeReason, /740\.4\.a\.2/);
  assert.match(program.judgeReason, /TriggerRegistration\.cost/);
  assert.match(program.judgeReason, /mayAtFinalize/);
  assert.ok(!/没有指令入口|no continuous\.might instruction exists|effect\.might-modify/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-095-166: 'When I move' subscribes to the object-moved movement timing point (421.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 383.3.a / 契约 3.9：首段 may 应在 Finalize 决定；body 暂只保留声明，缺口见绑定检查。
  assert.equal(ability.optional, true);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
});

test("ven-095-166: the declared leading Burn needs Finalize binding and the Might rider is temporary", () => {
  assert.deepEqual(optional.args.body.value.map((instruction) => [instruction.id, instruction.op]), [
    ["shadow-order-disciple.pay-burn-1", "cost.pay"],
    ["shadow-order-disciple.give-plus-1-might", "continuous.might"]
  ]);
  // 740.4.a.2 / 441.1：效果首段的 [Burn 1] 是在 Finalization 支付的费用；
  // body 里的 cost.pay 尚未被绑定为前置费用；即使补支付种类也不能直接在此结算付款。
  assert.deepEqual(payBurn.args.payments, {
    kind: "constant",
    value: [{ kind: "burn", amount: 1 }]
  });
  assert.equal(payBurn.targets, undefined);

  // 479.4.e.1 的临时 Might 修正（“this turn” 到期）：continuous.might 原语已合入
  //（RIFT-91），“me” 用 appliesTo: "self" 的来源简写表达，不是 TargetSpec。
  assert.equal(mightModify.linkedTo, "shadow-order-disciple.pay-burn-1");
  assert.deepEqual(mightModify.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightModify.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightModify.args.appliesTo, {
    kind: "constant",
    value: "self"
  });
  assert.equal(mightModify.args.object, undefined);
  assert.equal(mightModify.targets, undefined);
});

test("ven-095-166 golden: the Burn 1 action semantics move the top Main Deck card to the trash (441.1)", () => {
  // The declared Burn is a cost (unmergeable kind), but the printed reminder is
  // the fixed functional text of the Burn action (441.2); effect.mill is the
  // merged primitive for exactly that action, so the golden executes it on the
  // card's own controller and asserts the real zone change.
  const kernel = discipleWorld();
  const run = runInstruction(mill, { amount: 1 }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map((object) => object.id), ["burn-top"]);
  assert.deepEqual(kernel.zone("A", "deck").map((object) => object.id), ["next-card"]);
  assert.deepEqual(run.linked.burned, [{ id: "burn-top", zoneEntryId: 1 }]);
  assert.equal(run.linked.burnedCount, 1);
});

test("ven-095-166 golden: declining the may-body burns nothing and grants nothing", () => {
  const kernel = discipleWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["shadow-order-disciple.may-burn-and-grant", "negated", "skipped"]]
  );
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.equal(kernel.zone("A", "deck").length, 2);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.events, []);
});

test("ven-095-166 golden: continuous.might really grants +1 Might to the disciple until end of turn", () => {
  // continuous.might（RIFT-91）是真实合入的指令入口：golden 用卡片自己的 args
  // 执行它，断言 arithmetic 图层注册、“me” 的 appliesTo: "self" 来源选择、
  // “this-turn” 的 end-of-turn 到期，以及 layers 引擎中的真实数值变化。
  const kernel = discipleWorld();
  const run = runInstruction(continuousMight, mightModify.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.equal(registration.effect.filter.objectId, "disciple");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // 479.4.e.1 / 143.2.c：图层引擎求值 2 → 3，回合结束清理后回到 2。
  const engine = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(engine.evaluate(kernel.ref("disciple")).might, 3);
  assert.deepEqual(engine.advance({ id: "turn-end" }), [
    "continuous.might:settlement-1:disciple:1:disciple:1:1"
  ]);
  const expired = createLayerEngine(kernel.objects, kernel.continuousEffects.filter(
    (effect) => effect.id !== registration.id
  ));
  assert.equal(expired.evaluate(kernel.ref("disciple")).might, 2);
});

test("ven-095-166 golden: the 'When I move' self anchor is consumed by the merged binding and event match", () => {
  // object-moved 生产接线已合入（action-adapter 把 move-location 映射为 object-moved）；
  // translateTriggerFilter（RIFT-257）把内层 source: "self" 锚点解析成 objectId，
  // matchesTriggerEvent 再用该锚点过滤真实事件：只有本卡自己的移动匹配。
  const translated = translateTriggerFilter(ability.trigger.filter, "disciple", "object-moved");
  assert.deepEqual(translated, {
    event: "object-moved",
    object: { objectId: "disciple" }
  });

  const emission = (objectId) => ({
    kind: "object-moved",
    timingPoint: "object-moved",
    player: "A",
    object: {
      ref: { id: objectId, zoneEntryId: 1 },
      cardId: "card:" + objectId,
      name: objectId,
      types: ["unit"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      might: 2,
      energy: null,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    }
  });
  assert.equal(matchesTriggerEvent(translated, emission("disciple"), "A"), true);
  assert.equal(matchesTriggerEvent(translated, emission("other-unit"), "A"), false);
});

test("ven-095-166 binding inspection: the leading choice and Burn survive translation inside the settlement body", (t) => {
  const kernel = world().unit("disciple", { cardId: CANONICAL, might: 2 }).build();
  // Inspect only the adapter's transformation. The production program remains judge-required;
  // this local status projection is never registered with a pipeline or used to settle the card.
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const [registration] = triggerRegistrations(registry, kernel.getObject("disciple"));

  assert.deepEqual(registration.source, kernel.getObject("disciple"));
  assert.deepEqual(registration.spec.filter, { event: "object-moved", object: { objectId: "disciple" } });
  assert.equal(registration.controller, "A");
  assert.equal(registration.optional, true);
  assert.deepEqual(registration.body, ability.body);
  const [boundChoice] = registration.body;
  assert.equal(boundChoice.op, "choice.optional");
  assert.deepEqual(boundChoice.args.body.value[0], payBurn);
  assert.deepEqual(boundChoice.args.body.value[1], mightModify);
  // Diagnostics document the current blocker without declaring its missing fields a success
  // condition: only a future cost/mayAtFinalize extraction can satisfy 383.3 / 740.4.a.2.
  t.diagnostic(JSON.stringify({
    cost: registration.cost ?? null,
    mayAtFinalize: registration.mayAtFinalize ?? null,
    triggerValidation: validateTriggerSpec(registration.spec)
  }));
});

test.todo(
  "ven-095-166 Shadow Order Disciple: pay the printed [Burn 1] through a real cost plan (740.4.a.2, 441.1) — " +
    "cost.pay is merged but its payments shape accepts only energy/power/xp keys and the burn kind returns " +
    "cannotPay (CostPlanError) — plan-values.ts has no burn payment kind (RIFT-89)"
);

test.todo(
  "ven-095-166 Shadow Order Disciple: bind the leading may decision and Burn payment into Finalize " +
    "(383.3.a/383.3.b/740.4.a.2): programs/triggers.ts must produce mayAtFinalize + TriggerRegistration.cost " +
    "and remove the settlement-time choice/payment; adding the burn kind alone cannot fix this timing"
);

test.todo(
  "ven-095-166 Shadow Order Disciple: register and run move → may → pay → +1 Might end to end once " +
    "the trigger validator accepts the produced object-moved event discriminator (421.1); the movement " +
    "producer, self-filter translation, and continuous.might execution already exist"
);
