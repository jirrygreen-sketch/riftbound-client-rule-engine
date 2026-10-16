// RIFT-277 golden test — scenario `layers-fiora-buff-then-recheck-ability`
// 依据：CR v1.5 478.3 / 478.4 / 479.3 / 479.4（docs/rules/scenarios/layers.yaml）。
// given：4 [M] 单位 + 本回合 +1 [M] 的 buff。#u1 的印刷文字“当我 Mighty 时，我拥有
// Deflect、Ganking、Shield”编码为能力层条件效果（condition 读当前 Might），加值编码为
// 算术层持续效果（法术已结算的结果；缺 continuous.might 原语，见 task 回复遗留项）。
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

test("layers-fiora-buff-then-recheck-ability: arithmetic buff lifts Might to 5 and the ability layer is re-checked", () => {
  const fiora = unit("u1", { might: 4 });
  const engine = createLayerEngine([fiora], [
    { effect: { id: "buff", layer: "arithmetic", filter: { objectId: "u1" }, effect: { kind: "increase", amount: 1 } }, duration: { type: "end-of-turn" } },
    permanent({ id: "deflect", layer: "ability", filter: { objectId: "u1" }, effect: { kind: "grant-keyword", keyword: "deflect", condition: mighty } }, 2),
    permanent({ id: "ganking", layer: "ability", filter: { objectId: "u1" }, effect: { kind: "grant-keyword", keyword: "ganking", condition: mighty } }, 3),
    permanent({ id: "shield", layer: "ability", filter: { objectId: "u1" }, effect: { kind: "grant-keyword", keyword: "shield", condition: mighty } }, 4)
  ]);

  const snapshot = engine.evaluate(fiora.ref);
  assert.equal(snapshot.might, 5);
  assert.deepEqual(snapshot.keywords.map(keyword => keyword.id), ["deflect", "ganking", "shield"]);
  // 478.3：算术层之后必须回头重查能力层；buff 到期后回到 4 [M] 且三个关键词同时消失。
  assert.deepEqual(engine.advance({ id: "turn-end" }), ["buff"]);
  const after = engine.evaluate(fiora.ref);
  assert.equal(after.might, 4);
  assert.deepEqual(after.keywords, []);
});
