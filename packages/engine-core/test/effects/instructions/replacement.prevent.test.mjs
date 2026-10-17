import test from "node:test";
import assert from "node:assert/strict";
import replacementPrevent from "../../../src/effects/instructions/replacement.prevent.ts";
import { contextFor, pipeline, sourceAndEnemy, constant } from "./replacement.helpers.mjs";
import { BlockedReplacementError } from "../../../src/replacement/index.ts";

test("replacement.prevent prevents all matching damage", () => {
  const { world, source } = sourceAndEnemy();
  const registrations = pipeline(world);
  const ctx = contextFor(world, source.id, registrations);
  const result = replacementPrevent.execute(ctx, { amount: constant("all"), target: constant("self") });
  assert.equal(result.status, "executed");
  const action = { type: "damage", source, target: source, amount: 3, combat: false };
  assert.equal(registrations.commit(action).status, "prevented");
  assert.equal(world.getObject("source")?.damage, 0);
});

test("replacement.prevent consumes a this-turn numeric prevention budget", () => {
  const { world, source, enemy } = sourceAndEnemy();
  const registrations = pipeline(world);
  const ctx = contextFor(world, source.id, registrations);
  replacementPrevent.execute(ctx, { amount: constant(3), duration: constant("this-turn") });
  const first = { type: "damage", source, target: enemy, amount: 2, combat: false };
  assert.equal(registrations.commit(first).status, "prevented");
  const second = { type: "damage", source, target: enemy, amount: 2, combat: false };
  assert.equal(registrations.commit(second).status, "replaced");
  assert.equal(world.getObject("enemy")?.damage, 1);
  registrations.clock.turn += 1;
  assert.equal(registrations.commit(second).status, "done");
});

test("multiple replacement.prevent registrations are applied in pipeline order", () => {
  const first = sourceAndEnemy();
  const second = sourceAndEnemy();
  const registrations = pipeline(first.world);
  contextFor(first.world, first.source.id, registrations);
  replacementPrevent.execute(first.world, { amount: constant(2) });
  contextFor(second.world, second.source.id, registrations);
  replacementPrevent.execute(second.world, { amount: constant(3) });
  const action = { type: "damage", source: first.source, target: first.enemy, amount: 5, combat: false };
  assert.equal(registrations.commit(action).status, "prevented");
  assert.equal(first.world.getObject("enemy")?.damage, 0);
});

test("replacement.prevent rejects unsupported source classification instead of broadening the shield", () => {
  const { world, source } = sourceAndEnemy();
  const registrations = pipeline(world);
  const ctx = contextFor(world, source.id, registrations);
  assert.throws(
    () => replacementPrevent.execute(ctx, {
      amount: constant("all"),
      appliesTo: constant({ sourceKind: ["spell", "ability"] })
    }),
    BlockedReplacementError
  );
});
