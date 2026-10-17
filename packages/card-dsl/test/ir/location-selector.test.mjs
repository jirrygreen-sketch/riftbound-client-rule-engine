import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../dist/index.js";

const constant = value => ({ kind: "constant", value });
const program = body => ({
  canonicalCardId: "test.location-selector",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Choose a battlefield.",
  abilities: [{ kind: "play", body }]
});

test("EffectIR accepts location target declarations and relative LocationRef expressions", () => {
  const result = validateCardProgram(program([{
    id: "move",
    op: "effect.move",
    locations: [{ id: "destination", type: "battlefield", open: true, min: 1, max: 1, selection: "one" }],
    targets: [{ id: "unit", filter: { type: "unit" }, location: { type: "battlefield" }, min: 1, max: 1 }],
    args: {
      objects: constant({ target: "unit" }),
      to: { kind: "location", value: { kind: "target-location", target: "destination" } }
    }
  }]));
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("EffectIR accepts controller-relative base location filters", () => {
  const result = validateCardProgram(program([{
    id: "read",
    op: "condition.value",
    targets: [{ id: "unit", filter: { type: "unit" }, location: { type: "base", player: "controller" }, min: 1, max: 1 }],
    args: { value: constant(1) }
  }]));
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("EffectIR rejects malformed relative location selectors", () => {
  const result = validateCardProgram(program([{
    id: "bad",
    op: "effect.move",
    args: { to: { kind: "location", value: { kind: "target-location", target: "missing" } } }
  }]));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === "unresolved-target"), JSON.stringify(result));
});
