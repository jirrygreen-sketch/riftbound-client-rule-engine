import assert from "node:assert/strict";
import { createTestWorld } from "../../../src/effects/testing/test-kernel.ts";
import { EventPipeline } from "../../../dist/events/pipeline.js";

export function contextFor(world, sourceId, pipeline) {
  const source = world.getObject(sourceId);
  assert.ok(source, `missing source ${sourceId}`);
  Object.defineProperty(world, "source", { value: source, configurable: true });
  const dependencies = {
    host: {
      object: ref => world.object(ref),
      objects: () => world.objects,
      context: () => world
    },
    pipeline
  };
  Object.defineProperty(world, "replacement", { value: dependencies, configurable: true });
  return world;
}

export function pipeline(world) {
  const engine = new EventPipeline({
    checkpoint: () => world.snapshot(),
    restore: checkpoint => world.restore(checkpoint),
    execute: action => ({ outcome: world.perform(action), emissions: [] }),
    context: () => world,
    objects: () => world.objects,
    choose: request => request.type === "mode" ? request.options[0] : true
  }, ["A", "B"], "A");
  return engine;
}

export function sourceAndEnemy() {
  const world = createTestWorld();
  const source = world.addObject({
    ref: { id: "source", zoneEntryId: 1 }, cardId: "card:source", name: "Source",
    types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: { type: "base", player: "A" }, might: 1, energy: 1, power: ["Fury"], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  });
  const enemy = world.addObject({
    ref: { id: "enemy", zoneEntryId: 1 }, cardId: "card:enemy", name: "Enemy",
    types: ["unit"], tags: [], keywords: [], owner: "B", controller: "B", zone: "board",
    location: { type: "base", player: "B" }, might: 1, energy: 1, power: ["Fury"], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  });
  return { world, source, enemy };
}

export function constant(value) { return { kind: "constant", value }; }
