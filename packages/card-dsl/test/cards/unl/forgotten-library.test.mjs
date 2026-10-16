import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/forgotten-library.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-0c84a15b23d289310ee132b8937d22231ed0dab9f0fc4a5bdbd529b58be62c3a";
const SOURCE_TEXT =
  "While you control this battlefield, when you play a spell, if you spent :rb_energy_4: or more, [Predict]. " +
  "(Look at the top card of your Main Deck. You may recycle it.)";

const [ability] = program.abilities;
const [look, recycle] = ability.body;

// effect.inspect issues its select request with the card's stable choiceId; the
// interpreter prefixes it with the execution path (interpreter README).
const SELECT_ID = "forgotten-library.predict-look/forgotten-library.predict";

test("unl-211-219 Forgotten Library: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-211-219 Forgotten Library: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-211-219 Forgotten Library: judgeReason names the spent-energy, ordered-top and trigger gaps", () => {
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-102/);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-211-219 Forgotten Library: a spell play whose spend is part of the trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 383.4.a.4: "when you play a spell" is not a Play Effect; the event object
  // is the spell the ability's controller played (359/407).
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "spell", controller: "self" }
  });
  // 383.2.a.1: the spent-energy clause sits in the trigger condition, and the
  // frozen IR has no finalized-cost receipt to read it from (judgeReason).
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 4 });
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(ability.trigger.condition.left.subject, "energy-spent-on-the-played-spell");
  assert.equal(ability.trigger.once, undefined);
});

test("unl-211-219 Forgotten Library: [Predict] is an ordered top-1 look then a linked recycle", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "forgotten-library.predict-look",
    "forgotten-library.predict-recycle"
  ]);

  // 437.1/437.3.a: look at the top card of the Main Deck and choose 0..1 of the
  // seen cards to recycle. "your Main Deck" is the ability controller's
  // (190.6.d), and the ordered deck-top block stays an upstream obligation
  // (contract 3.6; effect.inspect never derives order from a set query).
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.player, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "forgotten-library.predict-top-1"
  });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, {
    kind: "constant",
    value: { min: 0, max: 1 }
  });
  assert.deepEqual(look.args.choiceId, {
    kind: "constant",
    value: "forgotten-library.predict"
  });
  assert.deepEqual(look.args.pickedKey, { kind: "constant", value: "predict-looked-at" });
  assert.deepEqual(look.args.choosePicksKey, { kind: "constant", value: "predict-recycle" });
  assert.equal(look.linkedTo, undefined);
  assert.equal(look.targets, undefined);

  // 417.1.b/417.4: the recycle follows the look and consumes its linked result.
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "forgotten-library.predict-look",
    key: "predict-recycle"
  });
  assert.equal(recycle.linkedTo, "forgotten-library.predict-look");
});

/**
 * Supply only the bindings the judgeReason names as missing: the viewer (the
 * symbolic controller selector effect.inspect's argsSchema cannot consume yet)
 * and the ordered deck-top block the primitive requires. Everything else is the
 * program's own instruction sequence.
 */
function predictBodyFor(player) {
  return [
    {
      ...look,
      args: { ...look.args, player: { kind: "constant", value: player } }
    },
    recycle
  ];
}

function deckWorld() {
  const kernel = world().deck(["top", "rest"]).build();
  kernel.setPicks("forgotten-library.predict-top-1", [kernel.ref("top")]);
  return kernel;
}

test("unl-211-219 Forgotten Library: recycling the predicted card sends it to the deck bottom (437.1)", () => {
  const kernel = deckWorld();
  kernel.setAnswers({ [SELECT_ID]: [kernel.ref("top")] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["forgotten-library.predict-look", "executed"],
    ["forgotten-library.predict-recycle", "executed"]
  ]);
  // 417.1: the chosen card went to the bottom of its owner's Main Deck.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["rest", "top"]);
  assert.deepEqual(outcome.linkedValues["forgotten-library.predict-recycle.recycledCount"], 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["look", "recycle"]);
});

test("unl-211-219 Forgotten Library: declining the recycle is a legal Predict (437.1/437.4)", () => {
  const kernel = deckWorld();
  kernel.setAnswers({ [SELECT_ID]: [] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "rest"]);
  assert.deepEqual(outcome.linkedValues["forgotten-library.predict-recycle.recycledCount"], 0);
  // Nothing was recycled, so the only committed game action is the private look.
  assert.deepEqual(outcome.events.map(event => event.action), ["look"]);
});

test("unl-211-219 Forgotten Library: a short Main Deck predicts as much as possible (437.4)", () => {
  const kernel = world().build();
  kernel.setPicks("forgotten-library.predict-top-1", []);
  kernel.setAnswers({ [SELECT_ID]: [] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").deckSize, 0);
  assert.deepEqual(outcome.linkedValues["forgotten-library.predict-look.inspected"], 0);
});

test.todo(
  "unl-211-219 Forgotten Library: evaluate 'if you spent :rb_energy_4: or more' from the " +
    "finalized cost plan of the spell that was just played (CR 383.2.a.1; needs the cost-receipt " +
    "reading path of RIFT-89) — no Expr/Condition form reads a paid amount today"
);

test.todo(
  "unl-211-219 Forgotten Library: run the trigger for the Battlefield's controller and resolve " +
    "the ordered top-of-deck Predict through the production pipeline (053.3 'this battlefield', " +
    "190.6.a/190.6.d, 437.1) — needs the ordered zone-pick lifecycle the effect.inspect contract " +
    "names plus RIFT-33 / contract §7.2 batch 5 CardProgram TriggerRegistration"
);

test.todo(
  "unl-211-219 Forgotten Library: effect.inspect accepting the contract 3.6 symbolic selector for " +
    "object-property (player: { object: 'source', property: 'controller' }) — the merged " +
    "argsSchema still requires a zone-bound ObjectRef (RIFT-102 follow-up), so the executed " +
    "scenarios bind the viewer explicitly"
);
