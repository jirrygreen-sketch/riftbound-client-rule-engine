import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mordekaiser-dominating.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-e9fc2b80d00083fe6d3d05f817392c9995133d2b989fa879251804de73b2df15";
const TARGET_ID = "mordekaiser-dominating.unit-or-gear";

const abilities = () => program.abilities;

test("rad-137-167 Mordekaiser, Dominating: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("383.3.b"), true);
  assert.equal(program.judgeReason.includes("triggered 能力没有 cost 字段"), true);
  assert.equal(program.sourceText, "When you play me or when I attack, you may discard 1 to kill a unit or gear.");
});

test("rad-137-167 Mordekaiser, Dominating: 打出/攻击两个可选触发，本体是 kill unit or gear", () => {
  assert.equal(program.abilities.length, 2);
  const [onPlay, onAttack] = abilities();

  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, { self: true });
  // 383.3.a："you may" 是效果第一段 → Finalize 时决定是否执行该触发能力。
  assert.equal(onPlay.optional, true);

  assert.equal(onAttack.kind, "triggered");
  assert.equal(onAttack.trigger.at, "attack-declared");
  assert.deepEqual(onAttack.trigger.filter, { self: true });
  assert.equal(onAttack.optional, true);

  for (const [label, ability, id] of [
    ["play", onPlay, "mordekaiser-dominating.kill-on-play"],
    ["attack", onAttack, "mordekaiser-dominating.kill-on-attack"]
  ]) {
    assert.equal(ability.body.length, 1, label);
    const instruction = ability.body[0];
    assert.equal(instruction.id, id);
    assert.equal(instruction.op, "effect.kill");
    assert.deepEqual(instruction.args.target, { kind: "constant", value: TARGET_ID });
    assert.equal(instruction.targets.length, 1);
    assert.deepEqual(instruction.targets[0].filter, { type: ["unit", "gear"], zone: "board" });
    assert.equal(instruction.targets[0].min, 1);
    assert.equal(instruction.targets[0].max, 1);
    assert.equal(instruction.targets[0].selection, "one");
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.picks, undefined);
  }
});

test("rad-137-167 Mordekaiser, Dominating: 383.3.b 的 \"discard 1\" 是 Finalize 基础费用，未被降级为结算效果", () => {
  // 效果侧只声明 kill；"discard 1" 不是 body 指令。把它写成 body 首条 effect.discard
  // 会把 383.3.b/204.1.c 的 Finalize 费用降级为结算效果（355.10.c.1 要求代价先行），
  // 因此本程序在缺少 triggered.cost 字段的情况下不写入该指令。
  for (const ability of abilities()) {
    assert.equal(ability.body.some(instruction => instruction.op === "effect.discard"), false);
  }
});

test("rad-137-167 Mordekaiser, Dominating: effect.kill 对锁定的装备目标真实执行", () => {
  const kernel = world()
    .unit("mordekaiser", { location: { type: "battlefield", id: "battlefield-1" }, might: 8 })
    .unit("enemy-gear", { types: ["gear"], location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const gearRef = kernel.ref("enemy-gear");
  const instruction = abilities()[0].body[0];
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { [TARGET_ID]: [gearRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [gearRef]);
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("rad-137-167 Mordekaiser, Dominating: effect.kill 对锁定的单位目标真实执行", () => {
  const kernel = world().unit("mordekaiser", {}).unit("enemy-unit", {}).build();
  const unitRef = kernel.ref("enemy-unit");
  const instruction = abilities()[1].body[0];
  const run = runInstruction(
    kill,
    { target: instruction.args.target.value },
    { world: kernel, targets: { [TARGET_ID]: [unitRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
  assert.equal(kernel.getObject("mordekaiser").zone, "board");
});

test("rad-137-167 Mordekaiser, Dominating: 可选节点拒绝时跳过 kill（383.3.a 的 Finalize 决定）", () => {
  const body = (id) => [
    {
      id,
      op: "choice.optional",
      args: {
        prompt: { kind: "constant", value: "Discard 1 to kill a unit or gear?" },
        body: { kind: "constant", value: abilities()[0].body }
      }
    }
  ];
  const kernel = world().unit("mordekaiser", {}).unit("enemy-unit", {}).build();
  kernel.setAnswers({ "mordekaiser.may-kill/optional": false });
  const outcome = runAbilityBody(body("mordekaiser.may-kill"), kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.getObject("enemy-unit").zone, "board");
});

test("rad-137-167 Mordekaiser, Dominating: 可选节点接受时按声明执行 kill 效果", () => {
  const kernel = world().unit("mordekaiser", {}).unit("enemy-gear", { types: ["gear"] }).build();
  const gearRef = kernel.ref("enemy-gear");
  kernel.setTargets(TARGET_ID, [gearRef]);
  kernel.setAnswers({ "mordekaiser.may-kill/optional": true });
  // 参考测试内核的 query 不匹配数组 type（`type: ["unit","gear"]`），也不解析生产链的
  // 占位符；按已合入先例去掉指令上的 TargetSpec，把 Finalize 锁定的目标直接交给内核，
  // 指令 args 里的 { target: <spec> } 选择器保持程序里的声明。
  const prelocked = abilities()[0].body.map(({ targets, ...rest }) => rest);
  const outcome = runAbilityBody(
    [
      {
        id: "mordekaiser.may-kill",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Discard 1 to kill a unit or gear?" },
          body: { kind: "constant", value: prelocked }
        }
      }
    ],
    kernel
  );
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.deepEqual(kernel.events.map(event => event.action), ["kill"]);
});

test("rad-137-167 Mordekaiser, Dominating: \"discard 1\" 的弃牌本体在参考内核下真实可用（未来作为 Finalize 费用）", () => {
  // 该执行证据只覆盖 effect.discard 动作本身（423.1/423.3 的弃牌），用于说明"discard 1"
  // 所需的原语已存在；它不证明 383.3.b 的 Finalize 基础费用已接线（见 test.todo）。
  const kernel = world().unit("mordekaiser", {}).hand("hand-card").build();
  const run = runInstruction(
    discard,
    {
      amount: { kind: "constant", value: 1 },
      player: { kind: "object-property", object: kernel.ref("mordekaiser"), property: "controller" }
    },
    { world: kernel, answers: { "effect.discard:A": [kernel.ref("hand-card")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.zone("A", "hand").length, 0);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["hand-card"]);
  assert.equal(run.linked.discarded.count, 1);
});

test.todo(
  "rad-137-167 Mordekaiser, Dominating: 383.3.b/204.1.c 的\"指令内费用作为触发能力基础费用\"——契约 3.1 的" +
    "triggered 能力没有 cost 字段，cost.discard 也未合入（RIFT-89 的 cost.* 一族），卡牌程序无法声明该" +
    "Finalize 费用；写入 body 会把费用降级为结算效果（355.10.c.1），属语义偏离"
);

test.todo(
  "rad-137-167 Mordekaiser, Dominating: 打出/攻击触发的注册（card-played / attack-declared → CardProgram 的" +
    "triggered 能力）需要事件管线接线（批 4）"
);
