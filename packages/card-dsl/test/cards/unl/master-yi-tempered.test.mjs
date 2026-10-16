import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/master-yi-tempered.js";

const CANONICAL_ID =
  "card.hash-c32a0493f88b4c947cb3f7806d8ba125b166dd6478a848bb39f1da87aed3ae92";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "[Level 6][>] I have [Deflect] and [Ganking]. (While you have 6+ XP, opponents must pay :rb_rune_rainbow: to choose me with a spell or ability and I can move from battlefield to battlefield.)";

const [hunt, deflectGrant, gankingGrant] = program.abilities;

test("unl-113-219 Master Yi, Tempered: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-113-219 Master Yi, Tempered: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /823\.1\.c\.1/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /Ganking/);
});

test("unl-113-219 Master Yi, Tempered: [Hunt 2] carries its printed Hunt Value", () => {
  assert.equal(program.abilities.length, 3);
  // 823.1.c.3: X is the Hunt Value; this printing prints 2.
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
});

test("unl-113-219 Master Yi, Tempered: [Level 6][>] gates both grants on 6 or more XP", () => {
  for (const ability of [deflectGrant, gankingGrant]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.condition.kind, "compare");
    assert.equal(ability.condition.operator, "gte");
    assert.deepEqual(ability.condition.right, { kind: "constant", value: 6 });
    // 824.1.c / 824.1.c.1 / 824.1.d: the gate is the controller's XP and must
    // re-evaluate as it changes; the shape is retained, not evaluated.
    assert.equal(ability.condition.left.kind, "count");
    assert.equal(ability.condition.left.subject, "controller-xp");
    assert.deepEqual(ability.condition.left.filter, { player: "controller" });
  }
});

test("unl-113-219 Master Yi, Tempered: Deflect is granted with the presumed value 1 (809.1.b.3)", () => {
  assert.equal(deflectGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(deflectGrant.effect.keyword, "Deflect");
  assert.deepEqual(deflectGrant.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(deflectGrant.effect.filter, { object: "self" });
});

test("unl-113-219 Master Yi, Tempered: Ganking is granted to the host", () => {
  assert.equal(gankingGrant.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingGrant.effect.keyword, "Ganking");
  assert.equal(gankingGrant.effect.value, undefined);
  assert.deepEqual(gankingGrant.effect.filter, { object: "self" });
});

test("unl-113-219 Master Yi, Tempered: the merged keyword registry has no Hunt or Level entry", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  assert.equal(keywordDefinitionsById.has("Hunt"), false);
  assert.equal(keywordDefinitionsById.has("Level"), false);
  // The two keywords this card needs for its grants are already merged, which is
  // why the judgeReason points at the grant-registration and XP-predicate gaps
  // rather than at missing Deflect/Ganking definitions.
  assert.equal(keywordDefinitionsById.has("Deflect"), true);
  assert.equal(keywordDefinitionsById.has("Ganking"), true);
});

test("unl-113-219 Master Yi, Tempered: the Deflect expansion is a target tax the merged target plan can bill", async () => {
  // 809.1.c / 809.1.d: the granted Deflect is a mandatory additional Power cost
  // for each time an opponent chooses this unit. The KeywordDef exists and the
  // target plan charges the tax it declares, but nothing registers the card's
  // Level-gated grant (see judgeReason).
  const { default: deflectDefinition } = await import(
    "../../../../engine-core/dist/effects/keywords/Deflect.js"
  );
  const [expansion] = deflectDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  // 809.1.b.3: the omitted Deflect Value is presumed 1.
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test.todo(
  "unl-113-219 Master Yi, Tempered: expand [Hunt 2] as the 823.1.c.1 conquer/hold trigger and the 823.2 summing — effects/keywords has no Hunt KeywordDef"
);
test.todo(
  "unl-113-219 Master Yi, Tempered: expand [Level 6][>] (824.1.b.1) with dynamic Active/Inactive re-evaluation (824.1.c.1 / 824.1.d) — no kw-level expansion and no Expr path to PlayerSnapshot.xp"
);
test.todo(
  "unl-113-219 Master Yi, Tempered: register the Level-gated Deflect target tax and Ganking grant as ContinuousEffectSpecs and bill the tax through the target/cost plan (809.1.c, 810.1.c) — no merged card-program → continuous-effect producer (RIFT-91)"
);
