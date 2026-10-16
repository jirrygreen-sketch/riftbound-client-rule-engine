// RIFT-277 golden test — scenario `layers-cost-references-printed-or-copied-cost`
// 依据：CR v1.5 206 / 479.1.b.1。费用参照永远用印刷（或复制后的）费用：8 费的法术
// 减 5 后实付 3，但 plan.printed 仍是 8；复制层追加的费用同样进入印刷参照。
// given 差异：Lux 的“打出费用 ≥5 的法术时 +3 [M]”触发属于卡牌程序/触发接线，
// 本文件只钉住费用参照本身（见回复）。
import assert from "node:assert/strict";
import test from "node:test";
import { createLayerEngine } from "../../../dist/layers/index.js";
import { world } from "../../../dist/effects/testing/index.js";
import { buildCostPlan } from "../../../dist/cost/cost-plan.js";
import { payCostPlan } from "../../../dist/cost/payment.js";

const literal = value => ({ kind: "constant", value });
const permanent = (effect, timestamp) => ({ effect, duration: { type: "permanent" }, timestamp });
const object = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 }, cardId: `card:${id}`, name: id, types: ["unit"], tags: [], keywords: [],
  owner: "A", controller: "A", zone: "board", location: null, might: 2, energy: 1, power: ["Fury"],
  exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  ...values
});

test("layers-cost-references-printed-or-copied-cost: cost references read printed values, never the discounted or buffed total", () => {
  // 206 官方例：印刷 8 的能量费，减 5（最低 1）后实付 3。
  const kernel = world().player("A", { energy: 6 })
    .unit("lux", { might: 5, power: [], energy: null })
    .hand("sky", { types: ["spell"], energy: 8, power: [], owner: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("sky")) });
  const plan = buildCostPlan(context, {
    id: "play:sky",
    cost: { kind: "printed" },
    discounts: [{ id: "sky-splitter", resource: "energy", amount: { kind: "object-property", object: kernel.ref("lux"), property: "might" }, minimum: literal(1) }]
  });
  assert.equal(plan.printed.energy, 8);
  assert.equal(plan.total.energy, 3);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(context.player("A").energy, 3);

  // 479.1.b.1：复制层追加的费用属于“复制后的”可复特征，费用参照拿到的就是它。
  const source = object("src", { might: 3, energy: 4, power: null });
  const token = object("tok", { might: 0, energy: null, power: null, isToken: true });
  const layers = createLayerEngine([source, token], [
    permanent({ id: "reflection", layer: "copy", filter: { objectId: "tok" }, effect: { kind: "copy-object", source: source.ref, properties: ["energy"] } }, 1)
  ]);
  const copied = layers.evaluate(token.ref);
  const tokenKernel = world().player("A", { energy: 6 }).build();
  const tokenContext = tokenKernel.clone({ sourceSnapshot: copied });
  const tokenPlan = buildCostPlan(tokenContext, { id: "play:tok", cost: { kind: "printed" } });
  assert.equal(copied.printed.energy, null);
  assert.equal(tokenPlan.printed.energy, 4);
  assert.equal(tokenPlan.total.energy, 4);
});
