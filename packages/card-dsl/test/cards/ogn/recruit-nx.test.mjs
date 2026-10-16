import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import recruitNx from "../../../dist/cards/ogn/recruit-nx.js";

test("ogn-272-298 Recruit (NX): program passes validateCardProgram", () => {
  const result = validateCardProgram(recruitNx);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-272-298 Recruit (NX): no-ability Colorless Recruit token", () => {
  assert.equal(
    recruitNx.canonicalCardId,
    "card.hash-3427b0d1d2aac421ca32b1a54e92aa724dfad5104e75a9c079ba3fcd994c1275"
  );
  assert.equal(recruitNx.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(recruitNx.status, "no-ability");
  assert.deepEqual(recruitNx.abilities, []);
  assert.equal(recruitNx.judgeReason, undefined);
});

test("ogn-272-298 Recruit (NX): sourceText records the empty printed text", () => {
  assert.equal(recruitNx.sourceText, "[NO TEXT]");
});
