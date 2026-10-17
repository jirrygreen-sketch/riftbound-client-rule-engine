import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/suave-negotiator.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CARD_ID = "card.hash-e7d215ccfa0f015b2ba252effc317eb2e2c19280d7d01a4eb41aba1ea8340507";
const SOURCE_TEXT = "When you play me, choose an opponent. You and that player each draw 1.";
const PICK_ID = "suave-negotiator.chosen-player";

test("rad-099-167 Suave Negotiator: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.9\.a/);
  assert.match(program.judgeReason, /ChoiceRequest/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-099-167 Suave Negotiator: one card-played trigger with two draw instructions", () => {
  assert.equal(program.abilities.length, 1);
  const triggered = program.abilities[0];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "suave-negotiator.draw-self",
    "suave-negotiator.draw-opponent"
  ]);
  // "You and that player each draw 1" is one instruction pair, so the second
  // draw is not linked to the first (neither depends on the other's result).
  assert.equal(triggered.body[1].linkedTo, undefined);
});

test("rad-099-167 Suave Negotiator: the chosen opponent is a non-target pick, never a TargetSpec", () => {
  const [drawSelf, drawOpponent] = program.abilities[0].body;

  // "You … draw 1": the implicit drawer is the ability controller (CR 190.6.d).
  assert.equal(drawSelf.op, "effect.draw");
  assert.deepEqual(drawSelf.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawSelf.targets, undefined);
  assert.equal(drawSelf.picks, undefined);

  // "that player … draw 1": the chosen opponent arrives through the draw
  // primitive's pick input, because 355.10.e makes a player chosen in part by
  // other players a non-target choice and targets() only returns ObjectRefs.
  assert.equal(drawOpponent.op, "effect.draw");
  assert.deepEqual(drawOpponent.args, {
    amount: { kind: "constant", value: 1 },
    pick: { kind: "constant", value: PICK_ID }
  });
  assert.equal(drawOpponent.targets, undefined);
  assert.deepEqual(drawOpponent.picks, [
    {
      id: PICK_ID,
      options: ["dynamic:opponent-players"],
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-099-167 Suave Negotiator: both players draw once the opponent pick is provisioned", () => {
  const body = program.abilities[0].body;
  const kernel = world().deck("my-card").deck("their-card", { owner: "B" }).build();
  // Finalize resolves "an opponent" to a PlayerId; the reference kernel exposes
  // it through the declared PickSpec id (ctx.picks allows PlayerIds).
  kernel.setPicks(PICK_ID, ["B"]);
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => `${result.id}:${result.result.status}`), [
    "suave-negotiator.draw-self:executed",
    "suave-negotiator.draw-opponent:executed"
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("B").handSize, 1);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["their-card"]);
  assert.equal(outcome.events.filter(event => event.action === "draw").length, 2);
});

test("rad-099-167 Suave Negotiator: each draw is an independent Draw 1 (CR 414.1/414.3)", () => {
  const [drawSelf] = program.abilities[0].body;
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, drawSelf.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("rad-099-167 Suave Negotiator: an empty opponent pick makes the second draw impossible, not a free draw", () => {
  const [, drawOpponent] = program.abilities[0].body;
  const kernel = world().deck("theirs", { owner: "B" }).build();
  const run = runInstruction(
    draw,
    { amount: { kind: "constant", value: 1 }, pick: PICK_ID },
    { world: kernel, picks: { [PICK_ID]: [] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.player("B").handSize, 0);
});

test.todo(
  "suave-negotiator: choosing an opponent (CR v1.5 355.7 / 355.9.a player choice) needs a player pick/target" +
    " shape: ChoiceRequest has only optional/mode/select-objects/order/number, and targets() returns ObjectRefs only" +
    " (contract change request: add a player pick/target form)"
);
test.todo(
  "suave-negotiator: card-played trigger end-to-end through the production chain, resolving the opponent pick at" +
    " Finalize (RIFT-257 card-program trigger binding / production trigger registration)"
);
