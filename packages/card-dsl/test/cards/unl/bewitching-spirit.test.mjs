import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/bewitching-spirit.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import discard from "../../../../engine-core/dist/effects/instructions/effect.discard.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-50e54034f879028f4935bc194153081e4d10c422fae37e9dc5706755d4ecd302";
const SOURCE_TEXT = "When you play me, choose a player. They discard 1.";

const [playTrigger] = program.abilities;
const [choosePlayer, chosenDiscards] = playTrigger.body;

test("unl-121-219 Bewitching Spirit: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-121-219 Bewitching Spirit: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /target\.player/);
  assert.match(program.judgeReason, /355\.7/);
  assert.match(program.judgeReason, /355\.9\.a/);
  // The trigger registration path is merged now (RIFT-257); the reason must not
  // still claim no subscriber exists.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.doesNotMatch(program.judgeReason, /触发能力没有注册路径/);
});

test("unl-121-219 Bewitching Spirit: 'When you play me' is a mandatory card-played trigger on the source", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.trigger.once, undefined);
});

test("unl-121-219 Bewitching Spirit: 'choose a player' is a player choice, recorded as target.player (355.7/355.9.a)", () => {
  // 355.7: choosing a specific Player is Targeting unless an exception applies;
  // 355.9.a lists players as valid targets. 355.10's exemptions do not apply,
  // so this is not a non-target pick.
  assert.equal(choosePlayer.id, "bewitching-spirit.choose-player");
  assert.equal(choosePlayer.op, "target.player");
  assert.deepEqual(choosePlayer.args.selection, { kind: "constant", value: "one" });
  assert.deepEqual(choosePlayer.args.chooser, { kind: "constant", value: "controller" });
  assert.deepEqual(choosePlayer.args.options, { kind: "constant", value: "dynamic:players" });
  assert.deepEqual(choosePlayer.args.linkKey, { kind: "constant", value: "chosenPlayer" });
  assert.equal(choosePlayer.targets, undefined);
  assert.equal(choosePlayer.picks, undefined);
  assert.equal(choosePlayer.linkedTo, undefined);
});

test("unl-121-219 Bewitching Spirit: 'They discard 1' is a non-target hand discard by the chosen player (423.1/423.1.a)", () => {
  assert.equal(chosenDiscards.id, "bewitching-spirit.chosen-discards-1");
  assert.equal(chosenDiscards.op, "effect.discard");
  assert.equal(chosenDiscards.linkedTo, "bewitching-spirit.choose-player");
  assert.deepEqual(chosenDiscards.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(chosenDiscards.args.player, {
    kind: "linked-value",
    instructionId: "bewitching-spirit.choose-player",
    key: "chosenPlayer"
  });
  // The card is in a private zone, so its choice is a non-target pick made by the
  // discarding player (355.10.a, 423.1.a); the card does not declare a target.
  assert.equal(chosenDiscards.args.target, undefined);
  assert.equal(chosenDiscards.args.pick, undefined);
  assert.equal(chosenDiscards.targets, undefined);
  assert.equal(chosenDiscards.picks, undefined);
});

test("unl-121-219 Bewitching Spirit golden: the chosen player discards one card from their own hand", () => {
  const kernel = world()
    .hand("b1", { owner: "B" })
    .hand("b2", { owner: "B" })
    .hand("a1", { owner: "A" })
    .build();

  const run = runInstruction(
    discard,
    {
      amount: { kind: "constant", value: 1 },
      // The player argument is the linked value the player choice writes; the
      // choice pipeline itself is unmerged (see judgeReason), so the golden
      // supplies the chosen player directly.
      player: { kind: "linked-value", instructionId: "bewitching-spirit.choose-player", key: "chosenPlayer" }
    },
    {
      world: kernel,
      linked: { chosenPlayer: "B" },
      answers: { "effect.discard:B": [kernel.ref("b2")] }
    }
  );

  assert.equal(run.result.status, "executed");
  // 423.1: the discarded card goes to its owner's Trash; 423.1.a: that player chose it.
  assert.deepEqual(kernel.zone("B", "trash").map(ref => ref.id), ["b2"]);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["b1"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["a1"]);
  assert.equal(run.linked.discarded.count, 1);
  assert.equal(run.linked.discarded.player, "B");
});

test("unl-121-219 Bewitching Spirit golden: an empty hand negates the discard as impossible (423.4)", () => {
  const kernel = world().hand("a1", { owner: "A" }).build();

  const run = runInstruction(
    discard,
    {
      amount: { kind: "constant", value: 1 },
      player: { kind: "linked-value", instructionId: "bewitching-spirit.choose-player", key: "chosenPlayer" }
    },
    { world: kernel, linked: { chosenPlayer: "B" } }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  // The discarded card belongs to the chosen player, never to the controller.
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["a1"]);
  assert.deepEqual(kernel.zone("B", "trash"), []);
});

test("unl-121-219 Bewitching Spirit golden: the discard body runs on the merged primitive", () => {
  // The discard body is expressible with the merged effect.discard primitive; the
  // unmerged half is the player choice (recorded in the judgeReason).
  assert.notEqual(instructionDefinitionsById.get("effect.discard"), undefined);
});

test.todo(
  "unl-121-219 Bewitching Spirit: “choose a player” locks one of the current players at Finalize as a player " +
    "target (CR 355.7/355.9.a) — the frozen IR has no player-target shape and the registrar has no target.player " +
    "op (ability-templates section 4: each player is not equivalent to choose opponent)"
);
test("unl-121-219 Bewitching Spirit: the merged trigger binder registers this card's card-played subscription", () => {
  // RIFT-257's production adapter accepts the program's declared trigger and
  // registers it with the pipeline (same shape as unl/abandoned-hall).
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = {
    ref: { id: "spirit", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Bewitching Spirit",
    types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: { type: "base", player: "A" }, might: 2, energy: 3, power: [], exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  };
  const registered = [];
  const ids = binding.registerProgramTriggers(
    { pipeline: { registerTrigger: registration => registered.push(registration) } },
    source
  );

  assert.equal(ids.length, 1);
  assert.equal(registered[0].spec.at, "card-played");
  assert.deepEqual(registered[0].spec.filter, {
    event: "card-played",
    object: { objectId: "spirit" },
    player: "self"
  });
  assert.equal(registered[0].optional, false);
});

