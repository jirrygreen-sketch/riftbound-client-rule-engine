// RIFT-277 golden test — scenario `layers-attached-equipment-becomes-unit-detaches`
// 依据：CR v1.5 143.5.b / 718.6.a（Orianna 例）。#g1 变单位的同一瞬间脱离 #u1；脱离后
// #u1 失去 +2 Might Bonus 回到 3 [M]（数值相同的巧合：本断言同时钉住 attached=false）。
import assert from "node:assert/strict";
import test from "node:test";
import { createLayerEngine } from "../../../dist/layers/index.js";

const permanent = (effect, timestamp) => ({ effect, duration: { type: "permanent" }, timestamp });
const object = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 }, cardId: `card:${id}`, name: id, types: ["unit"], tags: [], keywords: [],
  owner: "A", controller: "A", zone: "board", location: null, might: 2, energy: 1, power: ["Fury"],
  exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  ...values
});

test("layers-attached-equipment-becomes-unit-detaches: unitization detaches the attached gear immediately", () => {
  const host = object("u1", { might: 3 });
  const gear = object("g1", { types: ["gear"], might: null, attachedTo: host.ref });
  let engine;
  engine = createLayerEngine([host, gear], [
    { effect: { id: "might-bonus", layer: "arithmetic", source: gear.ref, filter: { objectId: "u1" }, effect: { kind: "increase", amount: 2, condition: () => engine.evaluate(gear.ref).attachedTo !== null } }, duration: { type: "permanent" }, timestamp: 1 },
    permanent({ id: "orianna", layer: "trait", filter: { objectId: "g1" }, effect: { kind: "set-types", types: ["unit", "gear"] } }, 2)
  ]);

  const unitized = engine.evaluate(gear.ref);
  assert.ok(unitized.types.includes("unit"));
  assert.equal(unitized.attachedTo, null);
  // 脱离后 #u1 失去 +2 Might Bonus。
  assert.equal(engine.evaluate(host.ref).might, 3);

  // 143.5.b 的还原路径：效果结束后附着关系与加成随之恢复。
  engine.removeContinuous("orianna");
  const reverted = engine.evaluate(gear.ref);
  assert.deepEqual(reverted.types, ["gear"]);
  assert.deepEqual(reverted.attachedTo, host.ref);
  assert.equal(engine.evaluate(host.ref).might, 5);
});
