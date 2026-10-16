import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/field-musicians.js";

const CANONICAL_ID =
  "card.hash-08498917b444057f23afae275c8776d4bff33d47135466ce826cff2b935cea29";
const SOURCE_TEXT = "When you play me, give a unit +3 :rb_might: this turn.";

const [ability] = program.abilities;
const [grantMight] = ability.body;
const targetSpec = grantMight.targets[0];

test("ven-026-166 Field Musicians: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-026-166 Field Musicians: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /315\.4/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("ven-026-166 Field Musicians: one mandatory card-played play effect scoped to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 383.4.a / 383.4.a.1 / 420.4.a: "When you play me".
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
});

test("ven-026-166 Field Musicians: the body is one temporary +3 Might grant on a chosen unit", () => {
  assert.deepEqual(ability.body.map((instruction) => instruction.id), [
    "field-musicians.give-plus-3-might"
  ]);
  // 143.2.a / 475-477: this is an arithmetic-layer Might change, never a Buff
  // counter (effect.buff's own header assigns temporary Might to layers/).
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.target, {
    kind: "constant",
    value: "field-musicians.unit"
  });
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
  // 355.5 / 355.7 / 355.9.a.1: "a unit" is a Choice, so a TargetSpec.
  assert.deepEqual(targetSpec, {
    id: "field-musicians.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
});

test.todo(
  "ven-026-166 Field Musicians: 'give a unit +3 :rb_might: this turn' needs the card-side " +
    "continuous.might primitive with the end-of-turn expiry (CR 143.2.a / 475-477 and the 315.4 cleanup), " +
    "plus the layers registration — RIFT-91 only merged the layer engine"
);

test.todo(
  "ven-026-166 Field Musicians: the card-played subscription and Finalize target locking run " +
    "through the CardProgram -> trigger/chain adapter (RIFT-120 follow-up)"
);
