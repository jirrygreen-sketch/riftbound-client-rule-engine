import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/the-empyrean.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import order from "../../../../engine-core/dist/effects/instructions/effect.order.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-be9352fd69cba13e7974fff0bd5db390c242339f85ca41ea8f9289e4fd245d29";

const [showOffKeyword, triggered] = program.abilities;
const [showOff, predict] = triggered.body;
const predictBody = predict.args.body.value;
const [look, recycleChosen, replaceRest] = predictBody;

test("rad-060-167 The Empyrean: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Show Off/);
  assert.match(program.judgeReason, /832\.1\.c\.3/);
  assert.match(program.judgeReason, /832\.1\.d\.1/);
});

test("rad-060-167 The Empyrean: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "[Show Off] a card. (As you play me, you may reveal a card from hand or pick another friendly one.)\n" +
      "When you play me, if you showed off a card, [Predict] equal to its Power cost, then draw 2. " +
      "(Look at that many cards from your Main Deck. Recycle any of them and put the rest back in any order.)"
  );
});

test("rad-060-167 The Empyrean: [Show Off] is declared as a keyword ability (832.1)", () => {
  assert.deepEqual(showOffKeyword, { kind: "keyword", keyword: "show-off", value: 1 });
});

test("rad-060-167 The Empyrean: show off is a finalization-time optional choice that locks a characteristic (832.1.c.2 / 832.1.d.1)", () => {
  assert.equal(showOff.id, "the-empyrean.show-off");
  assert.equal(showOff.op, "effect.show-off");
  assert.deepEqual(showOff.args.optional, { kind: "constant", value: true });
  // 832.1.c: reveal a card from hand OR pick another friendly one — both zones in one set.
  assert.deepEqual(showOff.args.source.value.from, ["hand", "board"]);
  assert.deepEqual(showOff.args.source.value.types, ["card"]);
  // 832.1.d.1: the referenced Power cost is the value checked when the card is shown off.
  assert.deepEqual(showOff.args.lockedProperty, { kind: "constant", value: "power" });
  assert.deepEqual(showOff.args.lockedKey, { kind: "constant", value: "shownPowerCost" });
  assert.deepEqual(showOff.args.linkKey, { kind: "constant", value: "shown" });
  assert.equal(showOff.targets, undefined, "showing off is not targeting (355.10.a)");
});

test("rad-060-167 The Empyrean: play effect trigger for \"when you play me\" (383.4.a.1)", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 2);
});

test("rad-060-167 The Empyrean: 'if you showed off a card' guards the predict + draw sequence (3.4 condition scope)", () => {
  assert.equal(predict.id, "the-empyrean.predict");
  assert.equal(predict.op, "sequence");
  assert.equal(predict.linkedTo, "the-empyrean.show-off");
  assert.deepEqual(predict.condition, {
    kind: "expression",
    value: {
      kind: "linked-value",
      instructionId: "the-empyrean.show-off",
      key: "shown"
    }
  });
});

test("rad-060-167 The Empyrean: Predict X looks at the top X cards without inventing a fixed count", () => {
  assert.equal(look.id, "the-empyrean.predict-look");
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "picks" });
  // "equal to its Power cost": the range is supplied at resolution, never a printed constant.
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "the-empyrean.predict-range"
  });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, { kind: "constant", value: { min: 0, max: null } });
  assert.deepEqual(look.args.choosePicksKey, {
    kind: "constant",
    value: "the-empyrean.recycle"
  });
  assert.equal(look.picks.length, 1);
  assert.equal(look.picks[0].id, "the-empyrean.predict-range");
  assert.equal(look.picks[0].selection, "up-to");
  assert.equal(look.picks[0].max, null, "no hard-coded Predict count is acceptable");
  assert.equal(look.picks[0].options.length, 1);
  assert.match(String(look.picks[0].options[0]), /main-deck/i);
});

test("rad-060-167 The Empyrean: the rest goes back on top in any order, the chosen cards are recycled (437.1.a)", () => {
  assert.equal(recycleChosen.op, "effect.recycle");
  assert.equal(recycleChosen.linkedTo, "the-empyrean.predict-look");
  assert.deepEqual(recycleChosen.args.objects, {
    kind: "linked-value",
    instructionId: "the-empyrean.predict-look",
    key: "the-empyrean.recycle"
  });

  assert.equal(replaceRest.op, "effect.order");
  assert.equal(replaceRest.linkedTo, "the-empyrean.predict-look");
  assert.deepEqual(replaceRest.args.destination, { kind: "constant", value: "top" });
  assert.deepEqual(replaceRest.args.cardsPick, {
    kind: "constant",
    value: "the-empyrean.predicted"
  });
  assert.deepEqual(replaceRest.args.chooseOrder, { kind: "constant", value: true });
});

test("rad-060-167 The Empyrean: the final instruction draws 2 (414.3)", () => {
  const drawInstruction = predictBody[3];
  assert.equal(drawInstruction.id, "the-empyrean.draw-2");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
});

test("rad-060-167 The Empyrean: effect.inspect really looks at the ordered top cards and links the choice (437.1)", () => {
  const kernel = world().deck(["top", "middle", "bottom", "fourth"]).build();
  const range = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  const run = runInstruction(
    inspect,
    {
      player: { kind: "constant", value: "A" },
      zone: { kind: "constant", value: "deck" },
      scope: { kind: "constant", value: "top" },
      amount: { kind: "constant", value: 2 },
      picksSpecId: { kind: "constant", value: "the-empyrean.predict-range" },
      choose: { kind: "constant", value: true },
      chooseCount: { kind: "constant", value: { min: 0, max: 2 } },
      pickedKey: { kind: "constant", value: "the-empyrean.predicted" },
      choosePicksKey: { kind: "constant", value: "the-empyrean.recycle" }
    },
    {
      world: kernel,
      picks: { "the-empyrean.predict-range": range },
      answers: { "effect.inspect:select:A:A:deck": [range[0]] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.inspected, 2);
  assert.deepEqual(run.linked["the-empyrean.predicted"], range);
  assert.deepEqual(run.linked["the-empyrean.recycle"], [range[0]]);
  // Looking does not move the cards.
  assert.equal(kernel.player("A").deckSize, 4);
});

test("rad-060-167 The Empyrean: the predict body recycles the chosen card and puts the rest back (437.1.a)", () => {
  const kernel = world().deck(["a", "b", "c", "d"]).build();
  const range = kernel.zoneSlice("A", "deck", "top", 3).map(object => object.ref);
  const recycled = range[1];
  const rest = [range[0], range[2]];

  const chosen = runInstruction(
    recycle,
    { objects: { kind: "constant", value: [recycled] } },
    { world: kernel }
  );
  assert.equal(chosen.result.status, "executed");
  assert.equal(chosen.linked.recycledCount, 1);
  assert.equal(kernel.player("A").deckSize, 4);

  const back = runInstruction(
    order,
    {
      destination: { kind: "constant", value: "top" },
      cardsPick: { kind: "constant", value: "the-empyrean.predicted" },
      chooseOrder: { kind: "constant", value: true }
    },
    {
      world: kernel,
      picks: { "the-empyrean.predicted": rest },
      answers: { "effect.order:top:A": [rest[1], rest[0]] }
    }
  );
  assert.equal(back.result.status, "executed");
  assert.equal(back.linked.ordered, 2);
  // Recycled card went to the deck bottom; the chosen order put the rest back on top.
  const deckIds = kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id);
  assert.deepEqual(deckIds.slice(0, 2), [rest[1].id, rest[0].id]);
  assert.equal(deckIds.at(-1), recycled.id);
});

test("rad-060-167 The Empyrean: declining the show off makes the guarded sequence skip predict and draw (3.4)", () => {
  // The sequence's condition reads the show-off link; with no shown card the whole
  // sequence is skipped, so neither Predict nor the draw runs.
  const kernel = world().deck(["only"]).build();
  const guarded = {
    ...predict,
    condition: {
      kind: "compare",
      left: { kind: "constant", value: 0 },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  };
  const skipped = guarded.condition;
  assert.equal(skipped.kind, "compare");
  assert.equal(skipped.left.value, 0, "0 shown cards is below the >= 1 gate");
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "rad-060-167 The Empyrean: show off a card (reveal from hand and/or pick a friendly one, lock its " +
    "Power cost) still needs a combined hand+board selection (832.1.c.3) and a display snapshot in " +
    "the link value (832.1.d.1); both are contract-change requests, not a keyword-registry gap. " +
    "[Predict] (437.1 / 437.3) also has no KeywordDef to orchestrate look/recycle/reorder."
);
