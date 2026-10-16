import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import recruitDe from "../../../dist/cards/ogn/recruit-de.js";

test("ogn-271-298 Recruit (DE): program passes validateCardProgram", () => {
  const result = validateCardProgram(recruitDe);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-271-298 Recruit (DE): no-ability Colorless Recruit token", () => {
  assert.equal(
    recruitDe.canonicalCardId,
    "card.hash-a1488e943c6c92d892414a146fbf3fff172049ed362c2c8e77f631f50456eedc"
  );
  assert.equal(recruitDe.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(recruitDe.status, "no-ability");
  assert.deepEqual(recruitDe.abilities, []);
  assert.equal(recruitDe.judgeReason, undefined);
});

test("ogn-271-298 Recruit (DE): sourceText records the empty printed text", () => {
  assert.equal(recruitDe.sourceText, "[NO TEXT]");
});
