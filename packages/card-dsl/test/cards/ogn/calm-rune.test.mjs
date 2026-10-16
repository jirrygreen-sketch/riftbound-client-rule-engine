import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/calm-rune.js";

const CANONICAL_ID =
  "card.hash-efe5e5f4811f4089cd86b83cd6b8385613b0f469b2c2ae9f6b74a55ceb5cf0ed";

test("ogn-042-298 Calm Rune: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-042-298 Calm Rune: no-ability basic rune identity", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "no-ability");
  assert.equal(program.judgeReason, undefined);
  assert.deepEqual(program.abilities, []);
});

test("ogn-042-298 Calm Rune: sourceText records the confirmable absence of printed abilities", () => {
  // The official gallery record for this printing has an empty ability string;
  // CardProgram requires a non-empty sourceText, so the repository uses the
  // "[NO TEXT]" no-text sentinel (matching ogn/body-rune.ts and the other basic
  // runes). CR 164.2's two Basic Rune abilities are rule-granted, not printed.
  assert.equal(program.sourceText, "[NO TEXT]");
});
