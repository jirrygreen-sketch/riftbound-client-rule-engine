import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/lightning-rush.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";

// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.

const CARD_ID = "card.hash-caa60c112cdc9dccc741c15d4bb6d88be761ea9eff1495e0945ebb1a86bc5d74";
const SOURCE_TEXT =
  "Look at the top 3 cards of your Main Deck. You may choose a card from among them and draw it. " +
  "Put the rest into your trash.\n" +
  "[Flow] :rb_energy_2::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)";
const VIEWED = "lightning-rush.viewed";
const CHOSEN = "lightning-rush.chosen-card";
const REST = "lightning-rush.rest";
const MAY = "lightning-rush.may-draw-chosen-card";

const [flowKeyword, play] = program.abilities;
const [bindController, lookTopThree, mayDraw, putRestIntoTrash] = play.body;
const [drawChosenCard] = mayDraw.args.body.value;
const [viewedPick] = lookTopThree.picks;
const [chosenPick] = drawChosenCard.picks;
const [restPick] = putRestIntoTrash.picks;

/** A four-card Main Deck plus the resolving spell as the ability source. */
const decked = () => {
  const kernel = world()
    .object("lightning-rush", { owner: "A", controller: "A", types: ["spell"], zone: "chain" })
    .deck(["top", "middle", "bottom", "fourth"], { owner: "A" })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("lightning-rush") });
};

/**
 * The production caller owns the ordered deck-top set effect.inspect requires
 * (contract 3.6 zoneSlice; query never carries zone order). The golden supplies
 * exactly that ordered set plus the resolution-time picks and answers, then runs
 * the card's own body — no instruction is rewritten.
 */
const runRush = (chosenIndex, { accept = true } = {}) => {
  const kernel = decked();
  const viewed = kernel.zoneSlice("A", "deck", "top", 3).map((object) => object.ref);
  kernel.setPicks(VIEWED, viewed);
  kernel.setPicks(CHOSEN, chosenIndex === null ? [] : [viewed[chosenIndex]]);
  kernel.setAnswers({ [`${MAY}/optional`]: accept });
  // "the rest" is the same looked-at group; the card leaves the amount unset,
  // so the primitive drops the stale (hand-moved) reference itself.
  kernel.setPicks(REST, viewed);
  return { kernel, viewed, outcome: resolveChainBody(play.body, kernel) };
};

const ids = (kernel, zone) => kernel.zone("A", zone).map((ref) => ref.id);

test("ven-156-166 Lightning Rush: program passes validateCardProgram as judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-156-166 Lightning Rush: judgeReason names Flow, the subset choice and chosen-card Draw gaps", () => {
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /picksSpecId/);
  assert.match(program.judgeReason, /Draw/);
  assert.match(program.judgeReason, /829\.1\.c/);
  assert.match(program.judgeReason, /Flow|flow\.cost/);
  assert.doesNotMatch(program.judgeReason, /RIFT-64|RIFT-66|RIFT-266.*KeywordDef/);
});

test("ven-156-166 Lightning Rush: [Flow] is declared as a keyword, not re-implemented", () => {
  // 829.1.c.1/.c.2: "Flow [Cost]" is a keyword whose cost is printed text; the
  // card names it and the expansion (plus cost rewriting) belongs to
  // effects/keywords/Flow (merged KeywordDef).
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);
  assert.equal(keywordDefinitionsById.has("Flow"), true);
});

test("ven-156-166 Lightning Rush: looking at the top three is a private ordered look, not a target", () => {
  // 128.3-128.4: look is private to the looking player; 108.4.e makes Main Deck
  // order secret information, so the range must come from an ordered pick set
  // (contract 3.6 zoneSlice) rather than a set query.
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.equal(lookTopThree.op, "effect.inspect");
  assert.equal(lookTopThree.linkedTo, "lightning-rush.bind-controller");
  assert.equal(lookTopThree.targets, undefined);
  assert.deepEqual(lookTopThree.args.player, {
    kind: "linked-value",
    instructionId: "lightning-rush.bind-controller",
    key: "controller"
  });
  assert.deepEqual(lookTopThree.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(lookTopThree.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookTopThree.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(lookTopThree.args.picksSpecId, { kind: "constant", value: VIEWED });
  assert.deepEqual(viewedPick, {
    id: VIEWED,
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 3 } }
  });
});

test("ven-156-166 Lightning Rush: 'you may choose … and draw it' is a may-wrapped non-target pick plus effect.zone", () => {
  // Contract 3.9: the may wraps the chosen instruction in body; the card never
  // writes a bare choice with a linkedTo follower. 355.10.a: a card in the Main
  // Deck is not in a public zone, so it is a pick, never a target.
  assert.equal(mayDraw.op, "choice.optional");
  assert.equal(mayDraw.linkedTo, "lightning-rush.look-top-three");
  assert.deepEqual(mayDraw.args.prompt, {
    kind: "constant",
    value: "Choose a card from among them and draw it?"
  });
  assert.equal(mayDraw.targets, undefined);
  assert.equal(mayDraw.args.body.kind, "constant");
  assert.deepEqual(mayDraw.args.body.value.map((instruction) => instruction.id), [
    "lightning-rush.draw-chosen-card"
  ]);
  // 414.1: "draw it" adds that card to the player's hand; effect.zone performs
  // it as a zone change, not by re-drawing the deck top.
  assert.equal(drawChosenCard.op, "effect.zone");
  assert.deepEqual(drawChosenCard.args.pick, { kind: "constant", value: CHOSEN });
  assert.deepEqual(drawChosenCard.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawChosenCard.args.amount, { kind: "constant", value: 1 });
  assert.equal(chosenPick.id, CHOSEN);
  assert.deepEqual(chosenPick.options, [
    { kind: "linked-value", instructionId: "lightning-rush.look-top-three", key: "viewed" }
  ]);
  assert.equal(chosenPick.min, 1);
  assert.equal(chosenPick.max, 1);
  assert.equal(chosenPick.selection, "one");
});

test("ven-156-166 Lightning Rush: 'put the rest into your trash' reuses the looked-at group and leaves the amount open", () => {
  // "the rest" is not a player choice: the looked-at group is handed over whole
  // and the card that already moved to Hand is dropped as a stale reference
  // (124), which is exactly the remainder. No fixed count is written, so the
  // declined case (three cards) is covered by the same shape.
  assert.equal(putRestIntoTrash.op, "effect.zone");
  assert.equal(putRestIntoTrash.linkedTo, "lightning-rush.look-top-three");
  assert.deepEqual(putRestIntoTrash.args.pick, { kind: "constant", value: REST });
  assert.deepEqual(putRestIntoTrash.args.to, { kind: "constant", value: "trash" });
  assert.equal(putRestIntoTrash.args.amount, undefined);
  assert.equal(putRestIntoTrash.targets, undefined);
  assert.deepEqual(restPick, {
    id: REST, options: [], ordered: true, selection: "all",
    linked: { kind: "linked-value", instructionId: "lightning-rush.look-top-three", key: "viewed" }
  });
});

test("ven-156-166 Lightning Rush golden: the chosen card goes to hand and the other two to the trash", () => {
  for (const [chosenIndex, chosenId, restIds] of [
    [0, "top", ["middle", "bottom"]],
    [1, "middle", ["top", "bottom"]],
    [2, "bottom", ["top", "middle"]]
  ]) {
    const { kernel, outcome } = runRush(chosenIndex);

    assert.deepEqual(
      outcome.results.map((entry) => [entry.id, entry.result.status]),
      [
        ["lightning-rush.bind-controller", "executed"],
        ["lightning-rush.look-top-three", "executed"],
        ["lightning-rush.draw-chosen-card", "executed"],
        ["lightning-rush.may-draw-chosen-card", "executed"],
        ["lightning-rush.put-rest-into-trash", "executed"]
      ]
    );
    // 414.1: exactly the chosen card reached the hand; 108.4.e: nothing else left
    // the top of the deck by accident.
    assert.deepEqual(ids(kernel, "hand"), [chosenId]);
    assert.deepEqual(ids(kernel, "trash"), restIds);
    // The fourth card was never looked at, so it stays on top of the deck.
    assert.deepEqual(ids(kernel, "deck"), ["fourth"]);
    assert.equal(outcome.linkedValues["lightning-rush.look-top-three.viewedCount"], 3);
    assert.deepEqual(outcome.events.map((event) => event.action), [
      "look",
      "return-to-hand",
      "move-zone",
      "move-zone"
    ]);
  }
});

test("ven-156-166 Lightning Rush golden: declining the may puts all three looked-at cards into the trash", () => {
  const { kernel, outcome } = runRush(null, { accept: false });

  // "You may choose a card …" is a resolution-time optional (383.3.a.3); a
  // refusal skips only that clause, so the following independent instruction
  // still moves the whole looked-at group to the trash.
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["lightning-rush.bind-controller", "executed", null],
      ["lightning-rush.look-top-three", "executed", null],
      ["lightning-rush.may-draw-chosen-card", "negated", "skipped"],
      ["lightning-rush.put-rest-into-trash", "executed", null]
    ]
  );
  assert.deepEqual(ids(kernel, "hand"), []);
  assert.deepEqual(ids(kernel, "trash"), ["top", "middle", "bottom"]);
  assert.deepEqual(ids(kernel, "deck"), ["fourth"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["look", "move-zone", "move-zone", "move-zone"]);
});

test("ven-156-166 Lightning Rush golden: a short Main Deck is looked at as far as possible and the drawn card still arrives", () => {
  const kernel = world()
    .object("lightning-rush", { owner: "A", controller: "A", types: ["spell"], zone: "chain" })
    .deck(["only-card"], { owner: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lightning-rush") });
  const viewed = scoped.zoneSlice("A", "deck", "top", 3).map((object) => object.ref);
  scoped.setPicks(VIEWED, viewed);
  scoped.setPicks(CHOSEN, viewed);
  scoped.setPicks(REST, []);
  scoped.setAnswers({ [`${MAY}/optional`]: true });

  const outcome = resolveChainBody(play.body, scoped);

  // 432.1.c: look at as much as possible and never Burn Out from looking. The
  // only card is looked at, chosen and drawn; the trash clause then has nothing
  // left to move, which the merged primitive reports as a mistargeted no-op (an
  // empty remainder is not an error, and no zone changes by accident).
  assert.equal(outcome.linkedValues["lightning-rush.look-top-three.viewedCount"], 1);
  assert.equal(outcome.results.find((entry) => entry.id === "lightning-rush.look-top-three").result.status, "executed");
  assert.equal(outcome.results.find((entry) => entry.id === "lightning-rush.draw-chosen-card").result.status, "executed");
  assert.deepEqual(ids(scoped, "hand"), ["only-card"]);
  assert.deepEqual(ids(scoped, "trash"), []);
  assert.deepEqual(ids(scoped, "deck"), []);
});

test("ven-156-166 Lightning Rush golden: without an ordered top-3 source the look resolves nothing and touches no zone", () => {
  // Guard the red line: the primitive never falls back to query() to guess deck
  // order. With no ordered picks collection the range is empty, the may has
  // nothing to choose and the trash instruction has nothing to move.
  const kernel = decked();
  kernel.setAnswers({ [`${MAY}/optional`]: false });

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["lightning-rush.bind-controller", "executed", null],
      ["lightning-rush.look-top-three", "executed", null],
      ["lightning-rush.may-draw-chosen-card", "negated", "skipped"],
      ["lightning-rush.put-rest-into-trash", "ignored", "mistargeted"]
    ]
  );
  assert.equal(outcome.linkedValues["lightning-rush.look-top-three.viewedCount"], 0);
  assert.deepEqual(outcome.linkedValues["lightning-rush.look-top-three.viewed"], []);
  assert.deepEqual(ids(kernel, "hand"), []);
  assert.deepEqual(ids(kernel, "trash"), []);
  assert.deepEqual(ids(kernel, "deck"), ["top", "middle", "bottom", "fourth"]);
  assert.deepEqual(outcome.events, []);
});

test("ven-156-166 Lightning Rush golden: a prevented look negates the instruction without moving any card", () => {
  const kernel = decked();
  const viewed = kernel.zoneSlice("A", "deck", "top", 3).map((object) => object.ref);
  kernel.setPicks(VIEWED, viewed);
  kernel.setAnswers({ [`${MAY}/optional`]: false });
  kernel.addReplacement((action) => (action.type === "look" ? "prevented" : null));

  const outcome = resolveChainBody(play.body, kernel);

  const look = outcome.results.find((entry) => entry.id === "lightning-rush.look-top-three");
  // Contract 3.6 primitive rule 2: a replaced/prevented perform negates the look
  // (effect.inspect documents the prevented case as reason "skipped").
  assert.equal(look.result.status, "negated");
  assert.equal(look.result.reason, "skipped");
  // A blocked perform still reports its own outcome event, but no looked-at set
  // is produced, so the follow-up clauses act on nothing and no card moves.
  assert.equal(look.result.linkedValues, undefined);
  assert.deepEqual(ids(kernel, "hand"), []);
  assert.deepEqual(ids(kernel, "trash"), []);
  assert.deepEqual(ids(kernel, "deck"), ["top", "middle", "bottom", "fourth"]);
});

test.todo(
  "ven-156-166 Lightning Rush: the optional single-card pick needs a real Resolve choice and a chosen-card Draw " +
    "action/event (414.1), rather than just moving a locked reference to hand"
);

test.todo(
  "ven-156-166 Lightning Rush: the printed [Flow] :rb_energy_2::rb_rune_rainbow: alternate cost and its then-banish " +
    "replacement (829.1.b/829.1.c) need the merged Flow KeywordDef's flow.cost consumer and replacement wiring, " +
    "and KeywordAbility still cannot carry the printed Flow cost (contract change request)"
);


test("Lightning Rush body: real Finalize locks deck order and linked rest needs no injected pick", () => {
  const { engine, kernel, card, answers } = fixture({
    cards: [{ id: "lightning-rush", cardId: CARD_ID, types: ["spell"], energy: 1 }]
  });
  engine.commit({ type: "order-top", player: "A",
    objects: ["A:deck:3", "A:deck:1", "A:deck:4", "A:deck:2"].map(id => kernel.ref(id)) });
  engine.advance();
  engine.execute(card("lightning-rush", { body: play.body }));
  assert.deepEqual(engine.items[0].pickPlans.map(plan => [plan.id, plan.refs.map(ref => ref.id)]), [
    [VIEWED, ["A:deck:3", "A:deck:1", "A:deck:4"]]
  ]);
  assert.equal(kernel.events.some(event => event.action === "look"), false);
  engine.pass("A");
  let request;
  assert.throws(() => engine.pass("B"), error => {
    if (!(error instanceof AwaitChoice)) return false;
    request = error.request;
    return true;
  });
  assert.equal(request.type, "optional");
  answers.set(request.id, false);
  resolveAll(engine);
  assert.deepEqual(ids(kernel, "deck"), ["A:deck:2"]);
  assert.deepEqual(ids(kernel, "trash"), ["A:deck:3", "A:deck:1", "A:deck:4", "lightning-rush"]);
  assert.deepEqual(ids(kernel, "hand"), []);
  assert.equal(kernel.linked("lightning-rush.look-top-three.viewedCount"), 3);
  const actions = kernel.events.map(event => event.action);
  assert.equal(actions.filter(action => action === "look").length, 1);
});
