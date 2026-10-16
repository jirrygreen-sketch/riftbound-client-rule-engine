import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/blade-twirler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-cb21758ecfca99ee0664cb303df5b4bcaf610c851720b908072b2555e533474b";
const SOURCE_TEXT =
  "The first time I move each turn, choose a player. They [Burn 1]. (They put the top card of their " +
  "Main Deck into their trash.)";

const [ability] = program.abilities;
const [choosePlayer, burn] = ability.body;

/**
 * target.player 未合入，所以前一条指令不能进链；单独执行烧牌步时按既有约定
 * （ogn/mindsplitter）剥离 linkedTo，只保留该指令自己的参数形状。
 */
function standalone(instruction) {
  const { linkedTo, ...rest } = instruction;
  return rest;
}

test("ven-002-166 Blade Twirler: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-002-166 Blade Twirler: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /target\.player/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-002-166 Blade Twirler: first-move trigger with the per-turn lifetime (383.2.a / 421.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1 / 449.2：一次成功完成的 Move 对应 object-moved 时点。
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  // 383.2.a 的 “The first time … each turn”：契约 3.5 用 once: "per-turn"。
  assert.equal(ability.trigger.once, "per-turn");
  assert.equal(ability.trigger.condition, undefined);
  // 印文没有 “you may”，触发本身是强制的；可选性在 body 内（本卡没有）。
  assert.equal(ability.optional, false);
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "blade-twirler.choose-player",
    "blade-twirler.burn-1"
  ]);
});

test("ven-002-166 Blade Twirler: 'choose a player' is declared as the missing target.player primitive (355.9.a)", () => {
  assert.equal(choosePlayer.op, "target.player");
  assert.deepEqual(choosePlayer.args.selection, { kind: "constant", value: "one" });
  assert.deepEqual(choosePlayer.args.chooser, { kind: "constant", value: "controller" });
  assert.deepEqual(choosePlayer.args.linkKey, { kind: "constant", value: "chosenPlayer" });
  // 玩家不是游戏对象：不能写成 TargetSpec（355.10.f）。
  assert.equal(choosePlayer.targets, undefined);
  assert.equal(choosePlayer.picks, undefined);
  assert.equal(choosePlayer.linkedTo, undefined);
});

test("ven-002-166 Blade Twirler: the chosen player burns 1 (441.1 / 441.2 / 190.6.d)", () => {
  assert.equal(burn.op, "effect.mill");
  assert.equal(burn.linkedTo, "blade-twirler.choose-player");
  // 441.2.a：印刷的 X = 1。
  assert.deepEqual(burn.args.amount, { kind: "constant", value: 1 });
  // 190.6.d 的 “They” 由前一条指令写出的玩家链接值提供（选择未合入，见 judgeReason）。
  assert.deepEqual(burn.args.player, {
    kind: "linked-value",
    instructionId: "blade-twirler.choose-player",
    key: "chosenPlayer"
  });
});

test("ven-002-166 Blade Twirler golden: Burn 1 moves the top card of the chosen player's Main Deck to their trash", () => {
  const kernel = world()
    .deck(["b-top", "b-second"], { owner: "B" })
    .deck(["a-top"], { owner: "A" })
    .build();
  // target.player 未合入：用链接值直接绑定被选中的玩家 B（不伪造选择），
  // 其余 args 与指令顺序沿用程序原文。
  kernel.link("blade-twirler.choose-player.chosenPlayer", "B");

  const outcome = resolveChainBody([standalone(burn)], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 441.1：牌库顶 → 该玩家的弃牌区。
  assert.deepEqual(kernel.zone("B", "trash").map(ref => ref.id), ["b-top"]);
  assert.deepEqual(kernel.zone("B", "deck").map(ref => ref.id), ["b-second"]);
  // 另一名玩家的牌库不受影响。
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["a-top"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.equal(outcome.linkedValues["blade-twirler.burn-1.burnedCount"], 1);
  assert.equal(outcome.linkedValues["blade-twirler.burn-1.burnedPlayer"], "B");
  assert.deepEqual(outcome.events.map(event => event.action), ["mill"]);
});

test("ven-002-166 Blade Twirler golden: a short Main Deck burns only what is available (441.4)", () => {
  const kernel = world().deck("only", { owner: "B" }).build();
  kernel.link("blade-twirler.choose-player.chosenPlayer", "B");

  const outcome = resolveChainBody([standalone(burn)], kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("B").deckSize, 0);
  assert.equal(outcome.linkedValues["blade-twirler.burn-1.burnedCount"], 1);
  // 两处确认：被烧的那张是牌库顶那张，且已不在牌库。
  assert.deepEqual(kernel.zone("B", "trash").map(ref => ref.id), ["only"]);
});

test.todo(
  "ven-002-166 Blade Twirler: choose a player through the target.player primitive and feed that " +
    "choice into effect.mill — TargetSpec only describes object filters and PickSpec.options is a " +
    "static value list, so no merged op can carry a replayable player choice (355.9.a; " +
    "ability-templates section 4, target.player)"
);
test.todo(
  "ven-002-166 Blade Twirler: fire on the first successful move each turn — events/action-adapter.ts " +
    "does not fill toZone/toKind for move-location and no subscriber turns a CardProgram triggered " +
    "ability into a TriggerRegistration (RIFT-120)"
);
