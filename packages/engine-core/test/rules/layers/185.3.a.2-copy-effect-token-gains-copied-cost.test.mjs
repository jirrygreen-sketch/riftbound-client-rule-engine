// RIFT-277 golden test — scenario `layers-copy-effect-token-gains-copied-cost`
// 依据：CR v1.5 185.3.a.2 / 479.1.b。衍生物天生没有费用（energy:null 表示无印刷费，
// 不是 0），复制层把被复制对象的费用追加给它；追加后 cost plan 读到的就是 4。
// 规格差异：ObjectSnapshot 没有单独的 `cost` 字段，印刷费用即 energy + power，见回复。
import assert from "node:assert/strict";
import test from "node:test";
import { createLayerEngine } from "../../../dist/layers/index.js";
import { world } from "../../../dist/effects/testing/index.js";
import { buildCostPlan } from "../../../dist/cost/cost-plan.js";
import { payCostPlan } from "../../../dist/cost/payment.js";

const permanent = (effect, timestamp) => ({ effect, duration: { type: "permanent" }, timestamp });
const object = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 }, cardId: `card:${id}`, name: id, types: ["unit"], tags: [], keywords: [],
  owner: "A", controller: "A", zone: "board", location: null, might: 2, energy: 1, power: ["Fury"],
  exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  ...values
});

test("layers-copy-effect-token-gains-copied-cost: the copy layer appends the copied cost to a costless token", () => {
  const source = object("src", { might: 3, energy: 4, power: null });
  const token = object("tok", { might: 0, energy: null, power: null, isToken: true });
  const engine = createLayerEngine([source, token], [
    permanent({ id: "reflection", layer: "copy", filter: { objectId: "tok" }, effect: { kind: "copy-object", source: source.ref, properties: ["energy"] } }, 1)
  ]);

  const snapshot = engine.evaluate(token.ref);
  // 185.3.a：衍生物天生没有费用；印刷值保持 null，不被改写成 0。
  assert.equal(snapshot.printed.energy, null);
  assert.equal(snapshot.energy, 4);

  // 479.1.b 的效果对费用参照同样生效：Finalize 按追加后的 4 收费。
  const kernel = world().player("A", { energy: 6 }).build();
  const context = kernel.clone({ sourceSnapshot: snapshot });
  const plan = buildCostPlan(context, { id: "play:tok", cost: { kind: "printed" } });
  assert.equal(plan.total.energy, 4);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(context.player("A").energy, 2);
});
