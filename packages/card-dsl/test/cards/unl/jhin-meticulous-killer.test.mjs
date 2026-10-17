import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/jhin-meticulous-killer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-2648cb6e37ecc2bc72c247e17fe7af8e3dc29a5758f7e6f972111de8c47ee473";
const SOURCE_TEXT =
  "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
  "If you've spent :rb_energy_4: or more to play a spell this turn, you may play me for :rb_rune_mind:.";

const [vision, alternateCost] = program.abilities;

test("unl-089-219 Jhin, Meticulous Killer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-089-219 Jhin, Meticulous Killer: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Energy/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-089-219 Jhin, Meticulous Killer: [Vision] is a plain keyword declaration", () => {
  // 817.1.b / 817.1.c: Vision is functionally "When this is played, [Predict]";
  // the card only names it and effects/keywords/Vision.ts owns the expansion.
  assert.deepEqual(vision, { kind: "keyword", keyword: "vision" });
  assert.equal(vision.value, undefined);
});

test("unl-089-219 Jhin, Meticulous Killer: the alternate play keeps the spent-4 condition and the 1 Mind Power cost", () => {
  // 355.1 / 356.1.a: "you may play me for [C]" is a Finalize-time permission
  // that replaces the printed cost; the declared static shape keeps it exact.
  assert.equal(alternateCost.kind, "static");
  assert.equal(alternateCost.effect.kind, "play-for-alternate-cost");
  assert.equal(alternateCost.effect.appliesTo, "self");
  assert.equal(alternateCost.effect.optional, true);
  assert.deepEqual(alternateCost.effect.cost, {
    kind: "alternate-cost",
    power: { kind: "constant", value: ["Mind"] }
  });

  // "If you've spent [4] or more to play a spell this turn" — the readable
  // condition shape; the amount actually paid has no reader today.
  assert.equal(alternateCost.condition.kind, "compare");
  assert.equal(alternateCost.condition.operator, "gte");
  assert.deepEqual(alternateCost.condition.right, { kind: "constant", value: 4 });
  assert.equal(alternateCost.condition.left.kind, "count");
  assert.equal(alternateCost.condition.left.subject, "energy-spent-on-spells-this-turn");
  // The energy: null / power: null of the printed characteristics are never
  // rewritten here; the alternate cost is a separate declaration.
  assert.deepEqual(alternateCost.effect.cost.power, { kind: "constant", value: ["Mind"] });
});

test("unl-089-219 Jhin, Meticulous Killer: the declared keyword resolves to the merged Vision definition", () => {
  const definition = keywordDefinitionsById.get("Vision");
  assert.ok(definition, "keywords/Vision.ts must be registered for this declaration");
  assert.equal(definition.valued, false);
  const expansion = definition.expand({ value: vision.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.length, 1);
  // 817.1.c: the trigger is the permanent entering the Board; the Predict body
  // (effect.inspect + effect.recycle) stays in the keyword definition.
  assert.equal(expansion[0].kind, "triggered");
  assert.equal(expansion[0].trigger.at, "object-enters-board");
});

test.todo(
  "unl-089-219 Jhin, Meticulous Killer: Vision's Predict binds the ordered top card " +
    "(CR 437.1 / 817.1.b) — effect.inspect still needs production injection of the ordered top-card picks " +
    "and a binding for the keyword's controller"
);
test.todo(
  "unl-089-219 Jhin, Meticulous Killer: fire the Vision trigger from the real Board-entry flow " +
    "(CR 817.1.c) — the keyword expansion exists, but the Board-entry producer and trigger registration " +
    "must deliver the resolved controller and source"
);
