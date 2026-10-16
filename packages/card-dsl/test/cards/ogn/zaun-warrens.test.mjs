import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/zaun-warrens.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7eb7c2878a687bba1f5053f3c775d1f55e01679f4a8124757d2bb0a70b15ad88";
const SOURCE_TEXT = "When you conquer here, discard 1, then draw 1.";

const [discard, draw] = program.abilities[0].body;

test("Zaun Warrens program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /359\.3\.e\.11/);
  assert.match(program.judgeReason, /RIFT-76/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Zaun Warrens structure: conquer trigger, then discard 1 and draw 1 unlinked", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "conquer");
  // 053.3: "here" is this Battlefield; the sibling battlefield programs keep
  // the same placeholder spelling for the referent and the holding player.
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    here: true,
    player: "controller"
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "zaun-warrens.discard",
    "zaun-warrens.draw"
  ]);

  // 423.1.a / 423.4: the controller discards 1 and chooses the card; no
  // target/pick is locked at Finalize.
  assert.equal(discard.op, "effect.discard");
  assert.deepEqual(discard.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(discard.targets, undefined);
  assert.equal(discard.picks, undefined);
  assert.equal(discard.linkedTo, undefined);

  // "then draw 1" is a separate instruction: 359.3.e.11's official example
  // ("Discard 2, then draw 2") draws even when the discard is negated, so the
  // draw must not be linked to the discard.
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.targets, undefined);
  assert.equal(draw.picks, undefined);
});

test("Zaun Warrens golden: an empty hand negates the discard and still draws 1 (CR 359.3.e.11)", () => {
  const kernel = world().deck("deck-card").build();

  const outcome = resolveChainBody(program.abilities[0].body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["zaun-warrens.discard", "negated"],
    ["zaun-warrens.draw", "executed"]
  ]);
  assert.equal(outcome.results[0].result.reason, "impossible");
  // 423.4: nothing to discard; 414.3: the draw still happens.
  assert.deepEqual(kernel.events.map(event => event.action), ["draw"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["deck-card"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("Zaun Warrens golden: a single card in hand is discarded and then replaced by the draw", () => {
  const kernel = world().deck("deck-card").hand("hand-card").build();

  const outcome = resolveChainBody(program.abilities[0].body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["zaun-warrens.discard", "executed"],
    ["zaun-warrens.draw", "executed"]
  ]);
  assert.equal(outcome.results[0].result.linkedValues.discarded.count, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["discard", "draw"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["hand-card"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["deck-card"]);
});

test("Zaun Warrens golden: the discarding player chooses which card leaves a multi-card hand (CR 423.1.a)", () => {
  const kernel = world().deck("deck-card").hand("hand-a").hand("hand-b").build();

  // Without an answer the primitive suspends and the world is untouched.
  assert.throws(
    () => resolveChainBody(program.abilities[0].body, kernel),
    error => error.request?.id === "zaun-warrens.discard/effect.discard%3AA" &&
      error.request?.type === "select-objects" &&
      error.request?.min === 1 && error.request?.max === 1 &&
      error.request?.options.map(option => option.id).join(",") === "hand-a,hand-b"
  );
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["hand-a", "hand-b"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);

  // Replaying the whole body with the answer discards exactly the chosen card.
  const chosen = kernel.ref("hand-b");
  kernel.setAnswers({ "zaun-warrens.discard/effect.discard%3AA": [chosen] });
  const outcome = resolveChainBody(program.abilities[0].body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["discard", "draw"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["hand-b"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["hand-a", "deck-card"]);
});

test.todo(
  "Zaun Warrens trigger: the conquer timing point is emitted by scoring when the player " +
    "gains control and scores the Battlefield (473.2.a, 471.1), and the CardProgram's triggered " +
    "ability is registered as a TriggerRegistration with the 053.3 'here' referent and the " +
    "controller of the Battlefield ability (190.6) resolved — scoring (RIFT-76) is not bridged " +
    "to the chain/events pipeline (RIFT-120) and no subscriber registers card-program triggers"
);

test.todo(
  "Zaun Warrens 359.3.e.11 end-to-end: a replacement effect that negates the discard leaves the " +
    "unlinked draw resolving inside the real chain resolution (needs the chain/events pipeline, RIFT-120)"
);
