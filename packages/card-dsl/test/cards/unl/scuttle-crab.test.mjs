import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/scuttle-crab.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-91762c9845d59867fb973e9ccacb4f75c8ba2a8d294513c8512d195dc2690d51";
const SOURCE_TEXT =
  "(Units with 0 :rb_might: can conquer and hold.)\n" +
  "When you play me, draw 1.\n" +
  "[Deathknell][>] Choose an opponent. They reveal their hand. You can look at their facedown cards this turn. " +
  "Gain 1 XP. (When I die, get the effects.)";

const [deathknell, playTrigger, deathTrigger] = program.abilities;
const [drawOne] = playTrigger.body;
const [chooseOpponent, revealHand, lookFacedown, gainXp] = deathTrigger.body;

test("unl-053-219 Scuttle Crab: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-053-219 Scuttle Crab: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Choose an opponent/);
  assert.match(program.judgeReason, /Facedown Zone/);
  assert.match(program.judgeReason, /107\.3\.a/);
  assert.match(program.judgeReason, /trigger\.leave/);
});

test("unl-053-219 Scuttle Crab: [Deathknell] is declared and its printed effect is authored explicitly (808.1.c)", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknell.value, undefined);
  // 808.1.c / 808.1.d: functionally "When I die, [Effect]"; the death trigger is
  // the permanent being killed and sent to the Trash (429.1).
  assert.equal(deathTrigger.kind, "triggered");
  assert.equal(deathTrigger.trigger.at, "object-killed");
  assert.deepEqual(deathTrigger.trigger.filter, {
    self: true,
    cause: "kill",
    destination: "trash"
  });
  assert.equal(deathTrigger.optional, false);
  // 135.2.d.1/d.3: "(When I die, get the effects.)" is reminder text and does
  // not add an ability; the first line's 0-Might reminder is likewise not a
  // separate ability.
  assert.deepEqual(deathTrigger.body.map(instruction => instruction.id), [
    "scuttle-crab.choose-opponent",
    "scuttle-crab.reveal-hand",
    "scuttle-crab.look-facedown-cards",
    "scuttle-crab.gain-xp"
  ]);
});

test("unl-053-219 Scuttle Crab: 'When you play me, draw 1.' is a Play Effect drawing one card (383.4.a, 414.3)", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.body.length, 1);
  assert.equal(drawOne.id, "scuttle-crab.draw-one");
  assert.equal(drawOne.op, "effect.draw");
  // The drawer defaults to the ability controller (190.6.d); no target or pick.
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("unl-053-219 Scuttle Crab: 'Choose an opponent' keeps the missing player-target shape (355.7/355.9.a)", () => {
  assert.equal(chooseOpponent.op, "target.player");
  assert.deepEqual(chooseOpponent.args.selection, { kind: "constant", value: "one" });
  assert.deepEqual(chooseOpponent.args.chooser, { kind: "constant", value: "controller" });
  assert.deepEqual(chooseOpponent.args.linkKey, { kind: "constant", value: "chosenOpponent" });
  assert.equal(chooseOpponent.targets, undefined);
});

test("unl-053-219 Scuttle Crab: 'They reveal their hand' reveals the whole hand and the facedown look keeps its placeholder", () => {
  // 425.3.a: revealing a zone without a count presents every card currently in it.
  assert.equal(revealHand.op, "effect.reveal");
  assert.deepEqual(revealHand.args.player, {
    kind: "linked-value",
    instructionId: "scuttle-crab.choose-opponent",
    key: "chosenOpponent"
  });
  assert.deepEqual(revealHand.args.zone, { kind: "constant", value: "hand" });
  assert.equal(revealHand.args.count, undefined);
  assert.equal(revealHand.linkedTo, "scuttle-crab.choose-opponent");

  // 128.4 / 107.3.a/107.3.f: looking at the opponent's facedown cards is a
  // private look whose zone is not a merged ZoneId; the placeholder records the
  // printed reference (see judgeReason) and is never treated as executable data.
  assert.equal(lookFacedown.op, "effect.inspect");
  assert.deepEqual(lookFacedown.args.player, { kind: "constant", value: "self" });
  assert.deepEqual(lookFacedown.args.zone, { kind: "constant", value: "facedown-zone" });
  assert.deepEqual(lookFacedown.args.scope, { kind: "constant", value: "zone" });
  assert.equal(lookFacedown.linkedTo, "scuttle-crab.choose-opponent");
});

test("unl-053-219 Scuttle Crab: 'Gain 1 XP' adds one XP to the controller (730.1)", () => {
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 1 } });
  // 731.1: XP is not a Game Object, so it is never a target.
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
});

test("unl-053-219 Scuttle Crab golden: the play trigger's effect.draw takes the top card (414.1/414.3)", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("unl-053-219 Scuttle Crab golden: an empty Main Deck draws 0 without inventing a card (414.4)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test("unl-053-219 Scuttle Crab golden: the reveal presents exactly the chosen opponent's hand (425.3)", () => {
  const kernel = world()
    .hand("b1", { owner: "B" })
    .hand("b2", { owner: "B" })
    .hand("a1", { owner: "A" })
    .build();
  // The player-target binding is the missing primitive; the golden supplies the
  // chosen opponent's seat directly so the merged reveal runs for real.
  const run = runInstruction(
    reveal,
    { player: { kind: "constant", value: "B" }, zone: { kind: "constant", value: "hand" } },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, [kernel.ref("b1"), kernel.ref("b2")]);
  assert.equal(run.linked.revealedCount, 2);
  // 425.1.a.2: revealed cards stay in their zone; the viewer's own hand is out of scope.
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["b1", "b2"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["a1"]);
  assert.deepEqual(run.events.map(event => event.action), ["reveal", "reveal"]);
});

test("unl-053-219 Scuttle Crab golden: 'Gain 1 XP' really marks one XP on the controller (728/730.1)", () => {
  const kernel = world().player("A", { xp: 2 }).build();
  const run = runInstruction(xp, gainXp.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.gained, 1);
  assert.equal(run.linked.gainedTo, "A");
  assert.equal(kernel.player("A").xp, 3);
  assert.deepEqual(run.events.map(event => event.action), ["gain-xp"]);
});

test.todo(
  "unl-053-219 Scuttle Crab: choose an opponent as a player target and link that player to reveal/inspect (CR 355.7/355.9.a)"
);
test.todo(
  "unl-053-219 Scuttle Crab: grant access to the chosen opponent's Facedown Zone for the rest of this turn (CR 107.3.a/107.3.f/425.1.a.3)"
);
test.todo(
  "unl-053-219 Scuttle Crab: bind the printed Deathknell body to its trigger.leave skeleton and preserve killed-to-Trash filtering and last-known information (CR 808.1.c/808.1.d)"
);
