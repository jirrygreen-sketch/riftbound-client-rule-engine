import assert from "node:assert/strict";
import test from "node:test";

import effectOrder from "../../../src/effects/instructions/effect.order.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "literal", value });

function orderArgs(overrides = {}) {
  return {
    destination: literal("top"),
    ...overrides
  };
}

function deckIds(kernel, player = "A") {
  return kernel.zone(player, "deck").map(ref => ref.id);
}

// 注意：WorldBuilder 的 deck() 用 unshift 入区——先建的牌在牌库底部，后建的在
// 顶部。world().deck("a").deck("b").deck("c") 的顶部到顶部序为 [c, b, a]。

test("sfd-065-221 Forecaster Vision: keeps the looked-at card on top via picks", () => {
  // "Your Mechs have [Vision]. (When you play us, look at the top card of your
  // Main Deck. You may recycle it.)" 本原语负责"不放回（留在顶部）"的等价路径：
  // 经 picks 取回顶部 1 张，chooseOrder 对单张无意义，order-top 保持原序。
  const kernel = world().deck("forecaster-top").deck("second").build();
  const picked = kernel.zone("A", "deck")[0];
  const run = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("vision-pick") }),
    { world: kernel, picks: { "vision-pick": [picked] } }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 1);
  assert.deepEqual(deckIds(kernel), ["second", "forecaster-top"]);
});

test("sfd-065-221 Forecaster Vision (recycle path): bottom put-back stacks under the deck", () => {
  // Vision 的回收路径由 effect.recycle 处理；本测试验证同一张卡"放到底部"时
  // 本原语把该卡置于牌库末尾，其余牌相对顺序不变。
  const kernel = world().deck("forecaster-top").deck("second").deck("third").build();
  const picked = kernel.zone("A", "deck")[0];
  const run = runInstruction(
    effectOrder,
    orderArgs({ destination: literal("bottom"), cardsPick: literal("vision-pick"), chooseOrder: literal(false) }),
    { world: kernel, picks: { "vision-pick": [picked] } }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 1);
  assert.deepEqual(deckIds(kernel), ["second", "forecaster-top", "third"]);
});

test("ogn-291-298 The Candlelit Sanctum: two cards put back on top in chosen order", () => {
  // "Put those you don't back in any order." 两张牌经 ctx.choose(order) 定序后
  // 经一次 order-top 放回顶部。
  const kernel = world().deck("candle-a").deck("candle-b").deck("rest").build();
  const [topA, topB] = kernel.zone("A", "deck");
  const run = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("candle-putback") }),
    {
      world: kernel,
      picks: { "candle-putback": [topA, topB] },
      answers: { "effect.order:top:A": [topB, topA] }
    }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 2);
  assert.deepEqual(deckIds(kernel), ["candle-b", "rest", "candle-a"]);
});

test("ogn-291-298 The Candlelit Sanctum: choosing zero puts nothing back (ignored)", () => {
  // 选择集合为空（两张都被 recycle）：本原语按契约 3.6 规则 2 返回 ignored。
  const kernel = world().deck("candle-a").deck("candle-b").build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("candle-putback") }),
    { world: kernel, picks: { "candle-putback": [] } }
  );
  assert.equal(run.result?.status, "ignored");
  assert.equal(run.result?.reason, "mistargeted");
  assert.deepEqual(deckIds(kernel), ["candle-b", "candle-a"]);
});

test("count mode takes the top N of the player's deck deterministically", () => {
  const kernel = world().deck("alpha").deck("beta").deck("gamma").build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(2), chooseOrder: literal(false) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 2);
  // 顶部两张按确定性顺序放回顶部，牌库整体不变。
  assert.deepEqual(deckIds(kernel), ["alpha", "beta", "gamma"]);
});

test("count larger than the deck orders as many as possible", () => {
  const kernel = world().deck("only").build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(5), chooseOrder: literal(false) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 1);
  assert.deepEqual(deckIds(kernel), ["only"]);
});

test("count 0 is a no-op that still links ordered = 0", () => {
  const kernel = world().deck("alpha").deck("beta").build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(0) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 0);
  assert.equal(run.events.length, 0);
  assert.deepEqual(deckIds(kernel), ["beta", "alpha"]);
});

test("order choice suspends without an answer and replays with one", () => {
  const kernel = world().deck("hold-a").deck("hold-b").deck("rest").build();
  const [topA, topB] = kernel.zone("A", "deck");
  const asked = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("holdback") }),
    { world: kernel, picks: { holdback: [topA, topB] } }
  );
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.type, "order");
  assert.equal(asked.asked.request.chooser, "A");
  // 挂起时世界未被修改（事务回滚）。
  assert.deepEqual(deckIds(kernel), ["rest", "hold-b", "hold-a"]);
  assert.equal(kernel.events.length, 0);

  const answered = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("holdback") }),
    { world: kernel, picks: { holdback: [topA, topB] }, answers: { "effect.order:top:A": [topB, topA] } }
  );
  assert.equal(answered.result?.status, "executed");
  assert.deepEqual(deckIds(kernel), ["hold-b", "rest", "hold-a"]);
});

test("replaced hook negates the order-top action", () => {
  const kernel = world().deck("neg-a").deck("neg-b").build();
  kernel.addReplacement(action => (action.type === "order-top" ? "replaced" : null));
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(2), chooseOrder: literal(false) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "replaced");
  assert.deepEqual(deckIds(kernel), ["neg-b", "neg-a"]);
});

test("stale target reference after the card left the deck is ignored", () => {
  // 目标在进入本指令前已离区（旧 zoneEntryId）：目标全部失效 → ignored。
  const kernel = world().deck("stale").deck("other").build();
  const stale = kernel.ref("stale");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  const run = runInstruction(
    effectOrder,
    orderArgs({ cards: literal("stale-target") }),
    { world: kernel, targets: { "stale-target": [stale] } }
  );
  assert.equal(run.result?.status, "ignored");
  assert.equal(run.result?.reason, "mistargeted");
  assert.equal(kernel.getObject("stale").zone, "trash");
});

test("cards owned by another player are filtered out and ignored when none remain", () => {
  const kernel = world().deck("mine").build();
  // 对手 B 的牌经 picks 混入：不属于归属玩家 A 的牌库，整批失效 → ignored。
  kernel.addObject(
    { ...kernel.getObject("mine"), ref: { id: "theirs", zoneEntryId: 1 }, owner: "B", controller: "B", zone: "deck" },
    "deck"
  );
  const theirs = kernel.ref("theirs");
  const run = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("mixed") }),
    { world: kernel, picks: { mixed: [theirs] } }
  );
  assert.equal(run.result?.status, "ignored");
  assert.deepEqual(deckIds(kernel, "B"), ["theirs"]);
});
