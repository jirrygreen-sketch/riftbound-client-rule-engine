// RIFT-277 golden test — scenario `layers-trait-layer-append-not-copied`（negative）
// 依据：CR v1.5 479.1.c / 479.2（Radiance patch notes：特征层追加的 Mech 标签不被复制）。
// 区分点：复制体身上的 Mech 只能来自 #u9 的特征层效果本身；#u9 的效果消失后两者同时失去。
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

test("layers-trait-layer-append-not-copied: trait-layer tags never propagate through a copy", () => {
  const source = object("src", { might: 3 });
  const copy = object("tok", { might: 0, isToken: true });
  const engine = createLayerEngine([source, copy], [
    permanent({ id: "hexplate", layer: "trait", filter: { types: ["unit"] }, effect: { kind: "add-tag", tag: "mech" } }, 1),
    permanent({ id: "copy", layer: "copy", filter: { objectId: "tok" }, effect: { kind: "copy-object", source: source.ref } }, 2)
  ]);

  // 两个 Mech 都来自特征层效果自身对“所有单位”的适用。
  assert.deepEqual(engine.evaluate(source.ref).tags, ["mech"]);
  assert.deepEqual(engine.evaluate(copy.ref).tags, ["mech"]);

  // 若实现错误地在复制时快照当前标签，复制体会在效果离场后仍保留 Mech。
  engine.removeContinuous("hexplate");
  assert.deepEqual(engine.evaluate(source.ref).tags, []);
  assert.deepEqual(engine.evaluate(copy.ref).tags, []);
});
