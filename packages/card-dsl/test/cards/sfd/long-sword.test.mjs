import assert from "node:assert/strict";
import test from "node:test";
import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/long-sword.js";

test("Long Sword card program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.issues));
  assert.equal(program.canonicalCardId, "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010");
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(
    program.sourceText,
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
  );
});

test("Long Sword hosts Quick-Draw and a valued Fury Equip keyword", () => {
  assert.equal(program.abilities.length, 2);
  const [quickDraw, equip] = program.abilities;
  assert.deepEqual(quickDraw, { kind: "keyword", keyword: "quick-draw" });
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
});

test.todo("Long Sword: Equip keyword expansion (action-speed activated ability, Fury power cost, controlled-unit target, effect.attach body) is owned by the engine keyword registry (RIFT-81~91)");
test.todo("Long Sword: Quick-Draw keyword expansion (inherent Reaction plus a card-played trigger that attaches to a unit you control) is owned by the engine keyword registry (RIFT-81~91)");
