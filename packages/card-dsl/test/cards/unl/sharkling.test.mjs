import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sharkling.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-a9d231899d6f3cc46b5f8d00320977ba937b799647d39e1c0b6ccf4ddb83b162";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "[Assault 4] (+4 :rb_might: while I'm an attacker.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("unl-006-219 Sharkling: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-006-219 Sharkling: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /805\.6/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /combatRole/);
});

test("unl-006-219 Sharkling: unvalued Accelerate plus Assault 4, in printed order", () => {
  assert.equal(program.abilities.length, 2);
  // 805.1.b: the Accelerate cost is the fixed [1][C] payment, so the keyword
  // carries no value; on this printing [C] must match the unit's Fury domain
  // (805.1.b.1) — card data only declares the keyword.
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "accelerate" });
  assert.equal(program.abilities[0].value, undefined);
  assert.equal(program.abilities[0].keyword, "accelerate");
  // 807.1.b.1-2: the printed "Assault 4" fixes the Assault Value at 4.
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "assault", value: 4 });
});

test("unl-006-219 Sharkling: both declared keywords resolve to the merged KeywordDefs", () => {
  const registeredAccelerate = keywordDefinitionsById.get("Accelerate");
  const registeredAssault = keywordDefinitionsById.get("Assault");
  assert.equal(registeredAccelerate, accelerate);
  assert.equal(registeredAssault, assault);
  // 805.4: multiple Accelerate instances are redundant; 807.2: Assault sums.
  assert.equal(registeredAccelerate.valued, false);
  assert.equal(registeredAccelerate.stacking, "single");
  assert.equal(registeredAssault.valued, true);
  assert.equal(registeredAssault.stacking, "sum");
});

test("unl-006-219 Sharkling: the Accelerate expansion declares the optional [1][C] cost and the enter-ready replacement", () => {
  const expansion = accelerate.expand({ host: HOST });
  assert.equal(expansion.length, 2);
  const [costDeclaration, replacement] = expansion;
  // 805.1.b / 805.2.a: the additional cost is [1] plus one matching-domain Power.
  assert.equal(costDeclaration.kind, "static");
  assert.equal(costDeclaration.effect.kind, "accelerate.cost");
  assert.deepEqual(costDeclaration.effect.cost.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } },
    { kind: "power", amount: { kind: "constant", value: 1 } }
  ]);
  // 805.6 / 805.6.a: the paid cost replaces entering exhausted with entering ready.
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces.filter, {
    self: true,
    cardId: CANONICAL_ID,
    exhausted: true
  });
  assert.deepEqual(replacement.with.map(instruction => instruction.op), ["effect.ready"]);
});

test("unl-006-219 Sharkling: the Assault 4 expansion is +4 Might gated on the Attacker designation", () => {
  const [ability] = assault.expand({ value: program.abilities[1].value, host: HOST });
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 4 });
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.condition.left.property, "designation");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "attacker" });
});

test("unl-006-219 Sharkling: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-006-219 Sharkling: pay the optional Accelerate cost [1][Fury] during the play and let the unit enter " +
    "ready instead of exhausted (CR 805.1.b.1 / 805.2.b / 805.6) — no merged producer feeds a card's keyword " +
    "abilities into cost/cost-plan.ts optionalAdditional, and the delayed entry replacement has no consumer (RIFT-89)"
);

test.todo(
  "unl-006-219 Sharkling: apply Assault 4 as +4 Might exactly while the unit holds the Attacker designation " +
    "(CR 807.1.c / 807.1.d.1) — no card-to-layer registration path for KeywordDef expansions (RIFT-81 / RIFT-91) " +
    "and the Attacker designation is not an ObjectSnapshot characteristic (contract 3.8 combatRole)"
);
