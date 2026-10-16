import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import mobilize from "../../../dist/cards/ogn/mobilize.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
// The chain layer executes card bodies through the production argument
// adapter (chain/engine.ts -> resolveChainBody), so the golden runs use it
// instead of re-marshalling IR arguments by hand.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const [play] = mobilize.abilities;
const [channelInstruction, drawInstruction] = play.body;

test("Mobilize program is structurally valid and executable", () => {
  const result = validateCardProgram(mobilize);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(mobilize.status, "executable");
  assert.equal(mobilize.judgeReason, undefined);
  assert.equal(
    mobilize.canonicalCardId,
    "card.hash-8b937ea127c7d610d6f502d591b666c7cf2eab805964c7a5a049f74066a969f1"
  );
  assert.equal(mobilize.rulesetVersion, "core-1.5");
  assert.equal(mobilize.sourceText, "Channel 1 rune exhausted. If you can't, draw 1.");
});

test("Mobilize structure: one play ability, channel-then-conditional-draw", () => {
  assert.equal(mobilize.abilities.length, 1);
  assert.equal(play.kind, "play");
  // No speed keyword is printed; spells default to Action timing (159.2.a).
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["mobilize.channel-rune", "effect.channel"],
      ["mobilize.draw-if-cant", "effect.draw"]
    ]
  );

  // "Channel 1 rune exhausted" (431.2): amount 1 plus the exhausted stipulation.
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelInstruction.targets, undefined);
  assert.equal(channelInstruction.linkedTo, undefined);
  assert.equal(channelInstruction.condition, undefined);

  // "If you can't, draw 1": the condition belongs to the draw instruction only
  // (contract 3.4) and reads the actual channeled count.
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.deepEqual(drawInstruction.condition, {
    kind: "compare",
    left: {
      kind: "linked-value",
      instructionId: "mobilize.channel-rune",
      key: "channeled"
    },
    operator: "lt",
    right: { kind: "constant", value: 1 }
  });
});

test("Mobilize golden: channeling the rune moves it to the rune zone and skips the fallback", () => {
  const kernel = world().deck("deck-card").rune(["top-rune", "next-rune"]).build();
  const outcome = resolveChainBody(play.body, kernel);
  // The conditional Draw 1 is guarded off once the rune was channeled, so it
  // reports negated/skipped (contract 3.9); the channel itself executed.
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status, result.result.reason ?? null]),
    [
      ["mobilize.channel-rune", "executed", null],
      ["mobilize.draw-if-cant", "negated", "skipped"]
    ]
  );
  // CR 431.1: the top rune leaves the Rune Deck and enters the board (rune zone).
  assert.equal(outcome.linkedValues["mobilize.channel-rune.channeled"], 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone").map((ref) => ref.id), ["top-rune"]);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(
    outcome.events.map((event) => event.action),
    ["channel-rune"]
  );
});

test("Mobilize golden: an empty Rune Deck channels 0 and the fallback draws 1 (431.3)", () => {
  const kernel = world().deck(["top-card", "next-card", "third-card"]).build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["mobilize.channel-rune", "executed"],
      ["mobilize.draw-if-cant", "executed"]
    ]
  );
  // CR 431.3: channel as many as possible; 431.2.a/effect.channel: zero is not
  // a failure, so the linked count is 0 and the printed fallback draws 1
  // (CR 414.3).
  assert.equal(outcome.linkedValues["mobilize.channel-rune.channeled"], 0);
  assert.equal(outcome.linkedValues["mobilize.draw-if-cant.drawn"], 1);
  assert.equal(kernel.player("A").runePool.length, 0);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 2);
  // The channel-rune action still commits with an actual result of 0 (the
  // instruction executes and links "channeled": 0, effect.channel.ts), and
  // the printed fallback then draws. No rune moved.
  assert.deepEqual(outcome.events.map((event) => event.action), ["channel-rune", "draw"]);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test("Mobilize golden: the channel instruction alone reports the actual count", () => {
  const kernel = world().rune(["top-rune", "next-rune"]).build();
  const run = runInstruction(
    channel,
    { amount: channelInstruction.args.amount, exhausted: channelInstruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
});

test("Mobilize golden: the fallback condition depends only on the channel's linked count", () => {
  // Contract 3.4: a condition scopes to its own instruction. Running the draw
  // instruction on its own (the channel never wrote "channeled" into this link
  // scope) leaves the condition unevaluable, so the interpreter ignores the
  // draw instead of drawing (interpreter README: missing information ignores
  // the instruction). This is why the condition names the channel instruction.
  const kernel = world().deck(["top-card", "next-card"]).build();
  const outcome = resolveChainBody([drawInstruction], kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 2);
});

test.todo(
  "Mobilize channel entry state: the channeled rune enters exhausted (431.2). The " +
    "reference test kernel's channel-rune action moves the rune but does not model entry " +
    "state; the production path (cost/resources.channelDuelRunes, readied=false) does. " +
    "待 RIFT-46 测试内核补齐 entry state 后改为实际场景"
);

test.todo(
  "Mobilize cast: pays the printed 2 Energy and the play window follows default spell " +
    "timing (依赖 RIFT-89 费用管线生产接线)"
);

