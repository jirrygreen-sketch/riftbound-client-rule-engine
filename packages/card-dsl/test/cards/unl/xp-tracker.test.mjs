import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/xp-tracker.js";

const CANONICAL_ID =
  "card.hash-bd13577acf2621457b102b04d868bc9c236deec535cbd42baead7bc5fee78ab4";
const SOURCE_TEXT =
  "Track gained XP here.\n" +
  "Some cards get bonuses based on your [Level].\n" +
  "Some cards can spend XP for powerful effects.";

test("unl-t08 XP Tracker: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-t08 XP Tracker: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.deepEqual(program.abilities, []);
});

test("unl-t08 XP Tracker: the reason names the tracking/reminder rules and keeps the ability list empty", () => {
  // 729.1.a: XP can be tracked with a card or any clear marker — the first line is
  // the physical tracking instruction, not an ability. 824.1: the Level clause is
  // reminder text for the dependent keyword implemented by the cards that use it.
  // 730.2: the spend clause reminds about XP spending, which those cards' costs do.
  assert.match(program.judgeReason, /729\.1\.a/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /730\.2/);
  assert.equal(program.judgeReason.includes("no-ability"), true);
  assert.deepEqual(program.abilities, []);
});

test.todo(
  "unl-t08 XP Tracker: no CardProgram ability is authored for this token because all three printed lines are rules reminders about " +
    "XP tracking (729.1.a), the [Level] dependent keyword (824.1) and XP spending (730.2); the XP actions live in effect.xp / cost.xp, not on this token"
);
