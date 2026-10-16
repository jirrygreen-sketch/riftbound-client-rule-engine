import assert from "node:assert/strict";
import test from "node:test";
import restrict from "../../../src/effects/instructions/continuous.restrict.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });

test("continuous.restrict registers a play-spell prohibition (Cataclysm shape)", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(restrict, {
    mode: literal("prohibit"),
    action: literal("play-spell"),
    appliesTo: literal({ controller: "opponent" }),
    duration: literal("this-turn"),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.registered, { id: "continuous-restrict:source:1", duration: "this-turn" });
});

test("continuous.restrict mode require registers a requirement, separate from restrictions", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(restrict, {
    mode: literal("require"),
    action: literal("target"),
    restriction: literal("must-include-a-unit"),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
});

test("continuous.restrict with an unknown mode is negated and registers nothing", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(restrict, { mode: literal("unknown"), action: literal("play-spell") }, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(run.linked, {});
});

test("continuous.restrict with no action and no restriction is negated", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(restrict, { mode: literal("prohibit") }, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
});

test("continuous.restrict with an empty target list is ignored as mistargeted", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(restrict, { action: literal("move"), target: literal("gone") }, {
    world: kernel, targets: { gone: [] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});
