import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/soaring-scout.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { default: channel } = await import(
  new URL("effects/instructions/effect.channel.js", engineCore)
);

const CHANNEL_ID = "soaring-scout.channel-1-exhausted";

test("ogn-216-298 Soaring Scout: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-21546c63920e01becbf09de7c0589b5713c48f7a17e0539ecb8caad77b4e3c9e"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /431\.2/);
  assert.equal(
    program.sourceText,
    "[Deathknell] — Channel 1 rune exhausted. (When I die, get the effect.)"
  );
});

test("ogn-216-298 Soaring Scout: Deathknell keyword plus the object-killed effect body", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  // 契约 §5：关键词只声明，展开由 engine-core 的关键词注册表负责。
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  // CR 808.1.c：Deathknell 功能上等于 "When I die, [Effect]"；808.1.d 的触发点是自身被消灭。
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.trigger.condition, undefined);

  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, CHANNEL_ID);
  assert.equal(instruction.op, "effect.channel");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // CR 431.2 的进入规定：「Channel 1 rune exhausted」以横置状态进入。
  assert.deepEqual(instruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(instruction.args.player, undefined);
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-216-298 Soaring Scout golden: the Channel 1 half moves the top rune of the controller's Rune Deck", () => {
  const kernel = world().rune(["rune-top", "rune-next"]).build();
  const [instruction] = program.abilities[1].body;
  const run = runInstruction(
    channel,
    { amount: instruction.args.amount, exhausted: instruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  // 431.1: the rune leaves the Rune Deck and enters the rune zone; player defaults
  // to the ability's controller (ctx.controller).
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("rune-top").zone, "rune-zone");
  assert.equal(kernel.getObject("rune-next").zone, "rune-deck");
  // The channel action carries the printed "exhausted" stipulation for the engine
  // to apply (431.2); the reference kernel records the action as submitted.
  const [event] = run.events;
  assert.equal(event.action, "channel-rune");
  assert.equal(event.reason, "channel-rune");
});

test("ogn-216-298 Soaring Scout: an empty Rune Deck channels as many as possible without failing (CR 431.3)", () => {
  const kernel = world().build();
  const [instruction] = program.abilities[1].body;
  const run = runInstruction(
    channel,
    { amount: instruction.args.amount, exhausted: instruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.equal(kernel.player("A").runePool.length, 0);
});

test.todo(
  "ogn-216-298 Soaring Scout: Deathknell keyword expansion (订阅 object-killed、808.1.d.1 死亡被替代时移出链、" +
    "808.1.d.3 进链前记录最后已知信息) — effects/keywords/Deathknell.ts 展开引用尚未注册的 trigger.leave 原语"
);

test.todo(
  "ogn-216-298 Soaring Scout: the channelled rune enters exhausted (CR 431.2) — " +
    "已合入的 channel-rune 动作忽略 exhausted 规定（符文仍以就绪状态进入），依赖内核补齐 431.2"
);
