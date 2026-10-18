import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/clairvoyance.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-932322ea9e594610dbc296c7b27a00cf97a5637134ab5407c3535c195d48e658";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Predict 5]. (Look at the top 5 cards of your Main Deck. Recycle any of them and put the rest back in any order.)\n" +
  "Draw 2.";

const [reaction, play] = program.abilities;
const [bindController, look, recycle, putBack, drawInstruction] = play.body;
const [predictRange] = look.picks;
const [restPick] = putBack.picks;

// The card's inspect issues its select request under the interpreter's
// path-derived id: the execution path plus the primitive's choiceId argument.
const LOOK_CHOICE_ID = "clairvoyance.predict-look/clairvoyance.predict-select";

const PREDICT_DECK = ["c1", "c2", "c3", "c4", "c5", "c6"];

/** The full program through the real ProgramBinding, Chain and EventPipeline. */
const runScenario = (answers) =>
  runCardScenario(program, {
    players: { A: { energy: 10, zones: { deck: PREDICT_DECK } } },
    objects: [
      { id: "spell", cardId: program.canonicalCardId, types: ["spell"], zone: "hand", energy: 7, power: null },
      ...PREDICT_DECK.map(id => ({ id, owner: "A", types: ["unit"], zone: "deck" })),
    ],
    answers,
    operations: [
      { type: "play", object: "spell", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" },
    ],
  });

const zoneIds = (result, zone) =>
  result.state.objects.filter(object => object.zone === zone).map(object => object.ref.id).sort();

/** Cards actually drawn, in order, from the real card-drawn events. */
const drawnIds = (result) =>
  result.events.filter(event => event.timingPoint === "card-drawn").map(event => event.object.ref.id);

/** The single ordered look's actual card sequence (417 / 437 order of view). */
const lookedIds = (result) =>
  result.events.filter(event => event.timingPoint === "cards-looked-at")
    .flatMap(event => event.action.objects.map(object => object.id));

/** Cards that actually left for the deck bottom (417.1.a), in performed order. */
const recycledIds = (result) =>
  result.events.filter(event => event.timingPoint === "object-enters-deck")
    .map(event => event.object.ref.id);

test("ven-056-166 Clairvoyance: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  // README section 2: an executable program carries no judgeReason.
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(CANONICAL), program);
});

// The previous "judgeReason names the ordered deck-top gap" test was deleted with
// the gap itself: RIFT-358 wired PickSpec.zoneSlice into Finalize, so the card now
// declares its own ordered top-5 source instead of waiting for an external binding.

test("ven-056-166 Clairvoyance: printed energy 7, absent power, [Reaction] keyword", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 7 }
  });
  // power: null in the catalog means no printed power; the field is absent.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("ven-056-166 Clairvoyance: structure — Predict 5 (inspect/recycle/order) then an independent Draw 2", () => {
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "clairvoyance.bind-controller",
    "clairvoyance.predict-look",
    "clairvoyance.predict-recycle",
    "clairvoyance.predict-put-back",
    "clairvoyance.draw"
  ]);

  // 「your Main Deck」的隐含 you（190.6.d）：先读出来源控制者，避免把玩家 id 写进卡数据。
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindController.args.key, { kind: "constant", value: "controller" });

  // 437.1 / 437.1.a step 1: look at exactly five cards and choose any number of
  // them to recycle; the ordered range comes from this card's own zoneSlice.
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(look.args.player, {
    kind: "linked-value",
    instructionId: "clairvoyance.bind-controller",
    key: "controller"
  });
  assert.deepEqual(look.args.picksSpecId, { kind: "constant", value: predictRange.id });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, { kind: "constant", value: { min: 0, max: 5 } });
  assert.equal(look.targets, undefined);
  assert.equal(look.linkedTo, "clairvoyance.bind-controller");

  // Contract 3.6 / RIFT-358: the explicit ordered source is options: [],
  // ordered: true, selection: "all" plus a zoneSlice. This is what makes the
  // top-5 look read the real deck order at Finalize instead of a set query.
  assert.deepEqual(predictRange, {
    id: "clairvoyance.predict-top-5",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 5 } }
  });

  // 437.1.a: "Recycle any of them".
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "clairvoyance.predict-look",
    key: "clairvoyance.predict-recycle"
  });
  assert.equal(recycle.linkedTo, "clairvoyance.predict-look");

  // 437.1.a: "put the rest back in any order" — "the rest" is the actual viewed
  // list (linked) minus the actually recycled identities (exclude), so the count
  // comes from the real result instead of a hard-coded 5 - N.
  assert.equal(putBack.op, "effect.order");
  assert.deepEqual(putBack.args.destination, { kind: "constant", value: "top" });
  assert.deepEqual(putBack.args.chooseOrder, { kind: "constant", value: true });
  assert.deepEqual(putBack.args.cardsPick, { kind: "constant", value: restPick.id });
  assert.equal(Object.hasOwn(putBack.args, "count"), false);
  assert.deepEqual(restPick, {
    id: "clairvoyance.predict-rest",
    options: [],
    ordered: true,
    selection: "all",
    linked: {
      kind: "linked-value",
      instructionId: "clairvoyance.predict-look",
      key: "clairvoyance.predict-looked"
    },
    exclude: {
      kind: "linked-value",
      instructionId: "clairvoyance.predict-recycle",
      key: "recycled"
    }
  });
  assert.equal(putBack.linkedTo, "clairvoyance.predict-recycle");

  // "Draw 2." is independent of the Predict steps (359.3.e.11), so it is not
  // linked to them.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("ven-056-166 Clairvoyance golden: recycling one predicted card puts it on the bottom and the rest back on top", () => {
  // Full card through the real ProgramBinding + ChainEngine + EventPipeline.
  const result = runScenario({
    [LOOK_CHOICE_ID]: ["c2"],
    // effect.order issues its request under the interpreter path plus the
    // primitive's fixed id; the harness also accepts the short "order" alias.
    order: ["c3", "c1", "c4", "c5"]
  });

  // 417.1.a: c2 recycles to the bottom of its owner's Main Deck. The four cards
  // put back land on top in the chosen order; c6 was never looked at, and the
  // following "Draw 2." then takes the two new top cards into hand.
  assert.deepEqual(lookedIds(result), ["c1", "c2", "c3", "c4", "c5"]);
  assert.deepEqual(recycledIds(result), ["c2"]);
  assert.deepEqual(zoneIds(result, "trash"), ["spell"]);
  assert.equal(result.state.players.A.handSize, 2);
  assert.equal(result.state.players.A.deckSize, 4);
  assert.equal(result.links["clairvoyance.predict-look.inspected"], 5);
  assert.equal(result.links["clairvoyance.predict-recycle.recycledCount"], 1);
  assert.equal(result.links["clairvoyance.predict-put-back.ordered"], 4);
  // "Draw 2." really drew the two top cards (414.1.a).
  assert.equal(result.links["clairvoyance.draw.drawn"], 2);
  assert.deepEqual(drawnIds(result), ["c3", "c1"]);
});

test("ven-056-166 Clairvoyance golden: recycling nothing puts all five predicted cards back", () => {
  const result = runScenario({
    [LOOK_CHOICE_ID]: [],
    order: ["c5", "c4", "c3", "c2", "c1"]
  });

  // 437.1.a: the rest (here: all five) go back on top in any order, above the
  // untouched sixth card, then Draw 2 takes the two new top cards.
  assert.equal(result.links["clairvoyance.predict-look.inspected"], 5);
  assert.equal(result.links["clairvoyance.predict-recycle.recycledCount"], 0);
  assert.equal(result.links["clairvoyance.predict-put-back.ordered"], 5);
  assert.deepEqual(recycledIds(result), []);
  assert.deepEqual(drawnIds(result), ["c5", "c4"]);
  assert.equal(result.state.players.A.deckSize, 4);
  assert.deepEqual(zoneIds(result, "trash"), ["spell"]);
});

test("ven-056-166 Clairvoyance golden: the ordered rest excludes exactly what was recycled", () => {
  // The exclude half of RIFT-358 does identity subtraction: recycling two cards
  // leaves three for effect.order, and the recycled pair lands at the deck bottom.
  const result = runScenario({
    [LOOK_CHOICE_ID]: ["c1", "c5"],
    order: ["c4", "c3", "c2"]
  });

  assert.equal(result.links["clairvoyance.predict-look.inspected"], 5);
  assert.equal(result.links["clairvoyance.predict-recycle.recycledCount"], 2);
  assert.equal(result.links["clairvoyance.predict-put-back.ordered"], 3);
  // c1 and c5 recycle in the chosen order; neither card reappears in the put-back
  // (that is the exclude doing its job), and the remaining three go back on top.
  assert.deepEqual(recycledIds(result), ["c1", "c5"]);
  assert.equal(result.links["clairvoyance.predict-put-back.ordered"] + result.links["clairvoyance.predict-recycle.recycledCount"], 5);
  assert.equal(result.state.players.A.handSize, 2);
  assert.deepEqual(drawnIds(result), ["c4", "c3"]);
  assert.deepEqual(zoneIds(result, "trash"), ["spell"]);
});

test("ven-056-166 Clairvoyance golden: a short Main Deck predicts as many as possible without Burn Out", () => {
  // 437.4 / 437.4.a: predicting more cards than available looks at as many as
  // possible and never causes a Burn Out; the whole body still executes.
  const result = runCardScenario(program, {
    players: { A: { energy: 10, zones: { deck: ["only-card"] } } },
    objects: [
      { id: "spell", cardId: program.canonicalCardId, types: ["spell"], zone: "hand", energy: 7, power: null },
      { id: "only-card", owner: "A", types: ["unit"], zone: "deck" }
    ],
    answers: { [LOOK_CHOICE_ID]: [] },
    operations: [
      { type: "play", object: "spell", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  });

  assert.equal(result.links["clairvoyance.predict-look.inspected"], 1);
  assert.equal(result.links["clairvoyance.predict-recycle.recycledCount"], 0);
  // "the rest" is the single un-recycled card: it goes back on top (437.1.a),
  // which is why the following Draw 2 then finds it.
  assert.equal(result.links["clairvoyance.predict-put-back.ordered"], 1);
  assert.deepEqual(recycledIds(result), []);
  // 414.4: the one available card was drawn, and no Burn Out action occurred.
  assert.equal(result.links["clairvoyance.draw.drawn"], 1);
  assert.deepEqual(drawnIds(result), ["only-card"]);
  assert.equal(result.events.some(event => event.timingPoint === "burn-out"), false);
});

test("ven-056-166 Clairvoyance golden: the top-5 look refuses to infer deck order without an ordered range", () => {
  // Contract 3.6 / effect.inspect: a non-zero top look must come from an
  // ordered range; without it the primitive fails closed instead of falling
  // back to a set query. Removing picksSpecId models exactly the missing
  // provider while every other argument stays the card's own.
  const kernel = world().deck(["c1", "c2"]).build();
  const { picksSpecId, ...withoutOrderedRange } = look.args;
  assert.deepEqual(picksSpecId, { kind: "constant", value: predictRange.id });

  // The player argument is the card's own linked-value read of its controller;
  // binding it to the acting player is exactly what the production chain does
  // (see the unl/eclipse golden), so only the ordered range is withheld here.
  const run = runInstruction(
    inspect,
    { ...withoutOrderedRange, player: { kind: "constant", value: "A" } },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.asked, null);
  assert.equal(kernel.player("A").deckSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
});

// The two former TODOs (external ordered top-5 provider, missing [Predict X]
// KeywordDef) were replaced by the executing scenarios above: the card declares
// its own zoneSlice source and 437 renders the action directly, so no keyword
// definition is required for this spell's printed text.
