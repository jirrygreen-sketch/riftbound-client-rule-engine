import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/frostcoat-cub.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-868962f51f93e867b6166a5b00e7da34767ced7692925eb143855d3d05c68618";

const [additionalCost, playTrigger] = program.abilities;
const [mightInstruction] = playTrigger.body;

test("sfd-067-221 Frostcoat Cub: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "You may pay :rb_rune_mind: as an additional cost to play me.\n" +
      "When you play me, if you paid the additional cost, give a unit -2 :rb_might: this turn."
  );
});

test("sfd-067-221 Frostcoat Cub: judgeReason names the cost, receipt and Might gaps", () => {
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  // The debuff must not be approximated with a Buff counter.
  assert.match(program.judgeReason, /702\/703/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-067-221 Frostcoat Cub: the optional additional cost is one Mind Power (CR 356.2.b)", () => {
  // 356.2.b/356.2.b.1: Optional Additional Cost imposed by a Passive Ability of
  // the card being played; the printed symbol :rb_rune_mind: is a named-domain
  // Power cost (135.2.e.4), never a generic Energy charge.
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "frostcoat-cub.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.equal(additionalCost.effect.payments.length, 1);
  const [payment] = additionalCost.effect.payments;
  assert.equal(payment.kind, "power");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.deepEqual(payment.allowedDomains, ["Mind"]);
});

test("sfd-067-221 Frostcoat Cub: the play trigger shape keeps the debuff as a continuous Might modification", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playTrigger.trigger.condition, undefined);

  assert.equal(playTrigger.body.length, 1);
  assert.equal(mightInstruction.id, "frostcoat-cub.give-minus-2-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.linkedTo, undefined);
  // "if you paid the additional cost" (356.4.f.1) has no receipt binding in the
  // frozen IR, so the instruction carries no invented always-true condition.
  assert.equal(mightInstruction.condition, undefined);

  // 355.9.b: "a unit" (no friend/foe qualifier) is a resolution-time choice of
  // one Board unit.
  assert.equal(mightInstruction.targets.length, 1);
  const [target] = mightInstruction.targets;
  assert.equal(target.id, "frostcoat-cub.unit");
  assert.deepEqual(target.filter, { type: "unit", zone: "board" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("sfd-067-221 Frostcoat Cub: the declared shapes name the cost and continuous-Might vocabulary", () => {
  // The program uses the cost-plan (cost.additional) and layers
  // (continuous.might) vocabulary rather than a merged stand-in: the debuff
  // must never be written as an effect.buff counter (702/703).
  assert.deepEqual(additionalCost.effect.kind, "cost.additional");
  assert.deepEqual(playTrigger.body.map((instruction) => instruction.op), ["continuous.might"]);
  assert.equal(playTrigger.body.some((instruction) => instruction.op === "effect.buff"), false);
});

test.todo(
  "sfd-067-221 Frostcoat Cub: charge the optional additional cost (:rb_rune_mind:, 356.2.b) in Finalize " +
    "and gate the -2 Might on the 356.4.f.1 paid receipt (cost.additional wiring + condition.result, RIFT-89)"
);
test.todo(
  "sfd-067-221 Frostcoat Cub: give a unit -2 :rb_might: this turn through a merged continuous.might " +
    "instruction with an end-of-turn duration and layer registration (CR 143.2.a/475-478; RIFT-9/RIFT-91)"
);
test.todo(
  "sfd-067-221 Frostcoat Cub: the card-played trigger enters the chain after the unit is played " +
    "(CR 383.4.a.2/420.4.a) through the CardProgram -> trigger/chain adapter (RIFT-120)"
);
