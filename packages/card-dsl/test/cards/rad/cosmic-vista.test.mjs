import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/cosmic-vista.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-6096f8a7ac4a9de3a47f4b906c5922677655ef6d2b97f64352b7057c63cafa87";
const [trigger] = program.abilities;

test("cosmic-vista: passes validateCardProgram and carries the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you hold here, if your Rune Deck is empty, you score 1 point."
  );
});

test("cosmic-vista: judgeReason names the trigger-condition adapter and the missing here anchor", () => {
  assert.match(program.judgeReason, /testTrigger/);
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /here/);
});

test("cosmic-vista: hold trigger with the empty-Rune-Deck condition on the TriggerSpec", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "hold");
  assert.equal(trigger.trigger.filter.event, "held");
  assert.equal(trigger.trigger.filter.here, true);
  // "you hold" — the merged PlayerSelector spelling for the ability
  // controller is "self".
  assert.equal(trigger.trigger.filter.player, "self");
  assert.equal(trigger.optional, false);

  // 383.2.a.1: "if your Rune Deck is empty" immediately follows the condition,
  // so it belongs to the Trigger Condition, not to the effect.
  const condition = trigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.equal(condition.right.value, 0);
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left.filter, { owner: "self", zone: "rune-deck" });
});

test("cosmic-vista: body is a single unlinked Score 1 point", () => {
  assert.equal(trigger.body.length, 1);
  const [instruction] = trigger.body;
  assert.equal(instruction.id, "cosmic-vista.score-1");
  assert.equal(instruction.op, "effect.score");
  assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.targets, undefined);
});

test("cosmic-vista: the Score 1 point body gains a point for the ability controller", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(trigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [["cosmic-vista.score-1", "executed"]]
  );
  assert.deepEqual(outcome.events.map((event) => event.action), ["score"]);
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(outcome.linkedValues["cosmic-vista.score-1.scored"], [
    { player: "A", amount: 1 }
  ]);
});

test("cosmic-vista: scoring is not a Battlefield Score and stays separate from hold", () => {
  // 470.1 / 470.2: Gaining a Point is a distinct process from Scoring a
  // Battlefield. The instruction must not carry a battlefield or control side
  // effect; only the point total changes.
  const kernel = world().player("A", { score: 2 }).build();
  const before = kernel.objectsInZone("A", "board");
  const outcome = resolveChainBody(trigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").score, 3);
  assert.deepEqual(kernel.objectsInZone("A", "board"), before);
});

test.todo(
  "cosmic-vista: end-to-end hold + empty Rune Deck + opponent non-empty Rune Deck resolves exactly one point"
);

test("cosmic-vista: hold and score are closed, registered timing points the rules module emits", () => {
  // 315.2.b.2 / 471.2 / 473.2.b: the Beginning Phase's scoring step is the hold
  // timing point. turn/flow.ts's scheduleScore publishes a structural Score
  // wave (hold / score / points-gained) carrying details.battlefieldId, so the
  // subscription point exists; the merged pipeline consumes it like any other.
  assert.equal(isTimingPointId("hold"), true);
  assert.equal(isTimingPointId("score"), true);
  assert.equal(isTimingPointId("points-gained"), true);
});

test.todo(
  "cosmic-vista: the hold trigger needs the production host.testTrigger adapter for its Rune Deck condition " +
    "(pipeline.ts throws \"Trigger condition adapter required\" when the adapter is absent)"
);

test.todo(
  "cosmic-vista: the EventPattern vocabulary must accept the source-battlefield here anchor before the trigger " +
    "can be bound to the emitted hold event's battlefieldId"
);
