import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/chaos-rune.js";

const CANONICAL_ID =
  "card.hash-055d9ad1c38fc05b800d053d3845209673f5397b39fb7bf76787adbc8cf42743";

test("ogn-166-298 Chaos Rune: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-166-298 Chaos Rune: no-ability basic rune identity", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "no-ability");
  assert.equal(program.judgeReason, undefined);
  assert.deepEqual(program.abilities, []);
});

test("ogn-166-298 Chaos Rune: sourceText records the confirmable absence of printed abilities", () => {
  // The official gallery record for this printing has an empty ability string;
  // CardProgram requires a non-empty sourceText, so the repository uses the
  // "[NO TEXT]" no-text sentinel (matching ogn/body-rune.ts). CR 164.2's two
  // Basic Rune abilities (the Chaos one adds Chaos Power, 164.2.b.1) are
  // rule-granted, not printed.
  assert.equal(program.sourceText, "[NO TEXT]");
});
