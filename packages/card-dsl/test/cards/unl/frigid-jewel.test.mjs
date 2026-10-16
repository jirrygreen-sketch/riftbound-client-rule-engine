import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/frigid-jewel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-7f0b19222fb898be4cda4e745fed0f0dccc5d8ef52e41e5d57c48a67ba743618";
const SOURCE_TEXT =
  "When you draw your second card each turn, give a friendly unit +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [mightInstruction] = ability.body;
const targetSpec = mightInstruction.targets[0];

test("unl-074-219 Frigid Jewel: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /drawIndexThisTurn|drawIndex/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-074-219 Frigid Jewel: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes the program by this exact identity.
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-074-219 Frigid Jewel: card-drawn trigger with the second-card clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.1: "when you draw your second card each turn" is a triggered ability keyed to the
  // closed card-drawn timing point (payloadFields includes drawIndexThisTurn).
  assert.equal(ability.trigger.at, "card-drawn");
  assert.deepEqual(ability.trigger.filter, { event: "card-drawn", player: "self" });
  // 383.2.a.1: the Nth-card clause follows the condition and belongs to it, evaluated
  // before the ability is placed on the chain.
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "eq");
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(ability.trigger.condition.left.subject, "cards-drawn-this-turn");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 2 });
  // 383.1.b: an Nth-time trigger fires once per turn even if the condition would match again.
  assert.equal(ability.trigger.once, "per-turn");
  // The printed text has no "you may", so the ability itself is mandatory (383.3.a contrasts).
  assert.equal(ability.optional, false);
});

test("unl-074-219 Frigid Jewel: +2 Might this turn on one chosen friendly unit", () => {
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [
    ["frigid-jewel.grant-might", "continuous.might"]
  ]);
  // "+2 :rb_might: this turn" is a temporary Might modification: it belongs to a layers
  // continuous.might duration, never to the 702/703 Buff counter primitive.
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.condition, undefined);
  // 355.10 / 355.9.a.1: "a friendly unit" is a Board object and the player chooses it, so it
  // is a target (355.7 keeps the non-target pick distinct).
  assert.deepEqual(targetSpec, {
    id: "frigid-jewel.friendly-unit",
    filter: { zone: "board", type: "unit", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(mightInstruction.picks, undefined);
});

test("unl-074-219 Frigid Jewel: the draw side of the trigger executes against the reference kernel", () => {
  // The card-drawn half of the trigger uses the merged effect.draw: deck order and hand
  // growth are real kernel state, so the timing half is executable evidence.
  const kernel = world().deck(["first", "second"]).build();
  const first = runInstruction(draw, { amount: { kind: "constant", value: 1 } }, { world: kernel });
  const second = runInstruction(draw, { amount: { kind: "constant", value: 1 } }, { world: kernel });

  assert.equal(first.result.status, "executed");
  assert.equal(second.result.status, "executed");
  assert.equal(first.linked.drawn, 1);
  assert.equal(second.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 0);
  // Card identity is preserved across the draw (top first, then the next card).
  assert.equal(kernel.getObject("first").zone, "hand");
  assert.equal(kernel.getObject("second").zone, "hand");
});

test.todo(
  "unl-074-219 Frigid Jewel: evaluate \"your second card each turn\" from the card-drawn payload's " +
    "drawIndexThisTurn (CR 383.1.b / 383.2.a.1) — Condition/Expr has no event-payload reader and " +
    "HistoryQuery counts actions rather than ordinals, so the authored count shape cannot be checked yet"
);
test.todo(
  "unl-074-219 Frigid Jewel: apply +2 Might until end of turn through a layers continuous.might effect " +
    "(RIFT-91 card-side entry) — effect.buff is the 702/703 counter and must not stand in for a temporary " +
    "Might modification"
);
test.todo(
  "unl-074-219 Frigid Jewel: register the card-drawn trigger through the card-program -> TriggerRegistration " +
    "bridge (contract 3.5 / RIFT-120 follow-up)"
);
