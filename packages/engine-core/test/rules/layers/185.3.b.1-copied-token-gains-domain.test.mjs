// RIFT-277 golden test — scenario `layers-copied-token-gains-domain`
// 依据：CR v1.5 185.3.b.1 / 479.1.b。衍生物天生没有领域（power:null 表示无印刷领域），
// 复制层可以把被复制对象的领域追加给它。
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

test("layers-copied-token-gains-domain: a domainless token gains the copied domain", () => {
  const source = object("src", { might: 2, power: ["Fury"] });
  const token = object("tok", { might: 0, power: null, isToken: true });
  const engine = createLayerEngine([source, token], [
    permanent({ id: "copy-domain", layer: "copy", filter: { objectId: "tok" }, effect: { kind: "copy-object", source: source.ref, properties: ["power"] } }, 1)
  ]);

  const snapshot = engine.evaluate(token.ref);
  assert.deepEqual(snapshot.power, ["Fury"]);
  // 印刷领域仍是“无”，不是被改写成某个默认领域。
  assert.equal(snapshot.printed.power, null);
});
