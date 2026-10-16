import test from "node:test";
import assert from "node:assert/strict";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";
import reveal from "../../../dist/effects/instructions/effect.reveal.js";

const lit = (value) => ({ kind: "literal", value });
const pickAnswerId = "effect.reveal:pick:A";

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
  // 参考内核的 ctx.query 按对象插入序返回；按 c1..c3 插入即把 c1 当“顶”。
  const kernel = world().deck("c1").deck("c2").deck("c3").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("deck"), count: lit(2) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["c1", "c2"]);
  assert.equal(revealActions(run).length, 2);
  // CR 425.1.a.2：被展示的牌停留在原区域，顺序不变。
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id).sort(), ["c1", "c2", "c3"]);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("省略 count 时展示整个区域（CR 425.3.a：reveal your hand）", () => {
  const kernel = world().hand("h1").hand("h2").hand("h3").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("hand") }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(sorted(revealedIds(run)), ["h1", "h2", "h3"]);
});

test("count 超过区域可用张数时按实际张数展示（CR 425.3 示例）", () => {
  const kernel = world().deck("only").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("deck"), count: lit(5) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["only"]);
});

test("数量边界 count=0：空区域无可展示 → impossible → negated（CR 425.2）", () => {
  const kernel = world().deck("c1").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("deck"), count: lit(0) }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(revealActions(run).length, 0);
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
  assert.equal(run.linked.revealed, undefined);
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

test("picker 缺答案时 choose 挂起且世界不变，带答案重跑后提交", () => {
  const kernel = world().deck("c1").deck("c2").build();
  const args = { player: lit("A"), zone: lit("deck"), count: lit(2), picker: lit("A"), pickCount: lit(1) };
  const asked = runInstruction(reveal, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.id, pickAnswerId);
  assert.equal(asked.asked.request.type, "select-objects");
  assert.equal(asked.asked.request.chooser, "A");
  assert.equal(asked.asked.request.min, 1);
  assert.equal(asked.asked.request.max, 1);
  assert.equal(asked.asked.request.options.length, 2);
  assert.equal(asked.result, null);
  assert.equal(kernel.events.length, 0);
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
  const kernel = world().deck("vb-1").deck("vb-2").deck("vb-3").build();
  const run = runInstruction(reveal, { player: lit("A"), zone: lit("deck"), count: lit(2) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["vb-1", "vb-2"]);
  // CR 425.1.a.2：展示不改变区域内容。
  assert.equal(kernel.player("A").deckSize, 3);
});

test("rad-018-167 Drakehound Packmaster：展示每位对手的 Main Deck 顶 1 张", () => {
  // 原文：“When you play me, reveal the top card of each opponent's Main Deck.”（每位对手一次本指令）
  const kernel = world()
    .card("b-top", { owner: "B", zone: "deck" })
    .card("b-second", { owner: "B", zone: "deck" })
    .build();
  const run = runInstruction(reveal, { player: lit("B"), zone: lit("deck"), count: lit(1) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["b-top"]);
  assert.equal(kernel.zone("B", "deck").length, 2);
});

test("rad-082-167（Show Off 承诺）：从手牌展示目标卡，供 cost.reveal 类效果使用", () => {
  const kernel = world().hand("shown").hand("other").build();
  const run = runInstruction(reveal, { target: "t" }, { world: kernel, targets: { t: refsByIds(kernel, ["shown"]) } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(revealedIds(run), ["shown"]);
});
