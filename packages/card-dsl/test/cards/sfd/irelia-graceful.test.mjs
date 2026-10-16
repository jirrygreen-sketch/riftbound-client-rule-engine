import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/irelia-graceful.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-4226ae419dd851644c384f3f4d645badcec767b55055e62cb45fcc436ec55e03";
const SOURCE_TEXT = "Your spells that choose me cost :rb_energy_1: or :rb_rune_rainbow: less.";

const [ability] = program.abilities;

test("sfd-141-221 Irelia, Graceful: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-141-221 Irelia, Graceful: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-141-221 Irelia, Graceful: one static cost reduction scoped to spells that choose this unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 356.4 / 356.4.b: a discount on the spell cost; 355.6: "choose" is Targeting,
  // so the scope names this unit through the symbolic "self" selector.
  const effect = ability.effect;
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.stage, "discount");
  assert.equal(effect.resource, "energy");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  // "or [A]": 163.2.b's Universal Power, kept as its own alternative rather than
  // being folded into a named domain.
  assert.deepEqual(effect.alternative, { resource: "power", universal: true, amount: 1 });
  assert.deepEqual(effect.appliesTo, { type: "spell", object: "self" });
});

test.todo(
  "sfd-141-221 Irelia, Graceful: apply the declared discount during Finalize for spells that target this " +
    "unit (356.4 / 356.4.c; 355.6 choose = Targeting) — needs the card static effect -> CostPlanInput.discounts " +
    "wiring plus a per-target discount dimension (RIFT-89 / RIFT-90)"
);

test.todo(
  "sfd-141-221 Irelia, Graceful: represent and charge the '[A]' (163.2.b Universal Power) alternative, and let " +
    "the payer choose between the Energy and Universal-Power reductions — the closed Domain type and " +
    "CostDiscount.resource cannot express either (effect.resources keeps [A] unsupported; contract change request)"
);
