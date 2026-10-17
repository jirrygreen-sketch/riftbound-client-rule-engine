import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mosstomper.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-3237f73ddd77661179f659d36e72559c7bdf667aadbeeb1a45d74e35b239ea35";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "[Level 3][>] I have +1 :rb_might: and [Deflect]. (While you have 3+ XP, get the effect. " +
  "Opponents must pay :rb_rune_rainbow: to choose a [Deflect] unit with a spell or ability.)";

const [hunt, mightBonus, deflectGrant] = program.abilities;

test("unl-047-219 Mosstomper: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-047-219 Mosstomper: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason records the current Hunt trigger, XP predicate, and Deflect tax gaps.
  assert.match(program.judgeReason, /823\.1/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /conquered/);
  assert.match(program.judgeReason, /programs\/filters\.ts/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("unl-047-219 Mosstomper: [Hunt 2] carries the printed Hunt Value", () => {
  assert.equal(program.abilities.length, 3);
  // 823.1.c.3：印刷的 Hunt Value 是 2（展开与 823.2 的求和由 keywords/Hunt.ts 负责）。
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
});

test("unl-047-219 Mosstomper: [Level 3][>]'s [Text] is a static +1 Might and a Deflect grant, both gated at 3 XP", () => {
  // 824.1.b.1：功能上等于“当你有 3 点或更多 XP 时，本牌获得 [Text]”。
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.equal(mightBonus.effect.appliesTo, "self");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 1 });

  assert.equal(deflectGrant.kind, "static");
  // 809.1.b.3：省略数值的 Deflect 按 1；801.3.a / 364.1：持续授予（不进链）。
  assert.equal(deflectGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(deflectGrant.effect.keyword, "deflect");
  assert.deepEqual(deflectGrant.effect.value, { kind: "constant", value: 1 });
  assert.equal(deflectGrant.effect.appliesTo, "self");

  // 824.1.c / 824.1.d：3+ XP 门控的保留形状（合并的 Condition 读不到 PlayerSnapshot.xp）。
  for (const ability of [mightBonus, deflectGrant]) {
    const condition = ability.condition;
    assert.equal(condition.kind, "compare");
    assert.equal(condition.operator, "gte");
    assert.deepEqual(condition.right, { kind: "constant", value: 3 });
    assert.equal(condition.left.kind, "count");
    assert.equal(condition.left.subject, "controller-xp");
    assert.deepEqual(condition.left.filter, { player: "controller" });
  }
});

test("unl-047-219 Mosstomper: the printed [Deflect] grant reuses the merged Deflect expansion shape", () => {
  // 卡片本身没有印刷 [Deflect]（徽记来自 [Level 3][>] 的依赖能力），所以 abilities 里没有
  // deflect keyword 条目；授予的形状与已合入的 Deflect.ts 展开一致（static target.tax）。
  assert.equal(
    program.abilities.some((ability) => ability.kind === "keyword" && ability.keyword === "deflect"),
    false
  );
  const deflectDef = keywordDefinitionsById.get("Deflect");
  assert.ok(deflectDef, "the merged Deflect KeywordDef is registered (CR 809)");
  const [expansion] = deflectDef.expand({ value: 1, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test("unl-047-219 Mosstomper: the merged Hunt KeywordDef publishes one trigger per printed timing, with X = 2", () => {
  const huntDef = keywordDefinitionsById.get("Hunt");
  assert.ok(huntDef, "the merged Hunt KeywordDef is registered (CR 823)");
  // 823.2: all granted Hunt values sum into one value passed to the expansion.
  assert.equal(huntDef.stacking, "sum");
  const expansion = huntDef.expand({ value: 2, host: { canonicalCardId: CANONICAL_ID } });
  // 823.1.b/823.1.c.1: one triggered ability for Conquer and one for Hold.
  assert.deepEqual(expansion.map(ability => ability.trigger.at), ["conquer", "hold"]);
  // 823.1.c.3: the printed Hunt Value flows into the sub-effect as the XP amount.
  for (const ability of expansion) {
    assert.equal(ability.trigger.filter.source ?? ability.trigger.filter.filter?.source, "self");
    assert.deepEqual(ability.body[0].args.amount, { kind: "constant", value: 2 });
  }
});

test("unl-047-219 Mosstomper golden: [Hunt 2]'s body really gains 2 XP when the trigger does run", () => {
  const huntDef = keywordDefinitionsById.get("Hunt");
  const expansion = huntDef.expand({ value: 2, host: { canonicalCardId: CANONICAL_ID } });
  for (const ability of expansion) {
    const kernel = world().build();
    const outcome = resolveChainBody(ability.body, kernel);
    assert.equal(outcome.results[0].result.status, "executed");
    // 728 / 730.1: gaining XP marks the controller's XP total.
    assert.equal(kernel.player("A").xp, 2);
    assert.equal(kernel.player("B").xp, 0);
    assert.deepEqual(kernel.events.map(event => event.action), ["gain-xp"]);
  }
});

test("unl-047-219 Mosstomper: the merged Level expansion only publishes the unevaluated XP predicate", () => {
  const levelDef = keywordDefinitionsById.get("Level");
  assert.ok(levelDef, "the merged Level KeywordDef is registered (CR 824)");
  const [predicate] = levelDef.expand({ value: 3, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(predicate.kind, "static");
  assert.equal(predicate.effect.kind, "condition.predicate");
  // 824.1.a: the [Level N] threshold is published as a query descriptor; the XP
  // read itself still has no Expr evaluator; static compare conditions can run.
  assert.equal(predicate.effect.query, "controller-xp");
  assert.equal(predicate.effect.characteristic, "xp");
  assert.deepEqual(predicate.effect.threshold, { kind: "constant", value: 3 });
});

test("unl-047-219 Mosstomper golden: the arithmetic +1 Might and the Deflect grant are really executable instructions", () => {
  // 824.1.b.1's [Text] halves are card-owned static effects; the merged primitives
  // The merged continuous primitives can really apply both when the 3+ XP gate is true. The goldens pin
  // the merged primitives' behaviour, and the unevaluated 824.1.c gate is what
  // keeps the whole card judge-required.
  const base = world().unit("mosstomper", { might: 3 }).build();
  const context = base.clone({ sourceSnapshot: base.getObject("mosstomper"), source: base.ref("mosstomper") });

  // 824.1.b.1's [Text] halves are card-owned static declarations; run them as the
  // merged primitives' executable args (the continuous.* ops take their selector
  // and amount through the contract 3.6 expression forms, and the layer is fixed
  // by the op itself).
  const mightOutcome = resolveChainBody([{
    id: "might-bonus", op: "continuous.might",
    args: { amount: mightBonus.effect.amount, mode: { kind: "constant", value: mightBonus.effect.mode }, appliesTo: { kind: "constant", value: mightBonus.effect.appliesTo } }
  }], context);
  assert.equal(mightOutcome.results[0].result.status, "executed");
  assert.equal(context.continuousEffects[0].effect.layer, "arithmetic");
  assert.equal(context.continuousEffects[0].effect.effect.amount, 1);

  const grantOutcome = resolveChainBody([{
    id: "grant-deflect", op: "continuous.grant-keyword",
    args: { keyword: { kind: "constant", value: deflectGrant.effect.keyword }, value: deflectGrant.effect.value, appliesTo: { kind: "constant", value: deflectGrant.effect.appliesTo } }
  }], context);
  assert.equal(grantOutcome.results[0].result.status, "executed");
  const layers = createLayerEngine(context.objects, context.continuousEffects);
  const snapshot = layers.evaluate(context.ref("mosstomper"));
  // 143.2.a / 475: +1 Might lands in the arithmetic layer.
  assert.equal(snapshot.might, 4);
  // 809.1.b.3: the granted Deflect carries the presumed value of 1.
  assert.deepEqual(snapshot.keywords, [{ id: "deflect", value: 1 }]);
});

test.todo(
  "unl-047-219 Mosstomper: evaluate [Level 3]'s 3+ XP gate (CR 824.1.b.1/824.1.c/824.1.d) so the [Text] " +
    "halves switch Active/Inactive by wiring condition.predicate to PlayerSnapshot.xp"
);
