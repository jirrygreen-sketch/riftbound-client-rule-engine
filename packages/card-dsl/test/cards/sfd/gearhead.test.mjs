import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/gearhead.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-2c09104cfceee81462b6ee602bc9183760b8851fe12ba9f8a6283f6432704cd4";

const [accelerate, attachedBonus] = program.abilities;

test("sfd-068-221 Gearhead: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
      "Each Equipment attached to me gives double its base Might bonus."
  );
});

test("sfd-068-221 Gearhead: judgeReason names the Accelerate expansion and the Might Bonus gaps", () => {
  assert.match(program.judgeReason, /805/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /137\.1/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-068-221 Gearhead: [Accelerate] is declared as a keyword, never re-expanded", () => {
  // 805.1/805.1.a: Accelerate is an optional-additional-cost keyword on Units;
  // its expansion (cost.additional + the enter-ready replacement of 805.6) is
  // owned by effects/keywords/Accelerate.ts (contract 3.7).
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.equal(accelerate.value, undefined);
});

test("sfd-068-221 Gearhead: the attached-Equipment doubling is a static self Might modification", () => {
  // 137.3/435.1.d: an attached card's Might Bonus modulates its host; "double
  // its base Might bonus" adds one more copy of that Equipment's PRINTED bonus.
  assert.equal(attachedBonus.kind, "static");
  assert.equal(attachedBonus.effect.kind, "continuous.might");
  assert.equal(attachedBonus.effect.mode, "add");
  assert.equal(attachedBonus.effect.layer, "arithmetic");
  assert.equal(attachedBonus.effect.appliesTo, "self");
  assert.equal(attachedBonus.effect.source, "attached-equipment");
  assert.equal(attachedBonus.effect.baseValue, true);
  assert.deepEqual(attachedBonus.effect.amount, {
    kind: "constant",
    value: "each-attached-equipment-base-might-bonus"
  });
  // The doubling is a layer modification of Might, never a Buff counter (702/703).
  assert.equal("buffs" in attachedBonus.effect, false);
});

test.todo(
  "sfd-068-221 Gearhead: [Accelerate]'s optional additional cost [1][Mind] charges in Finalize and the " +
    "805.6 enter-ready replacement runs through the replacement pipeline (cost plan wiring + " +
    "replacement.enter; RIFT-89 and the enter-replacement batch)"
);
test.todo(
  "sfd-068-221 Gearhead: an attached Equipment's printed Might Bonus doubles through the arithmetic " +
    "layer — the ObjectSnapshot has no Might Bonus characteristic (CR 137.1/435.1.d) and no card static " +
    "ability is registered into layers (RIFT-91 follow-up)"
);
