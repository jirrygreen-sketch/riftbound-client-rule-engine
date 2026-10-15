import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTriggerSpec,
  isEventPattern,
  isObjectFilter,
  isTriggerSpec,
  validateTriggerSpec
} from "../../dist/events/index.js";

test("validates object and event filters", () => {
  assert.equal(isObjectFilter({ type: "unit", controller: "opponent", zone: "battlefield" }), true);
  assert.equal(isEventPattern({ event: "card-played", object: { type: "spell" } }), true);
  assert.equal(isEventPattern({ type: "combat-damage-after", amount: { operator: "gte", value: 1 } }), true);
  assert.equal(isObjectFilter({ type: "not-a-real-object" }), false);
});

test("validates a timing trigger with condition and once scope", () => {
  const trigger = {
    at: "object-killed",
    filter: {
      event: "zone-entered",
      object: { type: "unit", controller: "self" },
      toZone: "trash"
    },
    condition: { kind: "all", conditions: [{ kind: "has-characteristic" }] },
    once: "per-combat"
  };
  assert.equal(isTriggerSpec(trigger), true);
  assert.doesNotThrow(() => assertTriggerSpec(trigger));
  assert.deepEqual(validateTriggerSpec(trigger), { ok: true, value: trigger, issues: [] });
});

test("rejects unknown timing points, missing filters and invalid scopes", () => {
  const result = validateTriggerSpec({ at: "future-point", once: "per-round" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some(issue => issue.code === "invalid-timing-point"));
  assert.ok(result.issues.some(issue => issue.code === "missing-field"));
  assert.ok(result.issues.some(issue => issue.code === "invalid-once-scope"));
});

test("rejects conflicting event discriminants and cyclic conditions", () => {
  const conflicting = validateTriggerSpec({
    at: "score",
    filter: { event: "scored", type: "card-played" }
  });
  assert.equal(conflicting.ok, false);
  if (!conflicting.ok) assert.ok(conflicting.issues.some(issue => issue.code === "conflicting-event-types"));

  const condition = { kind: "not" };
  condition.condition = condition;
  const cyclic = validateTriggerSpec({ at: "score", filter: {}, condition });
  assert.equal(cyclic.ok, false);
  if (!cyclic.ok) assert.ok(cyclic.issues.some(issue => issue.code === "cyclic-condition"));
});
