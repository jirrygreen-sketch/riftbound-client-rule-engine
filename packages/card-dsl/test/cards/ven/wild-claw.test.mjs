import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/wild-claw.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-28f97aabe7a3a4dfd6dae43c8b97140d885896c00f5daa8175c00a2e9b0a9d64";
const SOURCE_TEXT =
  "Look at the top 5 cards of your Main Deck. You may banish a unit or gear " +
  "from among them and play it, reducing its Energy cost by :rb_energy_5:. " +
  "Recycle the rest. Then you may do this: Empower it. (It becomes Empowered if " +
  "it's not already.)";

const [play] = program.abilities;
const [bindController, lookTopFive, mayBanishAndPlay, recycleRest, mayEmpower] = play.body;
const [banishChosen, playIt] = mayBanishAndPlay.args.body.value;
const [empowerIt] = mayEmpower.args.body.value;
const [topFivePick] = lookTopFive.picks;

const LOOK_CHOICE_ID = "wild-claw.look-top-five/wild-claw.pick-card";
const BANISH_CHOICE_ID = "wild-claw.may-banish-and-play/optional";
const EMPOWER_CHOICE_ID = "wild-claw.may-empower/optional";

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

/**
 * The reference kernel binds `source` to the ability host, so the spell is
 * installed as the source snapshot and the deck is stacked top-to-bottom. The
 * ordered deck-top set the merged effect.inspect requires for a non-zero top
 * look (contract 3.6 zoneSlice; query order is not a deck order) is supplied
 * through the declared PickSpec.
 */
function wildClawWorld(cards = ["unit-a", "gear-b", "spell-c", "spell-d", "spell-e", "deeper"]) {
  const kernel = world()
    .object("wild-claw", { zone: "chain", types: ["spell"], owner: "A", controller: "A", energy: 7, power: ["Body"] })
    .deck(cards, { owner: "A" })
    .build();
  kernel.setPicks(topFivePick.id, kernel.zone("A", "deck").slice(0, 5));
  return kernel;
}

test("ven-089-166 Wild Claw: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-089-166 Wild Claw: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-089-166 Wild Claw: judgeReason names the cost reduction, the 'it' reference and the type filter gaps", () => {
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /356\.1\.c/);
  assert.match(program.judgeReason, /356\.6/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9|RIFT-89|RIFT-90/);
  assert.match(program.judgeReason, /effect\.play/);
  assert.match(program.judgeReason, /effect\.empower/);
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-089-166 Wild Claw: printed 7 Energy + 1 Body Power cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 7 },
    power: { kind: "constant", value: 1 }
  });
});

test("ven-089-166 Wild Claw structure: look-top-5, may(banish -> play), recycle the rest, may empower", () => {
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["wild-claw.bind-controller", "condition.value"],
    ["wild-claw.look-top-five", "effect.inspect"],
    ["wild-claw.may-banish-and-play", "choice.optional"],
    ["wild-claw.recycle-rest", "effect.recycle"],
    ["wild-claw.may-empower", "choice.optional"]
  ]);

  // "your Main Deck" is the caster's deck: the controller is bound once as a
  // data value (190.6.d) and read back by the look that needs a player id.
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindController.args.key, { kind: "constant", value: "controller" });

  // "Look at the top 5 cards of your Main Deck": private look in top scope,
  // reading the deck in real zone order through the ordered pick set.
  assert.deepEqual(lookTopFive.args.player, {
    kind: "linked-value",
    instructionId: "wild-claw.bind-controller",
    key: "controller"
  });
  assert.deepEqual(lookTopFive.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(lookTopFive.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookTopFive.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(lookTopFive.args.picksSpecId, { kind: "constant", value: "wild-claw.top-five" });
  assert.deepEqual(lookTopFive.args.choose, { kind: "constant", value: true });
  assert.deepEqual(lookTopFive.args.chooseCount, { kind: "constant", value: { min: 0, max: 1 } });
  assert.deepEqual(lookTopFive.args.choiceId, { kind: "constant", value: "wild-claw.pick-card" });
  assert.deepEqual(lookTopFive.args.choosePicksKey, { kind: "constant", value: "selectedCard" });
  assert.equal(lookTopFive.targets, undefined);
  assert.deepEqual(topFivePick, {
    id: "wild-claw.top-five",
    options: ["runtime:main-deck-top-five"],
    min: 0,
    max: 5,
    selection: "up-to",
    filter: { type: ["unit", "gear"], zone: "deck", owner: "self" }
  });

  // Contract 3.9: the "you may banish … and play it" wraps both chosen
  // instructions inside one choice.optional body.
  assert.deepEqual(mayBanishAndPlay.args.body.value.map(instruction => instruction.id), [
    "wild-claw.banish-chosen-card",
    "wild-claw.play-it"
  ]);
  assert.equal(banishChosen.op, "effect.banish");
  // 355.10.a / 355.18: the card is in the private Main Deck, so the choice is a
  // resolve-time non-target pick, consumed through the linked selection.
  assert.deepEqual(banishChosen.args.objects, {
    kind: "constant",
    value: { linked: "selectedCard" }
  });
  assert.equal(banishChosen.linkedTo, undefined);
  assert.deepEqual(banishChosen.args.linkKey, { kind: "constant", value: "banished" });

  // "then play it, reducing its Energy cost by [5]": the play reads the banished
  // card's fresh reference (124) and carries the required cost rewrite, which
  // no merged producer materializes (judgeReason).
  assert.equal(playIt.linkedTo, "wild-claw.banish-chosen-card");
  assert.deepEqual(playIt.args.object, {
    kind: "linked-value",
    instructionId: "wild-claw.banish-chosen-card",
    key: "banishedObject"
  });
  assert.deepEqual(playIt.args.cost.value, {
    kind: "cost.modify",
    base: "printed",
    discount: { resource: "energy", amount: 5, minimum: 0 },
    finalized: false
  });
  assert.equal(playIt.targets, undefined);

  // "Recycle the rest": the looked-at list itself; the banished/played card's
  // old reference is stale, which is exactly "the rest" (417.1.a / 417.4).
  assert.deepEqual(recycleRest.args.objects, {
    kind: "linked-value",
    instructionId: "wild-claw.look-top-five",
    key: "lookedCards"
  });
  assert.equal(recycleRest.targets, undefined);

  // "Then you may do this: Empower it.": a second optional instruction whose
  // "it" refers to the permanent the play instruction put on the Board; the
  // reference has no producer (judgeReason), so the selector stays descriptive.
  assert.deepEqual(mayEmpower.args.body.value.map(instruction => instruction.id), [
    "wild-claw.empower-it"
  ]);
  assert.equal(empowerIt.op, "effect.empower");
  assert.deepEqual(empowerIt.args.objects, {
    kind: "constant",
    value: { linked: "wild-claw.play-it" }
  });
  assert.equal(empowerIt.targets, undefined);
});

test("ven-089-166 Wild Claw golden: looking at the top 5 is an ordered read and moves nothing (128.3-128.4)", () => {
  const kernel = wildClawWorld();
  const before = kernel.zone("A", "deck");

  // The may-banish choice is answered with "none" so the look half runs alone.
  kernel.setAnswers({ [LOOK_CHOICE_ID]: [] });

  // The look itself (the card's first instruction with its own args) submits one
  // private look over the ordered top five; the ordered set is the declared
  // PickSpec supplied by the caller, never a set-query guess (contract 3.6).
  const outcome = resolveChainBody([bindController, lookTopFive], kernel);

  assert.equal(resultFor(outcome, "wild-claw.look-top-five").result.status, "executed");
  assert.equal(outcome.linkedValues["wild-claw.look-top-five.looked"], 5);
  assert.deepEqual(
    outcome.linkedValues["wild-claw.look-top-five.lookedCards"].map(ref => ref.id),
    ["unit-a", "gear-b", "spell-c", "spell-d", "spell-e"]
  );
  // 425.1.a.2 / 128.3-128.4: looking never changes the zone or the deck order.
  assert.deepEqual(kernel.zone("A", "deck"), before);
  assert.equal(kernel.player("A").deckSize, 6);
  assert.equal(kernel.player("A").handSize, 0);
});

test("ven-089-166 Wild Claw golden: declining the may banishes nothing and still recycles every looked-at card", () => {
  const kernel = wildClawWorld();
  kernel.setAnswers({
    [LOOK_CHOICE_ID]: [],
    [BANISH_CHOICE_ID]: false,
    [EMPOWER_CHOICE_ID]: false
  });

  const outcome = resolveChainBody(play.body, kernel);

  // 359.3.e.11 / 417.4: declining the optional banish+play does not stop the
  // following sentence — all five looked-at cards recycle to the bottom of the
  // owner's Main Deck, and the unlooked card stays on top (417.1.a).
  assert.deepEqual(resultFor(outcome, "wild-claw.may-banish-and-play").result, {
    status: "negated",
    reason: "skipped",
    events: []
  });
  assert.equal(resultFor(outcome, "wild-claw.recycle-rest").result.status, "executed");
  assert.equal(outcome.linkedValues["wild-claw.recycle-rest.recycledCount"], 5);
  assert.deepEqual(kernel.objectsInZone("A", "banishment"), []);
  // Recycled cards receive a fresh zone entry (124), so the deck is compared by
  // identity and order, not by the pre-recycle references.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "deeper", "unit-a", "gear-b", "spell-c", "spell-d", "spell-e"
  ]);
  assert.equal(kernel.player("A").handSize, 0);
});

test("ven-089-166 Wild Claw golden: the chosen card is banished and the rest is recycled (417.1.a)", () => {
  const kernel = wildClawWorld();
  const looked = kernel.zone("A", "deck").slice(0, 5);
  kernel.setAnswers({
    [LOOK_CHOICE_ID]: [looked[1]],
    [BANISH_CHOICE_ID]: true,
    [EMPOWER_CHOICE_ID]: false
  });

  const outcome = resolveChainBody(play.body, kernel);

  // "You may banish a unit or gear from among them": the chosen gear leaves its
  // Main Deck zone for its owner's Banishment (428.1 / 428.2).
  assert.equal(resultFor(outcome, "wild-claw.banish-chosen-card").result.status, "executed");
  assert.deepEqual(kernel.zone("A", "banishment").map(ref => ref.id), ["gear-b"]);
  // The chosen card's old deck reference is stale, so "recycle the rest" recycles
  // exactly the other four looked-at cards (417.1.a / 417.4), and the unlooked
  // card stays on top.
  assert.equal(resultFor(outcome, "wild-claw.recycle-rest").result.status, "executed");
  assert.equal(outcome.linkedValues["wild-claw.recycle-rest.recycledCount"], 4);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "deeper", "unit-a", "spell-c", "spell-d", "spell-e"
  ]);
});

test.todo(
  "ven-089-166 Wild Claw: play the banished card with its Energy cost reduced by :rb_energy_5: and floored " +
    "at 0 (CR 356.1.c / 356.6) — cost.modify exists, but the card still needs a dynamic printed-cost producer " +
    "and the Finalize cost-plan entry point; effect.play requires an already-finalized plan"
);

test.todo(
  "ven-089-166 Wild Claw: 'Then you may do this: Empower it' — needs the played permanent's Board reference " +
    "(effect.play links only the played count, and the Banishment receipt's reference is stale after the play) " +
    "together with an object selector form effect.empower accepts for that prior result (CR 442.1 / 124)"
);

test.todo(
  "ven-089-166 Wild Claw: restrict the inspected choice to a unit or gear (CR 417.6-style type restriction) — " +
    "effect.inspect's resolve-time choose does not read the PickSpec filter, so the declared filter is descriptive " +
    "until the ordered-pick/filter consumer from RIFT-358 is complete"
);
