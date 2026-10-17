import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCondition } from "../../../dist/effects/interpreter/condition.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { world } from "../../../dist/effects/testing/index.js";
import { registry, constant, gain } from "./helpers.mjs";

const source = {
  ref: { id: "host", zoneEntryId: 1 },
  cardId: "card:host",
  name: "Host",
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "bf-1" },
  combatRole: null,
  might: 2,
  energy: 1,
  power: ["Fury"],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
};

const event = (fromZone = "hand", printedPower = 2) => ({
  timingPoint: "card-played",
  fromZone,
  object: { ...source, ref: { id: "played", zoneEntryId: 3 }, zone: "chain", printedPower }
});

const paid = { selectedAdditional: [{ id: "boost", kind: "additional" }], declinedAdditional: [] };
const declined = { selectedAdditional: [], declinedAdditional: ["boost"] };
const all = (...conditions) => ({ kind: "all", conditions });
const printedPowerAtLeast = value => ({
  kind: "event-printed",
  object: "object",
  characteristic: "power",
  operator: "gte",
  right: { kind: "constant", value }
});

function contextFor(worldInstance, payload, cost) {
  return {
    context: worldInstance,
    event: payload,
    cost,
    linked: key => worldInstance.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  };
}

test("play-origin predicates use the event's from-zone fact", () => {
  const kernel = world().unit("host", source).build().clone({ sourceSnapshot: source });
  const environment = contextFor(kernel, event("hand", 2), paid);
  assert.equal(evaluateCondition({ kind: "played-from-hand", object: "object" }, environment), true);
  assert.equal(evaluateCondition({ kind: "played-from-zone", object: "object", zone: "trash" }, environment), false);
  assert.equal(evaluateCondition({ kind: "played-from-zone", object: "object", zone: "hand" }, environment), true);
  assert.equal(evaluateCondition({ kind: "playedFromHand", object: "object" }, environment), true);

  const roleSpecific = {
    ...event("hand", 2),
    source: { ...source, ref: { id: "source", zoneEntryId: 4 }, zone: "trash", fromZone: "trash" }
  };
  const roleEnvironment = contextFor(kernel, roleSpecific, paid);
  assert.equal(evaluateCondition({ kind: "played-from-hand", object: "source" }, roleEnvironment), false);
  assert.equal(evaluateCondition({ kind: "played-from-zone", object: "source", zone: "trash" }, roleEnvironment), true);
});

test("printed event-object predicates compare copied/printed Power without reading current Power", () => {
  const kernel = world().unit("host", source).build().clone({ sourceSnapshot: source });
  const environment = contextFor(kernel, event("hand", 2), paid);
  assert.equal(evaluateCondition(printedPowerAtLeast(2), environment), true);
  assert.equal(evaluateCondition(printedPowerAtLeast(3), environment), false);

  const nullPrinted = contextFor(kernel, event("hand", null), paid);
  assert.throws(() => evaluateCondition(printedPowerAtLeast(0), nullPrinted), /Printed characteristic/);

  const missingPayload = event("hand", 2);
  const { printedPower: _printedPower, ...objectWithoutPrinted } = missingPayload.object;
  const missingPrinted = contextFor(kernel, { ...missingPayload, object: objectWithoutPrinted }, paid);
  assert.throws(() => evaluateCondition(printedPowerAtLeast(0), missingPrinted), /printed .* characteristic/i);
});

test("result predicates use the optional-cost decision, even when its payment was reduced", () => {
  const kernel = world().unit("host", source).build().clone({ sourceSnapshot: source });
  assert.equal(evaluateCondition({ kind: "result", result: "additional-cost-paid", id: "boost" }, contextFor(kernel, event(), paid)), true);
  assert.equal(evaluateCondition({ kind: "result", result: "additional-cost-paid", id: "boost" }, contextFor(kernel, event(), declined)), false);
  assert.equal(evaluateCondition({ kind: "result", result: "additional-cost-paid" }, contextFor(kernel, event(), paid)), true);

  const mandatory = {
    plan: {
      components: [{ id: "tax", stage: "mandatory-additional" }],
      selectedAdditional: [],
      declinedAdditional: []
    },
    receipt: { paid: true, additional: [] }
  };
  assert.equal(evaluateCondition({ kind: "result", result: "cost.additional", id: "tax" }, contextFor(kernel, event(), mandatory)), true);
  assert.equal(evaluateCondition({ kind: "result", result: "cost.additional" }, contextFor(kernel, event(), mandatory)), true);
  assert.equal(evaluateCondition({ kind: "result", result: "cost.additional" }, contextFor(kernel, event(), { paid: true, additional: [] })), false);
});

test("a trigger-style conjunction gates an instruction on origin, printed cost, and payment result", () => {
  const condition = all(
    { kind: "played-from-hand", object: "object" },
    printedPowerAtLeast(2),
    { kind: "result", result: "additional-cost-paid", id: "boost" }
  );
  const kernel = world().unit("host", source).build().clone({ sourceSnapshot: source });
  const outcome = runAbilityBody(
    [gain("branch", 1, { condition })],
    kernel,
    registry,
    { event: event("hand", 2), cost: paid }
  );
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").energy, 1);

  const blocked = runAbilityBody(
    [gain("branch", 1, { condition })],
    kernel,
    registry,
    { event: event("trash", 2), cost: paid }
  );
  assert.equal(blocked.status, "partial");
  assert.equal(blocked.results[0].result.status, "negated");
  assert.equal(kernel.player("A").energy, 1);
});
