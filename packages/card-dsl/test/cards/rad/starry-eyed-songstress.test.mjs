import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/starry-eyed-songstress.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-464b0b2dffb63bc44ee6874ec88c809233d08e06f5215125cc0ac77d4012c215";
const SOURCE_TEXT =
  "As an additional cost to play a spell, you may exhaust me and three friendly units to reduce " +
  "the cost of that spell by :rb_energy_2:.";

const [ability] = program.abilities;
const { effect } = ability;

test("rad-151-167 Starry-Eyed Songstress: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-151-167 Starry-Eyed Songstress: identity, status, judgeReason, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.(additional|modify|pay)/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /legend-zone/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("rad-151-167 Starry-Eyed Songstress: passive ability is a spell-play cost modification", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  // CR 363: the provider is a Passive Ability; CR 356.4.f: the discount is a
  // fixed 2 Energy reduction of the spell being played.
  assert.equal(effect.kind, "cost.modify");
  assert.equal(effect.appliesTo, "play-spell-cost");
  assert.equal(effect.resource, "energy");
  assert.equal(effect.amount, -2);
  assert.deepEqual(effect.filter, { type: "spell", controller: "controller" });
});

test("rad-151-167 Starry-Eyed Songstress: optional additional cost is exhaust me plus three friendly units", () => {
  // CR 356.2.b.1: "as an additional cost" + "may" is an Optional Additional Cost.
  assert.equal(effect.additionalCost.optional, true);
  assert.equal(effect.additionalCost.payments.length, 2);

  // CR 415.4 / 415.5: "exhaust me" is a cost-Exhaust on the legend itself.
  const [exhaustMe, exhaustUnits] = effect.additionalCost.payments;
  assert.deepEqual(exhaustMe, { kind: "exhaust", object: "self" });

  // CR 355.10.c.1 / 355.7: cost selections are not targets, so this is a
  // non-target object choice (three friendly units, exactly three).
  assert.equal(exhaustUnits.kind, "exhaust");
  assert.equal(exhaustUnits.amount, 3);
  assert.equal(exhaustUnits.choice.id, "starry-eyed-songstress.friendly-units");
  assert.equal(exhaustUnits.choice.min, 3);
  assert.equal(exhaustUnits.choice.max, 3);
  assert.equal(exhaustUnits.choice.selection, "all");
  assert.equal(exhaustUnits.choice.zone, "board");
  assert.equal(exhaustUnits.choice.type, "unit");
  // "friendly units" = the legend controller's units.
  assert.equal(exhaustUnits.choice.owner, "controller");
});

// The whole card stays blocked: cost.additional / cost.pay / cost.modify are
// still in flight (RIFT-261), no consumer reads a card's static cost declaration
// and the contract ZoneId has no legend zone, so there is no honest execution
// scenario to run here.
test.todo(
  "rad-151-167 Starry-Eyed Songstress: offer the optional additional cost in the cost plan's " +
    "step 2 and apply the fixed -2 Energy discount to the spell's cost (CR 356.2.b.1 / 356.4.f; " +
    "cost.additional + cost.modify, RIFT-261)"
);
test.todo(
  "rad-151-167 Starry-Eyed Songstress: exhaust the legend in the Legend Zone (CR 107.4.c / 415.4; " +
    "contract ZoneId needs legend-zone) and bind the card's static cost ability into the cost/layer " +
    "pipeline (RIFT-257)"
);
