import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../dist/index.js";
import cruelPatron from "../../dist/cards/ogn/cruel-patron.js";

const constant = value => ({ kind: "constant", value });
const linked = (instructionId = "produce", key = "objects") => ({
  kind: "linked-value",
  instructionId,
  key
});
const pick = overrides => ({ id: "chosen", options: [], ...overrides });
const program = picks => ({
  canonicalCardId: "test.linked-resolve-picks",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "synthetic linked Resolve pick contract",
  abilities: [{
    kind: "play",
    body: [
      { id: "produce", op: "effect.look", args: { objects: constant([]), amount: constant(0) } },
      { id: "choose", op: "effect.draw", args: { amount: constant(0) }, picks }
    ]
  }]
});
const check = picks => validateCardProgram(program(picks));
const rejected = (picks, path, code) => {
  const result = check(picks);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.issues.some(issue => issue.path.endsWith(path) && issue.code === code), JSON.stringify(result));
};

test("explicit linked Resolve picks accept proven filter, bounds, and selection combinations", () => {
  for (const shape of [
    pick({ ordered: true, linked: linked(), filter: { type: "unit" }, min: 1, max: 1, selection: "one" }),
    pick({ ordered: true, linked: linked(), filter: { type: "unit" }, min: 0, max: 2, selection: "up-to" }),
    pick({ ordered: true, linked: linked(), min: 0, max: 3, selection: "any" }),
    pick({ ordered: true, linked: linked(), selection: "all" }),
    pick({ ordered: true, linked: { kind: "linked", instructionId: "produce", key: "objects" }, max: null, selection: "up-to" })
  ]) {
    const result = check([shape]);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

test("the original sole linked-value option remains valid without an explicit source", () => {
  const result = check([pick({ options: [linked()], filter: { type: "unit" }, min: 1, max: 1, selection: "one" })]);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("linked options reject static mixtures and combinations with another source", () => {
  rejected([pick({ options: [linked(), "static"] })], ".picks[0].options", "ambiguous-linked-pick-source");
  rejected([pick({ options: [linked(), linked()] })], ".picks[0].options", "ambiguous-linked-pick-source");
  rejected([pick({ options: [linked()], zoneSlice: { zone: "deck", from: "top" } })], ".picks[0].options", "ambiguous-linked-pick-source");
  rejected([pick({ options: [linked()], linked: linked() })], ".picks[0].options", "ambiguous-linked-pick-source");
  rejected([pick({ options: [linked()], exclude: linked("used") })], ".picks[0].options", "ambiguous-linked-pick-source");
});

test("linked sources remain singular and cannot mix another source or linked option", () => {
  rejected([pick({ ordered: true, linked: linked(), zoneSlice: { zone: "deck", from: "top" } })], ".picks[0]", "ambiguous-pick-source");
  rejected([pick({ ordered: true, linked: linked(), options: [linked()] })], ".picks[0]", "invalid-ordered-pick-source");
  rejected([pick({ ordered: true, linked: linked(), options: ["static"] })], ".picks[0]", "invalid-ordered-pick-source");
});

test("linked Resolve bounds and selection stay in the runtime-supported vocabulary", () => {
  rejected([pick({ ordered: true, linked: linked(), min: 2, max: 1 })], ".picks[0]", "invalid-selection-bounds");
  rejected([pick({ ordered: true, linked: linked(), selection: "some" })], ".picks[0].selection", "invalid-selection");
  rejected([pick({ ordered: true, linked: linked(), min: -1 })], ".picks[0].min", "invalid-number");
});

test("linked instruction/key identity is required and its scope remains preceding", () => {
  rejected([pick({ ordered: true, linked: { kind: "linked-value", key: "objects" } })], ".picks[0].linked.instructionId", "invalid-string");
  rejected([pick({ ordered: true, linked: { kind: "linked-value", instructionId: "produce" } })], ".picks[0].linked", "invalid-pick-link");
  rejected([pick({ ordered: true, linked: linked("later") })], ".picks[0].linked.instructionId", "linked-instruction-not-prior");
  rejected([pick({ ordered: true, linked: linked("produce", "   ") })], ".picks[0].linked.key", "invalid-linked-source-key");
});

test("zoneSlice remains Finalize-bound and cannot borrow linked Resolve restrictions", () => {
  const slice = { zone: "deck", from: "top", count: constant(3) };
  for (const [shape, code] of [
    [pick({ ordered: true, zoneSlice: slice, selection: "up-to" }), "invalid-ordered-pick-source"],
    [pick({ ordered: true, zoneSlice: slice, filter: { type: "unit" }, selection: "all" }), "invalid-ordered-pick-source"],
    [pick({ ordered: true, zoneSlice: slice, min: 1, selection: "all" }), "invalid-ordered-pick-source"],
    [pick({ ordered: true, zoneSlice: slice, max: 2, selection: "all" }), "invalid-ordered-pick-source"]
  ]) rejected([shape], ".picks[0]", code);

  assert.equal(check([pick({ options: [], ordered: true, selection: "all", zoneSlice: slice })]).ok, true);
});

test("unknown fields and runtime ObjectRefs remain rejected", () => {
  rejected([pick({ ordered: true, linked: linked(), source: "global" })], ".picks[0].source", "unknown-field");
  rejected([pick({ ordered: true, linked: { ...linked(), id: "runtime", zoneEntryId: 1 } })], ".picks[0].linked", "invalid-object-selector");
  rejected([pick({ ordered: true, linked: linked(), options: [{ id: "runtime", zoneEntryId: 1 }] })], ".picks[0].options[0]", "invalid-object-selector");
});

test("legacy cost-payment choices retain descriptive filter fields without widening instruction picks", () => {
  const costProgram = choice => ({
    canonicalCardId: "test.cost-choice",
    rulesetVersion: "core-1.5",
    status: "judge-required",
    judgeReason: "synthetic cost-choice compatibility",
    sourceText: "synthetic",
    abilities: [{
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust", choice }]
      },
      body: []
    }]
  });
  const legacyChoice = {
    id: "friendly-unit",
    options: ["friendly-unit-on-board"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "board",
    type: "unit",
    controller: "controller",
    mighty: true
  };
  assert.equal(validateCardProgram(costProgram(legacyChoice)).ok, true);

  const instruction = program([{ ...pick({ options: ["friendly-unit-on-board"] }), zone: "board", type: "unit" }]);
  const widened = validateCardProgram(instruction);
  assert.equal(widened.ok, false);
  assert.ok(widened.issues.some(issue => issue.code === "unknown-field" && issue.path.endsWith(".picks[0].zone")));
  assert.ok(widened.issues.some(issue => issue.code === "unknown-field" && issue.path.endsWith(".picks[0].type")));
});

test("legacy chooser metadata remains accepted but linked Resolve sources reject descriptive extensions", () => {
  const legacy = program([{ ...pick({ options: ["dynamic:units"] }), chooser: "call-to-battle.chosen-opponent" }]);
  assert.equal(validateCardProgram(legacy).ok, true);

  const linkedWithExtension = program([pick({ ordered: true, linked: linked(), mighty: true })]);
  const result = validateCardProgram(linkedWithExtension);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === "invalid-linked-pick-extension" && issue.path.endsWith(".picks[0].mighty")));
});

test("the unmodified Cruel Patron IR retains its legacy cost-choice semantics", () => {
  const result = validateCardProgram(cruelPatron);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.value.abilities[0].cost.payments[0].choice, {
    id: "friendly-unit",
    options: ["friendly-unit-on-board"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "board",
    type: "unit",
    controller: "controller"
  });
});
