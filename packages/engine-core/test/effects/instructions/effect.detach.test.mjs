import test from "node:test";
import assert from "node:assert/strict";
import {
  AwaitChoice,
  runInstruction,
  world
} from "../../../src/effects/testing/index.ts";
import detach from "../../../src/effects/instructions/effect.detach.ts";

const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

function equipped(attached = ["gear"], hostId = "u1") {
  const builder = world().unit(hostId, { might: 3 });
  for (const gearId of attached) {
    builder.object(gearId, {
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: BATTLEFIELD,
      attachedTo: { id: hostId, zoneEntryId: 1 }
    });
  }
  return builder.build();
}

test("detach via picks detaches the chosen equipment and links results", () => {
  const kernel = equipped();
  const run = runInstruction(
    detach,
    { pick: "equipment" },
    { world: kernel, picks: { equipment: [kernel.ref("gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("gear").attachedTo, null);
  assert.equal(run.linked.detached, 1);
  assert.deepEqual(run.linked.detachedObjects, [{ id: "gear", zoneEntryId: 1 }]);
  // 436.2：detach 作为游戏动作被内核记录进 history。
  assert.equal(kernel.history({ action: "detach" }), 1);
});

test("replacement hook replacing the detach action negates the instruction", () => {
  const kernel = equipped();
  kernel.addReplacement(action => (action.type === "detach" ? "replaced" : null));
  const run = runInstruction(
    detach,
    { pick: "equipment" },
    { world: kernel, picks: { equipment: [kernel.ref("gear")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.getObject("gear").attachedTo.id, "u1");
  assert.equal(kernel.history({ action: "detach" }), 0);
});

test("ignored when every host target is stale (equipment already detached by Angle Shot)", () => {
  // CR-v1.5 359.3.e.12 示例：Strike Down 结算时宿主已没有装备，与其关联的指令被忽略。
  // 宿主在链形成后被对手 effect 回了手：旧引用随换区失效。
  const kernel = equipped();
  const staleHost = kernel.ref("u1");
  kernel.perform({ type: "return-to-hand", object: staleHost });
  const run = runInstruction(
    detach,
    { eachAttachedTo: "host" },
    { world: kernel, targets: { host: [staleHost] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test("pick of zero objects executes with detached = 0 (436.3 non-target choice)", () => {
  const kernel = equipped();
  const run = runInstruction(
    detach,
    { pick: "equipment" },
    { world: kernel, picks: { equipment: [] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.detached, 0);
  assert.deepEqual(run.linked.detachedObjects, []);
});

test("eachAttachedTo detaches more than one attachment from the host", () => {
  const kernel = equipped(["gear-a", "gear-b"]);
  const run = runInstruction(
    detach,
    { eachAttachedTo: "host" },
    { world: kernel, targets: { host: [kernel.ref("u1")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.detached, 2);
  assert.equal(kernel.getObject("gear-a").attachedTo, null);
  assert.equal(kernel.getObject("gear-b").attachedTo, null);
});

test("a surrounding choose suspends with AwaitChoice and replays with the answer", () => {
  // 包一层 choose 的指令（如 “you may detach it” 的可选确认），验证
  // effect.detach 能被重放式挂起包裹：无答案时挂起且世界不变，带答案重跑后生效。
  const maybeDetach = {
    op: "effect.detach",
    argsSchema: detach.argsSchema,
    execute(ctx, args) {
      ctx.choose({ id: "confirm", type: "optional", chooser: "A", visibility: "public" });
      return detach.execute(ctx, args);
    }
  };
  const kernel = equipped();
  const asked = runInstruction(
    maybeDetach,
    { pick: "equipment" },
    { world: kernel, picks: { equipment: [kernel.ref("gear")] } }
  );
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(kernel.getObject("gear").attachedTo.id, "u1");
  assert.equal(kernel.history({ action: "detach" }), 0);

  const answered = runInstruction(
    maybeDetach,
    { pick: "equipment" },
    { world: kernel, picks: { equipment: [kernel.ref("gear")] }, answers: { confirm: true } }
  );
  assert.equal(answered.result.status, "executed");
  assert.equal(kernel.getObject("gear").attachedTo, null);
});

test("sfd-107-221 Strike Down: detach one Equipment from the equipped unit", () => {
  // Strike Down：“Choose an equipped friendly unit. It deals damage equal to its
  // Might to an enemy unit. Then detach an Equipment from it.”
  // 结算到 detach 指令时，宿主已被选为目标，本指令以 pick 指定要脱离的装备。
  const kernel = equipped();
  const run = runInstruction(
    detach,
    { pick: "strike-down-equipment" },
    { world: kernel, picks: { "strike-down-equipment": [kernel.ref("gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.detached, 1);
  assert.equal(kernel.getObject("gear").attachedTo, null);
  assert.equal(kernel.getObject("u1").zone, "board");
});

test("sfd-221-221 Veiled Temple: detach a friendly Equipment gear after readying it", () => {
  // Veiled Temple：“When you conquer here, you may ready a friendly gear.
  // If it's an Equipment, you may detach it.”
  // detach 前导的 ready 由前一条指令完成；本指令只负责 detach，并记录历史。
  const kernel = world()
    .unit("u1")
    .object("gear", {
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: BATTLEFIELD,
      exhausted: true,
      attachedTo: { id: "u1", zoneEntryId: 1 }
    })
    .build();
  const gear = kernel.ref("gear");
  kernel.perform({ type: "ready", object: gear });
  const run = runInstruction(
    detach,
    { pick: "temple-gear" },
    { world: kernel, picks: { "temple-gear": [gear] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("gear").attachedTo, null);
  assert.equal(kernel.getObject("gear").exhausted, false);
  assert.equal(kernel.history({ action: "ready" }), 1);
  assert.equal(kernel.history({ action: "detach" }), 1);
});

test("sfd-011-221 Angle Shot: detach mode ignores a stale host target on resolution", () => {
  // Angle Shot：“Choose a unit and an Equipment with the same controller. Attach that
  // Equipment to that unit or detach that Equipment from that unit. Draw 1.”
  // CR-v1.5 359.3.e.12 的对偶场景：若宿主在结算时不再合法，detach 一侧的指令被
  // ignored，后续 “Draw 1” 依链接规则处理（本测试只验证 ignored）。
  const kernel = equipped();
  const staleHost = { id: "u1", zoneEntryId: 1 };
  kernel.perform({ type: "kill", object: kernel.ref("u1") });
  const run = runInstruction(
    detach,
    { eachAttachedTo: "angle-shot-unit" },
    { world: kernel, targets: { "angle-shot-unit": [staleHost] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("gear").attachedTo.id, "u1");
});

test("picking an unattached card negates with impossible (436.1.a.1)", () => {
  const kernel = equipped([]);
  const gear = kernel.ref("u1"); // u1 是单位、未附着；detach 它对内核是不可能的。
  const run = runInstruction(
    detach,
    { pick: "equipment" },
    { world: kernel, picks: { equipment: [gear] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("u1").attachedTo, null);
});
