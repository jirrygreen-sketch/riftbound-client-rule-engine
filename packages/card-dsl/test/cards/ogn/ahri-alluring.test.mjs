import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/ahri-alluring.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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

test.todo(
  "ogn-066-298 Ahri, Alluring: the hold trigger cannot fire: merged scoring " +
    "(scoring/scoring.ts scoreDuelBattlefield) returns a scoring outcome and emits no pipeline " +
    "timing, and the duel turn executor only uses 'hold' as its own internal step name " +
    "(P0 contract 7.2 batch 5 / scoring workstream)"
);

test.todo(
  "ogn-066-298 Ahri, Alluring: effect.score has no merged instruction file, so 'you score 1 " +
    "point' has no registered opcode; the survey (ability-templates.md, 22 identities) maps it " +
    "to effect.score and the program keeps that shape without approximating points through " +
    "another action"
);

test.todo(
  "ogn-066-298 Ahri, Alluring: point accounting and the Final Point window (470.1/470.2, " +
    "473.1.b) belong to the engine; once effect.score lands, the golden test must assert the " +
    "controller's points and the points-gained event"
);
