import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/rakelstake.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-1b896afb48233f602257054e1545c35265f320f21b47acd9ff53e914226707f7";
const SOURCE_TEXT =
  "For each player, the first time they play a unit or gear here each turn, they [Predict]. " +
  "(They look at the top card of their Main Deck. They may recycle it.)";

const [ability] = program.abilities;
const [look, recycle] = ability.body;

// effect.inspect issues its select request with a default choice id derived from
// viewer/owner/zone; the interpreter prefixes it with the execution path.
const SELECT_ID = "rakelstake.predict/effect.inspect%3Aselect%3AA%3AA%3Adeck";

test("rad-165-167 Rakelstake: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("rad-165-167 Rakelstake: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /event-player/);
  assert.match(program.judgeReason, /per-player/);
  assert.match(program.judgeReason, /programs\.triggers|triggerRegistrations/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-165-167 Rakelstake: per-turn play trigger for units and gear played here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 359/407: playing a card is the event; 053.3 marks the destination, and
  // 383.1.b records the printed "the first time ... each turn" frequency.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    here: true,
    object: { type: ["unit", "gear"] }
  });
  assert.equal(ability.trigger.once, "per-turn");

  // The trigger is the judged part: no event-player selector, no per-player
  // frequency and no play-location payload exist in the frozen IR.
  assert.match(program.judgeReason, /TriggerSpec\.once/);
});

test("rad-165-167 Rakelstake: Predict is inspect-top-one-then-optionally-recycle", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "rakelstake.predict",
    "rakelstake.recycle"
  ]);

  // 437.1/437.3.a: look at the top card of the Main Deck, choose 0..1 to recycle.
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, {
    kind: "constant",
    value: { min: 0, max: 1 }
  });
  // "they": the frozen IR has no event-player selector, so the constant is a
  // documented placeholder, not a fabricated seat.
  assert.deepEqual(look.args.player, { kind: "constant", value: "event-player" });
  assert.equal(look.linkedTo, undefined);

  // 417.1.b/417.4: recycle follows the look and consumes its linked result.
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "rakelstake.predict",
    key: "rakelstake-recycle"
  });
  assert.equal(recycle.linkedTo, "rakelstake.predict");
});

test("rad-165-167 Rakelstake: the as-printed body cannot execute (event-player placeholder)", () => {
  const kernel = world().deck(["top", "rest"]).build();

  const outcome = resolveChainBody(ability.body, kernel);

  // The look is negated because "event-player" is not a resolvable viewer; the
  // deck is untouched, so nothing is silently approximated.
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "rest"]);
  assert.equal(kernel.events.length, 0);
});

/** Supplying only the missing bindings the judgeReason names: viewer + ordered top picks. */
function predictBodyFor(player) {
  return [
    {
      ...look,
      args: {
        ...look.args,
        player: { kind: "constant", value: player },
        picksSpecId: { kind: "constant", value: "rakelstake-top" }
      }
    },
    recycle
  ];
}

test("rad-165-167 Rakelstake: Predict executes once the viewer is bound (choose to recycle)", () => {
  const kernel = world().deck(["top", "rest"]).build();
  const top = kernel.ref("top");
  kernel.setPicks("rakelstake-top", [top]);
  kernel.setAnswers({ [SELECT_ID]: [top] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["rakelstake.predict", "executed"],
    ["rakelstake.recycle", "executed"]
  ]);
  // 437.1: exactly one card was seen; 417.1.b: the chosen card went to the bottom.
  assert.equal(kernel.getObject("top").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["rest", "top"]);
  assert.equal(kernel.events.map(event => event.action).join(","), "look,recycle");
});

test("rad-165-167 Rakelstake: declining to recycle keeps the predicted card on top", () => {
  const kernel = world().deck(["top", "rest"]).build();
  const top = kernel.ref("top");
  kernel.setPicks("rakelstake-top", [top]);
  kernel.setAnswers({ [SELECT_ID]: [] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "rest"]);
  // Nothing was recycled, so the only committed game action is the look
  // (417.4: recycling zero cards is a successful no-op, not an event).
  assert.deepEqual(kernel.events.map(event => event.action), ["look"]);
  assert.equal(kernel.getObject("top").zone, "deck");
});

test("rad-165-167 Rakelstake: an empty Main Deck predicts nothing without Burn Out (437.4)", () => {
  const kernel = world().build();
  kernel.setPicks("rakelstake-top", []);
  kernel.setAnswers({ [SELECT_ID]: [] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "rad-165-167 Rakelstake: bind 'they' to the player who played the card (event-player selector, " +
    "contract change request) and gate the trigger to that player's first unit-or-gear play at this " +
    "Battlefield each turn (per-player once frequency + play-location payload) — the frozen " +
    "TriggerSpec.once scopes are keyed to one source, and no payload names the play's destination"
);

test.todo(
  "rad-165-167 Rakelstake: register the card program's triggered ability as a TriggerRegistration " +
    "and run it from the real play pipeline: the adapter exists (programs/triggers.ts), but the " +
    "here:true filter is rejected by the strict validator and silently dropped by the translator, " +
    "so a real destination filter must land first (053.3 here referent, 190.6 Battlefield-controller " +
    "resolution)"
);

