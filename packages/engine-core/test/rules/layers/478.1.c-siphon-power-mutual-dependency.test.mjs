// RIFT-277 golden test — scenario `layers-siphon-power-mutual-dependency`（edge）
// 依据：CR v1.5 478.1.c / 479.4.e。官方 Siphon Power 例：两个互相引用的 4 [M] 单位
// 各自 +1 / -1，环内逐层同时计算，双方最终都是 4 [M]；条件 +5 因不满足 Mighty 不适用。
// 断言只锚定官方终值（场景 notes 已标 UNCERTAIN），并额外断言结果与求值顺序无关。
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

function siphonWorld() {
  const a1 = object("a1", { might: 4 });
  const b1 = object("b1", { might: 4, owner: "B", controller: "B" });
  let engine;
  engine = createLayerEngine([a1, b1], [
    permanent({ id: "a1-buff", layer: "arithmetic", filter: { objectId: "a1" }, effect: { kind: "increase", amount: 1 } }, 1),
    permanent({ id: "b1-buff", layer: "arithmetic", filter: { objectId: "b1" }, effect: { kind: "increase", amount: 1 } }, 2),
    permanent({ id: "a1-siphon", layer: "arithmetic", filter: { objectId: "a1" }, effect: { kind: "decrease", amount: 1 } }, 3),
    permanent({ id: "b1-siphon", layer: "arithmetic", filter: { objectId: "b1" }, effect: { kind: "decrease", amount: 1 } }, 4),
    permanent({ id: "a1-mighty", layer: "arithmetic", filter: { objectId: "a1" }, effect: { kind: "increase", amount: 5, condition: () => (engine.evaluate(b1.ref).might ?? 0) >= 5 } }, 5),
    permanent({ id: "b1-mighty", layer: "arithmetic", filter: { objectId: "b1" }, effect: { kind: "increase", amount: 5, condition: () => (engine.evaluate(a1.ref).might ?? 0) >= 5 } }, 6)
  ]);
  return { engine, a1, b1 };
}

test("layers-siphon-power-mutual-dependency: mutually referencing units terminate at the official 4 [M] in either evaluation order", () => {
  for (const order of ["a-first", "b-first"]) {
    const { engine, a1, b1 } = siphonWorld();
    const first = order === "a-first" ? engine.evaluate(a1.ref) : engine.evaluate(b1.ref);
    const second = order === "a-first" ? engine.evaluate(b1.ref) : engine.evaluate(a1.ref);
    assert.equal(first.might, 4, `${order}: first evaluated unit stays at 4 Might`);
    assert.equal(second.might, 4, `${order}: second evaluated unit stays at 4 Might`);
    // 环内双方都没有 Mighty（4 < 5），条件 +5 不适用，重复求值不得漂移。
    assert.deepEqual(engine.evaluateAll().map(snapshot => snapshot.might).sort(), [4, 4]);
  }
});
