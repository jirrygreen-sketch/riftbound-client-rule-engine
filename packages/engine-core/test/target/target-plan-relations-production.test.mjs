import assert from "node:assert/strict";
import test from "node:test";

import smokeAndMirrors from "../../../card-dsl/dist/cards/unl/smoke-and-mirrors.js";
import { translateInstructionTargets } from "../../dist/programs/filters.js";
import { bindResolveContext } from "../../dist/events/action-adapter.js";
import { world } from "../../dist/effects/testing/index.js";
import {
  TargetSelectionError,
  bindFinalizedTargetPlans,
  finalizeTargetPlan,
  resolveTargetPlan
} from "../../dist/target/target-plan.js";

const play = smokeAndMirrors.abilities.find(ability => ability.kind === "play");
const [translatedSwap] = translateInstructionTargets(play.body);
const [firstRequirement, secondRequirement] = translatedSwap.targets;

function relationWorld({ sameLocation = false, enemy = false, zoneEntryId = 1 } = {}) {
  const builder = world()
    .player("A")
    .player("B")
    .base("source", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("a", { owner: "A", controller: "A", zoneEntryId, location: { type: "battlefield", id: "bf-1" } })
    .unit("b", {
      owner: enemy ? "B" : "A",
      controller: enemy ? "B" : "A",
      location: { type: "battlefield", id: sameLocation ? "bf-1" : "bf-2" }
    })
    .unit("other", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-3" } });
  return builder.build().clone({ sourceSnapshot: builder.kernel.getObject("source"), controller: "A" });
}

function boundContext(kernel, firstRef) {
  const context = bindResolveContext(kernel, { source: kernel.getObject("source"), controller: "A" });
  return bindFinalizedTargetPlans(context, [{
    requirement: firstRequirement,
    selected: [firstRef],
    lockedAt: "finalize",
    retestAtResolve: true
  }]);
}

function finalizePair(kernel, firstRef = kernel.ref("a")) {
  const firstContext = bindResolveContext(kernel, { source: kernel.getObject("source"), controller: "A" });
  const first = finalizeTargetPlan(firstContext, firstRequirement, { selected: [firstRef] });
  const secondContext = bindFinalizedTargetPlans(kernel, [first]);
  const second = finalizeTargetPlan(secondContext, secondRequirement, { selected: [kernel.ref("b")] });
  return { first, second, context: secondContext };
}

test("Smoke and Mirrors original symbolic filters consume the prior locked target", () => {
  assert.deepEqual(firstRequirement.filter, { zone: "board", type: "unit", controller: "self" });
  assert.deepEqual(secondRequirement.filter.exclude, { target: firstRequirement.id });
  assert.deepEqual(secondRequirement.filter.differentLocationFrom, { target: firstRequirement.id });
  assert.deepEqual(secondRequirement.filter.relation, {
    relation: "different-location",
    object: { target: firstRequirement.id }
  });

  const kernel = relationWorld();
  const pair = finalizePair(kernel);
  assert.deepEqual(pair.first.selected, [kernel.ref("a")]);
  assert.deepEqual(pair.second.selected, [kernel.ref("b")]);
  assert.equal(kernel.answers.size, 0);
});
for (const [label, options, targetId] of [
  ["same target", {}, "a"],
  ["enemy controller", { enemy: true }, "b"],
  ["same location", { sameLocation: true }, "b"]
]) {
  test(`Smoke and Mirrors rejects ${label} without widening the relation`, () => {
    const kernel = relationWorld(options);
    const context = boundContext(kernel, kernel.ref("a"));
    assert.throws(
      () => finalizeTargetPlan(context, secondRequirement, { selected: [kernel.ref(targetId)] }),
      error => error instanceof TargetSelectionError && error.code === "invalid-target-choice"
    );
  });
}

test("Smoke and Mirrors relation follows a legal move and rejects an old incarnation", () => {
  const kernel = relationWorld({ sameLocation: true });
  const first = kernel.ref("a");
  assert.equal(kernel.perform({ type: "move-location", object: first, to: { type: "battlefield", id: "bf-2" } }).status, "done");
  assert.equal(kernel.ref("a").zoneEntryId, first.zoneEntryId);
  assert.deepEqual(finalizeTargetPlan(boundContext(kernel, first), secondRequirement, { selected: [kernel.ref("b")] }).selected, [kernel.ref("b")]);
  assert.equal(kernel.perform({ type: "move-location", object: kernel.ref("a"), to: { type: "battlefield", id: "bf-1" } }).status, "done");
  assert.throws(
    () => finalizeTargetPlan(boundContext(kernel, first), secondRequirement, { selected: [kernel.ref("b")] }),
    error => error instanceof TargetSelectionError && (error.code === "invalid-target-choice" || error.code === "no-legal-targets")
  );

  const stale = kernel.ref("a");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  assert.notEqual(kernel.ref("a").zoneEntryId, stale.zoneEntryId);
  assert.throws(
    () => finalizeTargetPlan(boundContext(kernel, stale), secondRequirement, { selected: [kernel.ref("b")] }),
    error => error instanceof TargetSelectionError && (error.code === "invalid-target-choice" || error.code === "no-legal-targets")
  );
});

test("a re-entered id is a different target and never substitutes for the locked incarnation", () => {
  const kernel = relationWorld({ sameLocation: true });
  const old = kernel.ref("a");
  assert.equal(kernel.perform({ type: "return-to-hand", object: old }).status, "done");
  const current = kernel.ref("a");
  assert.notEqual(current.zoneEntryId, old.zoneEntryId);
  assert.equal(current.zoneEntryId, old.zoneEntryId + 1);

  const staleContext = boundContext(kernel, old);
  assert.throws(
    () => finalizeTargetPlan(staleContext, secondRequirement, { selected: [kernel.ref("b")] }),
    error => error instanceof TargetSelectionError && error.code === "no-legal-targets"
  );
  assert.throws(
    () => finalizeTargetPlan(staleContext, secondRequirement, { selected: [current] }),
    error => error instanceof TargetSelectionError && (error.code === "invalid-target-choice" || error.code === "no-legal-targets")
  );

  const freshContext = boundContext(kernel, current);
  assert.throws(
    () => finalizeTargetPlan(freshContext, secondRequirement, { selected: [kernel.ref("b")] }),
    error => error instanceof TargetSelectionError && error.code === "no-legal-targets"
  );
});

test("Smoke and Mirrors preserves Finalize relation after departure, control change and source change", () => {
  const kernel = relationWorld();
  const first = kernel.ref("a");
  const pair = finalizePair(kernel, first);
  assert.deepEqual(resolveTargetPlan(pair.context, pair.first).selected, [first]);

  assert.equal(kernel.perform({ type: "take-control", object: first, player: "B" }).status, "done");
  assert.equal(kernel.object(first).controller, "B");
  assert.equal(resolveTargetPlan(pair.context, pair.first).status, "ignored");
  assert.equal(resolveTargetPlan(pair.context, pair.second).status, "resolved");

  const movedSource = kernel.clone({ sourceSnapshot: kernel.getObject("source") });
  const changed = bindResolveContext(movedSource, {
    source: movedSource.getObject("b"),
    controller: "A"
  });
  assert.equal(resolveTargetPlan(bindFinalizedTargetPlans(changed, [pair.first]), pair.second).status, "resolved");
});

test("Smoke and Mirrors retry and rollback reuse the locked first target without mutation", () => {
  const kernel = relationWorld();
  const first = kernel.ref("a");
  const before = kernel.stateForTest();
  const attempt = () => {
    const context = boundContext(kernel, first);
    return finalizeTargetPlan(context, secondRequirement, { selected: [kernel.ref("b")] });
  };
  const firstAttempt = attempt();
  const secondAttempt = attempt();
  assert.deepEqual(firstAttempt, secondAttempt);
  assert.deepEqual(kernel.stateForTest(), before);

  const context = boundContext(kernel, first);
  assert.throws(
    () => finalizeTargetPlan(context, secondRequirement, { selected: [kernel.ref("a")] }),
    error => error instanceof TargetSelectionError && error.code === "invalid-target-choice"
  );
  assert.deepEqual(kernel.stateForTest(), before);
});

