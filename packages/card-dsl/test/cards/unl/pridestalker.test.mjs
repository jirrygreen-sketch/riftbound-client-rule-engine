import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/pridestalker.js";

const CANONICAL_ID =
  "card.hash-0498072c7fa1411e598b868d1675b34cf40890cde5ab313bf5598e1fcf1f08eb";
const SOURCE_TEXT = "When you play a unit, give a unit +1 :rb_might: this turn.";

const [ability] = program.abilities;
const [grantMight] = ability.body;
const targetSpec = grantMight.targets[0];

test("unl-183-219 Pridestalker: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-183-219 Pridestalker: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /702/);
});

test("unl-183-219 Pridestalker: mandatory card-played trigger on a friendly unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a.4: an ability that triggers when another object is played is not a
  // Play Effect, so the timing point is the card-played event with a unit
  // object filter controlled by the ability's controller.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "unit", controller: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // No printed "may": the trigger is mandatory (383.3.a).
  assert.equal(ability.optional, false);
});

test("unl-183-219 Pridestalker: 'give a unit +1 Might this turn' is one chosen target plus a duration-bounded modifier", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grantMight.id, "pridestalker.grant-might");
  // The merged engine has no might-modification primitive; the op records the
  // intended continuous.might layer effect (see judgeReason) and must not be
  // approximated with effect.buff (702 Buff counters are a different thing).
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // 355.9 / 355.10: "a unit" is a single chosen target, not a pick.
  assert.deepEqual(targetSpec, {
    id: "pridestalker.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
});

test.todo(
  "unl-183-219 Pridestalker: apply +1 Might in the arithmetic layer with an end-of-turn duration and cleanup expiry " +
    "(CR 315.4; no continuous.might / effect.might-modify instruction file is merged — RIFT-91)"
);
test.todo(
  "unl-183-219 Pridestalker: register the card-played trigger for the played unit and lock the chosen target at Finalize (RIFT-87/90)"
);
