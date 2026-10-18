import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/divine-judgment.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-adf97d6260131adb3a3b5b54d1904b16d8330ea2476fe31e8652a57b081a380a";

const play = program.abilities[0];
const chooseInstruction = play.body[0];
const recycleInstruction = play.body[1];
const pickIds = chooseInstruction.picks.map(pick => pick.id);
const forged = { ...program, status: "executable", judgeReason: undefined };

const trashCard = (id, extra = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: `card:${id}`,
  name: id,
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "deck",
  location: null,
  might: 1,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...extra
});

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
  assert.match(program.judgeReason, /choice\.each-player/);
  assert.match(program.judgeReason, /355\.10\.a/);
  assert.match(program.judgeReason, /417\.1\.a/);
  assert.match(program.judgeReason, /effect\.recycle/);
  assert.match(program.judgeReason, /运行时对象集合/);
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

test("ogn-244-298 Divine Judgment current gap: neither declared op is registered, so the card's body cannot run", () => {
  assert.equal(instructionDefinitionsById.has("choice.each-player"), false);
  assert.equal(instructionDefinitionsById.has("effect.recycle-rest"), false);
  const kernel = world().unit("unit", {}).build();
  assert.throws(
    () => runAbilityBody(play.body, kernel),
    /Unregistered instruction opcode: choice\.each-player/
  );
});

test("ogn-244-298 Divine Judgment current gap: the pick options are descriptive strings no code parses", () => {
  // Each category declares a `dynamic:…` option string. Nothing resolves them:
  // they are static Value entries, and the merged kernels take their option
  // lists from the caller. The recycle query below keys off real objects, not
  // these strings.
  assert.deepEqual(
    chooseInstruction.picks.map(pick => pick.options),
    [
      ["dynamic:units-on-board"],
      ["dynamic:gear-on-board"],
      ["dynamic:runes-in-rune-zone"],
      ["dynamic:cards-in-hand"]
    ]
  );
  // The reference kernel exposes no resolver for such a spelling.
  const kernel = world().unit("unit", {}).build();
  assert.deepEqual(kernel.picks("divine-judgment-units"), []);
});

test("ogn-244-298 Divine Judgment golden: the merged recycle primitive recycles N from one zone", () => {
  // effect.recycle is the piece "recycle the rest" needs; the merged form
  // recycles a chosen count from a single zone (417.6) and shows why the
  // complement selection is the missing part.
  const kernel = world().deck("main-card").build();
  kernel.addObject(trashCard("trashed-card", { types: ["card"] }), "trash");
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

test("ogn-244-298 Divine Judgment golden: effect.recycle cannot express a complement", () => {
  // Two kept units and one spare: "recycle the rest" must pick the spare by
  // subtraction, but the primitive only takes an amount from a zone (or an
  // explicit object list). Recycling the amount recycles whichever cards the
  // caller answers with, not the complement.
  const kernel = world().deck(["deck:1", "deck:2", "deck:3", "deck:4"]).build();
  for (const id of ["kept-a", "kept-b", "spare"]) {
    kernel.addObject(trashCard(id, { zone: "board", location: { type: "base", player: "A" } }), "board");
  }
  const run = runInstruction(
    recycle,
    { from: { zone: "board", owner: "controller", amount: { kind: "literal", value: 1 } } },
    { world: kernel, answers: { "effect.recycle:board:controller:1": [kernel.ref("kept-a")] } }
  );
  // The instruction recycles exactly the answered card: it has no way to know
  // that "the rest" means "the board units outside the kept set".
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("kept-a").zone, "deck");
  assert.equal(kernel.getObject("spare").zone, "board");
  assert.deepEqual(Object.keys(run.result.linkedValues).sort(), ["recycled", "recycledCount"]);
});

test("ogn-244-298 Divine Judgment golden: effect.recycle routes mixed objects by type and owner", () => {
  const kernel = world()
    .deck("main-a", { owner: "A" })
    .deck("main-b", { owner: "B" })
    .rune("rune-a", { owner: "A" })
    .card("unit-A", { zone: "board", types: ["unit"], owner: "A" })
    .card("gear-B", { zone: "board", types: ["gear"], owner: "B" })
    .hand("hand-B", { types: ["card"], owner: "B" })
    .card("rune-A", { zone: "rune-zone", types: ["rune"], owner: "A" })
    .build();
  const refs = ["unit-A", "gear-B", "hand-B", "rune-A"].map(id => kernel.ref(id));

  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: refs } },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.recycledCount, 4);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["main-a", "unit-A"]);
  assert.deepEqual(kernel.zone("B", "deck").map(ref => ref.id), ["main-b", "gear-B", "hand-B"]);
  assert.deepEqual(kernel.zone("A", "rune-deck").map(ref => ref.id), ["rune-a", "rune-A"]);
  assert.equal(kernel.getObject("unit-A").zone, "deck");
  assert.equal(kernel.getObject("gear-B").zone, "deck");
  assert.equal(kernel.getObject("hand-B").zone, "deck");
  assert.equal(kernel.getObject("rune-A").zone, "rune-deck");
});

test("ogn-244-298 Divine Judgment current gap: the program cannot be described for play by the production binder", () => {
  const state = fixture({ cards: [{ id: "judgment", cardId: CARD_ID, types: ["spell"], energy: 7, power: ["Order"] }] });
  const binding = createProgramBinding({ cardPrograms: [forged] });
  const draft = binding.describePlay({ type: "play", object: state.kernel.ref("judgment"), player: "A" }, state.kernel.getObject("judgment"));
  // describePlay itself only translates surfaces; the missing ops surface when
  // the draft is executed, so the card can be put on the chain but never resolve.
  assert.deepEqual(draft.body.map(instruction => instruction.op), ["choice.each-player", "effect.recycle-rest"]);
  assert.equal(instructionDefinitionsById.has(draft.body[0].op), false);
});

test.todo(
  "Divine Judgment: iterate every player for each of the four categories (2 units, 2 gear, " +
    "2 runes, 2 hand cards) with runtime pick options including the non-public hand choice " +
    "(355.10.a), then recycle the complement with per-type destinations " +
    "(units/gear/hand -> Main Deck bottom, runes -> Rune Deck bottom; 417.1.a/417.1.b/417.1.c)"
);
test.todo(
  "Divine Judgment: recycle the complement of the kept sets (417.6) and present the 417.5 random order " +
    "for 2+ simultaneous Main Deck recycles without hiding which cards were kept"
);

