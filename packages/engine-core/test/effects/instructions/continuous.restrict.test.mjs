import assert from "node:assert/strict";
import test from "node:test";
import restrict from "../../../src/effects/instructions/continuous.restrict.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";
import { ContinuousEffectRegistry } from "../../../src/layers/duration.ts";
import { restrictions, requirements } from "../../../src/layers/rules/query.ts";

const literal = value => ({ kind: "constant", value });
const registryOf = kernel => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};

test("continuous.restrict registers a play-spell prohibition (Cataclysm shape)", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(restrict, {
    mode: literal("prohibit"),
    action: literal("play-spell"),
    appliesTo: literal({ controller: "opponent" }),
    duration: literal("this-turn"),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.registered.duration, "this-turn");
  assert.match(run.linked.registered.id, /^continuous-restrict:source:1:/);
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

test("continuous.restrict permit is not reported as a prohibition", () => {
  const kernel = world().unit("hero").build();
  runInstruction(restrict, { mode: literal("permit"), action: literal("move"), restriction: literal("cannot-move") }, { world: kernel });
  assert.deepEqual(restrictions(registryOf(kernel), "move"), []);
});

test("continuous.restrict binds selected target and preserves requirement separation", () => {
  const kernel = world().unit("chosen").unit("bystander").build();
  const chosen = kernel.ref("chosen");
  const bystander = kernel.ref("bystander");
  runInstruction(restrict, { mode: literal("require"), action: literal("target"), restriction: literal("must-include-a-unit"), target: literal("chosen") }, { world: kernel, targets: { chosen: [chosen] } });
  const registry = registryOf(kernel);
  assert.equal(requirements(registry, "target", chosen, kernel.getObject("chosen")).length, 1);
  assert.equal(requirements(registry, "target", bystander, kernel.getObject("bystander")).length, 0);
});

test("continuous.restrict expires through the real registry", () => {
  const kernel = world().unit("hero").build();
  runInstruction(restrict, { action: literal("move"), duration: literal("this-turn") }, { world: kernel });
  const registry = registryOf(kernel);
  assert.equal(restrictions(registry, "move").length, 1);
  registry.expireAt({ id: "turn-end" }, () => null);
  assert.equal(restrictions(registry, "move").length, 0);
});

test("continuous.restrict allows two same-source restrictions", () => {
  const kernel = world().unit("hero").build();
  runInstruction(restrict, { action: literal("move"), restriction: literal("cannot-move") }, { world: kernel });
  runInstruction(restrict, { action: literal("attack"), restriction: literal("cannot-attack") }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 2);
});
