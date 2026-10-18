// Golden test for War Scout (rad-008-167).
//
// Execution evidence (the real play -> card-played -> Finalize target lock ->
// continuous.might +2, plus the non-Board illegal-target boundary) lives in
// the RIFT-660 parameterized template golden:
// test/cards/templates/keyword-triggered-card-played-continuous-660.test.mjs.
// The +2 Might clause is executable with the merged continuous.might
// instruction (RIFT-258) and the real layer engine. [Accelerate] itself is
// merged, but no play flow writes the optional [1][Fury] additional cost into
// Finalize optionalAdditional / selectedAdditional yet, so the card stays
// judge-required. This file keeps validation, identity, verbatim text,
// declared status and the key structure of the printed abilities; the
// interpreter goldens below still execute the card's own body.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/war-scout.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const MIGHT_BODY = "war-scout.give-plus-2-might";
const MIGHT_TARGET = "war-scout.unit";

test("rad-008-167 War Scout: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-d81d427199a8fc8e3fb295ca97af6524da92927058f329c1bb53fd0c95837bfa"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
      "When you play me, give a unit +2 :rb_might: this turn."
  );
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /selectedAdditional/);
});

test("rad-008-167: keyword declaration plus card-played trigger with a +2 Might effect", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  const [instruction] = triggered.body;
  assert.equal(instruction.id, MIGHT_BODY);
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  // 作用对象是 objects 的 { kind: "target", id } 选择符：生产链的
  // resolveChainBody 在结算时按 ctx.targets(id) 解析该值（RIFT-660 实测
  // 修正；旧的 target 参数拼写在生产链上不会命中 TargetSpec）。
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: MIGHT_TARGET }
  });
  // “a unit” 是任意单位的目标选择（352/355.9），min=max=1。
  assert.equal(instruction.targets.length, 1);
  const [spec] = instruction.targets;
  assert.equal(spec.id, MIGHT_TARGET);
  assert.deepEqual(spec.filter, { zone: "board", type: "unit" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("rad-008-167: [Accelerate] resolves to the merged KeywordDef (RIFT-86 cost declaration plus 805.6 replacement)", () => {
  assert.equal(keywordDefinitionsById.get("Accelerate"), accelerate);
  const expansion = accelerate.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.deepEqual(expansion.map(ability => ability.kind), ["static", "replacement"]);
  // 805.1.b：固定 [1][Fury] 的附加费声明（optional 附加费由费用管线收取）。
  assert.equal(expansion[0].effect.kind, "accelerate.cost");
  assert.deepEqual(expansion[0].effect.cost.payments.map(payment => payment.kind), ["energy", "power"]);
  // 805.6：入场替代使用已合入的 effect.ready，替代状态是在场上就绪（不减未经 ready 时点）。
  assert.equal(expansion[1].replaces.event, "object-enters-board");
  assert.equal(expansion[1].with[0].op, "effect.ready");
});

test("rad-008-167: the continuous.might body really grants +2 Might for the turn through the layer engine", () => {
  const kernel = world().unit("war-scout", { might: 2 }).unit("other", { might: 3 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("war-scout") });
  scoped.setTargets(MIGHT_TARGET, [scoped.ref("other")]);
  // 用默认解释器注册表执行卡牌原始 body：continuous.might 已注册（RIFT-258），
  // objects 的 { kind: "target", id } 值在解释器求值后按 TargetSpec id 解析。
  const outcome = runAbilityBody(program.abilities[1].body, scoped);
  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [[MIGHT_BODY, "executed"]]
  );
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  const engine = createLayerEngine(
    scoped.listObjects(),
    scoped.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  // 只有被选中的单位获得 +2；来源本身不受影响。
  assert.equal(engine.evaluate(scoped.ref("other")).might, 5);
  assert.equal(engine.evaluate(scoped.ref("war-scout")).might, 2);
});

test("rad-008-167: an unselected target leaves the Might effect ignored, never silently applied", () => {
  const kernel = world().unit("war-scout", { might: 2 }).unit("other", { might: 3 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("war-scout") });
  scoped.setTargets(MIGHT_TARGET, []);
  const outcome = runAbilityBody(program.abilities[1].body, scoped);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(scoped.continuousEffects.length, 0);
});

test.todo(
  "rad-008-167 War Scout: 805.1.b 的可选附加费 [1][Fury] 收取 - accelerate.cost 声明已合入，" +
    "但没有任何打出流程把该附加费写入 Finalize 的 selectedAdditional 并收取；" +
    "engine.ts 的 accelerate → ready 消费因此仍无生产输入"
);
