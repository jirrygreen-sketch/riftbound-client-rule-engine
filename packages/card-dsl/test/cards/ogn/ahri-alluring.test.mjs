import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/ahri-alluring.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-4f9cef9a5292a16fac59206baa263b0654606faa95119ee4a76583f82b2a4dac";
const SOURCE_TEXT = "When I hold, you score 1 point.";

const triggered = program.abilities[0];
const scoreInstruction = triggered.body[0];

test("ogn-066-298 Ahri, Alluring: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-066-298 Ahri, Alluring: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /effect\.score/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-066-298 Ahri, Alluring: hold trigger filtered to this unit", () => {
  // 383.4.d/383.4.d.1: "When I hold …" is a Hold Effect; 383.4.d.2.a requires
  // the unit to be present at the Battlefield during the Hold.
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "hold");
  assert.deepEqual(triggered.trigger.filter, {
    event: "hold",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.trigger.condition, undefined);
});

test("ogn-066-298 Ahri, Alluring: 'you score 1 point' is one amount-1 instruction", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(scoreInstruction.id, "ahri-alluring.score-1");
  assert.equal(scoreInstruction.op, "effect.score");
  assert.deepEqual(scoreInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(scoreInstruction.targets, undefined);
  assert.equal(scoreInstruction.picks, undefined);
  assert.equal(scoreInstruction.linkedTo, undefined);
  assert.equal(scoreInstruction.condition, undefined);
});

test("ogn-066-298 Ahri, Alluring golden: the score instruction awards the ability controller 1 point (RIFT-115)", () => {
  const kernel = world().player("A").player("B").build();
  const outcome = runAbilityBody(triggered.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["ahri-alluring.score-1", "executed"]]
  );
  // 194.1.c / 470.1-3：受让者缺省为能力控制者，只有该玩家获得 1 点。
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(outcome.results[0].result.linkedValues.scored, [{ player: "A", amount: 1 }]);
  assert.deepEqual(outcome.events.map(event => event.action), ["score"]);
});

test("ogn-066-298 Ahri, Alluring golden: a zero-point award links an empty list without scoring", () => {
  const kernel = world().player("A").player("B").build();
  const outcome = runAbilityBody(
    [{ id: "zero", op: "effect.score", args: { amount: { kind: "constant", value: 0 } } }],
    kernel
  );
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").score, 0);
  assert.deepEqual(outcome.results[0].result.linkedValues.scored, []);
});

test.todo(
  "ogn-066-298 Ahri, Alluring: the hold trigger still cannot register: the card's nested " +
    "{ event, filter } spelling is rejected by events/trigger-spec.ts (engine spellings are " +
    "held/self) and no merged consumer binds a CardProgram's triggered ability into a " +
    "TriggerRegistration (RIFT-257)."
);
