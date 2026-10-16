import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/warmogs-armor.js";

test("Warmog's Armor card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-902c6a1366a1a0e653ccb65102ff621b109af3b0b40f5bbeb7d8d3a5aeae2322");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.sourceText, "[Equip] :rb_rune_body: (:rb_rune_body:: Attach this to a unit you control.)");
});

test("Warmog's Armor hosts a valued Body Equip keyword", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Body");
});

test.todo("Warmog's Armor: Equip keyword expansion (Body power cost, controlled-unit target, effect.attach body) is owned by the engine keyword registry (RIFT-81~91)");
