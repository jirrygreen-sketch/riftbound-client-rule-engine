import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import bodyRune from "../../../dist/cards/ogn/body-rune.js";

test("ogn-126-298 Body Rune: program passes validateCardProgram", () => {
  const result = validateCardProgram(bodyRune);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-126-298 Body Rune: no-ability basic rune", () => {
  assert.equal(bodyRune.canonicalCardId, "card.hash-a2227b03e9e13c8e2ddae7a973c746cc4243ff631dfaf462dc9823e687bbbf17");
  assert.equal(bodyRune.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(bodyRune.status, "no-ability");
  assert.deepEqual(bodyRune.abilities, []);
  assert.equal(bodyRune.judgeReason, undefined);
});

test("ogn-126-298 Body Rune: sourceText records the empty printed text", () => {
  assert.equal(bodyRune.sourceText, "[NO TEXT]");
});
