// RIFT-277 golden test — scenario `layers-copy-granted-ability-not-carried`（negative）
// 依据：CR v1.5 479.1.b.1 / 479.1.c / 479.3。能力层追加的 Shield 不属于可复特征；
// 复制体的 Shield 只能来自 #aura 对“其他友方单位”的再次适用。#aura 离场后两者同时失去。
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

test("layers-copy-granted-ability-not-carried: keywords granted in the ability layer are not part of the copyable traits", () => {
  const source = object("src", { might: 2 });
  const copy = object("tok", { might: 0, isToken: true });
  // 图层过滤器没有“排除某对象”锚点，#aura 的“其他友方单位”按其自身效果范围建模。
  const engine = createLayerEngine([source, copy], [
    permanent({ id: "aura", layer: "ability", filter: { types: ["unit"] }, effect: { kind: "grant-keyword", keyword: "shield" } }, 1),
    permanent({ id: "copy", layer: "copy", filter: { objectId: "tok" }, effect: { kind: "copy-object", source: source.ref } }, 2)
  ]);

  assert.deepEqual(engine.evaluate(source.ref).keywords.map(keyword => keyword.id), ["shield"]);
  assert.deepEqual(engine.evaluate(copy.ref).keywords.map(keyword => keyword.id), ["shield"]);

  // 区分点：#aura 离场后两者应同时失去 Shield；若 Shield 是复制来的，复制体会保留。
  engine.removeContinuous("aura");
  assert.deepEqual(engine.evaluate(source.ref).keywords, []);
  assert.deepEqual(engine.evaluate(copy.ref).keywords, []);
});
