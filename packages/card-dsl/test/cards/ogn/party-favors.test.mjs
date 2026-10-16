import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/party-favors.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-545730428f68ed4f654f780ffcb9e3789ff51480ea2f17983910893660b0dc3f";
const SOURCE_TEXT =
  "Each other player chooses Cards or Runes. For each player that chooses Cards, " +
  "you and that player each draw 1. For each player that chooses Runes, " +
  "you and that player each channel 1 rune exhausted.";

const [play] = program.abilities;
const [chooseInstruction, drawInstruction, channelInstruction] = play.body;

test("ogn-071-298 Party Favors: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-071-298 Party Favors identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-071-298 Party Favors judgeReason names the multi-player chooser gap", () => {
  assert.match(program.judgeReason, /355\.10\.e/);
  assert.match(program.judgeReason, /choose/);
  assert.match(program.judgeReason, /chooser/);
  assert.match(program.judgeReason, /RIFT-9/);
});

test("ogn-071-298 Party Favors structure: one each-other-player choice node then two gated clauses", () => {
  // No [Action]/[Reaction] is printed, so the spell keeps default spell timing
  // (159.2.a) and the program holds exactly one play ability.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "party-favors.each-other-player-chooses",
    "party-favors.draw-per-cards-chooser",
    "party-favors.channel-per-runes-chooser"
  ]);

  // "Each other player chooses Cards or Runes." — a resolution-time,
  // multi-chooser decision (355.18) over a set chosen by other players
  // (355.10.e: not targeted). No merged node enumerates or repeats it.
  assert.equal(chooseInstruction.op, "choice.each-other-player");
  assert.equal(chooseInstruction.linkedTo, undefined);
  assert.equal(chooseInstruction.targets, undefined);
  assert.equal(chooseInstruction.picks, undefined);
  assert.deepEqual(chooseInstruction.args.choosers, {
    kind: "constant",
    value: "each-other-player"
  });
  assert.deepEqual(chooseInstruction.args.different, { kind: "constant", value: true });
  assert.equal(chooseInstruction.args.modes.kind, "constant");
  assert.deepEqual(chooseInstruction.args.modes.value.map(mode => mode.id), ["cards", "runes"]);

  // "For each player that chooses Cards, you and that player each draw 1." —
  // the merged draw plus the per-choice seat.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.equal(drawInstruction.linkedTo, "party-favors.each-other-player-chooses");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(drawInstruction.args.player, { kind: "constant", value: "choice.player" });

  // "For each player that chooses Runes, ... channel 1 rune exhausted."
  assert.equal(channelInstruction.op, "effect.channel");
  assert.equal(channelInstruction.linkedTo, "party-favors.each-other-player-chooses");
  assert.deepEqual(channelInstruction.args.player, { kind: "constant", value: "choice.player" });
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
});

test("ogn-071-298 Party Favors: the merged registry really registers the two clause primitives", () => {
  assert.equal(draw.op, "effect.draw");
  assert.equal(channel.op, "effect.channel");
});

test("ogn-071-298 Party Favors golden: the Cards clause draws 1 for the caster", () => {
  const kernel = world().deck(["caster-card"]).build();
  const run = runInstruction(
    draw,
    { amount: drawInstruction.args.amount },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("ogn-071-298 Party Favors golden: the Cards clause draws 1 for the choosing player too", () => {
  // The clause names two seats ("you and that player"), so the same merged
  // instruction is run once per seat; here the choosing player is B.
  const kernel = world().player("B").deck(["chooser-card"], { owner: "B" }).build();
  const run = runInstruction(
    draw,
    { amount: drawInstruction.args.amount, player: "B" },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "B");
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").handSize, 0);
});

test("ogn-071-298 Party Favors golden: the Runes clause channels 1 rune exhausted for the chooser (431.1/431.2)", () => {
  const kernel = world().rune(["rune-1", "rune-2"], { owner: "B" }).build();
  // The reference kernel's channel handler does not model entry state, so the
  // submitted GameAction is captured to prove the printed stipulation reaches
  // it; the hook observes the action and applies no replacement.
  const submitted = [];
  kernel.addReplacement(action => {
    submitted.push(action);
    return null;
  });

  const run = runInstruction(channel, {
    player: "B",
    amount: channelInstruction.args.amount,
    exhausted: channelInstruction.args.exhausted
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.deepEqual(submitted, [
    { type: "channel-rune", player: "B", amount: 1, exhausted: true }
  ]);
  assert.deepEqual(run.events.map(event => event.action), ["channel-rune"]);
  assert.equal(kernel.player("B").runeDeckSize, 1);
  assert.deepEqual(kernel.zone("B", "rune-zone").map(ref => ref.id), ["rune-1"]);
  assert.equal(kernel.player("A").runeDeckSize, 0);
});

test("ogn-071-298 Party Favors golden: a short Rune Deck still channels as many as possible (431.3)", () => {
  const kernel = world().rune("only-rune", { owner: "B" }).build();
  const run = runInstruction(channel, {
    player: "B",
    amount: channelInstruction.args.amount,
    exhausted: channelInstruction.args.exhausted
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("B").runeDeckSize, 0);
});

test.todo(
  "Party Favors: enumerate the other seats and repeat a Cards-or-Runes mode choice once per seat at " +
    "resolution (355.10.e non-target set chosen by other players; 355.18 resolution-time choices) - needs " +
    "the multi-player selection/iteration support (RIFT-9 target.player), since ResolveContext.choose takes " +
    "one chooser and choice.mode's chooser is a single static id"
);

test.todo(
  "Party Favors: gate and repeat the draw/channel clauses per chooser result, including the caster's own " +
    "share of every choosing player's clause, once the choice results are bound"
);
