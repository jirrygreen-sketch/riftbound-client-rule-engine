import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/firebrand-raider.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ENTER_READY = "firebrand-raider.enter-ready";
const READY_ENEMIES = "firebrand-raider.ready-enemy-units";
const OTHERS_ENTER_READY = "firebrand-raider.others-enter-ready";

test("rad-019-167 Firebrand Raider: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-f4847d9fdb97d7ccf7a9d4a296e64e63e5d8c219daa10d1016d79ae12591dc77"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\n" +
      "Units don't ready during the Awaken Phase."
  );
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /continuous\.restrict/);
});

test("rad-019-167: enter-ready replacements, ready-all-enemies trigger and Awaken restriction", () => {
  assert.equal(program.abilities.length, 4);
  const [selfReady, trigger, othersReady, restriction] = program.abilities;

  assert.equal(selfReady.kind, "replacement");
  assert.deepEqual(selfReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(selfReady.with[0].id, ENTER_READY);
  assert.equal(selfReady.with[0].op, "effect.ready");

  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.trigger.at, "card-played");
  assert.deepEqual(trigger.trigger.filter, { self: true });
  assert.equal(trigger.optional, false);
  assert.equal(trigger.body.length, 1);
  const [readyInstruction] = trigger.body;
  assert.equal(readyInstruction.id, READY_ENEMIES);
  assert.equal(readyInstruction.op, "effect.ready");
  // “all enemy units” = 非目标集合（355.10.d），不是 TargetSpec。
  assert.equal(readyInstruction.targets, undefined);
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { zone: "board", type: "unit", controller: "opponent" }
    }
  });

  assert.equal(othersReady.kind, "replacement");
  assert.deepEqual(othersReady.replaces, {
    event: "object-enters-board",
    filter: { type: "unit", other: true, exhausted: true }
  });
  assert.equal(othersReady.with[0].id, OTHERS_ENTER_READY);

  assert.equal(restriction.kind, "static");
  assert.equal(restriction.effect.kind, "continuous.restrict");
  assert.equal(restriction.effect.mode, "prevent");
  assert.equal(restriction.effect.event, "ready");
  assert.equal(restriction.effect.during, "awaken-phase");
  assert.deepEqual(restriction.effect.filter, { zone: "board", type: "unit" });
});

test("rad-019-167: the enter-ready replacement body readies the exhausted source", () => {
  const kernel = world().unit("firebrand-raider", { might: 6, exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("firebrand-raider") });
  const outcome = runAbilityBody(program.abilities[0].with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("firebrand-raider").exhausted, false);
});

test("rad-019-167: 'ready all enemy units' readies only opponents' units", () => {
  // 生产链上下文会把 controller: "opponent" 归一化（chain/engine.ts 的 query 覆盖）；
  // 这里用同一归一化规则的宿主验证指令语义，不手改 frame/zone/health。
  const kernel = world()
    .unit("enemy", { owner: "B", exhausted: true })
    .unit("mine", { exhausted: true })
    .player("B")
    .build();
  const raw = kernel.query.bind(kernel);
  kernel.query = filter => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" || normalized[key] === "self") delete normalized[key];
    }
    const objects = raw(normalized);
    if (filter.controller === "opponent") return objects.filter(object => object.controller !== kernel.controller);
    if (filter.controller === "self") return objects.filter(object => object.controller === kernel.controller);
    return objects;
  };

  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy").exhausted, false);
  assert.equal(kernel.getObject("mine").exhausted, true);
  const link = outcome.linkedValues[`${READY_ENEMIES}.readied`];
  assert.equal(link.count, 1);
  assert.deepEqual(link.objects, [{ id: "enemy", zoneEntryId: 1 }]);
});

test.todo(
  "rad-019-167 Firebrand Raider: “I enter ready.” / “Other units enter ready.” 的入场替代" +
    "（143.4 + 369.3；365.1）依赖 replacement.enter 管线（RIFT-83/RIFT-84）"
);
test.todo(
  "rad-019-167 Firebrand Raider: “Units don't ready during the Awaken Phase.” 需要" +
    "continuous.restrict 的图层/阶段接线（315.1.b 的常规重置；RIFT-91 与回合阶段）"
);
