import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import mindRune from "../../../dist/cards/ogn/mind-rune.js";

test("ogn-089-298 Mind Rune: program passes validateCardProgram", () => {
  const result = validateCardProgram(mindRune);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-089-298 Mind Rune: no-ability basic rune", () => {
  assert.equal(mindRune.canonicalCardId, "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b");
  assert.equal(mindRune.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(mindRune.status, "no-ability");
  assert.deepEqual(mindRune.abilities, []);
  assert.equal(mindRune.judgeReason, undefined);
});

test("ogn-089-298 Mind Rune: sourceText records the empty printed text", () => {
  assert.equal(mindRune.sourceText, "[NO TEXT]");
});
