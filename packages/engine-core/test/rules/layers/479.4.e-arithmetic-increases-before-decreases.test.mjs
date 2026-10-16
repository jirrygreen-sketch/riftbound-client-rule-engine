// RIFT-277 golden test — scenario `layers-arithmetic-increases-before-decreases`
// 依据：CR v1.5 479.4.e / 479.4.e.1 / 479.4.e.2。算术层固定先施加全部增加、再施加全部
// 减少。时间戳故意让减少更早：3 + 2 - 4 = 1；若按时间戳交叉施加会得到 0 + 2 = 2。
import assert from "node:assert/strict";
import test from "node:test";
import { createLayerEngine } from "../../../dist/layers/index.js";

const permanent = (effect, timestamp) => ({ effect, duration: { type: "permanent" }, timestamp });
const unit = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 }, cardId: `card:${id}`, name: id, types: ["unit"], tags: [], keywords: [],
  owner: "A", controller: "A", zone: "board", location: null, might: 2, energy: 1, power: ["Fury"],
  exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  ...values
});

test("layers-arithmetic-increases-before-decreases: increases are applied before decreases inside the arithmetic layer", () => {
  const target = unit("u1", { might: 3 });
  const engine = createLayerEngine([target], [
    permanent({ id: "decrease", layer: "arithmetic", filter: { objectId: "u1" }, effect: { kind: "decrease", amount: 4 } }, 1),
    permanent({ id: "increase", layer: "arithmetic", filter: { objectId: "u1" }, effect: { kind: "increase", amount: 2 } }, 2)
  ]);

  assert.equal(engine.evaluate(target.ref).might, 1);
});
