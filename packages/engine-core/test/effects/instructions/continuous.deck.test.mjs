import assert from "node:assert/strict";
import test from "node:test";
import deck from "../../../src/effects/instructions/continuous.deck.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });

test("continuous.deck registers an unlimited copy limit for the source card (Spiderling shape)", () => {
  const kernel = world().unit("spiderling", { name: "Spiderling" }).build();
  const run = runInstruction(deck, { mode: literal("unlimited") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.registered, { id: "continuous-deck:source:1", duration: "permanent" });
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
