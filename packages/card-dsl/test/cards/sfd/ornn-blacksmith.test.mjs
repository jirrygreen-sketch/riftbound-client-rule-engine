import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ornn-blacksmith.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
// Production resolves a card body through the chain's interpreter adapter
// (chain/interpreter-adapter.ts), which keeps each card Expr argument inside one
// literal envelope so the merged primitives validate and evaluate them themselves.
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-9dc6aa1c0b143c97fcb8a2380ebb6b0c2130148d5d9974ba8568d615c7d1d2e9";
const SOURCE_TEXT =
  "When you play me or when I hold, look at the top 4 cards of your Main Deck. " +
  "You may reveal a gear from among them and draw it. Then recycle the rest.";

const [playTrigger, holdTrigger] = program.abilities;
const [bindController, lookTopFour, mayReveal, recycleRest] = playTrigger.body;
const [revealGear, drawIt] = mayReveal.args.body.value;

const resultFor = (outcome, id) => outcome.results.find((entry) => entry.id === id);

/** 牌库顶 4 张（保序）由上游按 zoneSlice 提供——参考内核里用 setPicks 模拟。 */
function ornnWorld(cards = ["gear-a", "spell-b", "gear-c", "unit-d", "deeper"]) {
  const base = world()
    .unit("ornn", { might: 5, zone: "board" })
    .deck(cards, { owner: "A" })
    .build();
  const kernel = base.clone({ source: base.ref("ornn"), sourceSnapshot: base.getObject("ornn") });
  kernel.setPicks("ornn-blacksmith.top-four", kernel.zone("A", "deck").slice(0, 4));
  return kernel;
}

test("sfd-058-221 Ornn, Blacksmith: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-058-221 Ornn, Blacksmith: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /结算期/);
  assert.match(program.judgeReason, /生产侧可用/);
  assert.match(program.judgeReason, /hold/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-058-221 Ornn, Blacksmith: the printed \"or\" is two trigger subscriptions with the same body", () => {
  assert.equal(program.abilities.length, 2);

  // 383.4.a / 420.4.a: "When you play me".
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(playTrigger.optional, false);

  // 383.4.d / 315.2.b.2 / 471.2 / 473.2.b: "when I hold".
  assert.equal(holdTrigger.kind, "triggered");
  assert.equal(holdTrigger.trigger.at, "hold");
  assert.deepEqual(holdTrigger.trigger.filter, { event: "held", filter: { source: "self" } });
  assert.equal(holdTrigger.optional, false);

  // Both printed conditions share the identical effect instructions.
  assert.deepEqual(
    holdTrigger.body.map((instruction) => instruction.id),
    playTrigger.body.map((instruction) => instruction.id)
  );
});

test("sfd-058-221 Ornn, Blacksmith: look is a private top-4 inspect whose ordered range comes from the engine", () => {
  // 128.3-128.4: look is private; 432.1.c: no Burn Out.
  assert.equal(lookTopFour.op, "effect.inspect");
  assert.deepEqual(lookTopFour.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(lookTopFour.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookTopFour.args.amount, { kind: "constant", value: 4 });
  // 契约 3.6: the deck top must be read in zone order, so the primitive takes an
  // upstream ordered pick range instead of trusting ctx.query's set order.
  assert.deepEqual(lookTopFour.args.picksSpecId, { kind: "constant", value: "ornn-blacksmith.top-four" });
  assert.deepEqual(lookTopFour.picks, [
    {
      id: "ornn-blacksmith.top-four",
      options: ["runtime:main-deck-top-four-in-zone-order"],
      min: 0,
      max: 4,
      selection: "up-to",
      filter: { owner: "self", zone: "deck" }
    }
  ]);
  assert.equal(lookTopFour.targets, undefined);

  // "your Main Deck": the controller is bound as data (190.6.d) because the merged
  // primitive's player argument takes a PlayerId expression, not a selector.
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(lookTopFour.args.player, {
    kind: "linked-value",
    instructionId: "ornn-blacksmith.bind-controller",
    key: "controller"
  });
  assert.equal(lookTopFour.linkedTo, "ornn-blacksmith.bind-controller");
});

test("sfd-058-221 Ornn, Blacksmith: the may clause wraps reveal-then-draw, and \"the rest\" recycles the looked list", () => {
  // 383.3.a.3: this "you may" is not the first part of the effect, so the ability is
  // always finalized and the choice is made on resolution; contract 3.9 wraps the
  // chosen instructions inside the choice's body.
  assert.equal(mayReveal.op, "choice.optional");
  // The chosen instructions read the look result through their own linked-value
  // options, so the may node itself is not chained to the look (359.3.e.14).
  assert.equal(mayReveal.linkedTo, undefined);
  assert.equal(mayReveal.args.body.kind, "constant");
  assert.deepEqual(mayReveal.args.body.value.map((instruction) => instruction.id), [
    "ornn-blacksmith.reveal-gear",
    "ornn-blacksmith.draw-it"
  ]);

  // "reveal a gear from among them": the candidate list is the look result and is
  // not a public zone, so 355.10.a makes it a non-target pick.
  assert.equal(revealGear.op, "effect.reveal");
  assert.deepEqual(revealGear.args.pick, { kind: "constant", value: "ornn-blacksmith.revealed-gear" });
  assert.deepEqual(revealGear.picks, [
    {
      id: "ornn-blacksmith.revealed-gear",
      options: [
        { kind: "linked-value", instructionId: "ornn-blacksmith.look-top-four", key: "lookedCards" }
      ],
      min: 1,
      max: 1,
      selection: "one",
      filter: { type: "gear", zone: "deck" }
    }
  ]);
  assert.equal(revealGear.targets, undefined);

  // "and draw it" = add the revealed card to hand (414.1), driven by the reveal's
  // own linked result rather than a fresh draw off the top of the deck.
  assert.equal(drawIt.op, "effect.zone");
  assert.equal(drawIt.linkedTo, "ornn-blacksmith.reveal-gear");
  assert.deepEqual(drawIt.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawIt.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(drawIt.args.pick, { kind: "constant", value: "ornn-blacksmith.revealed-drawn-gear" });
  assert.deepEqual(drawIt.picks[0].options, [
    { kind: "linked-value", instructionId: "ornn-blacksmith.reveal-gear", key: "revealed" }
  ]);

  // "Then recycle the rest": the looked list, where the card already moved to the
  // hand is a stale reference and therefore drops out (417.1/417.4).
  assert.equal(recycleRest.op, "effect.recycle");
  assert.equal(recycleRest.linkedTo, "ornn-blacksmith.look-top-four");
  assert.deepEqual(recycleRest.args.objects, {
    kind: "linked-value",
    instructionId: "ornn-blacksmith.look-top-four",
    key: "lookedCards"
  });
});

test("sfd-058-221 Ornn, Blacksmith golden: the private look sees 4 cards in deck order and moves nothing", () => {
  const kernel = ornnWorld();
  const before = kernel.zone("A", "deck");

  const outcome = resolveChainBody(playTrigger.body.slice(0, 2), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, "ornn-blacksmith.look-top-four").result.status, "executed");
  assert.equal(outcome.linkedValues["ornn-blacksmith.look-top-four.lookedCount"], 4);
  assert.deepEqual(
    outcome.linkedValues["ornn-blacksmith.look-top-four.lookedCards"].map((ref) => ref.id),
    ["gear-a", "spell-b", "gear-c", "unit-d"]
  );
  assert.deepEqual(kernel.zone("A", "deck"), before);
  assert.deepEqual(outcome.events.map((event) => event.action), ["look"]);
});

test("sfd-058-221 Ornn, Blacksmith golden: accepting reveals the chosen gear, draws it, and recycles the rest", () => {
  const kernel = ornnWorld();
  const looked = kernel.zone("A", "deck").slice(0, 4);

  // The reveal / draw / recycle steps run on the merged primitives with the card's
  // own declared arguments. The reveal step is driven at the primitive level because
  // chain/interpreter-adapter.ts unwraps only `target` for effect.reveal; the card
  // keeps the declared `pick` shape (see judgeReason).
  const revealed = runInstruction(
    reveal,
    { pick: revealGear.args.pick.value },
    { world: kernel, picks: { "ornn-blacksmith.revealed-gear": [looked[0]] } }
  );
  assert.equal(revealed.result.status, "executed");
  assert.deepEqual(revealed.linked.revealed, [looked[0]]);
  // 425.1.a.2: the revealed card stays in the Main Deck until the draw moves it.
  assert.equal(kernel.getObject("gear-a").zone, "deck");

  const drawn = runInstruction(
    zone,
    {
      pick: drawIt.args.pick.value,
      to: drawIt.args.to,
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, picks: { "ornn-blacksmith.revealed-drawn-gear": [looked[0]] } }
  );
  assert.equal(drawn.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["gear-a"]);

  const recycled = runInstruction(
    recycle,
    { objects: { kind: "linked-value", instructionId: "ornn-blacksmith.look-top-four", key: "lookedCards" } },
    { world: kernel, linked: { lookedCards: looked } }
  );
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 3);

  // gear-a went to hand; the other three looked-at cards are on the deck bottom,
  // above the card that was never looked at.
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["gear-a"]);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), [
    "deeper", "spell-b", "gear-c", "unit-d"
  ]);
  assert.deepEqual(recycled.events.map((event) => event.action), ["recycle", "recycle", "recycle"]);
});

test("sfd-058-221 Ornn, Blacksmith golden: declining the may recycles every looked-at card", () => {
  const kernel = ornnWorld();
  kernel.setAnswers({ "ornn-blacksmith.may-reveal-a-gear/optional": false });

  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(resultFor(outcome, "ornn-blacksmith.may-reveal-a-gear").result, {
    status: "negated",
    reason: "skipped",
    events: []
  });
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), [
    "deeper", "gear-a", "spell-b", "gear-c", "unit-d"
  ]);
  assert.equal(resultFor(outcome, "ornn-blacksmith.recycle-the-rest").result.linkedValues.recycledCount, 4);
});

test("sfd-058-221 Ornn, Blacksmith golden: an unprovisioned ordered range looks at nothing instead of guessing deck order", () => {
  const kernel = world().deck(["a", "b", "c", "d"], { owner: "A" }).build();
  const run = runInstruction(
    inspect,
    {
      player: { kind: "constant", value: "A" },
      zone: { kind: "constant", value: "deck" },
      scope: { kind: "constant", value: "top" },
      amount: { kind: "constant", value: 4 },
      picksSpecId: { kind: "constant", value: "ornn-blacksmith.top-four" }
    },
    // No ordered picks are supplied: ctx.picks is empty, which is exactly what a
    // production play sees until the Finalize ordered-pick lifecycle exists.
    { world: kernel, picks: { "ornn-blacksmith.top-four": [] } }
  );

  // The primitive never falls back to a set query for order: it inspects 0 cards
  // and drives no look action, so a production play cannot see the deck top.
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.inspected, 0);
  assert.deepEqual(run.linked["inspected-picked"], []);
  assert.deepEqual(run.events, []);
  assert.equal(kernel.player("A").deckSize, 4);
});

test("sfd-058-221 Ornn, Blacksmith golden: the recycle primitive places the remaining looked-at cards on the deck bottom", () => {
  const kernel = world().deck(["kept", "recycled"]).build();
  const looked = kernel.zone("A", "deck");
  const run = runInstruction(
    recycle,
    { objects: { kind: "linked-value", instructionId: "probe", key: "lookedCards" } },
    // The reference kernel resolves a linked-value expression by its `key` binding.
    { world: kernel, linked: { lookedCards: [looked[0]] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["recycled", "kept"]);
  assert.deepEqual(run.events.map((event) => event.action), ["recycle"]);
});

test.todo(
  "sfd-058-221 Ornn, Blacksmith: 'reveal a gear from among them' needs a consumer that turns the linked " +
    "look result plus the gear type filter into a replayable resolution choice — effect.inspect's choose " +
    "offers every looked-at card with no type gate, so an unfiltered choose would let a non-gear be revealed"
);

test.todo(
  "sfd-058-221 Ornn, Blacksmith: the ordered deck-top pick ('ornn-blacksmith.top-four') needs a Finalize " +
    "lifecycle; chain/engine.ts locks only instruction.targets TargetSpecs, so a production play has no " +
    "ordered source and effect.inspect sees nothing (contract 3.6 zoneSlice) — ordered-pick Finalize follow-up"
);

test.todo(
  "sfd-058-221 Ornn, Blacksmith: both subscriptions (card-played 383.4.a and hold 383.4.d) must reach the " +
    "chain as Pending items through a CardProgram trigger registration; the hold timing point is " +
    "emitted and the RIFT-257 program binding is merged, but the hold payload carries no object " +
    "for the self-scoped filter to match"
);
