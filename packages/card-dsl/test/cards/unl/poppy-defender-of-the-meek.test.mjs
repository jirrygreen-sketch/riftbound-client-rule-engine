import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/poppy-defender-of-the-meek.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-c54e80533d4de83be156d119811d549cd348fa8bda54774a52cd58b3c451f3cf";
const SOURCE_TEXT =
  "You may spend 3 XP as an additional cost to play me. If you do, I cost :rb_energy_3: less.\n" +
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "[Tank] (I must be assigned combat damage first.)";

const [ambush, tank, additionalCost, discount] = program.abilities;

test("unl-178-219 Poppy, Defender of the Meek: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-178-219 Poppy, Defender of the Meek: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /condition\.result/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("unl-178-219 Poppy, Defender of the Meek: [Ambush] and [Tank] are declared without values", () => {
  // 822.1 / 815.1: both keywords print without a numeric value.
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
});

test("unl-178-219 Poppy, Defender of the Meek: the optional additional cost is 3 XP (356.2.b.1)", () => {
  assert.equal(program.abilities.length, 4);
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "poppy-defender-of-the-meek.xp-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments, [
    { kind: "xp", amount: { kind: "constant", value: 3 } }
  ]);
});

test("unl-178-219 Poppy, Defender of the Meek: the granted discount is 3 Energy, gated on the paid cost (356.4/356.4.f.1)", () => {
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "cost.modify");
  assert.equal(discount.effect.resource, "energy");
  // amount is the reduction (same meaning as the merged CostDiscount.amount), not
  // a signed delta; 356.4.e's minimum is not printed here, so no minimum is set.
  assert.deepEqual(discount.effect.amount, { kind: "constant", value: 3 });
  assert.equal(discount.effect.stage, "discount");
  assert.equal(discount.effect.minimum, undefined);
  // 356.4.f.1: the reduction is granted by the decision to pay, so it is scoped
  // to that additional-cost component rather than applied unconditionally.
  assert.equal(discount.effect.grantedBy, additionalCost.effect.id);
  assert.equal(discount.condition, undefined);
});

test.todo(
  "unl-178-219 Poppy, Defender of the Meek: charge the optional 3-XP additional cost during Finalize and feed the discount — " +
    "wire the declared cost.additional and cost.modify components into the CardProgram -> CostPlan path"
);
test.todo(
  "unl-178-219 Poppy, Defender of the Meek: gate the 3-Energy discount on the paid decision (356.4.f.1) by binding the original play decision to grantedBy (condition.result already exists)"
);
test.todo(
  "unl-178-219 Poppy, Defender of the Meek: bind [Ambush] location permission and the in-hand conditional Reaction scope (822.1.b/c); chain.canAct already queries timing"
);
test.todo(
  "unl-178-219 Poppy, Defender of the Meek: consume [Tank]'s lethal-first combat damage priority (815.1.b) in the combat allocator"
);
