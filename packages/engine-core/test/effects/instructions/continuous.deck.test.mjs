import assert from "node:assert/strict";
import test from "node:test";
import deck from "../../../src/effects/instructions/continuous.deck.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";
import { ContinuousEffectRegistry } from "../../../src/layers/duration.ts";
import { deckLimit } from "../../../src/layers/rules/query.ts";

const literal = value => ({ kind: "constant", value });
const registryOf = kernel => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};

test("continuous.deck registers an unlimited copy limit for the source card (Spiderling shape)", () => {
  const kernel = world().unit("spiderling", { name: "Spiderling" }).build();
  const run = runInstruction(deck, { mode: literal("unlimited") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.registered.duration, "permanent");
  assert.match(run.linked.registered.id, /^continuous-deck:source:1:/);
});

test("continuous.deck registers a named max limit (Unique shape)", () => {
  const kernel = world().unit("unique", { name: "Unique Leader" }).build();
  const run = runInstruction(deck, {
    mode: literal("max"), amount: literal(1), name: literal("Unique Leader"),
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.registered.duration, "permanent");
});

test("continuous.deck with an unknown mode is negated", () => {
  const kernel = world().unit("hero", { name: "Hero" }).build();
  const run = runInstruction(deck, { mode: literal("anything") }, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(run.linked, {});
});

test("continuous.deck with max and no amount is negated", () => {
  const kernel = world().unit("hero", { name: "Hero" }).build();
  const run = runInstruction(deck, { mode: literal("max") }, { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
});

test("continuous.deck accepts a source ObjectSelector property expression", () => {
  const kernel = world().unit("spiderling", { name: "Spiderling" }).build();
  const run = runInstruction(deck, { mode: literal("unlimited"), name: { kind: "object-property", object: "source", property: "name" } }, { world: kernel });
  assert.equal(run.result.status, "executed");
});

test("continuous.deck ignores a stale selected reference", () => {
  const kernel = world().unit("hero").build();
  const run = runInstruction(deck, { mode: literal("unlimited"), target: literal("gone") }, { world: kernel, targets: { gone: [{ id: "gone", zoneEntryId: 99 }] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
});

test("continuous.deck expires through the real registry", () => {
  const kernel = world().unit("hero", { name: "Hero" }).build();
  runInstruction(deck, { mode: literal("max"), amount: literal(1), duration: literal("this-turn") }, { world: kernel });
  const registry = registryOf(kernel);
  assert.deepEqual(deckLimit(registry, "source"), { mode: "max", amount: 1 });
  registry.expireAt({ id: "turn-end" }, () => null);
  assert.equal(deckLimit(registry, "source"), null);
});

test("continuous.deck allows two same-source limits", () => {
  const kernel = world().unit("hero", { name: "Hero" }).build();
  runInstruction(deck, { mode: literal("unlimited") }, { world: kernel });
  runInstruction(deck, { mode: literal("max"), amount: literal(1) }, { world: kernel });
  assert.equal(kernel.continuousEffects.length, 2);
});
