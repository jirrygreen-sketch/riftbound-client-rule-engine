import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/agonys-embrace.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-94134bbbfa792bc74c51d8f90ca3d64c802ed0a643c32b0e50464e8b2431f37d";
const SOURCE_TEXT =
  "Once each turn, when you play a card from face down, draw 1. Then, if it's not your turn, " +
  "discard 1.";

const [ability] = program.abilities;
const [drawInstruction, discardInstruction] = ability.body;

test("rad-153-167 Agony's Embrace: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-153-167 Agony's Embrace: identity, status, judgeReason, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The gap must stay concrete: the missing action/zone/event fact and the missing
  // turn-player predicate, each with the merged interface that rejects it.
  assert.match(program.judgeReason, /Hide 动作/);
  assert.match(program.judgeReason, /facedown-zone/);
  assert.match(program.judgeReason, /355\.9\.a\.3/);
  assert.match(program.judgeReason, /Unsupported filter field details/);
  assert.match(program.judgeReason, /notYourTurn/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("rad-153-167 Agony's Embrace: once-per-turn card-played trigger for this controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.a / timing point "card-played": a card was played.
  assert.equal(ability.trigger.at, "card-played");
  // "you play" = this legend's controller; "from face down" stays declared as the
  // details.fromFaceDown premise (see judgeReason) instead of matching ordinary plays.
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    player: "self",
    details: { fromFaceDown: true }
  });
  // CR 383.3.e / 383.3.e.1: "Once each turn" = the once scope is per-turn.
  assert.equal(ability.trigger.once, "per-turn");
  assert.equal(ability.trigger.condition, undefined);
  // "when you play …" is mandatory; the "may" wording does not appear (383.3.a).
  assert.equal(ability.optional, false);
});

test("rad-153-167 Agony's Embrace: draw 1, then a condition-guarded discard 1", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "agonys-embrace.draw",
    "agonys-embrace.discard"
  ]);
  // CR 414.1 / 414.3: "draw 1"; the implicit drawer is the ability controller.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
  assert.equal(drawInstruction.targets, undefined);

  // CR 383.2.b / 135.2.b.3: "if it's not your turn" belongs to the effect and is
  // checked when this instruction resolves; its scope is exactly this
  // instruction (contract 3.4), so the draw is NOT gated by it.
  assert.equal(discardInstruction.op, "effect.discard");
  assert.equal(discardInstruction.linkedTo, undefined);
  assert.equal(discardInstruction.condition.kind, "expression");
  assert.deepEqual(discardInstruction.condition.value, {
    kind: "object-property",
    object: "source",
    property: "notYourTurn"
  });
  assert.deepEqual(discardInstruction.args.amount, { kind: "constant", value: 1 });
  // CR 423.1.a: the private discard choice needs a stable replay id.
  assert.deepEqual(discardInstruction.args.choiceId, {
    kind: "constant",
    value: "agonys-embrace.discard"
  });
});

test("rad-153-167 Agony's Embrace: the declared turn predicate has no evaluation path", () => {
  // "notYourTurn" is not an ObjectSnapshot characteristic, so the interpreter's
  // object-property read raises MissingInformation and the guarded instruction
  // is ignored (mistargeted) instead of being treated as true. That is the
  // honest evidence for the judge-required gap.
  const kernel = world().hand("kept").hand("also-kept").build();
  const host = kernel.ref("kept");
  const outcome = runAbilityBody([discardInstruction], kernel, undefined, { host });

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status, result.result.reason]),
    [["agonys-embrace.discard", "ignored", "mistargeted"]]
  );
  // Nothing was discarded: the condition could not be established.
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), []);
  assert.equal(kernel.player("A").handSize, 2);
});

test("rad-153-167 Agony's Embrace: the merged Draw 1 half really draws the top card", () => {
  // CR 414.1.a: drawing takes from the top of the Main Deck; amount comes from
  // the program's own argument expression.
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second"]);
});

test("rad-153-167 Agony's Embrace: the merged Discard 1 half really discards the chosen card", () => {
  // CR 423.1.a / 423.1.b: the player chooses which card leaves their Hand.
  const kernel = world().hand("kept").hand("chosen").build();
  const chosen = kernel.ref("chosen");
  const run = runInstruction(discard, discardInstruction.args, {
    world: kernel,
    answers: { "agonys-embrace.discard": [chosen] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.discarded.count, 1);
  assert.equal(run.linked.discarded.player, "A");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["chosen"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["kept"]);
});

test.todo(
  "rad-153-167 Agony's Embrace: recognize 'a card played from face down' in the card-played " +
    "trigger (CR 355.9.a.3 / 107.3.e; needs the Hide action, the Facedown Zone and a card-played " +
    "from-zone payload plus the trigger registration path)"
);
test.todo(
  "rad-153-167 Agony's Embrace: evaluate 'if it's not your turn' against the current turn player " +
    "(CR 304 / 383.2.b; needs a turn-player predicate in Condition/Expr)"
);
