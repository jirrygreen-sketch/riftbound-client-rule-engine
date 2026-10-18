import assert from "node:assert/strict";
import test from "node:test";
import looseCannon from "../../../card-dsl/dist/cards/ogn/loose-cannon.js";
import {
  EVENT_PATTERN_TYPES,
  TIMING_POINT_ALIASES,
  TIMING_POINTS,
  TRIGGER_ONCE_SCOPES,
  canonicalEventPatternType,
  isEventPattern,
  isTimingPointAlias,
  resolveTimingPointId,
  validateEventPattern,
  validateTriggerSpec
} from "../../dist/events/index.js";
import { ProgramRegistry } from "../../dist/programs/registry.js";
import { triggerRegistrations } from "../../dist/programs/triggers.js";
import { world } from "../../dist/effects/testing/test-kernel.js";
import { fixture, trigger } from "../chain/helpers.mjs";

test("the event vocabulary covers every triggerable producer timing without exposing Contested", () => {
  for (const point of TIMING_POINTS) {
    const result = validateEventPattern({ event: point.id });
    if (point.triggerable === false) {
      assert.equal(result.ok, false, point.id);
      continue;
    }
    assert.equal(result.ok, true, point.id);
    assert.ok(EVENT_PATTERN_TYPES.includes(point.id), point.id);
  }
  assert.equal(validateEventPattern({ event: "contested-applied" }).ok, false);
  assert.equal(validateEventPattern({ event: "contested-removed" }).ok, false);
  assert.equal(validateEventPattern({ event: "future-event" }).ok, false);
});

test("timing aliases resolve to one physical timing identity and equivalent discriminants validate", () => {
  for (const [alias, timingPoint] of Object.entries(TIMING_POINT_ALIASES)) {
    assert.equal(isTimingPointAlias(alias), true, alias);
    assert.equal(resolveTimingPointId(alias), timingPoint, alias);
    assert.equal(canonicalEventPatternType(alias), timingPoint, alias);
    assert.equal(isEventPattern({ event: alias }), true, alias);
    assert.equal(isEventPattern({ event: alias, type: timingPoint }), true, alias);
  }

  const unrelated = validateEventPattern({ event: "scored", type: "card-played" });
  assert.equal(unrelated.ok, false);
  if (!unrelated.ok) assert.ok(unrelated.issues.some(issue => issue.code === "conflicting-event-types"));
});

test("once vocabulary accepts per-batch declarations while rejecting invented lifetimes", () => {
  assert.ok(TRIGGER_ONCE_SCOPES.includes("per-batch"));
  const accepted = validateTriggerSpec({
    at: "card-discarded",
    filter: { event: "card-discarded" },
    once: "per-batch"
  });
  assert.equal(accepted.ok, true);

  const rejected = validateTriggerSpec({
    at: "card-discarded",
    filter: { event: "card-discarded" },
    once: "per-round"
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.issues.some(issue => issue.code === "invalid-once-scope"));
});

test("Loose Cannon raw IR reaches the production trigger assembler at Beginning-start", () => {
  const executable = { ...looseCannon, status: "executable", judgeReason: undefined };
  const registry = new ProgramRegistry([executable]);
  const source = world().player("A").unit("loose-cannon", {
    cardId: executable.canonicalCardId,
    controller: "A",
    owner: "A"
  }).build().getObject("loose-cannon");

  const registrations = triggerRegistrations(registry, source);
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].spec, {
    at: "beginning-start",
    filter: { event: "beginning-start", player: "self" }
  });
});

test("a real card-drawn producer accepts the closed event and malformed trigger ordering rolls back", () => {
  const f = fixture({ choose: request => request.type === "mode" ? "missing-trigger" : undefined });
  trigger(f, "first", { spec: { at: "card-drawn", filter: { event: "card-drawn" } } });
  trigger(f, "second", { spec: { at: "card-drawn", filter: { event: "card-drawn" } } });
  const before = f.kernel.player("A").deckSize;

  assert.throws(() => f.engine.commit({ type: "draw", player: "A", amount: 1 }), /Invalid trigger order/);
  assert.equal(f.kernel.player("A").deckSize, before);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.length, 0);
});

