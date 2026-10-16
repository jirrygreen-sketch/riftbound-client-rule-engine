import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/life-from-stone.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { default: channel } = await import(new URL("effects/instructions/effect.channel.js", engineCore));
const { default: draw } = await import(new URL("effects/instructions/effect.draw.js", engineCore));

const CANONICAL = "card.hash-0b434d5de4e3431420a6dddfc3ed5c57570643467c671f4efae850ed1f9905ea";
const [keyword, play] = program.abilities;
const [drawInstruction, channelInstruction] = play.body;

test("rad-029-167 Life from Stone: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "As an additional cost to play this, exhaust a friendly unit.\n" +
      "Draw 1 and channel 1 rune exhausted."
  );
});

test("rad-029-167 Life from Stone: judge-required naming the missing additional-cost path", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.2/);
  assert.match(program.judgeReason, /mandatoryAdditional/);
  assert.match(program.judgeReason, /431\.2/);
});

test("rad-029-167 Life from Stone: [Reaction], a mandatory exhaust cost, then Draw 1 and channel 1 exhausted", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(play.cost.energy, { kind: "constant", value: 1 });
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "exhaust");
  assert.deepEqual(payment.choice, {
    id: "life-from-stone.exhausted-unit",
    options: ["ready-friendly-unit"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "board",
    type: "unit",
    controller: "self",
    states: "ready"
  });

  assert.deepEqual(play.body.map((instruction) => instruction.id), [
    "life-from-stone.draw-1",
    "life-from-stone.channel-1"
  ]);
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  // "Draw 1 and channel 1 rune exhausted" is one clause: the channel is linked.
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelInstruction.linkedTo, "life-from-stone.draw-1");
});

test("rad-029-167 Life from Stone golden: Draw 1 then channel 1 rune exhausted", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .rune(["rune-1", "rune-2"])
    .build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["life-from-stone.draw-1", "executed"],
      ["life-from-stone.channel-1", "executed"]
    ]
  );
  // CR 414.1: one card moves from the top of the Main Deck to hand.
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-1"]);
  // CR 431.1/431.2: one rune leaves the Rune Deck for the rune zone.
  assert.equal(outcome.linkedValues["life-from-stone.channel-1.channeled"], 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone").map((ref) => ref.id), ["rune-1"]);
});

test("rad-029-167 Life from Stone golden: an empty Rune Deck still draws (CR 431.3 shortfall)", () => {
  const kernel = world().deck(["deck-1", "deck-2"]).build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(outcome.linkedValues["life-from-stone.channel-1.channeled"], 0);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test("rad-029-167 Life from Stone golden: the two body instructions each run on their own primitive", () => {
  // The individual primitives are merged; running them separately pins the
  // executed actions (draw, channel-rune) without claiming the cost was paid.
  const kernel = world().deck(["deck-1"]).rune(["rune-1"]).build();
  const drawn = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(drawn.result.status, "executed");
  assert.deepEqual(drawn.events.map((event) => event.action), ["draw"]);

  const channeled = runInstruction(
    channel,
    { amount: channelInstruction.args.amount, exhausted: channelInstruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(channeled.result.status, "executed");
  assert.equal(channeled.linked.channeled, 1);
  assert.deepEqual(channeled.events.map((event) => event.action), ["channel-rune"]);
});

test.todo(
  "rad-029-167 Life from Stone: CR 356.2 charges 'As an additional cost to play this, exhaust a " +
    "friendly unit' during Finalize together with the printed 1 Energy; no merged adapter maps a " +
    "card program's additional-cost clause into CostPlanInput.mandatoryAdditional (the chain only " +
    "supplies { kind: 'printed' }), and no cost.additional primitive exists (RIFT-89 scope)"
);
test.todo(
  "rad-029-167 Life from Stone: the [Reaction] Closed-State play window (CR 813.1.c) and the " +
    "chain admission for a Reaction spell need chain wiring (RIFT-84/RIFT-85 scope)"
);
