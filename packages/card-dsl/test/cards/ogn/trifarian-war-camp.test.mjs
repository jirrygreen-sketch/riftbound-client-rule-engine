// Scenario evidence: ../templates/static-641.test.mjs (supported paths and explicit binding gaps).
// Whole-card execution remains pending; the existing component evidence below is retained.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/trifarian-war-camp.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CANONICAL = "card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f";
const SOURCE_TEXT = "Units here have +1 :rb_might:. (This includes attackers.)";

const [ability] = program.abilities;

function unit(id, overrides = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 2,
    energy: 1,
    power: ["Fury"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  };
}

/** Isolate the declared arithmetic operation from the blocked here filter. */
function layeredEngine(objects) {
  const engine = createLayerEngine(objects, [
    {
      effect: {
        id: "trifarian-war-camp",
        layer: ability.effect.layer,
        filter: { type: "unit", zone: "board" },
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects(objects);
  return engine;
}

test("Trifarian War Camp program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /LocationRef/);
  // Re-probed 2026-10-17: the gap is the by-reference comparison inside
  // layers/filter.matchesObjectFilter against cloned layer snapshots.
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.match(program.judgeReason, /对象引用比较/);
  assert.match(program.judgeReason, /battlefield/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Trifarian War Camp structure: one arithmetic-layer +1 Might static, scoped to this Battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.3.b: "have" grants the ability; 479.4/479.4.a: +1 Might is the
  // arithmetic layer, applied as an increase (479.4.e.1).
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });

  // 053.3: "here" is this Battlefield. It covers every unit at the location
  // (both controllers) and makes no attacker/defender distinction — the printed
  // reminder "(This includes attackers.)" is exactly why no combat-role or
  // designation condition is written here.
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(ability.effect.filter.controller, undefined);
  assert.equal(ability.effect.condition, undefined);
});

test("Trifarian War Camp arithmetic component: +1 Might executes through the arithmetic layer", () => {
  const unitHere = unit("unit-here");
  const enemyHere = unit("enemy-here", { owner: "B", controller: "B", might: 5 });
  const engine = layeredEngine([unitHere, enemyHere]);

  // Both controllers' units get the bonus: the card says "Units here", not
  // "your units here".
  assert.equal(engine.evaluate(unitHere.ref).might, 3);
  assert.equal(engine.evaluate(enemyHere.ref).might, 6);
  // The printed Might characteristics and everything else are untouched.
  assert.equal(engine.evaluate(unitHere.ref).printed.might, 2);
  assert.deepEqual(engine.evaluate(unitHere.ref).types, ["unit"]);
});

test("Trifarian War Camp: the production static binder registers the source-relative location and removes its effect", async () => {
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const { createEngineStaticBinder } = await import("../../../../engine-core/dist/programs/statics.js");
  const f = fixture({ cards: [{ id: "camp", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null }] });
  const here = { type: "battlefield", id: "battlefield-1" };
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("camp"), to: "board", location: here });
  const source = f.kernel.getObject("camp");
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);
  const [entry] = f.engine.layers.registry.list();
  assert.deepEqual(entry.effect.source, source.ref);
  assert.equal(entry.effect.layer, "arithmetic");
  assert.equal(entry.effect.effect.amount, 1);
  assert.deepEqual(entry.effect.filter, { type: "unit", zone: "board", location: here });
  assert.deepEqual(entry.duration, { type: "permanent" });
  handle.unbind();
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("Trifarian War Camp boundary: the layer filter compares locations by reference, so the bound aura reaches no unit (CR 053.3 / 479.4)", () => {
  // Re-probed 2026-10-17: the registered filter carries the source's LocationRef,
  // but layers/filter.ts compares structured locations with !==. Layer snapshots
  // are cloned, so even a unit sharing the identical location value misses; this
  // is the production failure, not a hand-built filter.
  const sharedLocation = { type: "battlefield", id: "bf-1" };
  const snapshot = unit("unit-here");
  snapshot.location = sharedLocation;
  const filter = { type: "unit", zone: "board", location: sharedLocation };
  assert.equal(matchesObjectFilter(filter, snapshot), true);
  assert.equal(matchesObjectFilter({ ...filter, location: { ...sharedLocation } }, snapshot), false);

  // Drive the real static binder so the registered filter is the production one.
  const f = fixture({ cards: [
    { id: "camp", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null },
    { id: "own-unit", owner: "A", controller: "A", types: ["unit"], might: 2 },
    { id: "enemy-unit", owner: "B", controller: "B", types: ["unit"], might: 5 }
  ] });
  const here = { type: "battlefield", id: "battlefield-1" };
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("camp"), to: "board", location: here });
  for (const id of ["own-unit", "enemy-unit"]) {
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "board", location: { ...here } });
  }
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("camp"));
  const [registered] = f.engine.layers.registry.list();
  assert.deepEqual(registered.effect.filter, { type: "unit", zone: "board", location: here });
  f.engine.layers.setObjects(f.kernel.objects);
  // The aura is registered but lands on nobody: both players' units here keep
  // their printed Might because the cloned snapshots' locations never equal the
  // captured reference.
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("own-unit")).might, 2);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("enemy-unit")).might, 5);
  assert.equal(matchesObjectFilter(registered.effect.filter, f.engine.layers.snapshot(f.kernel.ref("own-unit"))), false);
});
