import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/vex-cheerless.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-f53634b94e6fae93d877ca3bb7f92c97c1f881953a9d82fc5a297b398f35d3ad";
const SOURCE_TEXT =
  "While I'm in combat, friendly spells cost :rb_energy_1::rb_rune_rainbow: less to a minimum of :rb_energy_1:, " +
  "and enemy spells cost :rb_energy_1::rb_rune_rainbow: more.";

const [friendly, enemy] = program.abilities;

const IN_COMBAT_CONDITION = {
  kind: "compare",
  left: { kind: "count", subject: "self-in-combat", filter: { object: "self" } },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

test("sfd-146-221 Vex, Cheerless: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-146-221 Vex, Cheerless: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.e/);
  assert.match(program.judgeReason, /740\.2\.c/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-146-221 Vex, Cheerless: friendly spells get a minimum-bounded [1]/[A] discount while in combat", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(friendly.kind, "static");
  // 356.4 / 356.4.b: "cost [amount] less"; 356.4.e: the minimum belongs to this
  // discount only (the rule's own example is Eager Apprentice's same shape).
  assert.equal(friendly.effect.kind, "continuous.cost-modification");
  assert.equal(friendly.effect.stage, "discount");
  assert.equal(friendly.effect.resource, "energy");
  assert.deepEqual(friendly.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(friendly.effect.minimum, { kind: "constant", value: 1 });
  // "or [A]": 163.2.b Universal Power kept as its own alternative.
  assert.deepEqual(friendly.effect.alternative, { resource: "power", universal: true, amount: 1 });
  // 740.1.a: "friendly" is relative to the spell's caster.
  assert.deepEqual(friendly.effect.appliesTo, { type: "spell", controller: "caster" });
  // 740.2.c: "While I'm in combat" — the recorded condition shape (no merged
  // in-combat characteristic exists; see judgeReason).
  assert.deepEqual(friendly.condition, IN_COMBAT_CONDITION);
});

test("sfd-146-221 Vex, Cheerless: enemy spells get a [1]/[A] increase while in combat", () => {
  assert.equal(enemy.kind, "static");
  // 356.2: an increase (mandatory additional cost) on the total spell cost.
  assert.equal(enemy.effect.kind, "continuous.cost-modification");
  assert.equal(enemy.effect.stage, "increase");
  assert.equal(enemy.effect.resource, "energy");
  assert.deepEqual(enemy.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(enemy.effect.alternative, { resource: "power", universal: true, amount: 1 });
  // 740.1.b: "enemy" is relative to the spell's caster.
  assert.deepEqual(enemy.effect.appliesTo, { type: "spell", controller: "caster-opponent" });
  assert.deepEqual(enemy.condition, IN_COMBAT_CONDITION);
});

test.todo(
  "sfd-146-221 Vex, Cheerless: apply the discount and the increase during Finalize for spells cast while this " +
    "unit is in combat (356.4 / 356.4.e / 356.2), including the caster's friendly/enemy relation (740.1.a-b) — " +
    "needs the card static effect -> CostPlanInput.discounts/increases wiring (RIFT-89 / RIFT-90)"
);

test.todo(
  "sfd-146-221 Vex, Cheerless: represent and charge the '[A]' (163.2.b Universal Power) term of both modifiers — " +
    "the closed Domain type and CostDiscount.resource cannot express it (effect.resources keeps [A] unsupported; " +
    "contract change request)"
);

test.todo(
  "sfd-146-221 Vex, Cheerless: evaluate \"While I'm in combat\" (740.2.c: a battlefield with combat ongoing plus a " +
    "combat designation) — contract 3.8's ObjectSnapshot.combatRole is not in engine-core's effects/contract.ts, and " +
    "layers/engine.ts conditionMatches does not evaluate a compare/count condition (RIFT-91)"
);
