import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import recruitZn from "../../../dist/cards/ogn/recruit-zn.js";

test("ogn-273-298 Recruit (ZN): program passes validateCardProgram", () => {
  const result = validateCardProgram(recruitZn);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-273-298 Recruit (ZN): no-ability Colorless Recruit token", () => {
  assert.equal(
    recruitZn.canonicalCardId,
    "card.hash-632c13dcb7b2a8f7fdf9713474eae27ad470c64055fd356750c3998847de0495"
  );
  assert.equal(recruitZn.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(recruitZn.status, "no-ability");
  assert.deepEqual(recruitZn.abilities, []);
  assert.equal(recruitZn.judgeReason, undefined);
});

test("ogn-273-298 Recruit (ZN): sourceText records the empty printed text", () => {
  assert.equal(recruitZn.sourceText, "[NO TEXT]");
});
