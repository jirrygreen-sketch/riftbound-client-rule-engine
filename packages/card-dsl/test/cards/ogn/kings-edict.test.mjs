import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/kings-edict.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CARD_ID = "card.hash-b27ddd6f340335a3b0cd6b5ad2ba3cd49695bb3a7430d3cfe541271f528f0baf";

const play = program.abilities[0];
const chooseInstruction = play.body[0];
const killInstruction = play.body[1];
const pickSpec = killInstruction.picks[0];

test("ogn-237-298 King's Edict: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Starting with the next player, each other player chooses a unit you don't control " +
      "that hasn't been chosen for this spell. Kill those units."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-237-298 King's Edict judgeReason names the chooser order and per-spell exclusion gaps", () => {
  assert.match(program.judgeReason, /each other player/);
  assert.match(program.judgeReason, /逐位/);
  assert.match(program.judgeReason, /hasn't been chosen for this spell/);
  assert.match(program.judgeReason, /累计/);
  assert.match(program.judgeReason, /355\.10\.e/);
  assert.match(program.judgeReason, /355\.18/);
  assert.match(program.judgeReason, /choice\.each-other-player/);
  // The non-target pick channel is the mechanism that stays supported; keep asserting it.
  assert.match(program.judgeReason, /非目标选择/);
  assert.match(program.judgeReason, /未注册/);
  assert.match(program.judgeReason, /Unregistered instruction opcode/);
  assert.match(program.judgeReason, /dynamic:units-chosen-for-this-spell/);
});

test("ogn-237-298 King's Edict structure: other-player choice node then a linked non-target kill", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), ["kings-edict-choose", "kings-edict-kill"]);

  // The choosers are the other players starting with the next player: a
  // resolution-time, multi-chooser decision that has no merged node.
  assert.equal(chooseInstruction.op, "choice.each-other-player");
  assert.equal(chooseInstruction.linkedTo, undefined);
  assert.deepEqual(chooseInstruction.args.startingWith, { kind: "literal", value: "next-player" });
  assert.deepEqual(chooseInstruction.args.choosers, { kind: "literal", value: "each-other-player" });
  assert.deepEqual(chooseInstruction.args.choose.value, {
    type: "unit",
    controller: "opponent",
    notChosenForThisSpell: true
  });

  // "Kill those units": the victims are chosen by other players, so they are
  // picks rather than targets (355.10.e); the merged kill primitive consumes
  // them through args.picks.
  assert.equal(killInstruction.op, "effect.kill");
  assert.equal(killInstruction.linkedTo, "kings-edict-choose");
  assert.deepEqual(killInstruction.args.picks, { kind: "literal", value: "kings-edict-units" });
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.picks.length, 1);
  assert.equal(pickSpec.id, "kings-edict-units");
  assert.equal(pickSpec.selection, "any");
  assert.equal(pickSpec.min, 0);
  assert.equal(pickSpec.max, null);
  assert.deepEqual(pickSpec.filter, { type: "unit", controller: "opponent" });
});

test("ogn-237-298 King's Edict golden: the merged kill half kills the picks supplied for the spell", () => {
  const kernel = world()
    .unit("first-victim", { owner: "B" })
    .unit("second-victim", { owner: "B" })
    .unit("survivor", { owner: "B" })
    .build();
  const picks = [kernel.ref("first-victim"), kernel.ref("second-victim")];

  const run = runInstruction(
    kill,
    { picks: "kings-edict-units" },
    { world: kernel, picks: { "kings-edict-units": picks } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("first-victim").zone, "trash");
  assert.equal(kernel.getObject("second-victim").zone, "trash");
  assert.equal(kernel.getObject("survivor").zone, "board");
  assert.equal(run.events.filter(event => event.action === "kill").length, 2);
  assert.deepEqual(run.result.linkedValues.killed, picks);
});

test("ogn-237-298 King's Edict golden: no units chosen leaves every unit alive", () => {
  const kernel = world().unit("untouched", { owner: "B" }).build();
  const run = runInstruction(
    kill,
    { picks: "kings-edict-units" },
    { world: kernel, picks: { "kings-edict-units": [] } }
  );

  // With nothing chosen there is no object to resolve: the instruction is
  // ignored (359.3.e) and no kill happens.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("untouched").zone, "board");
  assert.equal(run.events.length, 0);
});

test.todo(
  "King's Edict: starting with the next player, each opponent makes a non-target pick excluding all earlier picks " +
    "for this spell; kill the accumulated set only after the choices finish (CR 355.10.e, 355.18)"
);

test("ogn-237-298 King's Edict: the per-opponent chooser is registered", () => {
  // 355.10.e / 355.18's ordered chooser implementation is present. Execution
  // still needs this card's real instruction binding and runtime choices, so
  // registration alone does not make the card executable.
  assert.equal(instructionDefinitionsById.has("choice.each-other-player"), true);
});
