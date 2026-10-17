import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/ivern-nurturer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-d16fb2648e7e67bb98e89d79ce7ab8da7d8444eb3e9111b6847cabe2620a2187";
const SOURCE_TEXT =
  "When you play me or when I hold, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. " +
  "Recycle the rest. Then if you revealed a Bird, Cat, Dog, or Poro, do this: [Buff] a friendly unit. (Give it a +1 :rb_might: buff if it doesn't have one.)";

const [onPlay, onHold] = program.abilities;
const [bindController, lookTopThree, revealChoice, recycleRest, buffIfTrait] = onPlay.body;
const [revealUnit, drawRevealedUnit] = revealChoice.args.body.value;
const [revealedPick] = revealUnit.picks;

/** The reference kernel resolves linked values by key, so golden runs bind it. */
const DECK_TOP_THREE = "ivern-nurturer.top-three";
const LOOKED_KEY = "ivern-nurturer.looked-cards";
const OPTIONAL_ID = "ivern-nurturer.reveal-unit-opt/optional";

const resultFor = (outcome, id) => outcome.results.find(entry => entry.id === id);
const resultEntries = (outcome, id) => outcome.results
  .filter(entry => entry.id === id)
  .map(entry => [entry.id, entry.result.status, entry.result.reason]);

/**
 * The production chain adapter decodes only whitelisted literal fields
 * (chain/interpreter-adapter.ts LITERAL_FIELDS, which lists effect.reveal's
 * `target` but not `pick`), so the reveal's Expr-wrapped pick id reaches the
 * primitive undeclared and its schema rejects it. The two golden steps below
 * therefore execute that primitive through the reference kernel with the card's
 * own static pick id and TargetSpec-free pick declaration, which is the same
 * single-primitive path the merged tests use; the whole-body run is recorded as a
 * contract change request in the task reply, not worked around in card data.
 */
const REVEALED_PICK_ID = revealUnit.args.pick.value;

function worldWithDeck() {
  // A single-id .card() call stacks on top of the existing deck, so the calls
  // below are made bottom-to-top to obtain the printed top-to-bottom order.
  const kernel = world()
    .card("third-gear", { types: ["gear"], owner: "A", zone: "deck" })
    .card("second-spell", { types: ["spell"], owner: "A", zone: "deck" })
    .card("top-unit", { types: ["unit"], owner: "A", zone: "deck" })
    .unit("ally", { might: 2 })
    .build();
  kernel.setPicks(DECK_TOP_THREE, kernel.zoneSlice("A", "deck", "top", 3).map(object => object.ref));
  return kernel.clone({ source: kernel.ref("top-unit"), sourceSnapshot: kernel.getObject("top-unit") });
}

test("unl-051-219 Ivern, Nurturer: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-051-219 Ivern, Nurturer: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Bird, Cat, Dog, or Poro/);
  assert.match(program.judgeReason, /Recycle the rest/);
});

test("unl-051-219 Ivern, Nurturer: the printed text hangs off both the play and the hold condition (383.4.a.1/383.4.d.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(onPlay.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(onPlay.trigger.at, "card-played");
  assert.equal(onHold.trigger.at, "hold");
  assert.deepEqual(onHold.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.equal(onPlay.optional, false);
  assert.equal(onHold.optional, false);
  // Both conditions carry the same printed instructions.
  assert.deepEqual(
    onHold.body.map(instruction => instruction.id),
    onPlay.body.map(instruction => instruction.id)
  );
});

test("unl-051-219 Ivern, Nurturer: the private top-3 look reads the controller and an ordered deck-top pick", () => {
  // 190.6.d: "your Main Deck" belongs to the ability controller; the value is
  // read from the source snapshot rather than hard-coding a seat.
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindController.args.key, { kind: "constant", value: "controller" });

  assert.equal(lookTopThree.op, "effect.inspect");
  assert.deepEqual(lookTopThree.args.player, {
    kind: "linked-value",
    instructionId: "ivern-nurturer.bind-controller",
    key: "controller"
  });
  assert.deepEqual(lookTopThree.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(lookTopThree.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookTopThree.args.amount, { kind: "constant", value: 3 });
  // Contract 3.6: deck order must come from upstream ordered picks, never query.
  assert.deepEqual(lookTopThree.args.picksSpecId, { kind: "constant", value: DECK_TOP_THREE });
  assert.deepEqual(lookTopThree.args.choose, { kind: "constant", value: false });
  assert.deepEqual(lookTopThree.args.pickedKey, { kind: "constant", value: LOOKED_KEY });
  assert.equal(lookTopThree.linkedTo, "ivern-nurturer.bind-controller");
});

test("unl-051-219 Ivern, Nurturer: the resolution-time may wraps reveal-and-draw in choice.optional (contract 3.9)", () => {
  // 383.3.a.3: "You may reveal …" is not the first part of the effect, so it is
  // decided on resolution and wrapped per contract 3.9.
  assert.equal(revealChoice.op, "choice.optional");
  assert.equal(revealChoice.linkedTo, "ivern-nurturer.look-top-three");
  assert.deepEqual(revealChoice.args.body.value.map(instruction => instruction.id), [
    "ivern-nurturer.reveal-unit",
    "ivern-nurturer.draw-revealed-unit"
  ]);

  // 425.1 / 425.1.a.2: reveal presents the chosen card without changing zones;
  // the choice is a non-target pick over the looked-at refs (355.7/355.10.a).
  assert.equal(revealUnit.op, "effect.reveal");
  assert.deepEqual(revealUnit.args.pick, { kind: "constant", value: "ivern-nurturer.revealed-unit" });
  assert.equal(revealUnit.targets, undefined);
  assert.equal(revealedPick.id, "ivern-nurturer.revealed-unit");
  assert.deepEqual(revealedPick.options, [
    {
      kind: "linked-value",
      instructionId: "ivern-nurturer.look-top-three",
      key: LOOKED_KEY
    }
  ]);
  // "a unit from among them" is the printed restriction; the merged pick
  // resolution never consumes a filter over a linked option set (see judgeReason).
  assert.deepEqual(revealedPick.filter, { type: "unit", zone: "deck" });
  assert.equal(revealedPick.min, 1);
  assert.equal(revealedPick.max, 1);
  assert.equal(revealedPick.selection, "one");

  // 414.1: "draw it" adds that card to the hand (a zone move, not a Draw action).
  assert.equal(drawRevealedUnit.op, "effect.zone");
  assert.equal(drawRevealedUnit.linkedTo, "ivern-nurturer.reveal-unit");
  assert.deepEqual(drawRevealedUnit.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawRevealedUnit.args.amount, { kind: "constant", value: 1 });
});

test("unl-051-219 Ivern, Nurturer: 'Recycle the rest' and the trait Buff keep their documented shapes", () => {
  // 417.1 / 417.1.a: the rest goes to the bottom of the owner's Main Deck; the
  // set difference has no merged expression, so the rest key is a documented
  // placeholder that no merged instruction writes (see judgeReason).
  assert.equal(recycleRest.op, "effect.recycle");
  assert.deepEqual(recycleRest.args.objects, {
    kind: "linked-value",
    instructionId: "ivern-nurturer.look-top-three",
    key: "rest"
  });
  assert.equal(recycleRest.linkedTo, undefined);

  // 383.2.a.1 / contract 3.4: the trait clause is a condition on the reveal
  // snapshot; the retained compare cannot test a tags array, so the merged
  // engine skips this Buff instead of running it unconditionally.
  assert.equal(buffIfTrait.op, "effect.buff");
  assert.deepEqual(buffIfTrait.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffIfTrait.targets, [
    {
      id: "ivern-nurturer.friendly-unit",
      filter: { type: "unit", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(buffIfTrait.condition.kind, "compare");
  assert.equal(buffIfTrait.condition.operator, "in");
  assert.deepEqual(buffIfTrait.condition.right, {
    kind: "constant",
    value: ["Bird", "Cat", "Dog", "Poro"]
  });
  assert.deepEqual(buffIfTrait.condition.left.object, {
    linked: "ivern-nurturer.reveal-unit"
  });
});

test("unl-051-219 Ivern, Nurturer golden: the look reads exactly the ordered top three and links them", () => {
  const kernel = worldWithDeck();
  const outcome = resolveChainBody([bindController, lookTopThree], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [
      ["ivern-nurturer.bind-controller", "executed"],
      ["ivern-nurturer.look-top-three", "executed"]
    ]
  );
  // 128.4 / 432.1.c: looking is private and moves nothing.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "top-unit",
    "second-spell",
    "third-gear"
  ]);
  assert.equal(outcome.linkedValues["ivern-nurturer.look-top-three.looked"], 3);
  assert.deepEqual(outcome.linkedValues[`ivern-nurturer.look-top-three.${LOOKED_KEY}`], [
    { id: "top-unit", zoneEntryId: 1 },
    { id: "second-spell", zoneEntryId: 1 },
    { id: "third-gear", zoneEntryId: 1 }
  ]);
  assert.deepEqual(outcome.events.map(event => event.action), ["look"]);
});

test("unl-051-219 Ivern, Nurturer golden: reveal presents exactly the chosen card and leaves it in the deck", () => {
  // 425.1 / 425.1.a.2 / 425.3: revealing the chosen unit presents it publicly and
  // does not move it; the choice is the card's non-target pick over the looked-at
  // ordered set.
  const kernel = worldWithDeck();
  const run = runInstruction(
    reveal,
    { pick: REVEALED_PICK_ID },
    {
      world: kernel,
      picks: { [REVEALED_PICK_ID]: [kernel.ref("top-unit")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, [kernel.ref("top-unit")]);
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["reveal"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "top-unit",
    "second-spell",
    "third-gear"
  ]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test("unl-051-219 Ivern, Nurturer golden: 'draw it' moves the revealed card into its owner's hand (414.1)", () => {
  const kernel = worldWithDeck();
  const run = runInstruction(
    zone,
    {
      pick: REVEALED_PICK_ID,
      to: drawRevealedUnit.args.to,
      amount: drawRevealedUnit.args.amount
    },
    {
      world: kernel,
      picks: { [REVEALED_PICK_ID]: [kernel.ref("top-unit")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-unit"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-spell", "third-gear"]);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test("unl-051-219 Ivern, Nurturer golden: declining the may skips reveal and draw (contract 3.9)", () => {
  const kernel = worldWithDeck();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const declined = resolveChainBody(onPlay.body, kernel);
  assert.deepEqual(
    resultEntries(declined, "ivern-nurturer.reveal-unit-opt"),
    [["ivern-nurturer.reveal-unit-opt", "negated", "skipped"]]
  );
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "top-unit",
    "second-spell",
    "third-gear"
  ]);
  // 359.3.e.14.b: refusing the may only negates that instruction; the look and
  // the following instructions still resolve as far as they can.
  assert.equal(resultFor(declined, "ivern-nurturer.look-top-three").result.status, "executed");
  assert.equal(declined.events.filter(event => event.action === "look").length, 1);
});

test("unl-051-219 Ivern, Nurturer golden: 'Recycle the rest' recycles the looked-at remainder to the deck bottom", () => {
  // 417.1 / 417.4: recycling the remainder moves those cards to the bottom of
  // their owner's Main Deck. The card's own objects expression is used with the
  // remainder supplied as the reviewed placeholder for the set difference.
  const kernel = worldWithDeck();
  // The recycled cards land at the bottom in the order effect.recycle is given
  // (CR 417.1.a / 417.5.a), so the supplied remainder order is observable.
  const rest = [kernel.ref("third-gear"), kernel.ref("second-spell")];
  const restRun = runInstruction(
    recycle,
    { objects: recycleRest.args.objects },
    { world: kernel, linked: { rest } }
  );
  assert.equal(restRun.result.status, "executed");
  assert.equal(restRun.linked.recycledCount, 2);
  assert.deepEqual(restRun.linked.recycled, rest);
  // 417.1.a: the recycled cards land at the bottom in recycle order.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "top-unit",
    "third-gear",
    "second-spell"
  ]);
  assert.deepEqual(restRun.events.map(event => event.action), ["recycle", "recycle"]);
});

test("unl-051-219 Ivern, Nurturer golden: the trait Buff really places one Buff counter on the chosen friendly unit", () => {
  // 702.2.a / 702.3.a: the printed Buff action runs on the merged effect.buff
  // primitive with this card's own arguments; the trait clause that gates it is
  // the recorded gap (see judgeReason).
  const kernel = worldWithDeck();
  // The interpreter evaluates each argument expression before dispatch, so the
  // primitive receives the literal mode and TargetSpec id from the card's args.
  const run = runInstruction(buff, { mode: "buff", target: "ivern-nurturer.friendly-unit" }, {
    world: kernel,
    targets: { "ivern-nurturer.friendly-unit": [kernel.ref("ally")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.deepEqual(run.events.map(event => event.action), ["buff"]);
});

test.todo(
  "unl-051-219 Ivern, Nurturer: produce the ordered Main-Deck-top picks for effect.inspect in production " +
    "(contract 3.6 zoneSlice ordering must reach the look)"
);

test.todo(
  "unl-051-219 Ivern, Nurturer: register the card-played and hold triggers end to end " +
    "(CR 383.4.a.1/383.4.d.2.a; the hold event must carry the held unit so the self filter can match)"
);
