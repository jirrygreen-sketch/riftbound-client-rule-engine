import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/eclipse.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { abilitySpeed, expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-de24e677d5541604808bbe583f958d702c8e2067e5a554af3d856ceac17c6354";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit -4 :rb_might: this turn.\n" +
  "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)";

const [keyword, play] = program.abilities;
const [mightInstruction, bindInstruction, lookInstruction, recycleInstruction] = play.body;
const [predictedPick] = lookInstruction.picks;

// effect.inspect issues its select request under the interpreter's path-derived
// id: the execution path plus the primitive's choiceId argument.
const PREDICT_CHOICE_ID = "eclipse.predict-look/eclipse.predict";

/** The Predict half only: controller binding, ordered look, optional recycle. */
const predictHalf = () => [bindInstruction, lookInstruction, recycleInstruction];

const predictedKernel = () => {
  const kernel = world().deck(["top-card", "rest-card"], { owner: "A" }).build();
  kernel.setPicks(predictedPick.id, [kernel.ref("top-card")]);
  return kernel;
};

test("unl-063-219 Eclipse: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-063-219 Eclipse: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-063-219 Eclipse: [Reaction], printed cost and the printed instruction order", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 3 energy, no printed power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["eclipse.give-minus-4-might", "continuous.might"],
      ["eclipse.bind-controller", "condition.value"],
      ["eclipse.predict-look", "effect.inspect"],
      ["eclipse.predict-recycle", "effect.recycle"]
    ]
  );
});

test("unl-063-219 Eclipse: Reaction expansion permits Showdown and closed-state timing", () => {
  const board = fixture({
    cards: [{ id: "eclipse", cardId: CANONICAL_ID, types: ["spell"], energy: 3, power: null }]
  });
  const source = board.kernel.getObject("eclipse");
  const expanded = expandProgram(program, source);
  const timingGrant = expanded.expanded.find(
    (ability) => ability.kind === "static" && ability.effect.kind === "continuous.timing"
  );
  assert.ok(timingGrant);
  assert.deepEqual(timingGrant.effect.grants, ["showdown", "closed-state"]);
  const speed = abilitySpeed(expanded.abilities, source);
  assert.equal(speed, "reaction");

  board.engine.openShowdown("A");
  assert.equal(board.engine.turnState, "showdown-open");
  assert.equal(board.engine.canAct("A", speed, source.ref, source), true);
  assert.equal(board.engine.canAct("A", "normal", source.ref, source), false);

  // Finalize a real Draw ability to enter a closed state before it resolves.
  board.engine.execute(board.draft("draw-before-eclipse"));
  assert.equal(board.engine.turnState, "showdown-closed");
  assert.equal(board.kernel.player("A").handSize, 1);
  assert.equal(board.engine.canAct("A", speed, source.ref, source), true);
  assert.equal(board.engine.canAct("A", "action", source.ref, source), false);
  assert.equal(board.engine.canAct("B", speed, source.ref, source), false);
});

test("unl-063-219 Eclipse: 'Give a unit -4 Might this turn' is a temporary modification, never a Buff", () => {
  // 143.2.a / 143.2.c: the card's "Might" is the layered effective value, and
  // 317.2.c expires "this turn" in the end-of-turn cleanup. Buff counters (702)
  // are a different object, so this is continuous.might.
  assert.equal(mightInstruction.op, "continuous.might");
  assert.notEqual(mightInstruction.op, "effect.buff");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -4 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "eclipse.chosen-unit" }
  });
  assert.deepEqual(mightInstruction.targets, [
    {
      id: "eclipse.chosen-unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("unl-063-219 Eclipse golden: continuous.might registers -4 and expires at end of turn", () => {
  const kernel = world().unit("chosen", { might: 5 }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("chosen") });
  ctx.setTargets("eclipse.chosen-unit", [ctx.ref("chosen")]);
  const outcome = runInstruction(might, {
    amount: mightInstruction.args.amount,
    duration: mightInstruction.args.duration,
    objects: mightInstruction.args.objects.value
  }, {
    world: ctx,
    targets: { "eclipse.chosen-unit": [ctx.ref("chosen")] }
  });

  assert.equal(outcome.result.status, "executed");
  assert.equal(ctx.continuousEffects.length, 1);
  const [registration] = ctx.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -4);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(ctx.objects, ctx.continuousEffects);
  assert.equal(layers.evaluate(ctx.ref("chosen")).might, 1);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(ctx.ref("chosen")).might, 5);
});

test("unl-063-219 Eclipse: the two printed sentences are independent, with the Predict bound to the controller", () => {
  // Two separate sentences (055 / 359.3.e.11): a failed Might clause must not
  // suppress the Predict, so the instructions are not linked.
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(bindInstruction.linkedTo, undefined);
  assert.deepEqual(bindInstruction.args, {
    value: { kind: "object-property", object: "source", property: "controller" },
    key: { kind: "constant", value: "controller" }
  });
  // "your Main Deck" is the caster's deck (190.6.d): the bound controller is
  // read back as a linked value.
  assert.deepEqual(lookInstruction.args.player, {
    kind: "linked-value",
    instructionId: "eclipse.bind-controller",
    key: "controller"
  });
  assert.equal(lookInstruction.linkedTo, "eclipse.bind-controller");
});

test("unl-063-219 Eclipse: [Predict] is CR 437's action — look at one card, then choose 0..1 to recycle", () => {
  // "[Predict]" is not in the CR 805-832 keyword glossary; it is the Predict
  // action of 437.1, and 437.3.a presumes X = 1 when the value is omitted.
  assert.deepEqual(lookInstruction.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(lookInstruction.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(lookInstruction.args.choose, { kind: "constant", value: true });
  assert.deepEqual(lookInstruction.args.chooseCount, {
    kind: "constant",
    value: { min: 0, max: 1 }
  });
  // 108.4.e / contract 3.6: the Main Deck's order is secret, so the top card
  // arrives as an ordered pick (zoneSlice), never from an unordered query.
  assert.deepEqual(predictedPick, {
    id: "eclipse.predicted-card",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
  });
  // The recycle follows the look (437.1) and recycles exactly what was chosen
  // under the look's choosePicksKey; recycling nothing is a legal no-op (417.4).
  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.equal(recycleInstruction.linkedTo, "eclipse.predict-look");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "eclipse.predict-look",
    key: "predicted-recycle"
  });
});

test("unl-063-219 Eclipse golden: choosing to recycle sends the predicted card to the deck bottom (437.1, 417.1.a)", () => {
  const kernel = predictedKernel();
  kernel.setAnswers({ [PREDICT_CHOICE_ID]: [kernel.ref("top-card")] });

  const outcome = resolveChainBody(predictHalf(), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["eclipse.bind-controller", "executed"],
      ["eclipse.predict-look", "executed"],
      ["eclipse.predict-recycle", "executed"]
    ]
  );
  assert.deepEqual(
    kernel.objectsInZone("A", "deck").map((ref) => ref.id),
    ["rest-card", "top-card"]
  );
  assert.deepEqual(outcome.events.map((event) => event.action), ["look", "recycle"]);
  assert.equal(outcome.linkedValues["eclipse.predict-recycle.recycledCount"], 1);
});

test("unl-063-219 Eclipse golden: declining the recycle leaves the predicted card on top", () => {
  const kernel = predictedKernel();
  kernel.setAnswers({ [PREDICT_CHOICE_ID]: [] });

  const outcome = resolveChainBody(predictHalf(), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    kernel.objectsInZone("A", "deck").map((ref) => ref.id),
    ["top-card", "rest-card"]
  );
  // The look is the only committed game action; recycling zero cards is a
  // successful no-op, not an event (417.4).
  assert.deepEqual(outcome.events.map((event) => event.action), ["look"]);
  assert.equal(outcome.linkedValues["eclipse.predict-recycle.recycledCount"], 0);
});

test("unl-063-219 Eclipse golden: predicting an empty Main Deck looks at nothing without Burn Out (437.4)", () => {
  const kernel = world().build();
  kernel.setPicks(predictedPick.id, []);
  kernel.setAnswers({ [PREDICT_CHOICE_ID]: [] });

  const outcome = resolveChainBody(predictHalf(), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(outcome.events, []);
});

test("unl-063-219 Eclipse fail-closed: the top scope refuses to guess deck order without ordered picks", () => {
  // Contract 3.6: without the ordered pick set the looked-at range is empty, so
  // the Predict sees nothing and the recycle is a legal no-op. The deck keeps
  // its real order — no guessed slice, no invented top card.
  const kernel = world().deck(["top-card", "rest-card"], { owner: "A" }).build();
  kernel.setAnswers({ [PREDICT_CHOICE_ID]: [] });

  const outcome = resolveChainBody(predictHalf(), kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["eclipse.bind-controller", "executed"],
      ["eclipse.predict-look", "executed"],
      ["eclipse.predict-recycle", "executed"]
    ]
  );
  // Nothing was looked at, so the picked list is empty rather than absent.
  assert.deepEqual(outcome.linkedValues["eclipse.predict-look.predicted"], []);
  assert.equal(outcome.linkedValues["eclipse.predict-look.inspected"], 0);
  assert.deepEqual(
    kernel.objectsInZone("A", "deck").map((ref) => ref.id),
    ["top-card", "rest-card"]
  );
  assert.deepEqual(outcome.events, []);
});

test("unl-063-219 Eclipse golden: production Finalize locks the deck top and the played spell resolves both effects", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const board = fixture({
    cards: [{ id: "eclipse", cardId: CANONICAL_ID, types: ["spell"], energy: 3, power: [] }],
    describePlay: binding.describePlay
  });
  board.kernel.addObject({
    ref: { id: "enemy", zoneEntryId: 1 },
    cardId: "card:enemy",
    name: "Enemy",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 5,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    combatRole: null
  }, "board");
  const source = board.kernel.getObject("eclipse");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  const deckTop = board.kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  board.answers.set("target:eclipse.chosen-unit", [board.kernel.ref("enemy")]);
  board.engine.execute(draft);
  assert.deepEqual(board.engine.items[0].pickPlans[0].refs, [deckTop]);
  board.answers.set(PREDICT_CHOICE_ID, [deckTop]);
  resolveAll(board.engine);

  assert.equal(board.engine.layers.evaluate(board.kernel.ref("enemy")).might, 1);
  assert.deepEqual(board.kernel.zone("A", "deck").map((ref) => ref.id).slice(-1), [deckTop.id]);
  assert.deepEqual(
    board.kernel.events.map((event) => event.action).filter((action) => action === "look" || action === "recycle"),
    ["look", "recycle"]
  );
});
