// RIFT-277 golden test — scenario `layers-trait-layer-before-ability-layer`
// 依据：CR v1.5 479.2 / 479.2.b / 479.3。#u1 必须先在特征层取得 Yordle 标签，
// 能力层“Yordle 拥有 Vision”才对它适用。@u2/@u3 的“其他友方单位”写法以
// 全单位过滤器表达（图层过滤器没有排除锚点）；断言只落在 #u1。
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

test("layers-trait-layer-before-ability-layer: gaining the Yordle tag enables the Yordle-only ability", () => {
  const u1 = unit("u1", { might: 1 });
  const u2 = unit("u2", { might: 2 });
  const u3 = unit("u3", { might: 2 });
  const engine = createLayerEngine([u1, u2, u3], [
    permanent({ id: "yordle", layer: "trait", filter: {}, effect: { kind: "add-tag", tag: "yordle" } }, 1),
    permanent({ id: "vision", layer: "ability", filter: { tags: ["yordle"] }, effect: { kind: "grant-keyword", keyword: "vision" } }, 2)
  ]);

  const snapshot = engine.evaluate(u1.ref);
  assert.ok(snapshot.tags.includes("yordle"));
  assert.deepEqual(snapshot.keywords.map(keyword => keyword.id), ["vision"]);

  // 区分点：Vision 依赖特征层给出的标签；标签消失后能力层不再适用。
  engine.removeContinuous("yordle");
  const after = engine.evaluate(u1.ref);
  assert.deepEqual(after.tags, []);
  assert.deepEqual(after.keywords, []);
});
