import assert from "node:assert/strict";
import test from "node:test";
import timing from "../../../src/effects/instructions/continuous.timing.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";
import { ContinuousEffectRegistry } from "../../../src/layers/duration.ts";
import { actionTimings, canAct } from "../../../src/layers/rules/query.ts";

const literal = value => ({ kind: "constant", value });
const registryOf = kernel => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};

test("continuous.timing registers a speed grant and links the registration", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(timing, { grants: literal("action"), duration: literal("this-turn") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.registered.duration, "this-turn");
  assert.match(run.linked.registered.id, /^continuous-timing:source:1:/);
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
  const kernel = world().unit("hero").build();
  runInstruction(timing, { grants: literal("action"), duration: literal("this-turn") }, { world: kernel });
  const registry = registryOf(kernel);
  assert.deepEqual(actionTimings(registry, kernel.source.ref, kernel.source), ["action"]);
  assert.equal(canAct({ player: "A", turnPlayer: "A", priorityHolder: "A", speed: "action", showdown: false, closedState: false, registry, ref: kernel.source.ref, object: kernel.source }), true);
  registry.expireAt({ id: "turn-end" }, () => null);
  assert.deepEqual(actionTimings(registry, kernel.source.ref, kernel.source), []);
});

test("continuous.timing binds a selected target to its zone-bound identity", () => {
  const kernel = world().unit("chosen", { owner: "A" }).unit("bystander", { owner: "A" }).build();
  const chosen = kernel.ref("chosen");
  const bystander = kernel.ref("bystander");
  runInstruction(timing, { grants: literal("reaction"), target: literal("chosen") }, { world: kernel, targets: { chosen: [chosen] } });
  const registry = registryOf(kernel);
  assert.deepEqual(actionTimings(registry, chosen, kernel.getObject("chosen")), ["reaction"]);
  assert.deepEqual(actionTimings(registry, bystander, kernel.getObject("bystander")), []);
});

test("continuous.timing rejects stale selected references", () => {
  const kernel = world().unit("hero").build();
  const stale = { id: "gone", zoneEntryId: 99 };
  const run = runInstruction(timing, { grants: literal("action"), target: literal("chosen") }, { world: kernel, targets: { chosen: [stale] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});

test("continuous.timing allows two same-source executions with distinct deterministic instances", () => {
  const kernel = world().unit("hero").build();
  runInstruction(timing, { grants: literal("action") }, { world: kernel });
  runInstruction(timing, { grants: literal("reaction") }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 2);
  assert.notEqual(kernel.continuousEffects[0].effect.id, kernel.continuousEffects[1].effect.id);
});

test("continuous.timing advances the deterministic instance when the shape repeats", () => {
  const kernel = world().unit("hero").build();
  runInstruction(timing, { grants: literal("action") }, { world: kernel });
  runInstruction(timing, { grants: literal("action") }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 2);
  assert.notEqual(kernel.continuousEffects[0].effect.id, kernel.continuousEffects[1].effect.id);
});
