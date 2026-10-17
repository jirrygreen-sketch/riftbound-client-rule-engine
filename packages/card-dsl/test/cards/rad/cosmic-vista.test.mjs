import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/cosmic-vista.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

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

test("cosmic-vista: judgeReason names the symbolic-owner and here-anchor gaps", () => {
  assert.match(program.judgeReason, /owner/);
  assert.match(program.judgeReason, /self/);
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

test("cosmic-vista: the declared here anchor is still rejected by both validation and translation", () => {
  // 383.4.d.1 / 471.2: the Hold Effect is scoped to this Battlefield. The
  // merged EventPattern vocabulary has no source-battlefield anchor, so both
  // the closed validator and the card-program translator refuse the key
  // instead of subscribing the ability to every hold.
  assert.throws(() => assertTriggerSpec(trigger.trigger), /here/);
  assert.throws(
    () => translateTriggerFilter(trigger.trigger.filter, "cosmic-vista", "hold"),
    /Unsupported filter field here/
  );
});

test("cosmic-vista: without the here anchor the hold trigger would translate, so `here` is the real gap", () => {
  // CR 383.4.d: the timing point and event name are merged. Only the
  // battlefield anchor is missing — removing it yields a valid registration,
  // which the program must not silently do (that would widen the trigger).
  const translated = translateTriggerFilter(
    { event: "held", player: "self" },
    "cosmic-vista",
    "hold"
  );
  assert.deepEqual(translated, { event: "held", player: "self" });
  assertTriggerSpec({ at: "hold", filter: translated });
});

test("cosmic-vista: a non-empty Rune Deck prevents the conditional hold trigger (383.2.a.1)", {
  todo: 'Trigger-condition fallback does not normalize owner: "self" in host.context.query; the count is incorrectly zero (events/pipeline.ts, 383.2.a.1)'
}, () => {
  // 383.2.a.1: the empty-Rune-Deck clause is a TriggerSpec.condition. Since
  // RIFT-359 the pipeline calls host.testTrigger when supplied and otherwise
  // falls back to evaluateTriggerCondition through host.context. On that
  // fallback the production host's query compares owner: "self" literally
  // against player ids (apps/game-server engine-runtime/host.ts does not
  // normalize symbolic owner/controller selectors; only chain/engine.ts does,
  // and it does not feed trigger-condition evaluation), so "your Rune Deck"
  // counts 0 even while a rune sits in A's Rune Deck. Preserve the correct
  // no-trigger expectation as a runnable TODO until that engine gap is fixed.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("battlefield", { types: ["battlefield"] })
    .rune(["rune-in-deck"], { owner: "A" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint }),
    choose: (request) => { throw new Error(`Unexpected choice: ${request.id}`); }
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const fired = [];
  pipeline.onTrigger = (snapshot) => fired.push(snapshot.registration.id);
  pipeline.registerTrigger({
    id: "cosmic-vista",
    source: kernel.getObject("battlefield"),
    controller: "A",
    spec: {
      at: "hold",
      filter: { event: "held", player: "self" },
      condition: trigger.trigger.condition
    },
    body: trigger.body
  });
  assert.equal(kernel.player("A").runeDeckSize, 1);
  // A rune is in A's Rune Deck, so 383.2.a.1 forbids the trigger.
  pipeline.emit({ timingPoint: "hold", player: "A" });
  assert.deepEqual(fired, []);
});
