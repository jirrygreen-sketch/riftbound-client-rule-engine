// Partial execution evidence is consolidated in ../templates/keyword-static-647.test.mjs; this card remains judge-required for the gaps asserted below.
import assert from "node:assert/strict";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/aurok-general.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-74533231e291deb55f594e5f04b19faf248214fac82769433d2d3387166f0bad";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3::rb_rune_order: (:rb_energy_3::rb_rune_order:: Empower me. " +
  "Use only if not Empowered.)\n[Empowered][>] Your units that are [Empowered] have " +
  "+2 :rb_might: (including me).";

const [empower, aura] = program.abilities;

test("ven-130-166 Aurok General: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-130-166 Aurok General: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /442\.1\.a/);
  // 复核后：continuous.might 已随 RIFT-258 合入，旧的“没有卡牌侧消费入口”已删除。
  assert.doesNotMatch(program.judgeReason, /没有卡牌侧的 continuous\.might/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-130-166 Aurok General: [Empower] is declared with the printed activation cost", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // 契约 3.8.3：KeywordAbility 没有费用字段；827.1.c.1 的 3 Energy + 1 Order Power
  // 记录在 judgeReason，不伪造启动能力。
});

test("ven-130-166 Aurok General: the Empowered dependent aura shape", () => {
  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  assert.equal(aura.effect.mode, "add");
  assert.equal(aura.effect.layer, "arithmetic");
  assert.deepEqual(aura.effect.amount, { kind: "constant", value: 2 });
  // “Your units that are [Empowered] (including me)”: a controller-scoped unit
  // filter with the 442.1.a Empowered status gate. The continuous.might primitive
  // and its card-side registration path are merged; only the Empowered predicate
  // recipient filter remains a blocked declaration here.
  assert.deepEqual(aura.effect.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    empowered: true
  });
});

test("ven-130-166 Aurok General: continuous.might is merged (RIFT-258) and really moves the arithmetic layer", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);

  // 本卡的依赖能力是「你控制的 Empowered 单位 +2 [M]」。目标状态过滤仍未接通，
  // 但 478 / 478.1.a 的注册与算术求值路径已合入：用本卡声明的 amount 真实执行一次，
  // 断言注册进 ability 之外的正确图层并真的改变有效 Might。
  const kernel = world()
    .unit("aurok-general", { types: ["unit"], zone: "board", owner: "A", controller: "A", might: 5 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("aurok-general") });
  const body = [{
    id: "aurok-general.grant-might",
    op: "continuous.might",
    args: {
      amount: aura.effect.amount,
      mode: { kind: "constant", value: aura.effect.mode },
      // 依赖能力的门控走 appliesTo/objects；这里只为验证合并的注册与求值路径，
      // 因此按宿主自身绑定（不是把门控近似成无条件能力——本卡仍为 judge-required）。
      appliesTo: { kind: "constant", value: "self" }
    }
  }];
  const outcome = resolveChainBody(body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.deepEqual(context.continuousEffects[0].effect.effect.amount, 2);
  assert.equal(context.continuousEffects[0].effect.layer, "arithmetic");

  const layers = createLayerEngine(context.objects, context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  })));
  assert.equal(layers.evaluate(context.ref("aurok-general")).might, 7);
});

test.todo(
  "ven-130-166 Aurok General: bind printed 3 Energy + 1 Order Power through KeywordAbility.params.cost and expandProgram (827.1.c.1)"
);

test.todo(
  "ven-130-166 Aurok General: bind dynamic empowered > 0 recipient filtering including multiple-Empowered units, not just exact count 1 (442.1.c.1 / 828.1.b.1)"
);

test.todo(
  "ven-130-166 Aurok General: integrate source gate, eligible-recipient filter and printed-cost Empower activation with authoritative state (442.1.a / 828.1.b.1)"
);

test("aurok-general: the merged Empower definition expands through the real program adapter", () => {
  const kernel = world().unit("keyword-host", {
    cardId: program.canonicalCardId, energy: null, power: null
  }).build();
  const { expanded } = expandProgram(program, kernel.getObject("keyword-host"));
  assert.equal(expanded.length, 1);
  const [activation] = expanded;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  // The missing printed-cost bridge must never turn this into a free activation.
  assert.deepEqual(activation.cost, { kind: "empower" });
  assert.deepEqual(activation.restriction, { kind: "empower", condition: {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq", right: { kind: "constant", value: 0 }
  } });
  assert.equal(activation.body[0].id, `empower:${program.canonicalCardId}`);
  assert.equal(activation.body[0].op, "effect.empower");
  assert.deepEqual(activation.body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(activation.body[0].condition, activation.restriction.condition);
  assert.equal(activation.body[0].targets, undefined);
  assert.equal(program.status, "judge-required");
});

test("aurok-general: the source gate evaluates the actual empowered state", () => {
  const kernel = world().unit("gate-host", { energy: null, power: null }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("gate-host") });
  const body = [{ id: "gate", op: "condition.predicate", args: {
    condition: { kind: "constant", value: aura.condition }
  } }];
  const evaluate = () => {
    const outcome = runAbilityBody(body, context);
    assert.equal(outcome.status, "executed");
    return outcome.results[0].result.linkedValues.value;
  };
  assert.equal(evaluate(), false);
  assert.equal(context.perform({ type: "empower", object: context.ref("gate-host") }).status, "done");
  assert.equal(evaluate(), true);
  assert.equal(context.perform({ type: "disempower", object: context.ref("gate-host") }).status, "done");
  assert.equal(evaluate(), false);
  assert.deepEqual(context.events.map(event => event.action), ["empower", "disempower"]);
});
