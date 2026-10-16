import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/the-candlelit-sanctum.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import order from "../../../../engine-core/dist/effects/instructions/effect.order.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-9cbd7ae406600f049622c2827bd155c0754bc7dee82570641d6f2eccff28654a";
const SOURCE_TEXT =
  "When you conquer here, look at the top two cards of your Main Deck. " +
  "You may recycle one or both of them. Put those you don't back in any order.";

const [look, recycleStep, putRest] = program.abilities[0].body;
const LOOKED = "candlelit-sanctum-looked";
const RECYCLED = "candlelit-sanctum-recycled";
const constant = value => ({ kind: "constant", value });

test("The Candlelit Sanctum program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  // The reason must name the real gaps: the inspect/selector mismatch, the
  // missing ordered top-of-deck provider, and the missing conquer emitter.
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /ObjectSelector/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-66/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("The Candlelit Sanctum structure: conquer trigger, look at two, recycle, put the rest back", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    here: true,
    player: "controller"
  });
  assert.equal(ability.trigger.once, undefined);

  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "candlelit-sanctum.look",
    "candlelit-sanctum.recycle",
    "candlelit-sanctum.put-rest"
  ]);

  // 432.1.c / 437.1: look at the top two of the Main Deck, then choose any
  // number (0..2) of them to recycle. The "you may recycle one or both" is a
  // count choice inside the look, not an optional instruction (contract 3.9).
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.zone, constant("deck"));
  assert.deepEqual(look.args.scope, constant("top"));
  assert.deepEqual(look.args.amount, constant(2));
  assert.deepEqual(look.args.choose, constant(true));
  assert.deepEqual(look.args.chooseCount, constant({ min: 0, max: 2 }));
  assert.deepEqual(look.args.pickedKey, constant(LOOKED));
  assert.deepEqual(look.args.choosePicksKey, constant(RECYCLED));
  // The looking player must be this ability's controller: no literal player id
  // and no fabricated target spec stand in for "your Main Deck".
  assert.deepEqual(look.args.player, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.equal(look.targets, undefined);
  assert.equal(look.picks, undefined);

  // 417.1.a / 417.4: recycle exactly the cards the player marked; none marked is
  // an executed no-op, so nothing is linked to it.
  assert.equal(recycleStep.op, "effect.recycle");
  assert.equal(recycleStep.linkedTo, "candlelit-sanctum.look");
  assert.deepEqual(recycleStep.args.objects, {
    kind: "linked",
    instructionId: "candlelit-sanctum.look",
    key: RECYCLED
  });

  // 437.1.a: the not-recycled remainder goes back on top in any order through
  // choice.order (effect.order's cardsPick + chooseOrder), never through a
  // second look or a hand-rolled ordering loop.
  assert.equal(putRest.op, "effect.order");
  assert.equal(putRest.linkedTo, "candlelit-sanctum.look");
  assert.deepEqual(putRest.args.destination, constant("top"));
  assert.deepEqual(putRest.args.cardsPick, constant("candlelit-sanctum.put-back"));
  assert.deepEqual(putRest.args.chooseOrder, constant(true));
  assert.equal(putRest.picks.length, 1);
  assert.deepEqual(putRest.picks[0], {
    id: "candlelit-sanctum.put-back",
    options: [{ kind: "linked-value", instructionId: "candlelit-sanctum.look", key: LOOKED }],
    min: 0,
    max: 2,
    selection: "up-to"
  });
});

test("The Candlelit Sanctum golden: recycling one looked card moves it to the deck bottom", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const looked = kernel.zone("A", "deck");
  const first = looked[0];
  const second = looked[1];

  // 417.1.a: the recycle half of the look's choice. The looked card goes to the
  // bottom of its owner's Main Deck.
  const recycled = runInstruction(recycle, recycleStep.args, {
    world: kernel,
    linked: { [RECYCLED]: [first] }
  });
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 1);
  assert.equal(kernel.getObject("top-card").zone, "deck");
  assert.deepEqual(kernel.events.map(event => event.action), ["recycle"]);
  // The recycled card is now at the bottom.
  const deckAfterRecycle = kernel.zone("A", "deck").map(ref => ref.id);
  assert.deepEqual(deckAfterRecycle, ["second-card", "top-card"]);

  // 437.1.a: put the looked cards back on top; the recycled one has left its
  // previous position, so the stale-looking duplicate must not be re-ordered.
  const ordered = runInstruction(order, putRest.args, {
    world: kernel,
    picks: { "candlelit-sanctum.put-back": [first, second] },
    linked: { [LOOKED]: [first, second] }
  });
  assert.equal(ordered.result.status, "executed");
  assert.deepEqual(ordered.result.linkedValues, { ordered: 1 });
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card", "top-card"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["recycle", "order-top"]);
});

test("The Candlelit Sanctum golden: recycling none puts both cards back in the chosen order", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const [first, second] = kernel.zone("A", "deck");

  // Choosing zero of two is an executed no-op (437.1 "one or both"; 0 is legal).
  const recycled = runInstruction(recycle, recycleStep.args, {
    world: kernel,
    linked: { [RECYCLED]: [] }
  });
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 0);
  assert.deepEqual(kernel.events, []);

  // choice.order: the looking player returns both in the order they choose.
  const ordered = runInstruction(order, putRest.args, {
    world: kernel,
    picks: { "candlelit-sanctum.put-back": [first, second] },
    linked: { [LOOKED]: [first, second] },
    answers: { "effect.order:top:A": [second, first] }
  });
  assert.equal(ordered.result.status, "executed");
  assert.deepEqual(ordered.result.linkedValues, { ordered: 2 });
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card", "top-card"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["order-top"]);
});

test("The Candlelit Sanctum look step exposes both unmerged gaps instead of guessing", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();

  // Gap 1 (RIFT-64 vs contract 3.6): the primitive's own schema still demands a
  // runtime ObjectRef in object-property.object, so the program's symbolic
  // "source" selector for the looking player is rejected outright. Rewriting it
  // as a literal player id is what the card program deliberately does NOT do.
  assert.throws(
    () => runInstruction(inspect, look.args, { world: kernel }),
    /player must be an Expr/
  );

  // Gap 2 (RIFT-66): even with a literal player, "top" needs ordered refs from
  // upstream; without them the primitive is negated instead of silently looking
  // at zero cards, so no deck card is touched.
  const blocked = runInstruction(inspect, { ...look.args, player: constant("A") }, { world: kernel });
  assert.deepEqual(blocked.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-card", "second-card"]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test.todo(
  "The Candlelit Sanctum look step: bind the looking player to the ability controller through " +
    "contract 3.6's ObjectSelector and supply the ordered top-two refs from zoneSlice (RIFT-66 " +
    "provider) so effect.inspect's top scope executes instead of being blocked as impossible"
);

test.todo(
  "The Candlelit Sanctum ordering step: an at-resolution choice over 'looked minus recycled' " +
    "(437.1.a). effect.order's non-target selection comes from a Finalize-locked PickSpec " +
    "(359.3.e.9) and cannot name cards revealed while resolving"
);

test.todo(
  "The Candlelit Sanctum trigger: the conquer timing point is emitted by scoring (473.2.a, " +
    "471.1) and the CardProgram's triggered ability is registered as a TriggerRegistration with " +
    "the 053.3 'here' referent — scoring (RIFT-76) is not bridged to the chain/events pipeline " +
    "(RIFT-120) and no subscriber registers card-program triggers"
);
