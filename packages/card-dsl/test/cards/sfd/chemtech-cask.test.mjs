import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/chemtech-cask.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { matchesTriggerEvent } = await import(new URL("events/pipeline-match.js", ENGINE));

const CARD_ID = "card.hash-b17653c3279ad7444bd22e0e4bbc50082723df4f070dcc8c6ac42259fb58b54e";
const EXPECTED_SOURCE =
  "When you play a spell on an opponent's turn, you may exhaust me to play a Gold gear token exhausted.";

const [ability] = program.abilities;
const [payExhaust, playGoldToken] = ability.body;

/** A chain spell snapshot comparable to what events/pipeline carries in its payload. */
const spell = (controller) => ({
  ref: { id: `spell-${controller}`, zoneEntryId: 1 },
  cardId: "card.spell",
  name: "A Spell",
  types: ["spell"],
  tags: [],
  keywords: [],
  owner: controller,
  controller,
  zone: "chain",
  location: null,
  might: null,
  energy: 2,
  power: [],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

test("sfd-063-221 Chemtech Cask: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /opponent's turn/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /187\.5/);
});

test("sfd-063-221 Chemtech Cask: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("sfd-063-221 Chemtech Cask: an optional card-played trigger filtered to a spell played by the controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.2.a / 383.4.a：“When you play a spell …” 是触发条件，事件对象是 spell、事件玩家是控制者。
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "spell" },
    player: "self"
  });
  // 「on an opponent's turn」需要回合归属谓词：不写条件，也不近似成恒真条件。
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 403.1 的 “you may”。
  assert.equal(ability.optional, true);
});

test("sfd-063-221 Chemtech Cask: the cost-within-instruction exhaust precedes the Gold token play", () => {
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [
    ["chemtech-cask.pay-exhaust", "cost.pay"],
    ["chemtech-cask.play-gold-token", "effect.token"]
  ]);
  // 204.1.c / 204.3 / 355.10.c.1：横置自身是费用，不是 effect.exhaust。
  assert.deepEqual(payExhaust.args.payments, {
    kind: "constant",
    value: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(payExhaust.targets, undefined);
  // 440.2.c / 185.2.a / 187.5：先在链上生成 Gold gear token，再由 play 接手打出。
  assert.deepEqual(playGoldToken.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGoldToken.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGoldToken.args.amount, { kind: "constant", value: 1 });
  assert.equal(playGoldToken.linkedTo, "chemtech-cask.pay-exhaust");
  // 「exhausted」是入场状态规定（184.1 / 185.2.d），不是入场后再横置。
  assert.equal(ability.body.some((step) => step.op === "effect.exhaust"), false);
});

test("sfd-063-221 Chemtech Cask: the declared filter matches the merged matcher for spells played by the controller", () => {
  const base = { timingPoint: "card-played", kind: "card-played", eventId: 1 };
  // “you play a spell”：事件玩家就是能力控制者（events/pipeline-match 的 playerMatches）。
  assert.equal(matchesTriggerEvent(ability.trigger.filter, { ...base, object: spell("A"), player: "A" }, "A"), true);
  // 对手打出的法术不满足 “you play a spell”。
  assert.equal(matchesTriggerEvent(ability.trigger.filter, { ...base, object: spell("B"), player: "B" }, "A"), false);
  // 打出的不是法术时不满足 “play a spell”。
  assert.equal(
    matchesTriggerEvent(ability.trigger.filter, { ...base, object: { ...spell("A"), types: ["unit"] }, player: "A" }, "A"),
    false
  );
});

test("sfd-063-221 Chemtech Cask: an unfulfilled Gold play preserves the gear and creates no substitute token", () => {
  const kernel = world().player("A")
    .unit("cask", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const bound = kernel.clone({ sourceSnapshot: kernel.getObject("cask") });
  const before = bound.objects;
  // Preserve the original Gold subeffect's event and state assertions without
  // asserting that the definition must remain unsupported.
  const run = runInstruction(token, {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "base", player: "A" } },
    linkKey: { kind: "constant", value: "goldToken" }
  }, { world: bound });

  assert.deepEqual(run.result.events, []);
  assert.deepEqual(bound.objects.filter((object) => object.isToken).map((object) => object.ref.id), []);
  assert.deepEqual(bound.objects, before);
  assert.deepEqual(bound.events, []);
});

test.todo(
  "sfd-063-221 Chemtech Cask: paying \"exhaust me\" as a cost within instructions (CR 204.1.c / 204.3 / 355.10.c.1) " +
    "needs a cost.pay payments shape that accepts declared nonstandard payment arrays (paymentsPlan currently " +
    "accepts only energy/power/xp and rejects this card's array with cannot-pay-cost) plus the trigger Finalize " +
    "cost pipeline; the exhaust must not be approximated with effect.exhaust"
);
test.todo(
  "sfd-063-221 Chemtech Cask: playing the Gold gear token (CR 187.5 definition plus 440.2.c / 185.2.a chain creation and " +
    "184.1 / 185.2.d exhausted entry) needs the Gold token definition plus the create-token entry-state rewrite"
);
test.todo(
  "sfd-063-221 Chemtech Cask: \"on an opponent's turn\" needs an event payload / trigger-filter predicate for turn ownership " +
    "so the trigger condition can compare the event's turn player with the ability controller"
);
