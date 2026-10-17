import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-rush.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-cd92b45de0981074325a5119213251cd97706ab04339f5fe7339e69c8761258a";
const SOURCE_TEXT =
  "Reveal the top 2 cards of your Main Deck. You may play one of them, reducing its cost by " +
  ":rb_energy_2:. Draw any you did not play this way.";

const [play] = program.abilities;
const revealInstruction = play.body[0];
const mayPlay = play.body[1];
const playInstruction = mayPlay.args.body.value[0];
const drawRest = play.body[2];

test("sfd-188-221 Void Rush: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason names the concrete current gaps and task numbers.
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-188-221 Void Rush structure: printed cost, ordered deck-top reveal, optional reduced play, remaining to hand", () => {
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["void-rush.reveal", "effect.reveal"],
      ["void-rush.may-play", "choice.optional"],
      ["void-rush.draw-rest", "effect.zone"]
    ]
  );

  // "Reveal the top 2 cards of your Main Deck": the ordered slice is an
  // upstream pick because query order is never deck order; 432.1.c keeps an
  // under-full deck legal.
  assert.equal(revealInstruction.targets, undefined);
  assert.deepEqual(revealInstruction.args.pick, { kind: "constant", value: "void-rush.top-two" });
  assert.equal(revealInstruction.picks.length, 1);
  const [topTwo] = revealInstruction.picks;
  assert.equal(topTwo.id, "void-rush.top-two");
  assert.equal(topTwo.selection, "up-to");
  assert.equal(topTwo.min, 0);
  assert.equal(topTwo.max, 2);
  assert.deepEqual(topTwo.options, ["deck-top-two-of-controller"]);
});

test("sfd-188-221 Void Rush structure: the play inside the optional body names the reduced-cost requirement", () => {
  // One optional decision (contract 3.9) whose body holds the play of one
  // revealed card; the printed cost minus 2 is a cost-plan request that only
  // selected-card Finalize integration must materialize (see judgeReason).
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.linkedTo, "void-rush.reveal");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.equal(playInstruction.op, "effect.play");
  assert.deepEqual(playInstruction.args.pick, { kind: "constant", value: "void-rush.played-card" });
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: { kind: "cost-plan-request", from: "printed", reduction: { energy: 2 } }
  });
  assert.equal(playInstruction.picks.length, 1);
  const [played] = playInstruction.picks;
  assert.equal(played.id, "void-rush.played-card");
  assert.equal(played.selection, "one");
  assert.equal(played.min, 1);
  assert.equal(played.max, 1);
  assert.deepEqual(played.options, [
    { kind: "linked-value", instructionId: "void-rush.reveal", key: "revealed" }
  ]);
});

test("sfd-188-221 Void Rush structure: pending Draw names all remaining revealed refs independently of the optional play", () => {
  // Pending selected-card Draw intent. It is independent of accepting play.
  // effect.zone is not Draw; no execution claim is made for this blocked part.
  assert.equal(drawRest.op, "effect.zone");
  assert.equal(drawRest.linkedTo, undefined);
  assert.deepEqual(drawRest.args.pick, { kind: "constant", value: "void-rush.remaining" });
  assert.deepEqual(drawRest.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawRest.args.amount, { kind: "constant", value: 2 });
  assert.equal(drawRest.targets, undefined);
  assert.equal(drawRest.picks.length, 1);
  const [remaining] = drawRest.picks;
  assert.equal(remaining.id, "void-rush.remaining");
  assert.equal(remaining.selection, "all");
  assert.equal(remaining.min, 0);
  assert.equal(remaining.max, 2);
  assert.deepEqual(remaining.options, [
    { kind: "linked-value", instructionId: "void-rush.reveal", key: "revealed" }
  ]);
});

test("sfd-188-221 Void Rush golden: the ordered deck-top reveal executes with a caller-supplied pick", () => {
  const kernel = world().deck(["c1", "c2", "c3"]).build();
  const topTwo = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  // The primitive itself executes the card's authored args when the ordered pick
  // is supplied (the missing producer is the Finalize lifecycle, see judgeReason).
  const run = runInstruction(reveal, { pick: "void-rush.top-two" }, {
    world: kernel,
    picks: { "void-rush.top-two": topTwo }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, topTwo);
  assert.equal(run.linked.revealedCount, 2);
  assert.deepEqual(run.events.map((event) => event.action), ["reveal", "reveal"]);
  // 425.1.a.2: revealed cards stay in the zone they were revealed from.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["c1", "c2", "c3"]);
});

test("sfd-188-221 Void Rush golden: a short deck reveals what is there instead of failing (432.1.c)", () => {
  const kernel = world().deck(["only-card"]).build();
  const run = runInstruction(reveal, { pick: "void-rush.top-two" }, {
    world: kernel,
    picks: { "void-rush.top-two": kernel.zone("A", "deck") }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(run.linked.revealed, [kernel.ref("only-card")]);
});

test.todo("Void Rush: hand the selected revealed card's printed plan with the existing [2] Energy discount to effect.play/Finalize (356.4/420.3)");
test.todo("Void Rush: bind ordered reveal picks through the real chain adapter (RIFT-358)");
test.todo("Void Rush: Draw the actual unplayed revealed objects and emit draw events even when optional play is declined (414.1); the pending effect.zone block cannot implement Draw");
