import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/reinforce.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
// Production resolves a card body through the chain's interpreter adapter
// (chain/interpreter-adapter.ts), which keeps each card Expr argument inside a
// literal envelope so the merged primitives validate and evaluate them
// themselves. The golden runs use that same path.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-c2c17a54e193d86678b7e7bb36f02bf0db8c677c91f7ac73a0fa57cb2acc8be5";
const SOURCE_TEXT =
  "Look at the top 5 cards of your Main Deck. You may banish a unit from among them, " +
  "then play it, reducing its cost by :rb_energy_5:. Recycle the remaining cards.";

const [playAbility] = program.abilities;
const [bindController, lookTopFive, mayBanishAndPlay, recycleRemaining] = playAbility.body;
const [banishChosenUnit, playIt] = mayBanishAndPlay.args.body.value;

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

/**
 * The reference kernel binds `source` to the ability host, so the spell is
 * installed as the source snapshot and the deck is stacked top-to-bottom.
 */
function reinforceWorld(cards = ["unit-a", "spell-a", "spell-b", "spell-c", "spell-d", "deeper"]) {
  const kernel = world()
    .object("reinforce", { zone: "chain", types: ["spell"], owner: "A", controller: "A", energy: 5 })
    .deck(cards, { owner: "A" })
    .build();
  // The ordered deck-top provider the merged effect.inspect requires for a
  // non-zero top look (contract 3.6 zoneSlice; query order is not a deck order).
  kernel.setPicks("reinforce.top-five", kernel.zone("A", "deck").slice(0, 5));
  return kernel;
}

test("ogn-062-298 Reinforce: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-062-298 Reinforce identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-062-298 Reinforce judgeReason names the current cost-plan and selection gaps", () => {
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /356\.1\.c/);
  assert.match(program.judgeReason, /356\.6/);
  assert.match(program.judgeReason, /FinalizedCostPlan/);
  assert.match(program.judgeReason, /unit/);
  // RIFT-66's ordered zoneSlice source merged with the RIFT-358 Finalize
  // lifecycle, so the reason must name the landed mechanism, not the old
  // picksSpecId delivery note.
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-358/);
});

test("ogn-062-298 Reinforce structure: no speed keyword, look -> may(banish -> play) -> recycle", () => {
  // No [Action]/[Reaction] is printed, so the program holds one play ability
  // with default spell timing (159.2.a) and no cost declaration (the printed
  // base cost is bound from the catalog at Finalize, contract 3.1).
  assert.equal(program.abilities.length, 1);
  assert.equal(playAbility.kind, "play");
  assert.equal(playAbility.cost, undefined);
  assert.deepEqual(playAbility.body.map(instruction => instruction.id), [
    "reinforce.bind-controller",
    "reinforce.look-top-five",
    "reinforce.may-banish-and-play",
    "reinforce.recycle-remaining"
  ]);

  // "Look at the top 5 cards of your Main Deck" — private look, top scope,
  // 5 cards, with the pick as a non-target choice (0 or 1 cards).
  assert.equal(lookTopFive.op, "effect.inspect");
  assert.deepEqual(lookTopFive.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(lookTopFive.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookTopFive.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(lookTopFive.args.picksSpecId, { kind: "constant", value: "reinforce.top-five" });
  assert.deepEqual(lookTopFive.args.choose, { kind: "constant", value: true });
  assert.deepEqual(lookTopFive.args.chooseCount, { kind: "constant", value: { min: 0, max: 1 } });
  assert.equal(lookTopFive.targets, undefined);

  // "you" is bound as a data value (the ability controller, 190.6.d) because
  // the merged primitive's player schema takes no symbolic selector.
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(lookTopFive.args.player, {
    kind: "linked-value",
    instructionId: "reinforce.bind-controller",
    key: "controller"
  });

  // "You may banish a unit from among them, then play it" — contract 3.9: the
  // may wraps the chosen instructions inside body, with no bare choice node.
  assert.equal(mayBanishAndPlay.op, "choice.optional");
  assert.equal(mayBanishAndPlay.args.body.kind, "constant");
  assert.deepEqual(mayBanishAndPlay.args.body.value.map(instruction => instruction.id), [
    "reinforce.banish-chosen-unit",
    "reinforce.play-it"
  ]);
  assert.equal(banishChosenUnit.op, "effect.banish");
  assert.deepEqual(banishChosenUnit.args.objects, {
    kind: "constant",
    value: { linked: "selectedCard" }
  });
  assert.equal(banishChosenUnit.linkedTo, undefined);

  // "then play it, reducing its cost by [5]" — the play reads the banished
  // card's fresh reference (never a guessed identity) and carries the required
  // cost reduction, which no merged producer materializes.
  assert.equal(playIt.op, "effect.play");
  assert.equal(playIt.linkedTo, "reinforce.banish-chosen-unit");
  assert.deepEqual(playIt.args.object, {
    kind: "linked-value",
    instructionId: "reinforce.banish-chosen-unit",
    key: "banishedObject"
  });
  assert.deepEqual(playIt.args.cost.value, {
    kind: "cost.modify",
    base: "printed",
    discount: { resource: "energy", amount: 5, minimum: 0 },
    finalized: false
  });
  assert.equal(playIt.targets, undefined);

  // "Recycle the remaining cards" — the looked list, not a fresh query.
  assert.equal(recycleRemaining.op, "effect.recycle");
  assert.deepEqual(recycleRemaining.args.objects, {
    kind: "linked-value",
    instructionId: "reinforce.look-top-five",
    key: "lookedCards"
  });
});

test("ogn-062-298 Reinforce golden: the merged registry really registers the used primitives", () => {
  assert.equal(inspect.op, "effect.inspect");
  assert.equal(recycle.op, "effect.recycle");
  assert.equal(play.op, "effect.play");
});

test("ogn-062-298 Reinforce golden: merged cost.modify floors the five-energy discount at zero", () => {
  const kernel = reinforceWorld();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("reinforce") });
  const run = runInstruction(
    costModify,
    {
      id: "reinforce.preview-cost",
      printed: { id: "unit-a", cardType: "Unit", energy: 3, power: 0, domains: ["Calm"] },
      modifier: {
        kind: "reduce",
        resource: "energy",
        amount: { kind: "constant", value: 5 },
        minimum: { kind: "constant", value: 0 }
      }
    },
    { world: ctx }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.cost.total.energy, 0);
  assert.deepEqual(run.linked.cost.discounts.map(discount => [discount.before, discount.after]), [[3, 0]]);
});

test("ogn-062-298 Reinforce golden: looking at the top 5 is private and moves nothing (128.3-128.4)", () => {
  const kernel = reinforceWorld();
  const before = kernel.zone("A", "deck");

  const run = runInstruction(
    inspect,
    {
      player: { kind: "constant", value: "A" },
      zone: { kind: "constant", value: "deck" },
      scope: { kind: "constant", value: "top" },
      amount: { kind: "constant", value: 5 },
      picksSpecId: { kind: "constant", value: "reinforce.top-five" },
      linkedKey: { kind: "constant", value: "looked" },
      pickedKey: { kind: "constant", value: "lookedCards" }
    },
    { world: kernel, picks: { "reinforce.top-five": before.slice(0, 5) } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.looked, 5);
  assert.deepEqual(run.linked.lookedCards.map(ref => ref.id), [
    "unit-a", "spell-a", "spell-b", "spell-c", "spell-d"
  ]);
  assert.deepEqual(run.events.map(event => event.action), ["look"]);
  assert.deepEqual(kernel.zone("A", "deck"), before);
  assert.equal(kernel.player("A").deckSize, 6);
});

test("ogn-062-298 Reinforce golden: a short Main Deck is looked at as far as possible (432.1.c)", () => {
  const kernel = world()
    .object("reinforce", { zone: "chain", types: ["spell"], owner: "A", controller: "A" })
    .deck(["only-card"], { owner: "A" })
    .build();
  const ordered = kernel.zone("A", "deck");

  const run = runInstruction(
    inspect,
    {
      player: { kind: "constant", value: "A" },
      zone: { kind: "constant", value: "deck" },
      scope: { kind: "constant", value: "top" },
      amount: { kind: "constant", value: 5 },
      picksSpecId: { kind: "constant", value: "reinforce.top-five" }
    },
    { world: kernel, picks: { "reinforce.top-five": ordered } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.inspected, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("ogn-062-298 Reinforce golden: accepting the may banishes the chosen card and recycles the rest", () => {
  const kernel = reinforceWorld();
  const looked = kernel.zone("A", "deck").slice(0, 5);
  kernel.setAnswers({
    "reinforce.look-top-five/reinforce.pick-unit": [looked[0]],
    "reinforce.may-banish-and-play/optional": true
  });

  const outcome = resolveChainBody(playAbility.body, kernel);

  // The play half negates on the missing finalized cost plan (judgeReason);
  // the look, banish and recycle halves execute for real.
  assert.equal(outcome.status, "partial");
  assert.equal(resultFor(outcome, "reinforce.look-top-five").result.status, "executed");
  assert.equal(resultFor(outcome, "reinforce.banish-chosen-unit").result.status, "executed");
  assert.deepEqual(resultFor(outcome, "reinforce.play-it").result, {
    status: "negated",
    reason: "impossible",
    events: []
  });
  assert.equal(resultFor(outcome, "reinforce.recycle-remaining").result.status, "executed");
  assert.equal(outcome.linkedValues["reinforce.look-top-five.looked"], 5);
  assert.deepEqual(kernel.zone("A", "banishment").map(ref => ref.id), ["unit-a"]);
  assert.equal(kernel.getObject("unit-a").zone, "banishment");
  // Only the four remaining looked-at cards were recycled (417.1.a: to the
  // bottom of their owner's Main Deck); the unlooked card stays on top.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "deeper", "spell-a", "spell-b", "spell-c", "spell-d"
  ]);
  assert.deepEqual(outcome.events.map(event => event.action), [
    "look", "banish", "recycle", "recycle", "recycle", "recycle"
  ]);
});

test("ogn-062-298 Reinforce golden: declining the may still recycles every looked-at card", () => {
  const kernel = reinforceWorld();
  kernel.setAnswers({
    "reinforce.look-top-five/reinforce.pick-unit": [],
    "reinforce.may-banish-and-play/optional": false
  });

  const outcome = resolveChainBody(playAbility.body, kernel);

  // The declined may is reported as a negated/skipped result, which the
  // interpreter aggregates as partial; every other instruction still resolves.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.id), [
    "reinforce.bind-controller", "reinforce.look-top-five",
    "reinforce.may-banish-and-play", "reinforce.recycle-remaining"
  ]);
  assert.deepEqual(resultFor(outcome, "reinforce.may-banish-and-play").result, {
    status: "negated",
    reason: "skipped",
    events: []
  });
  assert.deepEqual(kernel.zone("A", "banishment"), []);
  assert.equal(kernel.getObject("unit-a").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "deeper", "unit-a", "spell-a", "spell-b", "spell-c", "spell-d"
  ]);
  assert.equal(outcome.events.filter(event => event.action === "recycle").length, 5);
});

test("ogn-062-298 Reinforce golden: the banished card is a new object, so its old deck ref never recycles", () => {
  const kernel = reinforceWorld();
  const looked = kernel.zone("A", "deck").slice(0, 5);
  kernel.setAnswers({
    "reinforce.look-top-five/reinforce.pick-unit": [looked[0]],
    "reinforce.may-banish-and-play/optional": true
  });
  const outcome = resolveChainBody(playAbility.body, kernel);

  // Banishment moves the card to a Non-Board zone, so it becomes a new object
  // (124) and the stale looked-at reference drops out (359.3.e.4/.7): exactly
  // the four remaining cards recycle.
  assert.equal(resultFor(outcome, "reinforce.recycle-remaining").result.linkedValues.recycledCount, 4);
  assert.deepEqual(resultFor(outcome, "reinforce.banish-chosen-unit").result.linkedValues.banishedObjects, [
    { id: "unit-a", zoneEntryId: 2 }
  ]);
});

test("ogn-062-298 Reinforce golden: the merged play primitive refuses the unfinalized cost descriptor", () => {
  // Guards against silently playing the banished card at its full printed cost:
  // effect.play requires an already-finalized plan and never derives one.
  const kernel = world()
    .object("rescued", { zone: "banishment", types: ["unit"], owner: "A", controller: "A", energy: 4 })
    .build();
  const banished = kernel.zone("A", "banishment")[0];

  const run = runInstruction(
    play,
    { object: { kind: "constant", value: banished }, cost: playIt.args.cost },
    { world: kernel }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("rescued").zone, "banishment");
  assert.equal(run.events.length, 0);
});

test.todo(
  "Reinforce: materialize the reduced cost plan (printed base cost of the banished card minus 5 Energy, " +
    "never below 0 per CR 356.1.c/356.6) and play it out of Banishment as a Limited Action (420.3/420.3.a) - " +
    "cost.modify is merged, but the card-program/Finalize producer for the selected card's printed cost and effect.play plan is missing"
);

/**
 * Production-chain fixture: the spell starts in Hand, the chain Finalizes the
 * declared zoneSlice against the real deck order, and the two choices arrive
 * as AwaitChoice requests whose ids include the instruction path.
 */
function chainFixture(deck = ["unit-a", "spell-a", "spell-b", "spell-c", "spell-d", "deeper"]) {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("reinforce", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [], might: null })
    .deck(deck, { owner: "A" })
    .build();
  const answers = new Map();
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return {
    kernel,
    engine,
    answers,
    requests,
    draft: () => ({
      id: "play-reinforce",
      controller: "A",
      source: kernel.getObject("reinforce"),
      kind: "spell",
      speed: "normal",
      body: translateInstructionTargets(playAbility.body)
    })
  };
}

test("ogn-062-298 Reinforce golden: the chain locks the deck top at Finalize and resolves the look choice", () => {
  // The production path: Finalize locks the declared zoneSlice refs from the
  // real deck order before any look happens, Resolve asks the private
  // 0-or-1 selection out of the locked five, and the may is a separate
  // optional decision.
  const f = chainFixture();
  f.engine.execute(f.draft());
  f.engine.advance();

  const locked = f.engine.items[0].pickPlans;
  assert.deepEqual(locked.map((plan) => [plan.id, plan.refs.map((ref) => ref.id)]), [
    ["reinforce.top-five", ["unit-a", "spell-a", "spell-b", "spell-c", "spell-d"]]
  ]);
  // CR 128.3: a look is an effect, so nothing was looked at before Resolve.
  assert.equal(
    f.engine.pipeline.events.filter((event) => event.timingPoint === "cards-looked-at").length,
    0
  );

  const request = (() => {
    try {
      f.engine.pass("A");
      f.engine.pass("B");
    } catch (error) {
      assert.ok(error instanceof AwaitChoice, String(error));
      return error.request;
    }
    throw new Error("the look's 0-or-1 selection must be requested during Resolve");
  })();

  assert.equal(request.id, "reinforce.look-top-five/reinforce.pick-unit");
  assert.equal(request.type, "select-objects");
  assert.deepEqual(request.options.map((ref) => ref.id), ["unit-a", "spell-a", "spell-b", "spell-c", "spell-d"]);
  // "You may banish a unit from among them": zero or one of the looked cards.
  assert.equal(request.min, 0);
  assert.equal(request.max, 1);

  f.answers.set(request.id, [request.options[0]]);
  let banishChoice = null;
  try {
    f.engine.pass("B");
  } catch (error) {
    assert.ok(error instanceof AwaitChoice, String(error));
    banishChoice = error.request;
  }
  assert.equal(banishChoice?.id, "reinforce.may-banish-and-play/optional");
  assert.equal(banishChoice?.type, "optional");
  f.answers.set("reinforce.may-banish-and-play/optional", true);

  let guard = 0;
  while (f.engine.items.length && guard++ < 20) f.engine.pass(f.engine.priority);

  assert.deepEqual(f.kernel.zone("A", "banishment").map((ref) => ref.id), ["unit-a"]);
  // The play half negates on the missing finalized cost plan (judgeReason):
  // the banished card stays in Banishment and never enters Board.
  assert.deepEqual(f.kernel.zone("A", "board").map((ref) => ref.id), []);
  // The played card's old reference is stale, so exactly the four remaining
  // looked-at cards recycle to the deck bottom (417.1.a / 417.4).
  assert.deepEqual(f.kernel.zone("A", "deck").map((ref) => ref.id), [
    "deeper", "spell-a", "spell-b", "spell-c", "spell-d"
  ]);
});

test("ogn-062-298 Reinforce golden: finalizeOrderedPickPlans locks the ordered deck slice itself", () => {
  // Direct Finalize unit coverage for the merged RIFT-66/RIFT-358 lifecycle:
  // the chain locks refs from the real zone order, a short deck locks only the
  // cards that exist, and the spec keeps the contract-3.6 ordered source shape.
  const longDeck = world()
    .player("A")
    .deck(["d1", "d2", "d3", "d4", "d5", "d6"], { owner: "A" })
    .build();
  const longContext = longDeck.clone({ sourceSnapshot: longDeck.getObject("d1"), controller: "A" });
  const [topFive] = finalizeOrderedPickPlans(longContext, playAbility.body);
  assert.equal(topFive.id, "reinforce.top-five");
  assert.deepEqual(topFive.refs.map((ref) => ref.id), ["d1", "d2", "d3", "d4", "d5"]);

  // The spec itself keeps the contract-3.6 ordered source shape: options stays
  // empty, the whole slice is selected, and the only source is the zoneSlice.
  const [declared] = lookTopFive.picks;
  assert.deepEqual(declared, {
    id: "reinforce.top-five",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: {
      zone: "deck",
      from: "top",
      count: { kind: "constant", value: 5 }
    }
  });

  const shortDeck = world()
    .player("A")
    .deck(["only-card"], { owner: "A" })
    .build();
  const shortContext = shortDeck.clone({ sourceSnapshot: shortDeck.getObject("only-card"), controller: "A" });
  const [shortPlan] = finalizeOrderedPickPlans(shortContext, playAbility.body);
  // 432.1.c: a short deck is looked at as far as possible.
  assert.deepEqual(shortPlan.refs.map((ref) => ref.id), ["only-card"]);
});
