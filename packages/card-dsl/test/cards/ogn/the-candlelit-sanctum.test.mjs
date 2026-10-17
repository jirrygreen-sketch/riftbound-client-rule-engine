import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/the-candlelit-sanctum.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import order from "../../../../engine-core/dist/effects/instructions/effect.order.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-9cbd7ae406600f049622c2827bd155c0754bc7dee82570641d6f2eccff28654a";
const SOURCE_TEXT =
  "When you conquer here, look at the top two cards of your Main Deck. " +
  "You may recycle one or both of them. Put those you don't back in any order.";

const [, look, recycleStep, putRest] = program.abilities[0].body;
const LOOKED = "candlelit-sanctum-looked";
const RECYCLED = "candlelit-sanctum-recycled";
const constant = value => ({ kind: "constant", value });

/** A four-card Main Deck: the top two are the looked-at block. */
const deckWorld = () => world().deck(["top-card", "second-card", "third-card", "fourth-card"], { owner: "A" }).build();

test("The Candlelit Sanctum program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  // The reason must name the real gaps: the inspect/ObjectRef mismatch upstream,
  // the missing ordered top-of-deck provider, and the unresolved here anchor.
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /ObjectRef/);
  assert.match(program.judgeReason, /picksSpecId/);
  assert.match(program.judgeReason, /RIFT-64/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /here/);
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
    "candlelit-sanctum.bind-controller",
    "candlelit-sanctum.look",
    "candlelit-sanctum.recycle",
    "candlelit-sanctum.put-rest"
  ]);

  const [bindController] = ability.body;
  // effect.inspect's argsSchema still validates object-property.object as a
  // runtime ObjectRef, so the looking player is bound with the merged
  // condition.value + linked-value pattern (stacked-deck / double-trouble).
  assert.equal(bindController.op, "condition.value");
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindController.args.key, constant("controller"));
  assert.equal(bindController.linkedTo, undefined);

  // 432.1.c / 437.1: look at the top two of the Main Deck, then choose any
  // number (0..2) of them to recycle. The "you may recycle one or both" is a
  // count choice inside the look, not an optional instruction (contract 3.9).
  assert.equal(look.op, "effect.inspect");
  assert.equal(look.linkedTo, "candlelit-sanctum.bind-controller");
  assert.deepEqual(look.args.zone, constant("deck"));
  assert.deepEqual(look.args.scope, constant("top"));
  assert.deepEqual(look.args.amount, constant(2));
  assert.deepEqual(look.args.choose, constant(true));
  assert.deepEqual(look.args.chooseCount, constant({ min: 0, max: 2 }));
  assert.deepEqual(look.args.pickedKey, constant(LOOKED));
  assert.deepEqual(look.args.choosePicksKey, constant(RECYCLED));
  // The looking player must be this ability's controller: the controller is
  // read back from the binding instruction, no literal player id is written.
  assert.deepEqual(look.args.player, {
    kind: "linked-value",
    instructionId: "candlelit-sanctum.bind-controller",
    key: "controller"
  });
  assert.equal(look.targets, undefined);
  // 108.4.e / contract 3.6: the ordered top-two set is provisioned by the
  // caller; the primitive refuses to guess deck order from a set query.
  assert.deepEqual(look.picks, [
    {
      id: "candlelit-sanctum.top-two",
      options: ["dynamic:top-two-cards-of-your-main-deck-in-zone-order"],
      min: 0,
      max: 2,
      selection: "up-to",
      filter: { owner: "self", zone: "deck" }
    }
  ]);
  assert.deepEqual(look.args.picksSpecId, constant("candlelit-sanctum.top-two"));

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

test("The Candlelit Sanctum golden: the full look → recycle → put-back chain executes through the production adapter", () => {
  const kernel = deckWorld();
  const [top, second] = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  // The ordered deck-top set the production Finalize lifecycle must provision.
  kernel.setPicks("candlelit-sanctum.top-two", [top, second]);
  kernel.setPicks("candlelit-sanctum.put-back", [top, second]);
  kernel.setAnswers({
    // Choose the top card to recycle; put the rest back as [second, top].
    "candlelit-sanctum.look/effect.inspect%3Aselect%3AA%3AA%3Adeck": [top],
    "candlelit-sanctum.put-rest/effect.order%3Atop%3AA": [second, top]
  });

  const outcome = resolveChainBody(program.abilities[0].body, kernel);

  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["candlelit-sanctum.bind-controller", "executed", null],
      ["candlelit-sanctum.look", "executed", null],
      ["candlelit-sanctum.recycle", "executed", null],
      ["candlelit-sanctum.put-rest", "executed", null]
    ]
  );
  // 432.1.c / 128.3: the look really viewed both cards; 417.1.a recycled the
  // chosen one to the deck bottom; 437.1.a put the remainder back in the chosen
  // order (the recycled refs went stale and dropped out, 359.3.e.4).
  assert.equal(outcome.linkedValues["candlelit-sanctum.look.candlelit-sanctum-looked"].length, 2);
  assert.equal(
    outcome.linkedValues["candlelit-sanctum.look.candlelit-sanctum-recycled"].length,
    1
  );
  assert.equal(outcome.linkedValues["candlelit-sanctum.recycle.recycledCount"], 1);
  assert.equal(outcome.linkedValues["candlelit-sanctum.put-rest.ordered"], 1);
  // The recycled top card lands at the bottom; the stale ref drops out of the
  // put-back selection, leaving only second-card on top.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "second-card",
    "third-card",
    "fourth-card",
    "top-card"
  ]);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "recycle", "order-top"]);
});

test("The Candlelit Sanctum golden: recycling none puts both looked cards back in the chosen order", () => {
  const kernel = deckWorld();
  const [top, second] = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  kernel.setPicks("candlelit-sanctum.top-two", [top, second]);
  kernel.setPicks("candlelit-sanctum.put-back", [top, second]);
  kernel.setAnswers({
    "candlelit-sanctum.look/effect.inspect%3Aselect%3AA%3AA%3Adeck": [],
    "candlelit-sanctum.put-rest/effect.order%3Atop%3AA": [second, top]
  });

  const outcome = resolveChainBody(program.abilities[0].body, kernel);

  assert.equal(outcome.linkedValues["candlelit-sanctum.recycle.recycledCount"], 0);
  assert.equal(outcome.linkedValues["candlelit-sanctum.put-rest.ordered"], 2);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "second-card",
    "top-card",
    "third-card",
    "fourth-card"
  ]);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "order-top"]);
});

test("The Candlelit Sanctum golden: without an ordered top set the primitive refuses to guess deck order", () => {
  const kernel = deckWorld();
  // Without any ordered picks source at all the look is negated/impossible
  // rather than slicing the unordered set query.
  const noSource = runInstruction(
    inspect,
    { ...look.args, picksSpecId: undefined, player: constant("A") },
    { world: kernel }
  );
  assert.deepEqual(noSource.result, { status: "negated", reason: "impossible", events: [] });

  // With the declared id but nothing provisioned the primitive looks at zero
  // cards (never a guessed slice); no deck card moves and the look links an
  // empty viewed set.
  const blocked = runInstruction(inspect, { ...look.args, player: constant("A") }, { world: kernel });
  assert.equal(blocked.result.status, "executed");
  assert.equal(blocked.linked[LOOKED].length, 0);
  assert.equal(blocked.linked[RECYCLED].length, 0);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), [
    "top-card",
    "second-card",
    "third-card",
    "fourth-card"
  ]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test.todo(
  "The Candlelit Sanctum look step: the production Finalize/AwaitChoice lifecycle must provision the " +
    "ordered 'top two of your Main Deck' pick set — the merged chain Finalize surface only locks " +
    "instruction.targets TargetSpecs (chain/engine.ts assertFinalizationSurface) and has no ordered " +
    "zone-pick lifecycle, so the look range is empty in production"
);

test.todo(
  "The Candlelit Sanctum ordering step: an at-resolution choice over 'looked minus recycled' " +
    "(437.1.a). effect.order's non-target selection comes from a Finalize-locked PickSpec " +
    "(359.3.e.9) and cannot name cards revealed while resolving"
);

test.todo(
  "The Candlelit Sanctum trigger: the conquer timing point is emitted by scoring (473.2.a, " +
    "471.1, now emitted by TurnFlow's Score wave), but the trigger filter still needs the " +
    "053.3 'here' referent normalized before registration (RIFT-357)"
);
