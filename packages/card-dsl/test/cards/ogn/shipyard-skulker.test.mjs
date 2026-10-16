import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import shipyardSkulker from "../../../dist/cards/ogn/shipyard-skulker.js";

test("ogn-175-298 Shipyard Skulker: program passes validateCardProgram", () => {
  const result = validateCardProgram(shipyardSkulker);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-175-298 Shipyard Skulker: no-ability unit with an empty ability list", () => {
  assert.equal(
    shipyardSkulker.canonicalCardId,
    "card.hash-26b6496677401782ccd8026209ea073522a10c2606cf1c4abc1ecc56a88c6e83"
  );
  assert.equal(shipyardSkulker.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(shipyardSkulker.status, "no-ability");
  assert.deepEqual(shipyardSkulker.abilities, []);
  assert.equal(shipyardSkulker.judgeReason, undefined);
});

test("ogn-175-298 Shipyard Skulker: sourceText records the empty printed text", () => {
  // The local deck-catalog stores this printing's ability as "" (no ability
  // text at all); the CardProgram contract requires a non-empty sourceText, so
  // the placeholder matches the one used for the basic Runes in this repo.
  assert.equal(shipyardSkulker.sourceText, "[NO TEXT]");
});
