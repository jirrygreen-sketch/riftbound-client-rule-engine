// RIFT-277 golden test — scenario `layers-attached-might-bonus-in-arithmetic-layer`
// 依据：CR v1.5 479.4.d / 718.4 / 137.3。附着卡的 Might Bonus 属于算术层，晚于能力层：
// 4 [M] 的 #u1 先过能力层（尚非 Mighty、无 Shield），算术层加到 5 后按 478.3 递归
// 重查能力层补发 Shield。Might Bonus 本身尚无自动消费者，用附着来源的算术层效果表达。
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

test("layers-attached-might-bonus-in-arithmetic-layer: an attached Might Bonus is applied after the ability layer and re-checks it", () => {
  const host = object("u1", { might: 4 });
  const gear = object("g1", { types: ["gear"], might: null, attachedTo: host.ref });
  let engine;
  engine = createLayerEngine([host, gear], [
    { effect: { id: "might-bonus", layer: "arithmetic", source: gear.ref, filter: { objectId: "u1" }, effect: { kind: "increase", amount: 1, condition: () => engine.evaluate(gear.ref).attachedTo !== null } }, duration: { type: "while-source-in-zone", source: gear.ref } },
    permanent({ id: "shield", layer: "ability", filter: { objectId: "u1", characteristics: { might: 5 } }, effect: { kind: "grant-keyword", keyword: "shield" } }, 2)
  ]);

  const snapshot = engine.evaluate(host.ref);
  assert.equal(snapshot.might, 5);
  assert.deepEqual(snapshot.keywords.map(keyword => keyword.id), ["shield"]);

  // 137.3.a：Might Bonus 只在本卡仍附着时施加。
  engine.removeContinuous("might-bonus");
  const detached = engine.evaluate(host.ref);
  assert.equal(detached.might, 4);
  assert.deepEqual(detached.keywords, []);
});
