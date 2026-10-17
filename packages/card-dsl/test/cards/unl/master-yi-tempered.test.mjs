// Golden test for Master Yi, Tempered (unl-113-219).
//
// Execution evidence (the real printed 4 Energy payment, the registered
// [Level 6] grants with their unresolved XP gate, the fail-closed Hunt trigger
// registration and the blocked printed expectations) lives in the RIFT-673
// parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/master-yi-tempered.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /823\.1\.c\.1/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /Ganking/);
  // The remaining gaps are the trigger spelling/object payload, the XP
  // predicate, the target-tax consumer and the movement permission.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /controller-xp/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /condition\.predicate/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.doesNotMatch(program.judgeReason, /未识别条件按 true/);
});

test("unl-113-219 Master Yi, Tempered: [Hunt 2] carries its printed Hunt Value", () => {
  assert.equal(program.abilities.length, 3);
  // 823.1.c.3: X is the Hunt Value; this printing prints 2.
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
});

test("unl-113-219 Master Yi, Tempered: [Level 6][>] gates both grants on 6 or more XP", () => {
  for (const ability of [deflectGrant, gankingGrant]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.condition.kind, "all");
    assert.deepEqual(ability.condition.conditions[0], { kind: "never" });
    const pending = ability.condition.conditions[1];
    assert.equal(pending.kind, "compare");
    assert.equal(pending.operator, "gte");
    assert.deepEqual(pending.right, { kind: "constant", value: 6 });
    // 824.1.c / 824.1.c.1 / 824.1.d: the gate is the controller's XP and must
    // re-evaluate as it changes; the shape is retained, not evaluated.
    assert.equal(pending.left.kind, "count");
    assert.equal(pending.left.subject, "controller-xp");
    assert.deepEqual(pending.left.filter, { player: "controller" });
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

test.todo(
  "unl-113-219 Master Yi, Tempered: [Hunt 2] needs the conquer/hold event vocabulary and a unit " +
    "object payload so its subscription registers and matches (823.1.c.1)"
);
test.todo(
  "unl-113-219 Master Yi, Tempered: [Level 6]'s controller-XP gate needs an evaluable predicate with " +
    "live activation/deactivation, its own condition.predicate static needs a layer mapping, the granted " +
    "[Deflect] needs a target.tax consumer in Chain Finalize and the granted [Ganking] needs a movement " +
    "consumer reading permission.routes (824.1.c / 809.1.c / 810.1.c)"
);
