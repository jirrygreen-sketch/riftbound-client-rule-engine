import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import catalystOfAeons from "../../../dist/cards/ogn/catalyst-of-aeons.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
// Card bodies run through the production argument adapter used by the chain
// (chain/engine.ts -> resolveChainBody), not a hand-built primitive call.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const [play] = catalystOfAeons.abilities;
const [channelInstruction, drawInstruction] = play.body;

test("Catalyst of Aeons program is structurally valid and executable", () => {
  const result = validateCardProgram(catalystOfAeons);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(catalystOfAeons.status, "executable");
  assert.equal(catalystOfAeons.judgeReason, undefined);
  assert.equal(catalystOfAeons.rulesetVersion, "core-1.5");
  assert.equal(
    catalystOfAeons.canonicalCardId,
    "card.hash-d410ba7cd93c0eaef1fc5e938a2ed48f4779279e1906ab9badcbe60658cfec1b"
  );
  assert.equal(
    catalystOfAeons.sourceText,
    "Channel 2 runes exhausted. If you couldn't channel 2 runes this way, draw 1."
  );
});

test("Catalyst of Aeons structure: channel 2 exhausted, conditional draw 1", () => {
  assert.equal(catalystOfAeons.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["catalyst-of-aeons.channel-runes", "effect.channel"],
      ["catalyst-of-aeons.draw-if-short", "effect.draw"]
    ]
  );
  // "Channel 2 runes exhausted": amount 2 plus the exhausted stipulation (431.2).
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelInstruction.targets, undefined);
  assert.equal(channelInstruction.condition, undefined);

  // "If you couldn't channel 2 runes this way, draw 1": own-instruction
  // condition (contract 3.4) on the linked actual count, not linkedTo.
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.deepEqual(drawInstruction.condition, {
    kind: "compare",
    left: {
      kind: "linked-value",
      instructionId: "catalyst-of-aeons.channel-runes",
      key: "channeled"
    },
    operator: "lt",
    right: { kind: "constant", value: 2 }
  });
});

test("Catalyst of Aeons golden: two runes channel and the printed fallback is skipped", () => {
  const kernel = world().deck("deck-card").rune(["rune-a", "rune-b", "rune-c"]).build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status, result.result.reason ?? null]),
    [
      ["catalyst-of-aeons.channel-runes", "executed", null],
      ["catalyst-of-aeons.draw-if-short", "negated", "skipped"]
    ]
  );
  // CR 431.1: the top two runes leave the Rune Deck for the board in order.
  assert.equal(outcome.linkedValues["catalyst-of-aeons.channel-runes.channeled"], 2);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 2);
  assert.deepEqual(kernel.zone("A", "rune-zone").map((ref) => ref.id), ["rune-a", "rune-b"]);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["channel-rune"]);
});

test("Catalyst of Aeons golden: one rune short channels 1 and draws 1 (431.3/431.5)", () => {
  const kernel = world().rune(["only-rune"]).deck(["top-card", "next-card"]).build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["catalyst-of-aeons.channel-runes", "executed"],
      ["catalyst-of-aeons.draw-if-short", "executed"]
    ]
  );
  assert.equal(outcome.linkedValues["catalyst-of-aeons.channel-runes.channeled"], 1);
  assert.equal(outcome.linkedValues["catalyst-of-aeons.draw-if-short.drawn"], 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("Catalyst of Aeons golden: an empty Rune Deck still draws 1 (431.2.a)", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["catalyst-of-aeons.channel-runes.channeled"], 0);
  assert.equal(outcome.linkedValues["catalyst-of-aeons.draw-if-short.drawn"], 1);
  assert.equal(kernel.player("A").runePool.length, 0);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(outcome.results[0].result.status, "executed");
  // The channel-rune action commits with an actual result of 0 (431.2.a: zero
  // runes is not a failure), which is what lets the printed follow-up run.
  assert.deepEqual(outcome.events.map((event) => event.action), ["channel-rune", "draw"]);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test("Catalyst of Aeons golden: the channel instruction alone links the actual count", () => {
  const kernel = world().rune(["r1", "r2", "r3"]).build();
  const run = runInstruction(
    channel,
    { amount: channelInstruction.args.amount, exhausted: channelInstruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 2);
  assert.equal(kernel.player("A").runeDeckSize, 1);
});

test.todo(
  "Catalyst of Aeons channel entry state: both runes enter exhausted (431.2). The " +
    "reference test kernel's channel-rune action does not model entry state; the production " +
    "path (cost/resources.channelDuelRunes, readied=false) does. " +
    "待 RIFT-46 测试内核补齐 entry state 后改为实际场景"
);

test.todo(
  "Catalyst of Aeons cast: pays the printed 4 Energy through the Finalize cost plan " +
    "(依赖 RIFT-89 费用管线生产接线)"
);

