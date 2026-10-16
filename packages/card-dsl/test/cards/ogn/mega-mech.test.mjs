import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/mega-mech.js";

const CANONICAL_ID =
  "card.hash-013b8118d566bc866a5d38ab100291257ea7bcfbae2ffeecf5be16658ee2061d";

test("ogn-088-298 Mega-Mech: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-088-298 Mega-Mech: no-ability unit identity", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "no-ability");
  assert.equal(program.judgeReason, undefined);
  assert.deepEqual(program.abilities, []);
});

test("ogn-088-298 Mega-Mech: sourceText records the confirmable absence of printed abilities", () => {
  // A 7-Energy 8-Might Mind Mech with no printed ability text. CardProgram
  // requires a non-empty sourceText, so the "[NO TEXT]" sentinel is used.
  assert.equal(program.sourceText, "[NO TEXT]");
});
