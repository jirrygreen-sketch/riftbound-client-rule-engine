import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/mountain-drake.js";

const CANONICAL_ID =
  "card.hash-3da057e91cac9110282dafd16e8d7fb8c7bea131220ccfb510da18e1058ec4f2";

test("ogn-142-298 Mountain Drake: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-142-298 Mountain Drake: no-ability unit identity", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "no-ability");
  assert.equal(program.judgeReason, undefined);
  assert.deepEqual(program.abilities, []);
});

test("ogn-142-298 Mountain Drake: sourceText records the confirmable absence of printed abilities", () => {
  // A 9-Energy 10-Might Body Dragon with no printed ability text. CardProgram
  // requires a non-empty sourceText, so the "[NO TEXT]" sentinel is used.
  assert.equal(program.sourceText, "[NO TEXT]");
});
