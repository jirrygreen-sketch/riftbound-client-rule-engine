// RIFT-277 golden test — scenario `layers-buff-removal-drops-conditional-abilities`
// 依据：CR v1.5 478.4（第二个例子）。buff 与被它打开的能力是两件事：效果的移除/失格
// 仍然只施加一次；Buff 自身的 +1 已在算术层计算。移除 Buff 后，5 [M]
// 三关键词直接回到印刷值 4 [M] 无关键词。
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
const mighty = current => (current.might ?? 0) >= 5;

test("layers-buff-removal-drops-conditional-abilities: removing the buff recomputes every layer in one pass", () => {
  const fiora = unit("u1", { might: 4, buffs: 1 });
  const engine = createLayerEngine([fiora], [
    permanent({ id: "deflect", layer: "ability", filter: { objectId: "u1" }, effect: { kind: "grant-keyword", keyword: "deflect", condition: mighty } }, 2),
    permanent({ id: "ganking", layer: "ability", filter: { objectId: "u1" }, effect: { kind: "grant-keyword", keyword: "ganking", condition: mighty } }, 3),
    permanent({ id: "shield", layer: "ability", filter: { objectId: "u1" }, effect: { kind: "grant-keyword", keyword: "shield", condition: mighty } }, 4)
  ]);

  const buffed = engine.evaluate(fiora.ref);
  assert.equal(buffed.might, 5);
  assert.deepEqual(buffed.keywords.map(keyword => keyword.id), ["deflect", "ganking", "shield"]);

  engine.setObjects([{ ...fiora, buffs: 0 }]);
  const dispelled = engine.evaluate(fiora.ref);
  assert.equal(dispelled.might, 4);
  assert.deepEqual(dispelled.keywords, []);
});
