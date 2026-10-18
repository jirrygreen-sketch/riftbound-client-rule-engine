import test from "node:test";
import assert from "node:assert/strict";
import replacementEvent from "../../../src/effects/instructions/replacement.event.ts";
import { contextFor, pipeline, sourceAndEnemy, constant } from "./replacement.helpers.mjs";
import { BlockedReplacementError } from "../../../src/replacement/index.ts";

test("replacement.event applies an instead body through the shared binder", () => {
  const { world, source, enemy } = sourceAndEnemy();
  const registrations = pipeline(world);
  const ctx = contextFor(world, source.id, registrations);
  const result = replacementEvent.execute(ctx, {
    event: constant({ event: "object-killed", filter: { type: "unit" } }),
    instead: constant([{ id: "return", op: "effect.zone", args: {
      target: constant({ linked: "replacement.object" }), to: constant("hand")
    } }])
  });
  assert.equal(result.status, "executed");
  const action = { type: "kill", object: enemy };
  const outcome = registrations.commit(action);
  assert.equal(outcome.status, "replaced");
  assert.equal(world.getObject("enemy")?.zone, "hand");
});

test("replacement.event this-turn duration expires at the next turn", () => {
  const first = sourceAndEnemy();
  const registrations = pipeline(first.world);
  contextFor(first.world, first.source.id, registrations);
  replacementEvent.execute(first.world, {
    event: constant("damage"), duration: constant("this-turn"), instead: constant([])
  });
  const action = { type: "damage", source: first.source, target: first.enemy, amount: 1, combat: false };
  assert.equal(registrations.commit(action).status, "prevented");
  registrations.clock.turn += 1;
  assert.equal(registrations.commit(action).status, "done");
});

test("multiple replacement.event registrations preserve pipeline order", () => {
  const first = sourceAndEnemy();
  const registrations = pipeline(first.world);
  contextFor(first.world, first.source.id, registrations);
  replacementEvent.execute(first.world, {
    event: constant("damage"), instead: constant([])
  });
  const secondSource = first.world.addObject({
    ...first.world.getObject(first.source.id),
    ref: { id: "second-source", zoneEntryId: 1 }, owner: "B", controller: "B"
  });
  contextFor(first.world, secondSource.id, registrations);
  replacementEvent.execute(first.world, {
    event: constant("damage"), instead: constant([])
  });
  const action = { type: "damage", source: first.source, target: first.enemy, amount: 1, combat: false };
  assert.equal(registrations.commit(action).status, "prevented");
});

test("replacement.event fails closed for an unknown event kind", () => {
  const { world, source } = sourceAndEnemy();
  const registrations = pipeline(world);
  const ctx = contextFor(world, source.id, registrations);
  assert.throws(
    () => replacementEvent.execute(ctx, { event: constant("unknown-event"), instead: constant([]) }),
    BlockedReplacementError
  );
});
