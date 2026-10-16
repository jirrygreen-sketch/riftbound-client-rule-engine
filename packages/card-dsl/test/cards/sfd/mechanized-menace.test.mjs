import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import mechanizedMenace from "../../../dist/cards/sfd/mechanized-menace.js";

test("sfd-181-221 Mechanized Menace: program passes validateCardProgram", () => {
  const result = validateCardProgram(mechanizedMenace);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-181-221 Mechanized Menace: identity and status", () => {
  assert.equal(
    mechanizedMenace.canonicalCardId,
    "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7"
  );
  assert.equal(mechanizedMenace.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(mechanizedMenace.status, "executable");
  assert.equal(mechanizedMenace.judgeReason, undefined);
});

test("sfd-181-221 Mechanized Menace: single static keyword-grant ability", () => {
  assert.equal(mechanizedMenace.abilities.length, 1);
  const ability = mechanizedMenace.abilities[0];
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "grant-keyword");
  assert.equal(ability.effect.keyword, "shield");
  // Shield without a printed value presumes X = 1 (CR 814.1.b.3).
  assert.deepEqual(ability.effect.value, { kind: "constant", value: 1 });
  // The grant covers every Mech unit the legend's controller controls.
  assert.equal(ability.effect.filter.type, "unit");
  assert.equal(ability.effect.filter.tag, "mech");
  assert.equal(ability.effect.filter.controller, "controller");
  assert.equal(ability.effect.filter.zone, "board");
  assert.equal(ability.condition, undefined);
});

test("sfd-181-221 Mechanized Menace: sourceText is the printed ability text", () => {
  assert.equal(
    mechanizedMenace.sourceText,
    "Your Mechs have [Shield]. (+1 :rb_might: while they're defenders.)"
  );
});

test.todo(
  "layer evaluation of grant-keyword (Mech units gain Shield 1; +1 might while defenders) — pending Shield KeywordDef / layers expansion (RIFT-81~91)"
);
