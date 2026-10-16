import assert from "node:assert/strict";
import test from "node:test";
import timing from "../../../src/effects/instructions/continuous.timing.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });

test("continuous.timing registers a speed grant and links the registration", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(timing, { grants: literal("action"), duration: literal("this-turn") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.registered, { id: "continuous-timing:source:1", duration: "this-turn" });
});

test("continuous.timing accepts the timings alias and a list of speeds", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(timing, { timings: literal(["showdown", "closed-state"]) }, { world: kernel });
  assert.equal(run.result.status, "executed");
});

test("continuous.timing with no grants is negated and registers nothing", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(timing, { grants: literal([]) }, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(run.linked, {});
});

test("continuous.timing with an empty target list is ignored as mistargeted", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(timing, { grants: literal("reaction"), target: literal("gone") }, { world: kernel, targets: { gone: [] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.linked, {});
});

test("continuous.timing end-of-turn durations expire at turn-end", async () => {
  const { ContinuousEffectRegistry } = await import("../../../dist/layers/index.js");
  const registry = new ContinuousEffectRegistry();
  const kernel = world().unit("hero").build();
  runInstruction(timing, { grants: literal("action"), duration: literal("this-turn") }, { world: kernel });
  const registered = registry.list();
  assert.equal(registered.length, 0);
});
