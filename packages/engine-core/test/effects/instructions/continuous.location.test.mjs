import assert from "node:assert/strict";
import test from "node:test";
import location from "../../../src/effects/instructions/continuous.location.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";
import { ContinuousEffectRegistry } from "../../../src/layers/duration.ts";
import { playLocations } from "../../../src/layers/rules/query.ts";

const literal = value => ({ kind: "constant", value });
const registryOf = kernel => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};

test("continuous.location registers an any-battlefield permission", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(location, { permission: literal("any-battlefield"), duration: literal("this-turn") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.registered.duration, "this-turn");
  assert.match(run.linked.registered.id, /^continuous-location:source:1:/);
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

test("continuous.location binds a selected target and excludes a bystander", () => {
  const kernel = world().unit("chosen").unit("bystander").build();
  const chosen = kernel.ref("chosen");
  const bystander = kernel.ref("bystander");
  runInstruction(location, { permission: literal("any-battlefield"), target: literal("chosen") }, { world: kernel, targets: { chosen: [chosen] } });
  const registry = registryOf(kernel);
  assert.equal(playLocations(registry, chosen, kernel.getObject("chosen")).permissions.length, 1);
  assert.equal(playLocations(registry, bystander, kernel.getObject("bystander")).permissions.length, 0);
});

test("continuous.location expires through the real registry", () => {
  const kernel = world().unit("hero").build();
  runInstruction(location, { permission: literal("any-battlefield"), duration: literal("while-source-here") }, { world: kernel });
  const registry = registryOf(kernel);
  assert.equal(playLocations(registry, kernel.source.ref, kernel.source).permissions.length, 1);
  registry.expireInactive(() => null);
  assert.equal(playLocations(registry, kernel.source.ref, kernel.source).permissions.length, 0);
});

test("continuous.location allows two same-source placements", () => {
  const kernel = world().unit("hero").build();
  runInstruction(location, { permission: literal("any-battlefield") }, { world: kernel });
  runInstruction(location, { restriction: literal("no-battlefield") }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 2);
});
