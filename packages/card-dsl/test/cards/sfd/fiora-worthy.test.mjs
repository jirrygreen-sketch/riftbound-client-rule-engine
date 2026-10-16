import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/fiora-worthy.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const BODY_ID = "fiora-worthy.ready-source";

test("sfd-180-221 Fiora, Worthy: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(
    program.canonicalCardId,
    "card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f"
  );
  assert.equal(program.sourceText.includes("becomes [Mighty]"), true);
});

test("sfd-180-221 Fiora, Worthy: might-changed trigger filtered to friendly units becoming Mighty", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "might-changed");
  assert.deepEqual(ability.trigger.filter, {
    type: "unit",
    controller: "you",
    becomesMighty: true
  });
  // "you may pay :rb_rune_order:" → 可选触发；支付询问在 Finalize 进行。
  assert.equal(ability.optional, true);
});

test("sfd-180-221 Fiora, Worthy: body readies the trigger source unit", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, BODY_ID);
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("sfd-180-221 Fiora, Worthy: effect.ready body readies an exhausted unit via the reference kernel", () => {
  const kernel = world()
    .unit("mighty-unit", {
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 5,
      exhausted: true
    })
    .build();
  const unitRef = kernel.ref("mighty-unit");
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mighty-unit") });
  const run = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "source" } } },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 1);
  assert.equal(scoped.getObject("mighty-unit").exhausted, false);
  assert.equal(run.events[0].action, "ready");
});

test.todo(
  "sfd-180-221 Fiora, Worthy: \"becomes Mighty\" 的事件化（might-changed 时点的 " +
    "previousMight/currentMight → becomesMighty 过滤，CR 709）依赖触发管线与图层结算 " +
    "（RIFT-33 scenarios-triggers / RIFT-32 scenarios-layers）；:rb_rune_order: 符文费用 " +
    "的 Finalize 询问与支付依赖费用管线（RIFT-27 scenarios-costs）"
);
