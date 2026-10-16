import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/evershade-stalker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-bd90399f1d9ed5e571bbb359df812b1741c5813f6fbb4b8d1bc6e9e3a96730f5";
const SOURCE_TEXT = "When you play me, discard 1, then draw 1.";

const [playTrigger] = program.abilities;
const [discardOne, drawOne] = playTrigger.body;

test("unl-123-219 Evershade Stalker: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-123-219 Evershade Stalker: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  // Both instructions are merged, and the card needs no extra primitive,
  // keyword or layer effect, so the whole ability is executable (README §2);
  // the shared CardProgram -> TriggerRegistration wiring is integration work
  // recorded as a TODO below (same status decision as ogn/cloud-drake and
  // ogn/traveling-merchant).
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-123-219 Evershade Stalker: 'When you play me' is a mandatory card-played trigger on the source", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.trigger.once, undefined);
  assert.equal(playTrigger.optional, false);
});

test("unl-123-219 Evershade Stalker: the body is discard 1 then draw 1, without a link (359.3.e.11)", () => {
  assert.deepEqual(
    playTrigger.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["evershade-stalker.discard-1", "effect.discard"],
      ["evershade-stalker.draw-1", "effect.draw"]
    ]
  );
  assert.deepEqual(discardOne.args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  // It is an effect discard, not a cost discard: the player chooses the card
  // (423.1.a) and the instruction discards as much as possible (423.4).
  assert.equal(discardOne.condition, undefined);
  assert.equal(discardOne.targets, undefined);
  assert.equal(discardOne.picks, undefined);
  // 359.3.e.14 only links an instruction that references the earlier instruction;
  // "draw 1" references neither the discarded card nor the discard action, so the
  // draw still resolves when the discard is negated (359.3.e.11's own example is
  // "Discard 2, then draw 2").
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.condition, undefined);
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.notEqual(instructionDefinitionsById.get("effect.discard"), undefined);
  assert.notEqual(instructionDefinitionsById.get("effect.draw"), undefined);
});

test("unl-123-219 Evershade Stalker golden: the player chooses which card to discard, then draws 1", () => {
  const kernel = world().hand("first").hand("second").hand("third").deck("top").build();
  // The private Hand choice replays by stable request id
  // (interpreter README: <instruction path>/<choice id>); effect.discard's default
  // choice id is effect.discard:<player>.
  kernel.setAnswers({ "evershade-stalker.discard-1/effect.discard%3AA": [kernel.ref("second")] });

  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["evershade-stalker.discard-1", "executed"],
    ["evershade-stalker.draw-1", "executed"]
  ]);
  // 423.1: the chosen card goes to the controller's Trash; 414.1.a/414.3: the draw
  // takes the top card of the same player's Main Deck.
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["second"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["first", "third", "top"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["discard", "draw"]);
  assert.equal(outcome.results[0].result.linkedValues.discarded.count, 1);
  assert.equal(outcome.results[1].result.linkedValues.drawn, 1);
});

test("unl-123-219 Evershade Stalker golden: a single-card hand discards it and still draws (423.4)", () => {
  const kernel = world().hand("only").deck([ "top", "second" ]).build();

  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["only"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top"]);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("unl-123-219 Evershade Stalker golden: an empty hand negates the discard but the draw still happens (423.4, 359.3.e.11)", () => {
  const kernel = world().deck("top").build();

  const outcome = resolveChainBody(playTrigger.body, kernel);

  // “Discard 1, then draw 1”: the discard is negated as impossible (as much as
  // possible, 423.4) and the independent draw instruction still resolves.
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.equal(outcome.results[1].result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
});

test("unl-123-219 Evershade Stalker golden: an empty hand and empty deck leaves the board untouched", () => {
  const kernel = world().build();

  const outcome = resolveChainBody(playTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(kernel.zone("A", "trash"), []);
  // The draw instruction still executes (414.4's Burn Out belongs to the kernel).
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(outcome.linkedValues["evershade-stalker.draw-1.drawn"], 0);
});

test.todo(
  "unl-123-219 Evershade Stalker: register the card-played trigger as a TriggerRegistration and fire it when the " +
    "unit finishes being played (CR 383.4.a / 420.4.a) — RIFT-120 follow-up"
);

