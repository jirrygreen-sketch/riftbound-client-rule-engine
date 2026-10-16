import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";
import reveal from "../../../dist/effects/instructions/effect.reveal.js";

const lit = (value) => ({ kind: "literal", value });
const pickAnswerId = "reveal-hand:instruction-1";

function revealedIds(run) {
  return run.linked.revealed.map(entry => entry.id);
}
function sorted(list) {
  return [...list].sort();
}
function revealActions(run) {
  return run.events.filter(event => event.action === "reveal");
}
function refsByIds(kernel, ids) {
  return ids.map(id => kernel.ref(id));
}

test("正常执行：从牌库顶展示 2 张并链接结果", () => {
  const kernel = world().deck("c3").deck("c2").deck("c1").build();
  const before = kernel.zone("A", "deck");
  // 上游区域查询的非目标引用；使用真正的区域顺序，而非 ctx.query 的对象插入序。
  const run = runInstruction(reveal, { pick: "top-two" }, {
    world: kernel, picks: { "top-two": before.slice(0, 2) }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["c1", "c2"]);
  assert.equal(revealActions(run).length, 2);
  // CR 425.1.a.2：被展示的牌停留在原区域，顺序不变。
  assert.deepEqual(kernel.zone("A", "deck"), before);
  assert.equal(kernel.player("A").deckSize, 3);
  assert.equal(run.linked.revealedCount, 2);
  assert.deepEqual(run.result.linkedValues, run.linked);
});

test("省略 count 时展示整个区域（CR 425.3.a：reveal your hand）", () => {
  const kernel = world().hand("h1").hand("h2").hand("h3").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("hand") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(sorted(revealedIds(run)), ["h1", "h2", "h3"]);
});

test("count 超过区域可用张数时按实际张数展示（CR 432.1.c）", () => {
  const kernel = world().deck("only").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("deck"), count: lit(5) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["only"]);
});

test("数量边界 count=0：没有展示动作 → impossible → negated，实际张数为零", () => {
  const kernel = world().deck("c1").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("deck"), count: lit(0) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(revealActions(run).length, 0);
  assert.equal(run.linked.revealedCount, 0);
  assert.deepEqual(run.linked.revealed, []);
});

test("数量边界：空手牌区域无可展示 → negated（CR 425.2 Limited Action）", () => {
  const kernel = world().deck("c1").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("hand") }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
});

test("被替代钩子替代 → negated（契约 3.6 原语规则 2）", () => {
  const kernel = world().deck("c1").build();
  kernel.addReplacement(action => (action.type === "reveal" ? "replaced" : null));
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("deck"), count: lit(1) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.linked.revealed, []);
  assert.equal(run.linked.revealedCount, 0);
});

test("目标全部失效（对象已离区、旧 zoneEntryId）→ ignored", () => {
  const kernel = world().hand("h1").build();
  const stale = kernel.ref("h1");
  kernel.perform({ type: "discard", object: stale });
  assert.equal(kernel.object(stale), null);
  const run = runInstruction(reveal, { target: "t" }, { world: kernel, targets: { t: [stale] } });
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(revealActions(run).length, 0);
});

test("目标形态：展示 targets 锁定的合法对象", () => {
  const kernel = world().hand("h1").hand("h2").build();
  const run = runInstruction(reveal, { target: "t" }, { world: kernel, targets: { t: [kernel.ref("h1")] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["h1"]);
});

test("手牌选择缺答案时 choose 挂起且世界不变，带答案重跑后提交", () => {
  const kernel = world().hand("c1").hand("c2").build();
  const before = kernel.stateForTest();
  const args = { player: lit("A"), zone: lit("hand"), count: lit(1), choiceId: pickAnswerId };
  const asked = runInstruction(reveal, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.id, pickAnswerId);
  assert.equal(asked.asked.request.type, "select-objects");
  assert.equal(asked.asked.request.chooser, "A");
  assert.equal(asked.asked.request.visibility, "chooser-only");
  assert.equal(asked.asked.request.min, 1);
  assert.equal(asked.asked.request.max, 1);
  assert.equal(asked.asked.request.options.length, 2);
  assert.equal(asked.result, null);
  assert.equal(kernel.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
  const answered = runInstruction(reveal, args, {
    world: kernel,
    answers: { [pickAnswerId]: [kernel.ref("c2")] }
  });
  assert.equal(answered.result.status, "executed");
  assert.deepEqual(revealedIds(answered), ["c2"]);
  assert.equal(revealActions(answered).length, 1);
});

test("sfd-187-221 Void Burrower：展示你的 Main Deck 顶 2 张", () => {
  // 原文：“When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck.”
  const kernel = world().deck("vb-3").deck("vb-2").deck("vb-1").build();
  const run = runInstruction(reveal, { pick: "void-burrower:top" }, {
    world: kernel, picks: { "void-burrower:top": kernel.zone("A", "deck").slice(0, 2) }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["vb-1", "vb-2"]);
  // CR 425.1.a.2：展示不改变区域内容。
  assert.equal(kernel.player("A").deckSize, 3);
});

test("rad-018-167 Drakehound Packmaster：展示每位对手的 Main Deck 顶 1 张", () => {
  // 原文：“When you play me, reveal the top card of each opponent's Main Deck.”（每位对手一次本指令）
  const kernel = world()
    .card("b-second", { owner: "B", zone: "deck" })
    .card("b-top", { owner: "B", zone: "deck" })
    .build();
  const run = runInstruction(reveal, { pick: "opponent-top" }, {
    world: kernel, picks: { "opponent-top": kernel.zone("B", "deck").slice(0, 1) }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["b-top"]);
  assert.equal(kernel.zone("B", "deck").length, 2);
});

test("从手牌展示指定卡只保留对象引用，不执行 Show Off 特征快照", () => {
  const kernel = world().hand("shown").hand("other").build();
  const run = runInstruction(reveal, { target: "t" }, { world: kernel, targets: { t: refsByIds(kernel, ["shown"]) } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["shown"]);
});

test("回归：目标重验后集合为空时 ignored", () => {
  const kernel = world().hand("unrelated").build();
  const run = runInstruction(reveal, { target: "gone" }, { world: kernel, targets: { gone: [] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
});

test("回归：选择未展示手牌时不向全体玩家公开候选", () => {
  const kernel = world().hand("h1").hand("h2").build();
  const run = runInstruction(reveal, {
    zone: lit("hand"), count: lit(1), choiceId: "reveal-hand"
  }, { world: kernel });
  assert.ok(run.asked instanceof AwaitChoice);
  assert.equal(run.asked.request.visibility, "chooser-only");
  assert.deepEqual(kernel.events, []);
});

test("回归：后续展示被替代时保留前面已发生的事件和实际引用", () => {
  const kernel = world().hand("h1").hand("h2").hand("h3").build();
  kernel.addReplacement(action => action.type === "reveal" && action.object.id === "h2" ? "replaced" : null);
  const run = runInstruction(reveal, { target: "cards" }, {
    world: kernel, targets: { cards: refsByIds(kernel, ["h1", "h2", "h3"]) }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.result.events, run.events);
  assert.equal(run.events.length, 3);
  assert.deepEqual(revealedIds(run), ["h1", "h3"]);
  assert.equal(run.linked.revealedCount, 2);
});

test("回归：公开对象不能被当作 Reveal 执行", () => {
  const kernel = world().unit("public").build();
  const run = runInstruction(reveal, { target: "cards" }, {
    world: kernel, targets: { cards: [kernel.ref("public")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.events, []);
});

for (const [outcome, reason] of [["prevented", "skipped"], ["impossible", "impossible"]]) {
  test(`${outcome} 钩子使展示 negated/${reason}，不链接未执行的卡牌`, () => {
    const kernel = world().hand("h1").build();
    kernel.addReplacement(action => action.type === "reveal" ? outcome : null);
    const run = runInstruction(reveal, { target: "card" }, {
      world: kernel, targets: { card: [kernel.ref("h1")] }
    });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, reason);
    assert.deepEqual(run.result.events, run.events);
    assert.equal(run.events.length, 1);
    assert.deepEqual(run.linked.revealed, []);
    assert.equal(run.linked.revealedCount, 0);
  });
}

test("部分目标旧引用失效时仍展示其余合法目标，不追踪同 id 的新入区对象", () => {
  const kernel = world().hand("moved").hand("live").build();
  const stale = kernel.ref("moved");
  assert.equal(kernel.perform({ type: "discard", object: stale }).status, "done");
  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("moved") }).status, "done");
  const run = runInstruction(reveal, { target: "cards" }, {
    world: kernel, targets: { cards: [stale, kernel.ref("live")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["live"]);
  assert.equal(run.linked.revealedCount, 1);
  assert.equal(run.events.length, 1);
});

test("非目标 pick 旧引用失效时 negated，不成为 mistargeted 或展示新对象", () => {
  const kernel = world().hand("card").build();
  const stale = kernel.ref("card");
  assert.equal(kernel.perform({ type: "discard", object: stale }).status, "done");
  const run = runInstruction(reveal, { pick: "selected" }, {
    world: kernel, picks: { selected: [stale] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.events, []);
  assert.equal(run.linked.revealedCount, 0);
});

test("空 pick 没有可展示卡牌时 negated，不是目标失效", () => {
  const kernel = world().hand("unrelated").build();
  const run = runInstruction(reveal, { pick: "empty" }, { world: kernel, picks: { empty: [] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.events, []);
});

test("重复引用只展示一次并链接实际张数", () => {
  const kernel = world().hand("h1").build();
  const ref = kernel.ref("h1");
  const run = runInstruction(reveal, { pick: "cards" }, { world: kernel, picks: { cards: [ref, ref] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, [ref]);
  assert.equal(run.linked.revealedCount, 1);
  assert.equal(run.events.length, 1);
});

test("只展示指定玩家的手牌，默认玩家为控制者且默认区域为 hand", () => {
  const kernel = world().hand("a").hand("b", { owner: "B" }).deck("secret").build();
  const run = runInstruction(reveal, {}, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["a"]);
  const other = runInstruction(reveal, { player: lit("B") }, { world: kernel });
  assert.equal(other.result.status, "executed");
  assert.deepEqual(revealedIds(other), ["b"]);
});

test("展示后进入手牌的新卡不会加入已链接的展示集合（425.3.a.1）", () => {
  const kernel = world().hand("existing").deck("new").build();
  const run = runInstruction(reveal, {}, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.perform({ type: "draw", player: "A", amount: 1 }).status, "done");
  assert.deepEqual(kernel.linked("revealed"), [kernel.ref("existing")]);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.events.filter(event => event.action === "reveal").length, 1);
});

test("面朝下的私有对象可以展示，但不翻面、不移动、不锁定 Show Off 特征", () => {
  const kernel = world().unit("hidden", { faceDown: true, energy: null, power: null }).build();
  const ref = kernel.ref("hidden");
  const before = kernel.object(ref);
  const run = runInstruction(reveal, { target: "card" }, { world: kernel, targets: { card: [ref] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, [ref]);
  assert.deepEqual(kernel.object(ref), before);
  assert.equal(kernel.object(ref).energy, null);
  assert.equal(kernel.object(ref).power, null);
});

test("对手手牌的非目标选择只询问所有者，不泄露给能力控制者", () => {
  const kernel = world().hand("b1", { owner: "B" }).hand("b2", { owner: "B" }).build();
  const run = runInstruction(reveal, {
    player: lit("B"), count: lit(1), choiceId: "opponent-hand"
  }, { world: kernel });
  assert.ok(run.asked instanceof AwaitChoice);
  assert.equal(run.asked.request.chooser, "B");
  assert.equal(run.asked.request.visibility, "chooser-only");
  assert.deepEqual(run.asked.request.options, refsByIds(kernel, ["b1", "b2"]));
  assert.deepEqual(kernel.events, []);
});

test("需要选择时必须有调用方唯一 choiceId，避免不同指令重用答案", () => {
  const kernel = world().hand("h1").hand("h2").build();
  assert.throws(() => runInstruction(reveal, { count: lit(1) }, { world: kernel }), /choiceId is required/);
  assert.deepEqual(kernel.events, []);
});

test("无需选择时不挂起，超量 count 只展示现有手牌", () => {
  const kernel = world().hand("only").build();
  const run = runInstruction(reveal, { count: lit(5), choiceId: "unused" }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.deepEqual(revealedIds(run), ["only"]);
});

test("回归：严格校验 choose 答案的数量、去重、成员和 zoneEntryId", () => {
  const kernel = world().hand("h1").hand("h2").hand("h3").deck("outside").build();
  const before = kernel.stateForTest();
  const h1 = kernel.ref("h1");
  const h2 = kernel.ref("h2");
  for (const answer of [[], [h1], [h1, h2, kernel.ref("h3")], [h1, h1], [h1, kernel.ref("outside")],
    [h1, { ...h2, zoneEntryId: h2.zoneEntryId + 1 }], [h1, null], h1, null]) {
    assert.throws(() => runInstruction(reveal, { count: lit(2), choiceId: "two" }, {
      world: kernel, answers: { two: answer }
    }), /distinct available object references/);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("回归：不能用 ctx.query 的对象插入序近似实现牌库顶 N 张", () => {
  const kernel = world().deck("old-top").deck("new-top").deck("third").build();
  assert.equal(kernel.perform({
    type: "order-top", player: "A", objects: refsByIds(kernel, ["new-top", "third", "old-top"])
  }).status, "done");
  assert.notDeepEqual(kernel.query({ owner: "A", zone: "deck" }).map(object => object.ref), kernel.zone("A", "deck"));
  assert.throws(() => runInstruction(reveal, { zone: lit("deck"), count: lit(1) }, { world: kernel }), /upstream ordered picks/);
  const before = kernel.zone("A", "deck");
  const run = runInstruction(reveal, { pick: "top" }, { world: kernel, picks: { top: before.slice(0, 1) } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["new-top"]);
  assert.deepEqual(kernel.zone("A", "deck"), before);
});

test("Expr 在结算时求值，支持 linked、count 与对象属性", () => {
  const kernel = world().hand("h1").hand("h2").build();
  const run = runInstruction(reveal, {
    player: { kind: "object-property", object: kernel.ref("h1"), property: "owner" },
    zone: { kind: "linked-value", instructionId: "previous", key: "selected-zone" },
    count: { kind: "count", subject: "cards", filter: { owner: "A", zone: "hand" } }
  }, { world: kernel, linked: { "selected-zone": "hand" } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["h1", "h2"]);
  assert.equal(run.linked.revealedCount, 2);
});

test("argsSchema 拒绝未知 Expr、冲突来源及未支持的 viewers/duration", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  for (const args of [null, [], { count: 1 }, { count: { kind: "unknown" } }, { count: { kind: "literal" } },
    { count: lit(Infinity) }, { zone: lit(cyclic) }, { target: "" }, { pick: " " }, { choiceId: "x" },
    { target: "t", pick: "p" }, { target: "t", count: lit(1) }, { pick: "p", zone: lit("deck") },
    { viewers: lit(["A"]) }, { duration: lit("end-of-turn") }]) {
    assert.throws(() => reveal.argsSchema.parse(args), /effect.reveal:/);
  }
});

test("非法 count 或区域值在执行任何动作前拒绝", () => {
  for (const count of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    const kernel = world().hand("h1").build();
    assert.throws(() => runInstruction(reveal, { count: lit(count) }, { world: kernel }), /non-negative safe integer/);
    assert.deepEqual(kernel.events, []);
  }
  const kernel = world().hand("h1").build();
  assert.throws(() => runInstruction(reveal, { zone: lit("unknown") }, { world: kernel }), /known zone/);
  assert.throws(() => runInstruction(reveal, { player: lit(1) }, { world: kernel }), /non-empty id/);
  assert.deepEqual(kernel.events, []);
});

test("pick 中的玩家或普通字符串不能被当作 ObjectRef", () => {
  const kernel = world().hand("h1").build();
  assert.throws(() => runInstruction(reveal, { pick: "bad" }, {
    world: kernel, picks: { bad: ["A"] }
  }), /only object references/);
  assert.deepEqual(kernel.events, []);
});

test("失败重跑覆盖旧的展示链接，不能让 if you do 使用上次张数", () => {
  const kernel = world().hand("h1").build();
  kernel.addReplacement(action => action.type === "reveal" ? "prevented" : null);
  const run = runInstruction(reveal, {}, {
    world: kernel, linked: { revealed: [kernel.ref("h1")], revealedCount: 1 }
  });
  assert.equal(run.result.status, "negated");
  assert.deepEqual(run.linked.revealed, []);
  assert.equal(run.linked.revealedCount, 0);
});

// M1 卡表的 Rumble 牌组含 sfd-215-221；Fiora 不含直接 Reveal 文本。
// 原文：“When you defend here, reveal the top card of your Main Deck. If it's a spell,
// put it in your hand. Otherwise, recycle it.” 这里只测试 Reveal，后续移动由其他原语执行。
for (const [type, description] of [["spell", "法术牌顶"], ["unit", "非法术牌顶"]]) {
  test(`M1 Rumble sfd-215-221 Ravenbloom Conservatory：${description}展示并保留后续指令引用`, () => {
    const m1 = JSON.parse(readFileSync(new URL("../../../../../docs/plans/m1-decks.json", import.meta.url), "utf8"));
    const rumble = m1.candidates.find(deck => deck.id === "rumble-sfd");
    assert.ok(rumble.officialCardList.some(card => card.name === "Ravenbloom Conservatory"));
    const kernel = world()
      .battlefield("conservatory", { cardId: "sfd-215-221", types: ["battlefield"], energy: null, power: null })
      .deck("top", { types: [type], energy: null, power: null })
      .deck("other", { types: ["gear"] })
      .build();
    assert.equal(kernel.perform({ type: "order-top", player: "A", objects: [kernel.ref("top")] }).status, "done");
    const before = kernel.zone("A", "deck");
    const run = runInstruction(reveal, { pick: "conservatory:top" }, {
      world: kernel, picks: { "conservatory:top": before.slice(0, 1) }
    });
    assert.equal(run.result.status, "executed");
    assert.deepEqual(run.linked.revealed, [before[0]]);
    assert.equal(run.linked.revealedCount, 1);
    assert.equal(run.events.length, 1);
    assert.equal(run.events[0].action, "reveal");
    assert.deepEqual(kernel.object(run.linked.revealed[0]).types, [type]);
    assert.equal(kernel.object(run.linked.revealed[0]).energy, null);
    assert.equal(kernel.object(run.linked.revealed[0]).power, null);
    assert.deepEqual(kernel.zone("A", "deck"), before);
    assert.equal(kernel.player("A").handSize, 0);
  });
}

test("同样局面和答案重跑产生相同事件、链接与世界状态", () => {
  const left = world(42).hand("h1").hand("h2").build();
  const right = world(42).hand("h1").hand("h2").build();
  const args = { count: lit(1), choiceId: "deterministic" };
  const first = runInstruction(reveal, args, { world: left, answers: { deterministic: [left.ref("h2")] } });
  const second = runInstruction(reveal, args, { world: right, answers: { deterministic: [right.ref("h2")] } });
  assert.deepEqual(first.result, second.result);
  assert.deepEqual(first.linked, second.linked);
  assert.deepEqual(left.stateForTest(), right.stateForTest());
  assert.equal(left.randomState, right.randomState);
});
