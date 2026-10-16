import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import furyRune from "../../../dist/cards/ogn/fury-rune.js";

test("ogn-007-298 Fury Rune: program passes validateCardProgram", () => {
  const result = validateCardProgram(furyRune);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-007-298 Fury Rune: no-ability basic rune", () => {
  assert.equal(furyRune.canonicalCardId, "card.hash-30497c69657abd1d3abf17f9b3766e7d064817473a88828ca2ef4ab9b51f7902");
  assert.equal(furyRune.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(furyRune.status, "no-ability");
  assert.deepEqual(furyRune.abilities, []);
  assert.equal(furyRune.judgeReason, undefined);
});

test("ogn-007-298 Fury Rune: sourceText records the empty printed text", () => {
  assert.equal(furyRune.sourceText, "[NO TEXT]");
});
