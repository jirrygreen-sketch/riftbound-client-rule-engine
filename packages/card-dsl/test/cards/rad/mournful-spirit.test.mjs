import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mournful-spirit.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-32901e49217e3463bf29df57238a9370865527412373a7daa3ca361f82eb7a09";
const TARGET_ID = "mournful-spirit.unit-or-gear-here";

test("rad-126-167 Mournful Spirit: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("808.1.d.3"), true);
  assert.equal(program.sourceText, "[Deathknell][>] You may kill a unit or gear here. (When I die, get the effect.)");
});

test("rad-126-167 Mournful Spirit: Deathknell keyword + 383.3.a optional object-killed trigger", () => {
  assert.equal(program.abilities.length, 2);
  const [deathknell, triggered] = program.abilities;
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  // 383.3.a："you may" 是效果第一段 → 在 Finalize 决定是否执行该触发能力。
  assert.equal(triggered.optional, true);

  assert.equal(triggered.body.length, 1);
  const instruction = triggered.body[0];
  assert.equal(instruction.id, "mournful-spirit.kill-unit-or-gear");
  assert.equal(instruction.op, "effect.kill");
  // 355.10.c/204.3：此处是效果（不是费用）→ "a unit or gear" 用 TargetSpec。
  assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
  assert.equal(instruction.targets.length, 1);
  const [spec] = instruction.targets;
  assert.equal(spec.id, TARGET_ID);
  assert.deepEqual(spec.filter, { type: ["unit", "gear"], zone: "board", sameLocationAs: "self" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-126-167 Mournful Spirit: effect.kill 对锁定的装备目标真实执行", () => {
  const kernel = world()
    .unit("mournful-spirit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("here-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-1" } })
    .unit("far-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const gearRef = kernel.ref("here-gear");
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { [TARGET_ID]: [gearRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [gearRef]);
  assert.equal(kernel.getObject("here-gear").zone, "trash");
  // 同在场的另一个战场上的装备不受影响（"here" 限制由目标系统在 Finalize 施加）。
  assert.equal(kernel.getObject("far-gear").zone, "board");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("rad-126-167 Mournful Spirit: 目标在结算前离区 → 指令 ignored（359.3.e.5–e.8）", () => {
  const kernel = world()
    .unit("mournful-spirit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("here-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("here-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    kill,
    { target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.events.filter(event => event.action === "kill").length, 1);
});

test("rad-126-167 Mournful Spirit: 声明形状下 effect.kill 走真实 kill 动作并写链接值", () => {
  const kernel = world()
    .unit("mournful-spirit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("here-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const unitRef = kernel.ref("here-unit");
  const instruction = program.abilities[1].body[0];
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { [TARGET_ID]: [unitRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [unitRef]);
  assert.equal(kernel.getObject("here-unit").zone, "trash");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
  assert.equal(run.events[0].timingPoint, "main-start");
});

test("rad-126-167 Mournful Spirit: 429.2.a —— 只有 Board 上的对象能被消灭", () => {
  const kernel = world()
    .unit("mournful-spirit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("here-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const gearRef = kernel.ref("here-gear");
  // 先把装备移出 Board（战斗单位不可附着，这里用区域移动模拟"已不在场"）。
  kernel.perform({ type: "move-zone", object: gearRef, to: "hand" });
  const run = runInstruction(
    kill,
    { target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [gearRef] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("here-gear").zone, "hand");
});

test.todo(
  "rad-126-167 Mournful Spirit: 用解释器按声明的 TargetSpec（type: [\"unit\", \"gear\"]）重选目标尚无" +
    "执行证据：参考测试内核的 matchesFilter 只用 String(expected) 做精确比较，不匹配数组类型" +
    "（生产侧的 layers/filter.matchesObjectFilter 支持数组），因此这里只用 runInstruction 锁定" +
    "目标验证 kill 本体；整卡的 Finalize 目标选择仍待生产目标系统"
);

test.todo(
  "rad-126-167 Mournful Spirit: 808.1.d.1（死亡被替代时触发移出链）/808.1.d.2（换区前作为 Pending Item" +
    "入链）/808.1.d.3（记录最后已知位置以解析 \"here\"）需要 events/chain 侧消费卡牌程序的触发能力" +
    "（依赖 RIFT-82 关键词批次与批 4 的触发管线接线）"
);
