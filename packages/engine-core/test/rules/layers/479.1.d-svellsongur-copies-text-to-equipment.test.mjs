// RIFT-277 golden test — scenario `layers-svellsongur-copies-text-to-equipment`
// 依据：CR v1.5 479.1.d。带 “copy” 字样的效果归复制层，即使它写在装备上、
// 抄写的是规则文本。装备的 effectText 变为所附着单位的文本，脱落后回到自己的文本。
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

test("layers-svellsongur-copies-text-to-equipment: copy-text is applied in the copy layer while attached", () => {
  const host = object("u1", { might: 3, text: "当我攻击时，抽 1 张牌" });
  const gear = object("g1", { types: ["gear"], might: null, attachedTo: host.ref, text: "我自己的装备文本" });
  const engine = createLayerEngine([host, gear], [
    { effect: { id: "svellsongur", layer: "copy", filter: { objectId: "g1" }, effect: { kind: "copy-text", source: host.ref } }, duration: { type: "while-source-in-zone", source: gear.ref } }
  ]);

  const snapshot = engine.evaluate(gear.ref);
  assert.equal(snapshot.text, "当我攻击时，抽 1 张牌");
  assert.equal(snapshot.effectText, "当我攻击时，抽 1 张牌");

  // 479.1.d + 718.2：只在本装备仍附着于该单位时抄写；效果移除后恢复自己的文本。
  engine.removeContinuous("svellsongur");
  assert.equal(engine.evaluate(gear.ref).text, "我自己的装备文本");
});
