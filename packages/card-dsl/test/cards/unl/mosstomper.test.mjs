import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mosstomper.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

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
  assert.match(program.judgeReason, /823\.1/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-047-219 Mosstomper: [Hunt 2] carries the printed Hunt Value and no card-side expansion", () => {
  assert.equal(program.abilities.length, 3);
  // 823.1.c.3：印刷的 Hunt Value 是 2（展开与 823.2 的求和由 keywords/Hunt.ts 负责）。
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
  assert.equal(
    program.abilities.some((ability) => ability.kind === "triggered"),
    false,
    "[Hunt 2] must not be re-written as a conquer/hold trigger inside the card"
  );
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

test.todo(
  "unl-047-219 Mosstomper: expand [Hunt 2] (CR 823.1.b/823.1.c.1 with X = 2, 823.2 summing) into conquer " +
    "and hold triggers gaining 2 XP — no hunt KeywordDef exists (ability-templates kw-hunt)"
);
test.todo(
  "unl-047-219 Mosstomper: expand [Level 3][>] (CR 824.1.b.1: 'while you have 3 or more XP, this card gains " +
    "[Text]') with the dynamic Active/Inactive re-evaluation of 824.1.c.1/824.1.d — no kw-level expansion " +
    "and no readable XP expression path are merged (RIFT-89/90)"
);
test.todo(
  "unl-047-219 Mosstomper: register the +1 Might arithmetic layer effect and the Deflect keyword grant, " +
    "including re-expanding the granted Deflect on the receiver (CR 809, 801.3.a/364.1) — no card static " +
    "consumer and no continuous.grant-keyword primitive are merged (RIFT-91 / RIFT-90)"
);
