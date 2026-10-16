import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import vanguardSergeant from "../../../dist/cards/ogn/vanguard-sergeant.js";

test("ogn-219-298 Vanguard Sergeant: program passes validateCardProgram", () => {
  const result = validateCardProgram(vanguardSergeant);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-219-298 Vanguard Sergeant: no-ability unit with an empty ability list", () => {
  assert.equal(
    vanguardSergeant.canonicalCardId,
    "card.hash-2699806693271ba8415ce329175bc848332f4227c5bee9d0d012d756e7e91ad0"
  );
  assert.equal(vanguardSergeant.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(vanguardSergeant.status, "no-ability");
  assert.deepEqual(vanguardSergeant.abilities, []);
  assert.equal(vanguardSergeant.judgeReason, undefined);
});

test("ogn-219-298 Vanguard Sergeant: sourceText records the empty printed text", () => {
  assert.equal(vanguardSergeant.sourceText, "[NO TEXT]");
});
