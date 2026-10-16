import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/dockside-lock-up.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-165ba67b417b4ce0d002e23f14e303dcf239f2e29ae79669b7f663ffb9cfba17";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const BANISH_TARGET = "dockside-lock-up.unit-here";
const BANISHED_PICK = "dockside-lock-up.banished-card";

const playTrigger = () => program.abilities[1];
const holdTrigger = () => program.abilities[2];

test("rad-136-167 Dockside Lock-Up: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("Deploy"), true);
  assert.equal(program.judgeReason.includes("428.3"), true);
  assert.equal(
    program.sourceText,
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
      "When you play this, banish a unit here.\n" +
      "When you hold here, kill this to play the banished card, ignoring its cost. (Tokens aren't cards.)"
  );
});

test("rad-136-167 Dockside Lock-Up: [Deploy] + 打出放逐 + 固守杀死并打出被放逐牌", () => {
  assert.equal(program.abilities.length, 3);
  const [deploy, onPlay, onHold] = program.abilities;
  // 830 关键词只声明；展开由 effects/keywords/Deploy.ts 负责（不存在）。
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // "When you play this, banish a unit here."
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, { self: true });
  assert.equal(onPlay.optional, false);
  assert.equal(onPlay.body.length, 1);
  const banishInstruction = onPlay.body[0];
  assert.equal(banishInstruction.id, "dockside-lock-up.banish-unit-here");
  assert.equal(banishInstruction.op, "effect.banish");
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { target: BANISH_TARGET }
  });
  // 428.3：被放逐牌由同一对象引用；持久链接值未合入，此处是命名占位。
  assert.deepEqual(banishInstruction.args.linkKey, {
    kind: "constant",
    value: "dockside-lock-up.banishedCard"
  });
  assert.equal(banishInstruction.targets.length, 1);
  assert.deepEqual(banishInstruction.targets[0].filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(banishInstruction.targets[0].min, 1);
  assert.equal(banishInstruction.targets[0].max, 1);
  assert.equal(banishInstruction.targets[0].selection, "one");

  // "When you hold here, kill this to play the banished card, ignoring its cost."
  assert.equal(onHold.kind, "triggered");
  assert.equal(onHold.trigger.at, "hold");
  assert.deepEqual(onHold.trigger.filter, { self: true });
  assert.equal(onHold.optional, false);
  assert.deepEqual(onHold.body.map(instruction => instruction.id), [
    "dockside-lock-up.kill-this",
    "dockside-lock-up.play-banished-card"
  ]);

  const [killThis, playBanished] = onHold.body;
  // 204.3/429.6："[do X] to [do Y]" 里的 X 是 kill this（费用侧的消灭动作）。
  assert.equal(killThis.op, "effect.kill");
  assert.deepEqual(killThis.args, { self: { kind: "constant", value: true } });
  assert.equal(killThis.targets, undefined);

  assert.equal(playBanished.op, "effect.play");
  // 指令顺序：play 必须在 kill this 之后（355.10.c.1 的 [do X] to [do Y]）。
  assert.equal(playBanished.linkedTo, "dockside-lock-up.kill-this");
  assert.deepEqual(playBanished.args.pick, { kind: "constant", value: BANISHED_PICK });
  // 356.1.b.1/356.5.a："ignoring its cost" 的基础能量与力量设为 0。
  assert.deepEqual(playBanished.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });
  assert.equal(playBanished.picks.length, 1);
  assert.equal(playBanished.picks[0].id, BANISHED_PICK);
  assert.equal(playBanished.picks[0].selection, "one");
});

test("rad-136-167 Dockside Lock-Up: effect.banish 把\"这里的单位\"真实放入放逐区（428.1/428.2.a）", () => {
  const kernel = world()
    .unit("lockside", { location: BATTLEFIELD })
    .unit("here", { owner: "B", location: BATTLEFIELD })
    .unit("elsewhere", { owner: "B", location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const hereRef = kernel.ref("here");
  const instruction = playTrigger().body[0];
  const run = runInstruction(
    banish,
    { objects: instruction.args.objects, linkKey: instruction.args.linkKey },
    { world: kernel, targets: { [BANISH_TARGET]: [hereRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("here").zone, "banishment");
  // "here" 限制由目标系统施加：另一个战场的单位不受影响。
  assert.equal(kernel.getObject("elsewhere").zone, "board");
  const receipt = run.linked["dockside-lock-up.banishedCard"];
  assert.equal(receipt.count, 1);
  // 428.2.a：放逐不是消灭的子集 —— 只有 banish 动作，没有 kill。
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
  assert.equal(run.events.some(event => event.action === "kill"), false);
});

test("rad-136-167 Dockside Lock-Up: \"kill this\"（429.6 的自身消灭费用）真实把本卡送入弃牌区", () => {
  const kernel = world().unit("lockside", { location: BATTLEFIELD }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lockside") });
  const instruction = holdTrigger().body[0];
  const outcome = runAbilityBody(
    [{ id: instruction.id, op: instruction.op, args: instruction.args }],
    scoped
  );
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("lockside").zone, "trash");
  assert.deepEqual(outcome.results[0].result.linkedValues.killed.map(ref => ref.id), ["lockside"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
});

test("rad-136-167 Dockside Lock-Up: effect.play 以已定案零费用把被放逐的牌打出场（356.1.b.1）", () => {
  const kernel = world().unit("lockside", { location: BATTLEFIELD }).build();
  kernel.addObject(
    {
      ref: { id: "banished-card", zoneEntryId: 1 },
      owner: "A",
      types: ["unit"],
      zone: "banishment"
    },
    "banishment"
  );
  const instruction = holdTrigger().body[1];
  const run = runInstruction(
    play,
    {
      object: { kind: "constant", value: kernel.ref("banished-card") },
      cost: instruction.args.cost,
      location: { kind: "constant", value: BATTLEFIELD }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("banished-card").zone, "board");
  assert.deepEqual(kernel.getObject("banished-card").location, BATTLEFIELD);
  assert.equal(run.linked.played, 1);
  // 356.1.b.1："ignoring its cost" 的最终费用计划是零；内核先提交 pay（金额 0、不改动资源）
  // 再执行 play，打出事件落在 card-played 时点。
  assert.deepEqual(run.events.map(event => event.action), ["pay", "play"]);
  assert.equal(run.events[1].timingPoint, "card-played");
  assert.equal(kernel.player("A").energy, 0);
});

test.todo(
  "rad-136-167 Dockside Lock-Up: [Deploy]（830.1.b）的\"只能打到战场\"、830.1.b.3 的不被召回与" +
    "\"对手在此固守时消灭本卡\"需要 effects/keywords/Deploy.ts 与打出位置校验（关键词工作流）"
);

test.todo(
  "rad-136-167 Dockside Lock-Up: 428.3 的\"同一对象放逐的牌\"是跨结算的持久引用；契约 3.6 的 ctx.link" +
    "只在单次结算作用域内，当前用 PickSpec 命名该引用的来源作为占位（跨结算不可读）"
);

test.todo(
  "rad-136-167 Dockside Lock-Up: 204.3 指令内费用与 356.5.a\"忽略全部费用\"的最终费用计划构造" +
    "（cost.pay 未合入）——程序里已声明 finalized 零计划，但由卡牌程序构造该计划的生产路径缺失"
);
