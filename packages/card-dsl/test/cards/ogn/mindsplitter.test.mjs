import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/mindsplitter.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-5a79c5095e64f0c9ef63111a8530ec0264177b86281200874b657db83e5543f5";
const SOURCE_TEXT =
  "When you play me, choose an opponent. They reveal their hand. Choose a card from it, " +
  "and they discard that card.";

const [triggered] = program.abilities;
const [chooseOpponent, reveal, discard] = triggered.body;

/** 剥离 IR 里的 linkedTo / 目标声明，单步执行已合入的原语（Finalize 已锁定的等价调用）。 */
function standalone(instruction) {
  const { linkedTo, targets, ...rest } = instruction;
  return rest;
}

test("mindsplitter: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("mindsplitter: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /target\.player/);
  assert.match(program.judgeReason, /玩家选择原语/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("mindsplitter: play trigger and the three-instruction body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.deepEqual(
    triggered.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["mindsplitter.choose-opponent", "target.player"],
      ["mindsplitter.reveal-hand", "effect.reveal"],
      ["mindsplitter.discard-chosen-card", "effect.discard"]
    ]
  );
});

test("mindsplitter: opponent choice links into reveal and discard", () => {
  // CR 355.9.a 允许目标为 player；IR 里没有玩家目标原语，故声明 target.player。
  assert.deepEqual(chooseOpponent.args.selection, { kind: "constant", value: "one" });
  assert.deepEqual(chooseOpponent.args.chooser, { kind: "constant", value: "controller" });
  assert.deepEqual(chooseOpponent.args.linkKey, { kind: "constant", value: "chosenOpponent" });
  assert.equal(chooseOpponent.targets, undefined);

  // CR 425.3.a: 未指明张数 → 展示该区域当前全部牌。
  assert.equal(reveal.op, "effect.reveal");
  assert.equal(reveal.linkedTo, "mindsplitter.choose-opponent");
  assert.deepEqual(reveal.args.player, {
    kind: "linked-value",
    instructionId: "mindsplitter.choose-opponent",
    key: "chosenOpponent"
  });
  assert.deepEqual(reveal.args.zone, { kind: "constant", value: "hand" });
  assert.equal(reveal.args.count, undefined);
  assert.equal(reveal.targets, undefined);
});

test("mindsplitter: the card chosen from the revealed hand is a non-target pick", () => {
  // CR 355.10.a: 私有区域里的牌不是目标；423.1.a: 弃牌由执行者选择。
  assert.equal(discard.op, "effect.discard");
  assert.equal(discard.linkedTo, "mindsplitter.reveal-hand");
  assert.deepEqual(discard.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(discard.args.pick, { kind: "constant", value: "revealed-card" });
  assert.deepEqual(discard.args.player, {
    kind: "linked-value",
    instructionId: "mindsplitter.choose-opponent",
    key: "chosenOpponent"
  });
  assert.equal(discard.targets, undefined);

  assert.equal(discard.picks.length, 1);
  const [pick] = discard.picks;
  assert.equal(pick.id, "revealed-card");
  // 选项来自上一条 reveal 的实际结果（契约 3.9 的 linked-value）。
  assert.deepEqual(pick.options, [
    { kind: "linked-value", instructionId: "mindsplitter.reveal-hand", key: "revealed" }
  ]);
  assert.deepEqual(pick.filter, { zone: "hand" });
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
  assert.equal(pick.selection, "one");
});

test("mindsplitter golden: revealing the opponent's hand lists every card in hand order", () => {
  const kernel = world()
    .hand("b1", { owner: "B" })
    .hand("b2", { owner: "B" })
    .hand("a1", { owner: "A" })
    .build();
  // target.player 尚未实现，用链接值直接绑定被选中的对手（揭示 / 弃牌两步的真实执行）。
  kernel.link("mindsplitter.choose-opponent.chosenOpponent", "B");

  const outcome = resolveChainBody([standalone(reveal)], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues["mindsplitter.reveal-hand.revealed"], [
    { id: "b1", zoneEntryId: 1 },
    { id: "b2", zoneEntryId: 1 }
  ]);
  // CR 425.1.a.2: 展示不改变区域。
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["b1", "b2"]);
  // A 的手牌不在展示范围内（425.2：只展示被指名玩家手牌）。
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["a1"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["reveal", "reveal"]);
});

test("mindsplitter golden: the discarded card is the chosen one from that player's hand", () => {
  const kernel = world().hand("b1", { owner: "B" }).hand("b2", { owner: "B" }).build();
  kernel.link("mindsplitter.choose-opponent.chosenOpponent", "B");
  kernel.setPicks("revealed-card", [kernel.ref("b2")]);

  const outcome = resolveChainBody([standalone(discard)], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // CR 423.1: 手牌 → 该玩家的 Trash。
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["b1"]);
  assert.deepEqual(kernel.zone("B", "trash").map((ref) => ref.id), ["b2"]);
  const receipt = outcome.linkedValues["mindsplitter.discard-chosen-card.discarded"];
  assert.equal(receipt.count, 1);
  assert.equal(receipt.player, "B");
  assert.deepEqual(receipt.objects, [{ id: "b2", zoneEntryId: 1 }]);
});

test("mindsplitter golden: a stale pick negates the discard instruction (CR 423.4)", () => {
  const kernel = world().hand("b1", { owner: "B" }).build();
  const stale = kernel.ref("b1");
  kernel.link("mindsplitter.choose-opponent.chosenOpponent", "B");
  kernel.setPicks("revealed-card", [stale]);
  kernel.perform({ type: "discard", object: stale });

  const outcome = resolveChainBody([standalone(discard)], kernel);
  // 非目标的 pick 全部失效时没有“选错目标”语义：effect.discard 按 423.4 的“尽可能弃牌”
  // 报 negated(impossible)，而不是 ignored。
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "mindsplitter: “choose an opponent” 需要玩家选择原语 target.player + 重放式选项集合" +
    "（ability-templates 第 4 节 target.player 行）；target.player 落地后把选择结果接进 " +
    "effect.reveal / effect.discard 的 player 参数，" +
    "并断言选择与投影"
);
