// RIFT-1084-A: the layer evaluator may reuse its per-boundary derived effect
// index and fixed predicate vocabulary, but must keep CR v1.5 478.1.a-c
// dependencies and 478.2-478.4 apply-once/fixed-point semantics.
//
// Core Rules v1.5 (2026-10-09):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/
// 5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
import assert from "node:assert/strict";
import test from "node:test";

import { ChainEngine } from "../../dist/chain/engine.js";
import { matchesObjectFilter } from "../../dist/layers/filter.js";
import { createLayerEngine } from "../../dist/layers/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { world } from "../../dist/effects/testing/index.js";
import { createProgramBinding } from "../../dist/programs/index.js";

const c = value => ({ kind: "constant", value });
const battlefield = { type: "battlefield", id: "rift-1084-field" };
function unit(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 }, cardId: `test:${id}`, name: id,
    types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A",
    zone: "board", location: battlefield, might: 4, energy: null, power: null,
    exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null,
    faceDown: false, isToken: false, ...values,
  };
}

function frozenView(objects) {
  return Object.freeze(objects.map(object => {
    const current = { ...object };
    current.ref = Object.freeze({ ...current.ref });
    current.types = Object.freeze([...current.types]);
    current.tags = Object.freeze([...current.tags]);
    current.keywords = Object.freeze(current.keywords.map(keyword => Object.freeze({ ...keyword })));
    current.power = current.power === null ? null : Object.freeze([...current.power]);
    current.location = current.location === null ? null : Object.freeze({ ...current.location });
    current.attachedTo = current.attachedTo === null ? null : Object.freeze({ ...current.attachedTo });
    return Object.freeze(current);
  }));
}

function setupProgram(holder) {
  const one = c(1);
  const program = {
    canonicalCardId: "synthetic:rift-1084:conditional-a",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "Synthetic dependency/effect-once layer regression.",
    abilities: [
      {
        kind: "static",
        effect: { kind: "continuous.timing", layer: "ability", filter: { objectId: "dependent", mightGte: 5 },
          timings: ["showdown"] },
      },
      { kind: "static", effect: { kind: "continuous.might", layer: "arithmetic", appliesTo: "self", amount: one } },
    ],
  };
  const kernel = world().player("A").player("B")
    .unit("dependent", {
      cardId: program.canonicalCardId, might: 4, location: battlefield,
    })
    .unit("holder", { might: 5, energy: null, location: battlefield })
    .build();
  const choose = request => { throw new Error(`Unexpected choice ${request.id}`); };
  const reads = { count: 0 };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => { reads.count++; return frozenView(kernel.objects); },
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  engine.pipeline.emit({
    timingPoint: "object-enters-board", object: kernel.getObject("dependent"), player: "A",
  });
  return { engine, kernel, reads };
}

test("RIFT-1084 production binding preserves the layered fixed point", () => {
  const holder = { ref: { id: "holder", zoneEntryId: 1 } };
  const { engine, kernel, reads } = setupProgram(holder);
  const dependent = engine.pipeline.host.objects().find(object => object.ref.id === "dependent");
  assert.equal(dependent.might, 5, "the holder dependency applies once at the fixed point");
  assert.deepEqual(dependent.actionTimings, ["showdown"], "the ability layer sees arithmetic at the fixed point");
  assert.ok(reads.count > 0, "the real host supplied the layered input");
  assert.equal(engine.commit({ type: "take-control", object: kernel.ref("holder"), player: "B" }).status, "done");
  assert.equal(kernel.getObject("holder").controller, "B", "control mutation came from a real primitive");
  assert.equal(kernel.getObject("holder").energy, null, "control mutation did not change printed cost");
});

test("RIFT-1084 cached effect buckets preserve object dependency retries and apply-once results", () => {
  const holder = unit("holder", { might: 4 });
  const dependent = unit("dependent", { might: 2 });
  const bump = { effect: { id: "holder-bump", layer: "arithmetic", source: holder.ref,
    filter: { objectId: "holder" },
    effect: { kind: "increase", amount: 1 } }, duration: { type: "permanent" } };
  const waits = { effect: { id: "dependent-waits", layer: "arithmetic", source: holder.ref,
    filter: { objectId: "dependent" },
    effect: { kind: "increase", amount: 1, condition: { kind: "compare",
      left: { kind: "object-property", object: "source", property: "might" },
      operator: "gte", right: c(5) } } },
  duration: { type: "permanent" } };
  const layers = createLayerEngine(frozenView([dependent, holder]), [waits, bump]);
  const first = layers.evaluateAll();
  const second = layers.evaluateAll();
  const result = display => Object.fromEntries(display.map(object => [object.ref.id, object.might]));
  assert.deepEqual(result(first), { dependent: 3, holder: 5 });
  assert.deepEqual(result(second), result(first), "the cached layer index repeated no application");
  assert.equal(layers.registry.revision, 2);
});

test("RIFT-1084 derived effect cache tracks Buff validity across host boundaries", () => {
  const first = unit("fighter", { buffs: 0 });
  const layers = createLayerEngine(frozenView([first]));
  assert.equal(layers.evaluate(first.ref).might, 4);
  const reusedInput = new Map([["fighter:1", first]]);
  layers.setObjects(reusedInput);
  reusedInput.set("fighter:1", unit("fighter", { buffs: 2 }));
  layers.setObjects(reusedInput);
  assert.equal(layers.evaluate(reusedInput.get("fighter:1").ref).might, 6,
    "reusing the same Map as the next boundary invalidates the derived effect index");
  const buffed = unit("fighter", { buffs: 2 });
  layers.setObjects(frozenView([buffed]));
  assert.equal(layers.evaluate(buffed.ref).might, 6);
  const unbuffed = unit("fighter", { buffs: 0 });
  layers.setObjects(frozenView([unbuffed]));
  assert.equal(layers.evaluate(unbuffed.ref).might, 4);
});

test("RIFT-1084 cached numeric predicate aliases keep conjunction and null semantics", () => {
  const object = frozenView([unit("candidate", {
    might: 3, energy: 2, power: ["Fury"],
  })])[0];
  assert.equal(matchesObjectFilter({ mightLt: 4, mightAtLeast: 3, energyMax: 2 }, object), true);
  assert.equal(matchesObjectFilter({ mightGreaterThan: 2, printedEnergyMax: 2 }, object), true);
  assert.equal(matchesObjectFilter({ mightAtLeast: 4 }, object), false);
  assert.equal(matchesObjectFilter({ costEnergyLte: 2 }, frozenView([unit("no-cost", { energy: null })])[0]), false);
});
