// RIFT-277 golden test — scenario `layers-unitized-gear-cannot-be-reattached`（negative）
// 依据：CR v1.5 143.5.a / 435.1.h.1（Orianna 例后半句）：装备仍是单位时，后续附着结算
// 空转；启动合法、费用照付、什么都不发生。真实执行 effect.attach 原语验证空转路径。
import assert from "node:assert/strict";
import test from "node:test";
import { createLayerEngine } from "../../../dist/layers/index.js";
import { runInstruction, world } from "../../../dist/effects/testing/index.js";
import attach from "../../../dist/effects/instructions/effect.attach.js";

const literal = value => ({ kind: "constant", value });
const permanent = (effect, timestamp) => ({ effect, duration: { type: "permanent" }, timestamp });
const object = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 }, cardId: `card:${id}`, name: id, types: ["unit"], tags: [], keywords: [],
  owner: "A", controller: "A", zone: "board", location: null, might: 2, energy: 1, power: ["Fury"],
  exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false,
  ...values
});

test("layers-unitized-gear-cannot-be-reattached: a gear that is currently a unit stays unattached after an attach resolves", () => {
  const host = object("u1", { might: 3 });
  const gear = object("g1", { types: ["gear"], might: null });
  const layers = createLayerEngine([host, gear], [
    permanent({ id: "unitize", layer: "trait", filter: { objectId: "g1" }, effect: { kind: "set-types", types: ["unit", "gear"] } }, 1)
  ]);
  assert.ok(layers.evaluate(gear.ref).types.includes("unit"));

  const kernel = world().player("A", { energy: 1 })
    .unit("u1", { might: 3 })
    .unit("g1", { types: ["unit", "gear"], might: 3, exhausted: false })
    .build();
  const run = runInstruction(attach, {
    objects: literal({ kind: "pick", id: "objects" }),
    host: literal({ kind: "pick", id: "host" })
  }, { world: kernel, picks: { objects: [kernel.ref("g1")], host: [kernel.ref("u1")] } });

  // 435.1.h.1：单位不能被附着，附着动作被内核拒绝，什么都不发生。
  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "impossible");
  assert.equal(kernel.getObject("g1").attachedTo, null);
  assert.equal(kernel.getObject("u1").attachedTo, null);
  // 附着计数为 0：启动合法、费用照付，但结算空转。
  assert.equal(run.linked.attached.count, 0);
});

// 场景尚未覆盖的另一半：Orianna 例要求“启动合法、费用照付、结算空转”的完整链路径。
// 缺什么：Equip 关键词展开（effects/keywords/Equip.ts）声明的 `cost.activated` equip 支付
// 与激活层对宿主 source/controller 的绑定都未合入，无法构造合法的激活入链；附着动作本身
// 空转这一层已由上面的真实执行测试覆盖。需要的机制：cost.activated/equip 支付 + 激活入链，
// 属 chain/cost 任务范围，不在本任务写入范围。
test.todo("layers-unitized-gear-cannot-be-reattached（启动路径）: 单位化装备启动 Equip 合法、付费、结算空转（缺：cost.activated 与激活入链）");
