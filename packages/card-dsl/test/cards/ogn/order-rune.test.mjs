import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import orderRune from "../../../dist/cards/ogn/order-rune.js";

test("ogn-214-298 Order Rune: program passes validateCardProgram", () => {
  const result = validateCardProgram(orderRune);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-214-298 Order Rune: no-ability basic rune", () => {
  assert.equal(orderRune.canonicalCardId, "card.hash-e0efe08be77e60ed68f2e43ba425b763efd364eb44b0c760d26ef1fcc1b6df67");
  assert.equal(orderRune.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(orderRune.status, "no-ability");
  assert.deepEqual(orderRune.abilities, []);
  assert.equal(orderRune.judgeReason, undefined);
});

test("ogn-214-298 Order Rune: sourceText records the empty printed text", () => {
  assert.equal(orderRune.sourceText, "[NO TEXT]");
});
