import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/targonian-visionary.js";

const CANONICAL_ID =
  "card.hash-7a28733b1d7d68a60f53e6b2afcce546b7e3c138e103f63079734f2d3809e08f";
const SOURCE_TEXT =
  "[Level 11][>] I have +4 :rb_might:. (While you have 11+ XP, get the effect.)";

const [levelEleven] = program.abilities;

test("unl-098-219 Targonian Visionary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-098-219 Targonian Visionary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /Level/);
  assert.match(program.judgeReason, /XP/);
  assert.match(program.judgeReason, /continuous\.might/);
});

test("unl-098-219 Targonian Visionary: [Level 11][>] is one static +4 Might ability for the host", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(levelEleven.kind, "static");
  // 824.1.b.2: the Dependent Ability here is "I have +4 :rb_might:" — an
  // arithmetic-layer Might change (143.2.a), not a Buff counter (702).
  assert.equal(levelEleven.effect.kind, "continuous.might");
  assert.equal(levelEleven.effect.mode, "add");
  assert.equal(levelEleven.effect.layer, "arithmetic");
  assert.deepEqual(levelEleven.effect.amount, { kind: "constant", value: 4 });
  // 053.1: "I" is the ability host.
  assert.deepEqual(levelEleven.effect.filter, { object: "self" });
});

test("unl-098-219 Targonian Visionary: the 11-XP gate keeps the 824.1.b.1 shape", () => {
  const condition = levelEleven.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 11 });
  // 824.1.c: the gate is the controller's XP (824.1.c.1 / 824.1.d re-evaluate on
  // a controller change or a drop below 11). PlayerSnapshot.xp has no Expr path
  // yet — the shape is retained, not evaluated (see judgeReason).
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "controller-xp");
  assert.deepEqual(condition.left.filter, { player: "controller" });
});

test("unl-098-219 Targonian Visionary: no Level keyword expansion is registered in the merged engine", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  // The merged KeywordDef set is Accelerate…Weaponmaster; there is no "Level"
  // entry, so [Level 11][>] cannot expand (824.1).
  assert.equal(keywordDefinitionsById.has("Level"), false);
  assert.equal(keywordDefinitionsById.has("Accelerate"), true);
});

test.todo(
  "unl-098-219 Targonian Visionary: expand [Level N][>] (CR 824.1.b.1: 'while you have N or more XP, this card gains [Text]') " +
    "with dynamic Active/Inactive re-evaluation (824.1.c.1 / 824.1.d) — no kw-level expansion is merged"
);
test.todo(
  "unl-098-219 Targonian Visionary: register the +4 Might arithmetic-layer effect and evaluate its 11+ XP gate — no merged producer turns a CardProgram static ability into a ContinuousEffectSpec, and the layer engine's conditionMatches does not evaluate compare (RIFT-91 card wiring + the XP predicate path)"
);
