import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/prize-of-progress.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/index.js";

const CARD_ID = "card.hash-2affca3f8f8306aa0687163e5113f3532b04acb9960f806d7a7eba3bf504104a";

const [ability] = program.abilities;
const [mightInstruction] = ability.body;

test("sfd-075-221 Prize of Progress: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you use an activated ability of a gear, give me +1 :rb_might: this turn."
  );
});

test("sfd-075-221 Prize of Progress: judgeReason names the missing emitter and Might primitive", () => {
  assert.match(program.judgeReason, /ability-activated/);
  assert.match(program.judgeReason, /400\/402\/405/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-075-221 Prize of Progress: the trigger subscribes to ability-activated for gear sources", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 400/402/405-407: using an activated ability runs the same steps as playing
  // a card; the availability of the timing point is what a score trigger needs.
  assert.equal(ability.trigger.at, "ability-activated");
  assert.deepEqual(ability.trigger.filter, {
    event: "ability-activated",
    // "you use": the activating player is the ability's controller (190.6.d).
    player: "self",
    // "of a gear": the used ability's source object is the event's sourceId.
    source: { type: "gear" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("sfd-075-221 Prize of Progress: the subscription target is a declared timing point", () => {
  // 400/402/405-407: "use an activated ability" is a named rules moment, so the
  // trigger must subscribe to the closed timing-point enum rather than to a
  // card-invented event name. getTimingPoint throws for unknown ids.
  assert.equal(getTimingPoint("ability-activated").id, "ability-activated");
  assert.equal(ability.trigger.at, "ability-activated");
});

test("sfd-075-221 Prize of Progress: the body declares a one-turn self Might modification", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(mightInstruction.id, "prize-of-progress.give-plus-1-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // "me" is the ability host: the symbolic selector "self", never a runtime
  // ObjectRef and never a Buff counter (702/703).
  assert.deepEqual(mightInstruction.args.object, { kind: "constant", value: "self" });
  assert.equal(mightInstruction.targets, undefined);
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.linkedTo, undefined);
});

test.todo(
  "sfd-075-221 Prize of Progress: subscribe at the ability-activated timing point and emit it when an " +
    "activated ability of a gear finishes its legal play process (CR 400/402/405-407; timing-points.ts " +
    "declares the payload but no merged code emits it — RIFT-120)"
);
test.todo(
  "sfd-075-221 Prize of Progress: register 'give me +1 Might this turn' as an arithmetic-layer continuous " +
    "effect through ResolveContext.addContinuous with an end-of-turn duration (CR 143.2.a/475-478; no merged " +
    "instruction exists — RIFT-9/RIFT-91; never a Buff counter)"
);
