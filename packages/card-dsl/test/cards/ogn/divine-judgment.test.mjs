import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/divine-judgment.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-adf97d6260131adb3a3b5b54d1904b16d8330ea2476fe31e8652a57b081a380a";

const play = program.abilities[0];
const chooseInstruction = play.body[0];
const recycleInstruction = play.body[1];
const pickIds = chooseInstruction.picks.map(pick => pick.id);

test("ogn-244-298 Divine Judgment: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Each player chooses 2 units, 2 gear, 2 runes, and 2 cards in their hands. Recycle the rest."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-244-298 Divine Judgment judgeReason names the per-player picks and complement gap", () => {
  // The scope of "the rest" is recorded as an open ruling that needs a judge.
  assert.match(program.judgeReason, /裁定/);
  assert.match(program.judgeReason, /choose/);
  assert.match(program.judgeReason, /355\.10\.a/);
  assert.match(program.judgeReason, /417\.1\.a/);
  assert.match(program.judgeReason, /effect\.recycle/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("ogn-244-298 Divine Judgment structure: four per-player picks then the recycle-the-rest node", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "divine-judgment-choose",
    "divine-judgment-recycle-rest"
  ]);

  // "Each player chooses ...": a resolution-time per-player decision, so it is
  // not a target (355.10.e) and needs the missing multi-chooser node.
  assert.equal(chooseInstruction.op, "choice.each-player");
  assert.equal(chooseInstruction.linkedTo, undefined);
  assert.deepEqual(chooseInstruction.args.choosers, { kind: "literal", value: "each-player" });
  assert.deepEqual(chooseInstruction.args.choose.value, [
    { type: "unit", zone: "board", count: 2 },
    { type: "gear", zone: "board", count: 2 },
    { type: "rune", zone: "rune-zone", count: 2 },
    { type: "card", zone: "hand", count: 2 }
  ]);
  assert.equal(chooseInstruction.targets, undefined);

  // Four separate categories, two objects each; the hand cards are non-public
  // (355.10.a) and can only ever be picks.
  assert.deepEqual(pickIds, [
    "divine-judgment-units",
    "divine-judgment-gear",
    "divine-judgment-runes",
    "divine-judgment-hand"
  ]);
  assert.deepEqual(
    chooseInstruction.picks.map(pick => pick.filter),
    [
      { type: "unit", zone: "board" },
      { type: "gear", zone: "board" },
      { type: "rune", zone: "rune-zone" },
      { type: "card", zone: "hand" }
    ]
  );
  for (const pick of chooseInstruction.picks) {
    assert.equal(pick.min, 0);
    assert.equal(pick.max, 2);
    assert.equal(pick.selection, "up-to");
  }

  // "Recycle the rest": the complement of the kept sets, split by type and by
  // destination deck (417.1.a/417.1.b/417.1.c).
  assert.equal(recycleInstruction.op, "effect.recycle-rest");
  assert.equal(recycleInstruction.linkedTo, "divine-judgment-choose");
  assert.deepEqual(recycleInstruction.args.keptKey, {
    kind: "literal",
    value: "divine-judgment-kept"
  });
  assert.deepEqual(recycleInstruction.args.zones.value, [
    { zone: "board", types: ["unit", "gear"], toDeck: "main" },
    { zone: "hand", types: ["card"], toDeck: "main" },
    { zone: "rune-zone", types: ["rune"], toDeck: "rune" }
  ]);
});

test("ogn-244-298 Divine Judgment golden: the merged recycle primitive recycles N from one zone", () => {
  // effect.recycle is the piece the card's "recycle the rest" clause needs; the
  // merged form recycles a chosen count from a single zone (417.6) and shows why
  // the complement selection is the missing part.
  const kernel = world().deck("main-card").build();
  kernel.addObject(
    {
      ref: { id: "trashed-card", zoneEntryId: 1 },
      cardId: "card:trashed-card",
      name: "trashed-card",
      types: ["card"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "trash",
      location: null,
      might: null,
      energy: null,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    },
    "trash"
  );
  const trashed = kernel.ref("trashed-card");

  const run = runInstruction(
    recycle,
    { from: { zone: "trash", owner: "controller", amount: { kind: "literal", value: 1 } } },
    { world: kernel, answers: { "effect.recycle:trash:controller:1": [trashed] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.recycledCount, 1);
  assert.equal(kernel.getObject("trashed-card").zone, "deck");
  // 417.1.a: main-deck cards go to the bottom of that player's Main Deck.
  assert.equal(kernel.zone("A", "deck").at(-1).id, "trashed-card");
});

test.todo(
  "Divine Judgment: iterating every player for each of the four categories (2 units, 2 gear, " +
    "2 runes, 2 hand cards) needs the multi-player choice primitive and runtime pick options " +
    "(RIFT-9 target.player / RIFT-90), including the non-public hand choice (355.10.a)."
);

test.todo(
  "Divine Judgment: 'Recycle the rest' needs a complement selection plus per-type destinations " +
    "(units/gear/hand -> Main Deck bottom, runes -> Rune Deck bottom; 417.1.a/417.1.b/417.1.c) " +
    "and the 417.5 random-order presentation for 2+ simultaneous Main Deck recycles."
);
