// RIFT-277 golden test — scenario `layers-arithmetic-passive-set-to-five-not-snapshotted`
// 依据：CR v1.5 479.4.b（被动能力的算术效果不快照，随参照值持续浮动）。
// given 差异：“升至 5 [M]”以被动层效果编码为“Might < 5 时 +（5 - 当前值）”，
// 因此每次求值都按当前参照值重算；6 [M] 时贡献 +0，随后 +2 得 8，与官方一致。
import assert from "node:assert/strict";
import test from "node:test";
import { createLayerEngine } from "../../../dist/layers/index.js";

const literal = value => ({ kind: "constant", value });
const permanent = (effect, timestamp) => ({ effect, duration: { type: "permanent" }, timestamp });
const object = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 }, cardId: `card:${id}`, name: id, types: ["unit"], tags: [], keywords: [],
  owner: "A", controller: "A", zone: "board", location: null, might: 2, energy: 1, power: ["Fury"],
  exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  ...values
});
const riseToFive = ref => permanent({
  id: "aura", layer: "arithmetic", filter: { objectId: ref.id },
  effect: {
    kind: "increase",
    condition: current => (current.might ?? 0) < 5,
    amount: { kind: "subtract", left: literal(5), right: { kind: "object-property", object: ref, property: "might" } }
  }
}, 1);

test("layers-arithmetic-passive-set-to-five-not-snapshotted: the passive is recomputed for every reference value", () => {
  const target = object("u1", { might: 6 });
  const engine = createLayerEngine([target], [
    riseToFive(target.ref),
    permanent({ id: "disc", layer: "arithmetic", filter: { objectId: "u1" }, effect: { kind: "increase", amount: 2 } }, 2)
  ]);

  // 6 [M]：被动先施加但贡献 +0，后到的 +2 生效 → 8。
  assert.equal(engine.evaluate(target.ref).might, 8);

  // 不快照：参照值降到 3 后被动按新值贡献 +2，而不是锁在旧修正量（+0）上。
  engine.setObjects([object("u1", { might: 3 })]);
  assert.equal(engine.evaluate(target.ref).might, 7);
  engine.removeContinuous("disc");
  assert.equal(engine.evaluate(target.ref).might, 5);
  engine.setObjects([object("u1", { might: 6 })]);
  assert.equal(engine.evaluate(target.ref).might, 6);
});
