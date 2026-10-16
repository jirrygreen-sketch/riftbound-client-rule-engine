// RIFT-277 golden test — scenario `layers-copy-of-copy-chains`
// 依据：CR v1.5 479.1.b / 479.1.b.1（LeBlanc / Mirror Image 例）。施加了复制效果后，
// 该对象的可复特征就是复制来的那套；第二个复制体读到的是第一个复制体“已复制的”特征，
// 所以三个对象同名、同 Might。
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

test("layers-copy-of-copy-chains: a copy of a copy reads the first copy's copied traits", () => {
  const source = object("src", { name: "Honest Broker", might: 3, isToken: false });
  const first = object("tok1", { name: "Reflection", might: 0, isToken: true });
  const second = object("tok2", { name: "Reflection", might: 0, isToken: true });
  const engine = createLayerEngine([source, first, second], [
    permanent({ id: "reflection", layer: "copy", filter: { objectId: "tok1" }, effect: { kind: "copy-object", source: source.ref } }, 1),
    permanent({ id: "mirror-image", layer: "copy", filter: { objectId: "tok2" }, effect: { kind: "copy-object", source: first.ref } }, 2)
  ]);

  const firstSnapshot = engine.evaluate(first.ref);
  assert.equal(firstSnapshot.name, "Honest Broker");
  assert.equal(firstSnapshot.might, 3);

  const secondSnapshot = engine.evaluate(second.ref);
  assert.equal(secondSnapshot.name, "Honest Broker");
  assert.equal(secondSnapshot.might, 3);

  // 复制体不是同一个对象：身份与是否衍生物保持各自的。
  assert.notDeepEqual(secondSnapshot.ref, source.ref);
  assert.equal(source.isToken, false);
  assert.equal(secondSnapshot.isToken, true);
});
