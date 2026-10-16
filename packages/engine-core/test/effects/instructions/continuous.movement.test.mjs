import assert from "node:assert/strict";
import test from "node:test";
import movement from "../../../src/effects/instructions/continuous.movement.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";
import { ContinuousEffectRegistry } from "../../../src/layers/duration.ts";
import { movement as movementQuery } from "../../../src/layers/rules/query.ts";

const literal = value => ({ kind: "constant", value });
const registryOf = kernel => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};

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
  assert.equal(run.linked.registered.duration, "this-turn");
  assert.match(run.linked.registered.id, /^continuous-movement:source:1:/);
});

test("continuous.movement with addsPermission false turns route args into restrictions", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(movement, {
    permission: literal("move-from-here-to-base"),
    addsPermission: literal(false),
    restriction: literal("move-from-here-to-base"),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  const registry = registryOf(kernel);
  const view = movementQuery(registry, kernel.source.ref, kernel.source);
  assert.equal(view.canGank, false);
  assert.deepEqual(view.permissions, []);
  assert.deepEqual(view.restrictions, ["move-from-here-to-base"]);
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

test("continuous.movement binds a selected target and excludes a bystander", () => {
  const kernel = world().unit("chosen").unit("bystander").build();
  const chosen = kernel.ref("chosen");
  const bystander = kernel.ref("bystander");
  runInstruction(movement, { permission: literal("battlefield-to-battlefield"), target: literal("chosen") }, { world: kernel, targets: { chosen: [chosen] } });
  const registry = registryOf(kernel);
  assert.equal(movementQuery(registry, chosen, kernel.getObject("chosen")).canGank, true);
  assert.equal(movementQuery(registry, bystander, kernel.getObject("bystander")).canGank, false);
});

test("continuous.movement expires through the real registry", () => {
  const kernel = world().unit("hero").build();
  runInstruction(movement, { permission: literal("battlefield-to-battlefield"), duration: literal("this-combat") }, { world: kernel });
  const registry = registryOf(kernel);
  assert.equal(movementQuery(registry, kernel.source.ref, kernel.source).canGank, true);
  registry.expireAt({ id: "combat-end" }, () => null);
  assert.equal(movementQuery(registry, kernel.source.ref, kernel.source).canGank, false);
});

test("continuous.movement allows two same-source route effects", () => {
  const kernel = world().unit("hero").build();
  runInstruction(movement, { permission: literal("battlefield-to-battlefield") }, { world: kernel });
  runInstruction(movement, { permission: literal("battlefield-to-base") }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 2);
});
