import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/invert-timelines.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-2b0d48b46b31dd4d55ffc8e62c6db42641a683f4550c4a410384c03a347a0cc9";
const [play] = program.abilities;
const [discardHand, drawFour] = play.body;

test("Invert Timelines program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Invert Timelines identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("355.10.e"), true);
  assert.equal(program.judgeReason.includes("355.18"), true);
  assert.equal(program.sourceText, "Each player discards their hand, then draws 4.");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Invert Timelines structure: printed cost plus a full-hand discard then Draw 4", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(play.body.length, 2);

  // "discards their hand": a whole-hand discard with no card-based choice and
  // no target (355.10.e / 355.18 non-targeting; 108.7.b private Hand).
  assert.equal(discardHand.op, "effect.discard");
  assert.deepEqual(discardHand.args, { amount: { kind: "constant", value: "all" } });
  assert.equal(discardHand.targets, undefined);
  assert.equal(discardHand.picks, undefined);
  assert.equal(discardHand.linkedTo, undefined);

  // "then draws 4": the next printed instruction; the sequencing is not a
  // linked-result dependency, so no linkedTo.
  assert.equal(drawFour.op, "effect.draw");
  assert.deepEqual(drawFour.args, { amount: { kind: "constant", value: 4 } });
  assert.equal(drawFour.linkedTo, undefined);
  assert.equal(drawFour.targets, undefined);
});

test("Invert Timelines golden: one seat discards its whole hand then draws 4", () => {
  const kernel = world()
    .hand("hand-1")
    .hand("hand-2")
    .hand("hand-3")
    .deck(["deck-1", "deck-2", "deck-3", "deck-4", "deck-5"])
    .build();
    // resolveChainBody is the production handoff: it keeps the static IR Expr
  // nodes intact for the registered primitive schemas (contract 3.6).
  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["invert-timelines.discard-hand", "executed"],
    ["invert-timelines.draw-4", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 4);
  assert.equal(kernel.player("A").deckSize, 1);
  // The three old cards went to the trash (423.1: discard, not a generic
  // move); the four new ones are the deck top.
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["hand-1", "hand-2", "hand-3"]);
  assert.deepEqual(
    kernel.zone("A", "hand").map(ref => ref.id),
    ["deck-1", "deck-2", "deck-3", "deck-4"]
  );
  assert.deepEqual(outcome.events.map(event => event.action), ["discard", "discard", "discard", "draw"]);
});

test("Invert Timelines golden: an empty hand still draws 4", () => {
  const kernel = world().deck(["deck-1", "deck-2", "deck-3", "deck-4"]).build();
    // resolveChainBody is the production handoff: it keeps the static IR Expr
  // nodes intact for the registered primitive schemas (contract 3.6).
  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["invert-timelines.discard-hand", "executed"],
    ["invert-timelines.draw-4", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 4);
  assert.equal(kernel.zone("A", "trash").length, 0);
});

test("Invert Timelines golden: a short deck draws as many as possible (414.4)", () => {
  const kernel = world().hand("hand-1").deck(["deck-1", "deck-2"]).build();
    // resolveChainBody is the production handoff: it keeps the static IR Expr
  // nodes intact for the registered primitive schemas (contract 3.6).
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 0);
});

test.todo(
  "Invert Timelines: the whole-table sweep \"Each player discards their hand, then draws 4\" " +
    "(355.10.e / 355.18 resolution-time choices for every seat, including the opponent) needs " +
    "the multi-player selection/repetition primitive (RIFT-9 target.player) and the CardProgram " +
    "binding path (RIFT-257)."
);
