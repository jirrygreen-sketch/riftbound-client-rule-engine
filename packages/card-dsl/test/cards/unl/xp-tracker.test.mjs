import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/xp-tracker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.equal(program.status, "no-ability");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.deepEqual(program.abilities, []);
});

test("unl-t08 XP Tracker: tracking information declares no XP action or Level ability", () => {
  // CR 729.1.a permits a card to mark the player's XP. The other two lines
  // describe other cards, not an ability of this tracking aid (730.2 / 824.1).
  assert.deepEqual(program.abilities, []);
  assert.equal(program.judgeReason, undefined);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});
