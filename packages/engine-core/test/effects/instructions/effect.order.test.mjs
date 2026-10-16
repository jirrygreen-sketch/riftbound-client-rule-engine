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

// 用有序 deck 数组构建器声明从顶到底的顺序；断言一律经 zoneSlice 读取真实
// 区域内顺序（query 不保证顺序）。
function deckIds(kernel, player = "A") {
  return kernel.zoneSlice(player, "deck", "top").map(object => object.ref.id);
}

test("sfd-065-221 Forecaster Vision: keeps the looked-at card on top via picks", () => {
  // "Your Mechs have [Vision]. (When you play us, look at the top card of your
  // Main Deck. You may recycle it.)" 本原语负责"不放回（留在顶部）"的等价路径：
  // 经 picks 取回顶部 1 张，chooseOrder 对单张无意义，order-top 保持原序。
  const kernel = world().deck(["forecaster-top", "second"]).build();
  const picked = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("vision-pick") }),
    { world: kernel, picks: { "vision-pick": [picked] } }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 1);
  assert.deepEqual(deckIds(kernel), ["forecaster-top", "second"]);
});

test("sfd-065-221 Forecaster Vision (recycle path): bottom put-back stacks under the deck", () => {
  // Vision 的回收路径由 effect.recycle 处理；本测试验证同一张卡"放到底部"时
  // 本原语把该卡置于牌库末尾，其余牌相对顺序不变。
  const kernel = world().deck(["forecaster-top", "second", "third"]).build();
  const picked = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(
    effectOrder,
    orderArgs({ destination: literal("bottom"), cardsPick: literal("vision-pick"), chooseOrder: literal(false) }),
    { world: kernel, picks: { "vision-pick": [picked] } }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 1);
  assert.deepEqual(deckIds(kernel), ["second", "third", "forecaster-top"]);
});

test("ogn-291-298 The Candlelit Sanctum: two cards put back on top in chosen order", () => {
  // "Put those you don't back in any order." 两张牌经 ctx.choose(order) 定序后
  // 经一次 order-top 放回顶部。
  const kernel = world().deck(["candle-a", "candle-b", "rest"]).build();
  const [topA, topB] = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
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
  assert.deepEqual(deckIds(kernel), ["candle-b", "candle-a", "rest"]);
});

test("ogn-291-298 The Candlelit Sanctum: choosing zero puts nothing back (ignored)", () => {
  // 选择集合为空（两张都被 recycle）：本原语按契约 3.6 规则 2 返回 ignored。
  const kernel = world().deck(["candle-a", "candle-b"]).build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("candle-putback") }),
    { world: kernel, picks: { "candle-putback": [] } }
  );
  assert.equal(run.result?.status, "ignored");
  assert.equal(run.result?.reason, "mistargeted");
  assert.deepEqual(deckIds(kernel), ["candle-a", "candle-b"]);
});

test("count mode puts back the real top N of the player's deck (zoneSlice order)", () => {
  // 牌库数组从顶到底声明；id 字典序（"z-under" > "m-second" > "a-top"）与真实
  // 牌序故意相反：若实现退回 query + 按 id 排序，会误取 z-under 并打乱顺序。
  const kernel = world().deck(["a-top", "m-second", "z-under"]).build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(2), chooseOrder: literal(false) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 2);
  // 真实顶部两张 [a-top, m-second] 原序放回顶部，牌库整体不变。
  assert.deepEqual(deckIds(kernel), ["a-top", "m-second", "z-under"]);
});

test("count mode with an order answer applies the chosen permutation of the real top", () => {
  const kernel = world().deck(["lead", "mid", "bottom"]).build();
  const [lead, mid] = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(2) }),
    { world: kernel, answers: { "effect.order:top:A": [mid, lead] } }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 2);
  assert.deepEqual(deckIds(kernel), ["mid", "lead", "bottom"]);
});

test("count mode to the bottom moves the real top N under the deck in order", () => {
  const kernel = world().deck(["lead", "mid", "bottom"]).build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ destination: literal("bottom"), count: literal(2), chooseOrder: literal(false) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 2);
  assert.deepEqual(deckIds(kernel), ["bottom", "lead", "mid"]);
  assert.deepEqual(
    kernel.zoneSlice("A", "deck", "bottom", 2).map(object => object.ref.id),
    ["lead", "mid"]
  );
});

test("count larger than the deck takes the whole deck from the real top", () => {
  const kernel = world().deck(["topmost", "middle", "deepest"]).build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(9), chooseOrder: literal(false) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 3);
  assert.deepEqual(deckIds(kernel), ["topmost", "middle", "deepest"]);
});

test("count 0 is a no-op that still links ordered = 0", () => {
  const kernel = world().deck(["top", "bottom"]).build();
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(0) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.ordered, 0);
  assert.equal(run.events.length, 0);
  assert.deepEqual(deckIds(kernel), ["top", "bottom"]);
});

test("order choice suspends without an answer and replays with one", () => {
  const kernel = world().deck(["hold-a", "hold-b", "rest"]).build();
  const [topA, topB] = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  const asked = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("holdback") }),
    { world: kernel, picks: { holdback: [topA, topB] } }
  );
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.type, "order");
  assert.equal(asked.asked.request.chooser, "A");
  // 挂起时世界未被修改（事务回滚）。
  assert.deepEqual(deckIds(kernel), ["hold-a", "hold-b", "rest"]);
  assert.equal(kernel.events.length, 0);

  const answered = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("holdback") }),
    { world: kernel, picks: { holdback: [topA, topB] }, answers: { "effect.order:top:A": [topB, topA] } }
  );
  assert.equal(answered.result?.status, "executed");
  assert.deepEqual(deckIds(kernel), ["hold-b", "hold-a", "rest"]);
});

test("replaced hook negates the order-top action", () => {
  const kernel = world().deck(["neg-a", "neg-b"]).build();
  kernel.addReplacement(action => (action.type === "order-top" ? "replaced" : null));
  const run = runInstruction(
    effectOrder,
    orderArgs({ count: literal(2), chooseOrder: literal(false) }),
    { world: kernel }
  );
  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "replaced");
  assert.deepEqual(deckIds(kernel), ["neg-a", "neg-b"]);
});

test("stale target reference after the card left the deck is ignored", () => {
  // 目标在进入本指令前已离区（旧 zoneEntryId）：目标全部失效 → ignored。
  const kernel = world().deck(["stale", "other"]).build();
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
  assert.deepEqual(deckIds(kernel), ["other"]);
});

test("cards owned by another player are filtered out and ignored when none remain", () => {
  const kernel = world().deck(["mine"]).deck(["theirs"], { owner: "B" }).build();
  const theirs = kernel.ref("theirs");
  const run = runInstruction(
    effectOrder,
    orderArgs({ cardsPick: literal("mixed") }),
    { world: kernel, picks: { mixed: [theirs] } }
  );
  assert.equal(run.result?.status, "ignored");
  assert.deepEqual(deckIds(kernel, "B"), ["theirs"]);
});
