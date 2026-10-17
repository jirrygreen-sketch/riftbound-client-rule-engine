import assert from "node:assert/strict";
import test from "node:test";
import { queryLocationCandidates, resolveLocationSelector } from "../../../dist/target/location/index.js";
import { chooseLocations } from "../../../dist/effects/interpreter/locations.js";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { world } from "../../../dist/effects/testing/index.js";
import { resolveChainBody } from "../../../dist/chain/interpreter-adapter.js";

const base = player => ({ type: "base", player });
const field = id => ({ type: "battlefield", id });

test("target.location selects a battlefield and filters occupied/control state", () => {
  const kernel = world().unit("a", { owner: "A", controller: "A", location: field("alpha") }).build();
  const locations = [
    { ref: field("alpha"), controller: "A", occupied: true },
    { ref: field("beta"), controller: null, occupied: false },
    { ref: base("A"), controller: "A", occupied: false }
  ];
  assert.deepEqual(queryLocationCandidates(kernel, { id: "open", type: "battlefield", open: true }, { locations, players: ["A", "B"] }), [field("beta")]);
  assert.deepEqual(queryLocationCandidates(kernel, { id: "mine", type: "base", player: "controller" }, { locations, players: ["A", "B"] }), [base("A")]);
});

test("relative LocationRef resolves against ability controller, source, and target controller", () => {
  const kernel = world().unit("enemy", { owner: "B", controller: "B", location: field("alpha") }).build();
  kernel.setTargets("enemy", [kernel.ref("enemy")]);
  const environment = { context: kernel, players: ["A", "B"], locationBindings: () => [] };
  assert.deepEqual(resolveLocationSelector("ability-controller-base", environment), base("A"));
  assert.deepEqual(resolveLocationSelector({ kind: "target-controller-base", target: "enemy" }, environment), base("B"));
  assert.deepEqual(resolveLocationSelector({ kind: "target-location", target: "enemy" }, environment), field("alpha"));
});

test("location choice is public and rejects an answer outside the legal location set", () => {
  const locations = [
    { ref: field("alpha"), controller: "A", occupied: true },
    { ref: field("beta"), controller: null, occupied: false }
  ];
  const waiting = world().build();
  assert.throws(() => chooseLocations(waiting, [{ id: "destination", type: "battlefield", open: true }], { locations, players: ["A", "B"] }), /Awaiting choice/);
  const answered = waiting.clone();
  answered.setAnswers({ "location:destination": field("beta") });
  assert.deepEqual(chooseLocations(answered, [{ id: "destination", type: "battlefield", open: true }], { locations, players: ["A", "B"] }), [{ id: "destination", selected: [field("beta")] }]);
  const illegal = waiting.clone();
  illegal.setAnswers({ "location:destination": field("alpha") });
  assert.throws(() => chooseLocations(illegal, [{ id: "destination", type: "battlefield", open: true }], { locations, players: ["A", "B"] }), /Invalid location choice/);
});

test("location Expr binds a selected location for effect consumers", () => {
  const kernel = world().unit("unit", { location: field("alpha") }).build();
  const body = [{
    id: "read",
    op: "condition.value",
    args: { value: { kind: "location", value: { kind: "target-location", target: "unit" } } },
    targets: [{ id: "unit", filter: { type: "unit" }, min: 1, max: 1, selection: "one" }]
  }];
  kernel.setTargets("unit", [kernel.ref("unit")]);
  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["read.value"], field("alpha"));
});

test("a location choice is available to a destination expression in the same instruction", () => {
  const kernel = world().unit("unit", { location: field("alpha") }).build();
  kernel.setAnswers({ "read/location%3Adestination": field("alpha") });
  const outcome = runAbilityBody([{
    id: "read",
    op: "condition.value",
    locations: [{ id: "destination", type: "battlefield", selection: "one" }],
    args: { value: { kind: "location", value: { kind: "target-location", target: "destination" } } }
  }], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["read.value"], field("alpha"));
});

test("target.location rejects a locked object at the wrong location", () => {
  const kernel = world().unit("unit", { location: base("A") }).build();
  kernel.setTargets("unit", [kernel.ref("unit")]);
  const outcome = runAbilityBody([{
    id: "read",
    op: "condition.value",
    targets: [{ id: "unit", filter: { type: "unit" }, location: { type: "battlefield" }, min: 1, max: 1 }],
    args: { value: { kind: "constant", value: 1 } }
  }], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
});

test("target.location resolves controller-relative base filters", () => {
  const kernel = world().unit("unit", { owner: "A", controller: "A", location: base("A") }).build();
  kernel.setTargets("unit", [kernel.ref("unit")]);
  const outcome = runAbilityBody([{
    id: "read",
    op: "condition.value",
    targets: [{ id: "unit", filter: { type: "unit" }, location: { type: "base", player: "controller" }, min: 1, max: 1 }],
    args: { value: { kind: "constant", value: 1 } }
  }], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
});

test("effect.move consumes a selected LocationExpr destination", () => {
  const kernel = world()
    .unit("moving", { owner: "A", controller: "A", location: field("alpha") })
    .unit("anchor", { owner: "B", controller: "B", location: field("beta") })
    .build();
  kernel.setTargets("moving", [kernel.ref("moving")]);
  kernel.setAnswers({ "move/location%3Adestination": field("beta") });
  const outcome = resolveChainBody([{
    id: "move",
    op: "effect.move",
    locations: [{ id: "destination", type: "battlefield", selection: "one" }],
    targets: [{ id: "moving", filter: { type: "unit" }, min: 1, max: 1 }],
    args: {
      objects: { kind: "constant", value: { target: "moving" } },
      to: { kind: "location", value: { kind: "target-location", target: "destination" } }
    }
  }], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.getObject("moving").location, field("beta"));
  assert.equal(outcome.results[0].result.linkedValues.moved.count, 1);
});
