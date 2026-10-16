// RIFT-277 golden test — scenario `layers-dependency-chain-evaluate-from-endpoint`
// 依据：CR v1.5 478.1.b。依赖链 #u3 → #u2 → #u1：从链末端开始算，逐层回溯。
// given 差异：#u1 的标签来源改为特征层直接赋予（YAML 用“当我 Mighty 时，我是 Yeti”）。
// Mighty 条件型特征效果在算术层之后不会被重查，见同批 `478.3-object-dependency-…` 的
// todo 与回复说明；链本身的求值顺序按 478.1.b 真实执行并断言。
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

test("layers-dependency-chain-evaluate-from-endpoint: a three-link dependency chain resolves from the far endpoint", () => {
  const u1 = object("u1", { might: 3, name: "u1" });
  const u2 = object("u2", { might: 2 });
  const u3 = object("u3", { might: 2 });
  let engine;
  engine = createLayerEngine([u1, u2, u3], [
    permanent({ id: "u1-tag", layer: "trait", filter: { objectId: "u1" }, effect: { kind: "add-tag", tag: "yordle" } }, 1),
    permanent({ id: "u2-tags", layer: "trait", filter: { objectId: "u2" }, effect: { kind: "set-tags", value: { kind: "object-property", object: u1.ref, property: "tags" } } }, 2),
    permanent({ id: "u3-vision", layer: "ability", filter: { objectId: "u3" }, effect: { kind: "grant-keyword", keyword: "vision", condition: () => engine.evaluate(u2.ref).tags.includes("yordle") } }, 3)
  ]);

  // 直接求值链末端 #u3：必须先算 #u1 的标签，再算 #u2，最后才是 #u3 的能力层。
  const u3Snapshot = engine.evaluate(u3.ref);
  assert.deepEqual(u3Snapshot.keywords.map(keyword => keyword.id), ["vision"]);
  assert.deepEqual(engine.evaluate(u2.ref).tags, ["yordle"]);
  assert.ok(engine.evaluate(u1.ref).tags.includes("yordle"));

  // 依赖链消失（末端标签被移除）后，能力层不再适用。
  engine.removeContinuous("u1-tag");
  assert.deepEqual(engine.evaluate(u2.ref).tags, []);
  assert.deepEqual(engine.evaluate(u3.ref).keywords, []);
});
