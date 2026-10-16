// RIFT-277 golden test — scenario `layers-copyable-traits-ignore-arithmetic-buffs`（negative）
// 依据：CR v1.5 479.1.b.1 / 479.1.c。可复特征与实际特征是两套：#src 当前 5 [M]
// （2 印刷 + 3 buff），复制层只能拿到印刷的 2；复制效果在复制层取数，不看算术层结果。
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

test("layers-copyable-traits-ignore-arithmetic-buffs: the copy layer reads printed values, never current arithmetic values", () => {
  const source = object("src", { might: 2, energy: 3 });
  const copy = object("tok", { might: 0, energy: null, isToken: true });
  const engine = createLayerEngine([source, copy], [
    { effect: { id: "buff", layer: "arithmetic", filter: { objectId: "src" }, effect: { kind: "increase", amount: 3 } }, duration: { type: "end-of-turn" } },
    permanent({ id: "copy", layer: "copy", filter: { objectId: "tok" }, effect: { kind: "copy-object", source: source.ref } }, 2)
  ]);

  assert.equal(engine.evaluate(source.ref).might, 5);
  assert.equal(engine.evaluate(copy.ref).might, 2);

  // 479.1.c：复制体自身仍可被算术层修改，两者的实际值是独立的。
  engine.addContinuous({ id: "copy-buff", layer: "arithmetic", filter: { objectId: "tok" }, effect: { kind: "increase", amount: 1 } }, { type: "end-of-turn" });
  assert.equal(engine.evaluate(copy.ref).might, 3);
  assert.equal(engine.evaluate(source.ref).might, 5);
});
