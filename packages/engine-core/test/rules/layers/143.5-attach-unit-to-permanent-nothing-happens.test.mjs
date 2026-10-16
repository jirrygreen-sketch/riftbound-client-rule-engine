// RIFT-277 golden test — scenario `layers-attach-unit-to-permanent-nothing-happens`（negative）
// 依据：CR v1.5 143.5 / 143.5.a / 435.1.h.1。单位不能被附着：效果结算空转，法术费用照付，
// #host 的“被附着”状态不变。真实执行 effect.attach 原语（含附着动作被拒绝的路径）。
import assert from "node:assert/strict";
import test from "node:test";
import { runInstruction, world } from "../../../dist/effects/testing/index.js";
import attach from "../../../dist/effects/instructions/effect.attach.js";

const literal = value => ({ kind: "constant", value });

test("layers-attach-unit-to-permanent-nothing-happens: attaching a unit resolves to nothing", () => {
  const battlefield = { type: "battlefield", id: "bf1" };
  const kernel = world().player("A", { energy: 3 })
    .unit("u1", { might: 2, location: battlefield })
    .unit("host", { might: 3, location: battlefield })
    .build();

  const run = runInstruction(attach, {
    objects: literal({ kind: "pick", id: "objects" }),
    host: literal({ kind: "pick", id: "host" })
  }, { world: kernel, picks: { objects: [kernel.ref("u1")], host: [kernel.ref("host")] } });

  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "impossible");
  // 附着结算为空转：附着计数 0，两个单位都留在原战场，也没有脱离。
  assert.equal(run.linked.attached.count, 0);
  assert.deepEqual(run.linked.attached.objects, []);
  assert.equal(kernel.getObject("u1").attachedTo, null);
  assert.equal(kernel.getObject("u1").zone, "board");
  assert.deepEqual(kernel.getObject("u1").location, battlefield);
  assert.equal(kernel.getObject("host").might, 3);
  assert.equal(kernel.getObject("host").attachedTo, null);
});
