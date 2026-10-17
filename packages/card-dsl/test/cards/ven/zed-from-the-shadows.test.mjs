import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/zed-from-the-shadows.js";

const CANONICAL_ID =
  "card.hash-d7b6ea328eac7b13a0a652c5d95b38895d7026cbb51f23007ecdce1f9a3d951c";
const SOURCE_TEXT =
  "You may discard 1 as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, play a 0 :rb_might: Shadow Clone unit token. " +
  "(It has \"When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn.\")";

const [additionalCost, playEffect] = program.abilities;
const [playToken] = playEffect.body;

test("ven-023-166 Zed, From the Shadows: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-023-166 Zed: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|90|91|120|257)/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /187\.11/);
});

test("ven-023-166 Zed: the optional additional cost discards 1 as a non-target choice", () => {
  // 356.2.b / 356.2.b.1: an Optional Additional Cost declared by the played
  // card's own passive ability, charged in cost step 2 (356.2.a).
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "zed.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments.map((payment) => payment.kind), ["discard"]);
  const [payment] = additionalCost.effect.payments;
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  // 355.10.c / 423.1.a: a card discarded as part of a cost is not a target, so
  // the component carries a non-target pick rather than a TargetSpec.
  assert.equal(payment.choice.id, "zed.discarded-card");
  assert.deepEqual(payment.choice.filter, {
    type: "card",
    zone: "hand",
    owner: "controller"
  });
  assert.equal(payment.choice.selection, "one");
});

test("ven-023-166 Zed: the play effect is gated on the paid-cost receipt", () => {
  assert.equal(playEffect.kind, "triggered");
  assert.equal(playEffect.optional, false);
  assert.equal(playEffect.trigger.at, "card-played");
  assert.deepEqual(playEffect.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // 356.4.f.1: "if you paid the additional cost" is the decision-to-pay receipt;
  // the frozen IR has no cost-result binding, so this stays a descriptive
  // condition instead of an invented always-true gate.
  assert.deepEqual(playEffect.trigger.condition, {
    kind: "expression",
    value: { kind: "constant", value: "paid-additional-cost" }
  });
});

test("ven-023-166 Zed: the body plays the Shadow Clone token with no invented location", () => {
  assert.deepEqual(playEffect.body.map((instruction) => instruction.id), ["zed.play-shadow-clone"]);
  assert.equal(playToken.op, "effect.token");
  // 187.11: the printed 0-Might Shadow Clone token (with its own attack ability)
  // is not in effect.token's frozen definition table.
  assert.deepEqual(playToken.args.token, { kind: "constant", value: "shadow-clone" });
  assert.deepEqual(playToken.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a / 350.2 / 354: a played token is created on the Chain first.
  assert.deepEqual(playToken.args.mode, { kind: "constant", value: "play" });
  // 355.2/355.2.a: the legal destinations are a Finalize choice; the card data
  // never pins a location (no `location`, `target`, `pick` or `locations` arg).
  assert.equal(playToken.args.location, undefined);
  assert.equal(playToken.args.locations, undefined);
  assert.equal(playToken.args.target, undefined);
  assert.equal(playToken.args.pick, undefined);
  assert.equal(playToken.linkedTo, undefined);
  assert.equal(playToken.targets, undefined);
});

test("ven-023-166 Zed: the token identity is the printed Shadow Clone, never a substituted token", () => {
  // CR 187.11 names this exact token; the card does not swap in a different
  // definition so that the body would run.
  assert.equal(playToken.args.token.value, "shadow-clone");
  assert.notEqual(playToken.args.token.value, "recruit");
  assert.notEqual(playToken.args.token.value, "reflection");
});

test.todo(
  "ven-023-166 Zed: the optional additional discard cost needs CardProgram → CostPlan wiring and a " +
    "paid-cost receipt readable by the Play Effect (356.2/356.2.a/356.4.f.1, RIFT-261)"
);

test.todo(
  "ven-023-166 Zed: the 0 :rb_might: Shadow Clone token with its own attack ability (CR 187.11) is " +
    "absent from effect.token's frozen definition table (blocked there by design); playing it also " +
    "needs the Finalize location choice for a played token (355.2/355.2.a, 440.2.b.1), whose legal " +
    "destination set is the position-selection gap tracked by RIFT-357"
);
