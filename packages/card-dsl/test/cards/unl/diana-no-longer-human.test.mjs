import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/diana-no-longer-human.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-149-219 Diana, No Longer Human: [Ambush] is declared as a keyword only (CR 822)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.equal(ambush.value, undefined);
  // 822.1.b 的展开（合法打出位置 + Reaction 许可）属关键词管线；卡内不重写。
  // 该关键词的 KeywordDef 是否已合入由关键词任务决定（见 judgeReason 与下方 TODO），
  // 因此这里不断言注册表内容——依赖合入后会让这类断言失败。
});

test("unl-149-219 Diana, No Longer Human: 'when you play a spell' is a card-played trigger on a spell", () => {
  // 420.4.a：打出动作完成时触发；383.4.a.4：这不是 Play Effect。
  assert.equal(spellTrigger.kind, "triggered");
  assert.equal(spellTrigger.trigger.at, "card-played");
  assert.deepEqual(spellTrigger.trigger.filter, {
    event: "card-played",
    object: { type: "spell", controller: "controller" }
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
  // 355.10.g：“me” 指能力宿主，用契约 3.6 的符号选择器；不是 targets/picks 选择。
  assert.deepEqual(grantMight.args.object, { kind: "constant", value: "self" });
  assert.equal(grantMight.targets, undefined);
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
});

test.todo(
  "unl-149-219 Diana, No Longer Human: expand [Ambush] (CR 822.1.b: play to a battlefield where " +
    "you control units, with Reaction timing while being played there) and let chain.canAct / " +
    "Finalize read the permission — no Ambush KeywordDef is merged"
);
test.todo(
  "unl-149-219 Diana, No Longer Human: give me +2 Might this turn through the layers " +
    "continuous.might consumer with the end-of-turn duration (CR 143.2.a / 479.4) — RIFT-91"
);
test.todo(
  "unl-149-219 Diana, No Longer Human: register the 'when you play a spell' card-played trigger " +
    "so it actually queues from production play (CR 420.4.a) — RIFT-257 / RIFT-120"
);
