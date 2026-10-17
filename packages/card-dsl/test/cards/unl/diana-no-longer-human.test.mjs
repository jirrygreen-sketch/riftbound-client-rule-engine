import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/diana-no-longer-human.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL_ID =
  "card.hash-11be609f8d3a73cf3ab397a574e5dc2de111d0ec840bd515e8f6df0e19e3774b";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play a spell, give me +2 :rb_might: this turn.";

const [ambush, spellTrigger] = program.abilities;
const [grantMight] = spellTrigger.body;

test("unl-149-219 Diana, No Longer Human: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-149-219 Diana, No Longer Human: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /Ambush|play-location-permission/);
});

test("unl-149-219 Diana, No Longer Human: [Ambush] is declared as a keyword only (CR 822)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.equal(ambush.value, undefined);
  // 822.1.b 的展开（合法打出位置 + Reaction 许可）属关键词管线；卡内不重写。
  assert.equal(keywordDefinitionsById.has("Ambush"), true);
});

test("unl-149-219 Diana, No Longer Human: 'when you play a spell' is a card-played trigger on a spell", () => {
  // 420.4.a：打出动作完成时触发；383.4.a.4：这不是 Play Effect。
  assert.equal(spellTrigger.kind, "triggered");
  assert.equal(spellTrigger.trigger.at, "card-played");
  assert.deepEqual(spellTrigger.trigger.filter, {
    event: "card-played",
    object: { type: "spell", controller: "self" }
  });
  assert.equal(spellTrigger.trigger.condition, undefined);
  assert.equal(spellTrigger.trigger.once, undefined);
  // 原文没有 “may”：触发是强制的（383.3.a 只适用于 “you may”）。
  assert.equal(spellTrigger.optional, false);
});

test("unl-149-219 Diana, No Longer Human: 'give me +2 Might this turn' targets the host, not a choice", () => {
  assert.equal(spellTrigger.body.length, 1);
  assert.equal(grantMight.id, "diana-no-longer-human.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // 355.10.g：“me” 指能力宿主，用 continuous.might 的 appliesTo 选择器；不是 targets/picks 选择。
  assert.deepEqual(grantMight.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
});

test("unl-149-219 Diana, No Longer Human golden: the merged Might body registers a temporary arithmetic effect", () => {
  const kernel = world()
    .unit("diana", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const context = kernel.clone({ source: kernel.ref("diana"), sourceSnapshot: kernel.getObject("diana") });
  const outcome = resolveChainBody([grantMight], context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(context.continuousEffects[0].effect.effect.amount, 2);
  assert.deepEqual(context.continuousEffects[0].duration, { type: "end-of-turn" });
});

test.todo(
  "unl-149-219 Diana, No Longer Human: expand [Ambush] (CR 822.1.b: play to a battlefield where " +
    "you control units, with Reaction timing while being played there) and let chain.canAct / " +
    "Finalize consume the merged play-location-permission and conditional timing declarations"
);
test.todo(
  "unl-149-219 Diana, No Longer Human: give me +2 Might this turn through the layers " +
    "continuous.might consumer with the end-of-turn duration (CR 143.2.a / 479.4) from the production card-played trigger"
);
test.todo(
  "unl-149-219 Diana, No Longer Human: register the 'when you play a spell' card-played trigger " +
    "so it actually queues from production play with the spell controller bound to the ability controller (CR 420.4.a)"
);
