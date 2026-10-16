// RIFT-277 golden test — scenario `layers-stops-being-unit-equipment-stays-attached`
// 依据：CR v1.5 718.6 / 137.3.b（Orianna 例追问）。禁止附着的是“单位被附着”；非单位
// 对象互相附着没有限制，因此 #g1 停止是单位后，#g2 不必脱离。附注：#g2 的 Might Bonus
// 因 #g1 没有 Might 值而被忽略（137.3.b），但附着关系保留。
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

test("layers-stops-being-unit-equipment-stays-attached: attached gear remains attached when its host is not a unit", () => {
  const host = object("g1", { types: ["gear"], might: null });
  const attached = object("g2", { types: ["gear"], might: null, attachedTo: host.ref });
  const engine = createLayerEngine([host, attached], [
    permanent({ id: "might-bonus", layer: "arithmetic", source: attached.ref, filter: { objectId: "g1" }, effect: { kind: "increase", amount: 2 } }, 1)
  ]);

  const hostSnapshot = engine.evaluate(host.ref);
  assert.equal(hostSnapshot.types.includes("unit"), false);
  // 137.3.b：#g1 没有 Might 值，Might Bonus 被忽略（不产生数值）。
  assert.equal(hostSnapshot.might, null);
  const attachedSnapshot = engine.evaluate(attached.ref);
  assert.deepEqual(attachedSnapshot.attachedTo, host.ref);
});
