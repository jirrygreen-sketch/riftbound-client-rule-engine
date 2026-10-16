import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/fretful-feline.js";

const CANONICAL_ID =
  "card.hash-864252b4f9e2a925ac4decd2d9c2a4df3025182c727f74f452c8d8f70143d8c9";
const SOURCE_TEXT = "When I become ready, give me +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [mightInstruction] = ability.body;

test("ven-071-166 Fretful Feline: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-071-166 Fretful Feline: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /object-readied/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("ven-071-166 Fretful Feline: 'When I become ready' subscribes object-readied on self (416.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-readied");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-readied",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("ven-071-166 Fretful Feline: the body is the temporally-bounded Might modification shape", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(mightInstruction.id, "fretful-feline.plus-2-might-this-turn");
  // 143.2.a 的算术层修正；effect.buff 不是临时 Might（702 的计数器语义不同）。
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // “me” 指能力宿主（053.1），用契约 3.6 的符号选择器，不写运行时 ObjectRef。
  assert.deepEqual(mightInstruction.args.object, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(mightInstruction.targets, undefined);
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.op === "effect.buff", false);
});

test.todo(
  "ven-071-166 Fretful Feline: 'give me +2 :rb_might: this turn' (143.2.a) needs a continuous.might instruction " +
    "primitive with an end-of-turn duration registered through ctx.addContinuous — effects/instructions has no such " +
    "op (RIFT-91 delivered the layers engine only)"
);
test.todo(
  "ven-071-166 Fretful Feline: the object-readied subscription (416.1/416.1.c/416.2) needs the CardProgram → " +
    "TriggerRegistration adapter before the trigger can enter the chain (RIFT-120)"
);
