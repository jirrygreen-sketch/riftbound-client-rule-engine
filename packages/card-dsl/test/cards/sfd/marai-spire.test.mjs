import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/marai-spire.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const [ability] = program.abilities;

test("sfd-211-221 Marai Spire: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(
    program.canonicalCardId,
    "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd"
  );
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /Repeat/);
  assert.equal(
    program.sourceText,
    "While you control this battlefield, friendly [Repeat] costs cost :rb_energy_1: less."
  );
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("sfd-211-221 Marai Spire: static Repeat-cost discount scoped to friendly Repeat sources", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "cost.modify");
  assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
  assert.equal(ability.effect.appliesTo, "repeat-additional-cost");
  assert.deepEqual(ability.effect.filter, {
    keyword: "Repeat",
    controller: "self",
    zone: "board"
  });
  // "While you control this battlefield" (190.6.a / 190.6.d) is kept explicit.
  assert.deepEqual(ability.condition, { kind: "always" });
});

// The discount is not executable: no cost.modify primitive / Finalize cost-plan
// consumer, and the Repeat keyword's own additional-cost path is not wired.
test.todo(
  "sfd-211-221 Marai Spire: apply the -1 energy discount to friendly Repeat additional costs at Finalize (cost.modify + cost plan, RIFT-89; 356.4/356.4.f/356.6)"
);
test.todo(
  "sfd-211-221 Marai Spire: Repeat additional-cost payment wiring so the discount has a target cost to modify (keywords/Repeat.ts cost.additional/cost.pay)"
);
