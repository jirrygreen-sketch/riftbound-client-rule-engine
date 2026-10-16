import assert from "node:assert/strict";
import test from "node:test";
import location from "../../../src/effects/instructions/continuous.location.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });

test("continuous.location registers an any-battlefield permission", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(location, { permission: literal("any-battlefield"), duration: literal("this-turn") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.registered, { id: "continuous-location:source:1", duration: "this-turn" });
});

test("continuous.location registers a placement restriction", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(location, { restriction: literal("facedown-zone-maximum-occupancy") }, { world: kernel });
  assert.equal(run.result.status, "executed");
});

test("continuous.location with neither permission nor restriction is negated", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(location, {}, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(run.linked, {});
});

test("continuous.location with an empty target list is ignored as mistargeted", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(location, { permission: literal("any-battlefield"), target: literal("gone") }, {
    world: kernel, targets: { gone: [] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});
