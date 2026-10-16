import assert from "node:assert/strict";
import test from "node:test";
import movement from "../../../src/effects/instructions/continuous.movement.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });

test("continuous.movement registers a battlefield-to-battlefield permission (Ganking shape)", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(movement, {
    permission: literal("battlefield-to-battlefield"),
    source: literal("battlefield"),
    destination: literal("battlefield"),
    move: literal("standard"),
    duration: literal("this-turn"),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.registered, { id: "continuous-movement:source:1", duration: "this-turn" });
});

test("continuous.movement with addsPermission false turns route args into restrictions", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(movement, {
    permission: literal("move-from-here-to-base"),
    addsPermission: literal(false),
    restriction: literal("move-from-here-to-base"),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.registered, { id: "continuous-movement:source:1", duration: "permanent" });
});

test("continuous.movement with only a restriction registers a restriction", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(movement, { restriction: literal(["move-to-base"]) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.registered.duration, "permanent");
});

test("continuous.movement with no permission and no restriction is negated", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(movement, {}, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(run.linked, {});
});

test("continuous.movement with an empty target list is ignored as mistargeted", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(movement, { permission: literal("battlefield-to-battlefield"), target: literal("gone") }, {
    world: kernel, targets: { gone: [] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});
