// RIFT-277 golden test — scenario `layers-copy-layer-precedes-trait-layer`
// 依据：CR v1.5 479.1 / 479.2。#u1 先在复制层取得 #src 的可复特征（含 Fury 领域），
// 再由自身特征层效果把领域改成 Chaos。特征层效果的时间戳故意早于复制效果：
// 若实现按时间戳而不是按图层顺序处理，Chaos 会被复制来的 Fury 覆盖。
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

test("layers-copy-layer-precedes-trait-layer: the trait layer overwrites traits gained in the copy layer", () => {
  const source = unit("src", { might: 2, power: ["Fury"], keywords: [{ id: "shield" }] });
  const copy = unit("u1", { might: 1, power: ["Chaos"] });
  const engine = createLayerEngine([source, copy], [
    permanent({ id: "chaos", layer: "trait", filter: { objectId: "u1" }, effect: { kind: "set-domain", domain: "Chaos" } }, 1),
    permanent({ id: "copy", layer: "copy", filter: { objectId: "u1" }, effect: { kind: "copy-object", source: source.ref } }, 2)
  ]);

  const snapshot = engine.evaluate(copy.ref);
  assert.deepEqual(snapshot.power, ["Chaos"]);
  assert.equal(snapshot.might, 2);
  assert.deepEqual(snapshot.keywords.map(keyword => keyword.id), ["shield"]);
});
