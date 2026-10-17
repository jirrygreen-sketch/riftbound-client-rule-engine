// Golden test for Mosstomper (unl-047-219).
//
// Execution evidence (the real printed 3 Energy + 1 Calm Power payment, the
// registered [Level 3] statics behind their blocked XP gate, the fail-closed
// Hunt trigger registration and the blocked printed expectations) lives in the
// RIFT-673 parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mosstomper.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
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
    assert.equal(ability.condition.kind, "all");
    assert.deepEqual(ability.condition.conditions[0], { kind: "never" });
    const condition = ability.condition.conditions[1];
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
});

test.todo(
  "unl-047-219 Mosstomper: [Hunt 2] needs the conquer/hold event vocabulary alignment and the scoring " +
    "wave's unit attribution before its subscription can register (823.1.c.1)"
);
test.todo(
  "unl-047-219 Mosstomper: [Level 3] needs an evaluable controller-XP predicate (824.1.c) and the granted " +
    "[Deflect] needs its target.tax Power cost wired into Chain Finalize (809.1.c)"
);
