// RIFT-277 golden test — scenario `layers-copy-game-action-object-has-copied-traits-as-printed`
// 依据：CR v1.5 446.3 / 479.1.b.1。作为复制被创造的对象以被复制特征为自己的印刷特征，
// 不经复制层，也不因为“复制效果被移除”而还原（它根本没有复制效果）。
// 真实执行：effect.copy create 原语通过 effects/testing 参考内核提交 copy 游戏动作。
import assert from "node:assert/strict";
import test from "node:test";
import { createCopiedObjectSnapshot } from "../../../dist/layers/index.js";
import { runInstruction, world } from "../../../dist/effects/testing/index.js";
import copy from "../../../dist/effects/instructions/effect.copy.js";

const literal = value => ({ kind: "constant", value });

test("layers-copy-game-action-object-has-copied-traits-as-printed: the copy game action materializes copied traits without a copy effect", () => {
  const battlefield = { type: "battlefield", id: "bf1" };
  const kernel = world().player("A", { energy: 2 })
    .unit("src", { might: 4, energy: 3, power: ["Fury"], location: battlefield })
    .build();

  const run = runInstruction(copy, {
    source: literal({ pick: "source" }),
    location: literal(battlefield)
  }, { world: kernel, picks: { source: [kernel.ref("src")] } });

  assert.equal(run.result?.status, "executed");
  const created = run.linked.copied.objects[0];
  const snapshot = kernel.getObject(created.id);
  assert.equal(snapshot.might, 4);
  assert.equal(snapshot.energy, 3);
  assert.deepEqual(snapshot.power, ["Fury"]);
  assert.equal(snapshot.name, "src");
  assert.equal(snapshot.isToken, true);
  // 446.3：复制生成物不带活动复制效果，因此没有登记任何持续效果。
  assert.deepEqual(kernel.continuousEffects, []);

  // 479.1.b.1：这些被复制特征就是它自己的印刷特征。
  const materialized = createCopiedObjectSnapshot(kernel.getObject("src"), { ref: created, owner: "A" });
  assert.equal(materialized.printed.might, 4);
  assert.equal(materialized.printed.cardId, "card:src");
  assert.equal(materialized.might, 4);
});
