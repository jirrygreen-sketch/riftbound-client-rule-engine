import test from "node:test";
import assert from "node:assert/strict";
import replacementEnter from "../../../src/effects/instructions/replacement.enter.ts";
import { BlockedReplacementError } from "../../../src/replacement/index.ts";
import { contextFor, pipeline, constant } from "./replacement.helpers.mjs";
import { createTestWorld } from "../../../src/effects/testing/test-kernel.ts";

test("replacement.enter registers the binder-backed entry orientation", () => {
  const world = createTestWorld();
  world.addObject({
    ref: { id: "source", zoneEntryId: 1 }, cardId: "card:source", name: "Source", types: ["unit"], tags: [], keywords: [],
    owner: "A", controller: "A", zone: "chain", location: null, might: 1, energy: 1, power: ["Fury"],
    exhausted: true, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  });
  const registrations = pipeline(world);
  const ctx = contextFor(world, "source", registrations);
  const result = replacementEnter.execute(ctx, { state: constant("ready") });
  assert.equal(result.status, "executed");
  assert.equal(registrations.events.length, 0);

  // A chain item receives a new zone entry before it is moved to the board.
  const current = world.getObject("source");
  world.addObject({ ...current, ref: { id: "source", zoneEntryId: 2 }, zone: "chain", location: null });
  const entry = { type: "move-zone", object: { id: "source", zoneEntryId: 2 }, to: "base", location: { type: "base", player: "A" } };
  const outcome = registrations.commit(entry);
  assert.equal(outcome.status, "replaced");
  assert.equal(world.getObject("source")?.zone, "board");
  assert.equal(world.getObject("source")?.exhausted, false);
});

test("replacement.enter with this-turn duration expires at the next turn", () => {
  const world = createTestWorld();
  world.addObject({
    ref: { id: "source", zoneEntryId: 1 }, cardId: "card:source", name: "Source", types: ["unit"], tags: [], keywords: [],
    owner: "A", controller: "A", zone: "chain", location: null, might: 1, energy: 1, power: ["Fury"],
    exhausted: true, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  });
  const registrations = pipeline(world);
  const ctx = contextFor(world, "source", registrations);
  replacementEnter.execute(ctx, { state: constant("ready"), duration: constant("this-turn") });
  const current = world.getObject("source");
  world.addObject({ ...current, ref: { id: "source", zoneEntryId: 2 }, zone: "chain", location: null });
  const entry = { type: "move-zone", object: { id: "source", zoneEntryId: 2 }, to: "base", location: { type: "base", player: "A" } };
  assert.equal(registrations.commit(entry).status, "replaced");
  const next = world.getObject("source");
  world.addObject({ ...next, ref: { id: "source", zoneEntryId: 3 }, zone: "chain", location: null });
  registrations.clock.turn += 1;
  assert.equal(registrations.commit({ ...entry, object: { id: "source", zoneEntryId: 3 } }).status, "done");
});

test("replacement.enter next-time-this-turn applies once and preserves the entry filter", () => {
  const world = createTestWorld();
  world.addObject({
    ref: { id: "source", zoneEntryId: 1 }, cardId: "card:source", name: "Source", types: ["unit"], tags: [], keywords: [],
    owner: "A", controller: "A", zone: "chain", location: null, might: 1, energy: 1, power: ["Fury"],
    exhausted: true, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  });
  const registrations = pipeline(world);
  const ctx = contextFor(world, "source", registrations);
  replacementEnter.execute(ctx, {
    state: constant("ready"),
    duration: constant("next-time-this-turn"),
    appliesTo: constant({ self: true, type: "unit" })
  });

  const entry = (zoneEntryId) => ({
    type: "move-zone", object: { id: "source", zoneEntryId }, to: "base", location: { type: "base", player: "A" }
  });
  world.addObject({ ...world.getObject("source"), ref: { id: "source", zoneEntryId: 2 }, zone: "chain", location: null, types: ["unit"] });
  assert.equal(registrations.commit(entry(2)).status, "replaced");
  assert.equal(world.getObject("source")?.exhausted, false);

  world.addObject({ ...world.getObject("source"), ref: { id: "source", zoneEntryId: 3 }, zone: "chain", location: null, exhausted: true });
  assert.equal(registrations.commit(entry(3)).status, "done");
  assert.equal(world.getObject("source")?.exhausted, true);
});

test("multiple replacement.enter registrations keep pipeline order", () => {
  const world = createTestWorld();
  world.addObject({
    ref: { id: "source", zoneEntryId: 1 }, cardId: "card:source", name: "Source", types: ["unit"], tags: [], keywords: [],
    owner: "A", controller: "A", zone: "chain", location: null, might: 1, energy: 1, power: ["Fury"],
    exhausted: true, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  });
  const registrations = pipeline(world);
  replacementEnter.execute(contextFor(world, "source", registrations), { state: constant("exhausted") });
  world.addObject({ ...world.getObject("source"), ref: { id: "source", zoneEntryId: 2 }, zone: "chain", location: null });
  replacementEnter.execute(contextFor(world, "source", registrations), { state: constant("ready") });
  world.addObject({ ...world.getObject("source"), ref: { id: "source", zoneEntryId: 3 }, zone: "chain", location: null });

  const outcome = registrations.commit({
    type: "move-zone", object: { id: "source", zoneEntryId: 3 }, to: "base", location: { type: "base", player: "A" }
  });
  assert.equal(outcome.status, "replaced");
  assert.equal(world.getObject("source")?.exhausted, false);
});

test("replacement.enter fails closed without the replacement contract extension", () => {
  const world = createTestWorld();
  assert.throws(
    () => replacementEnter.execute(world, { state: constant("ready") }),
    BlockedReplacementError
  );
});
