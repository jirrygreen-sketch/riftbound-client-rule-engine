import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-temple.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-cd62916d98e552e83db520590945a7564cccd36cd0f631954e41d7c21e16695a";
const SOURCE_TEXT =
  "When you hold here, [Burn 3]. (Put the top 3 cards of your Main Deck into your trash.)";

const [ability] = program.abilities;
const [burn] = ability.body;

const deckIds = (kernel, player = "A") =>
  kernel.zoneSlice(player, "deck", "top").map(object => object.ref.id);
const trashIds = (kernel, player = "A") =>
  kernel.zoneSlice(player, "trash", "top").map(object => object.ref.id);

test("ven-165-166 Shadow Temple: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-165-166 Shadow Temple: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /effect\.mill/);
  assert.match(program.judgeReason, /RIFT-76/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("ven-165-166 Shadow Temple: hold-here trigger whose whole body is a Burn 3 (CR 441.1/441.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.d.2.b / 471.2 / 473.2.b: a Hold Effect referencing the player who
  // held; 383.4.d.2.c keeps it triggering when the point gain is negated or
  // replaced, so the body is unconditional.
  assert.equal(ability.trigger.at, "hold");
  // 053.3 "here" + 190.6.a/190.6.d "you"; "here" stays the 053.3 referent
  // placeholder while the trigger pipeline is unmerged (see judgeReason).
  assert.deepEqual(ability.trigger.filter, {
    event: "hold",
    here: true,
    player: "self"
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);

  // The reminder in parentheses is the fixed functional text of the Burn
  // action (441.2), not a second ability.
  assert.equal(ability.body.length, 1);
  assert.equal(burn.id, "shadow-temple.burn-3");
  assert.equal(burn.op, "effect.mill");
  assert.deepEqual(burn.args, { amount: { kind: "constant", value: 3 } });
  // 441.4: the burner defaults to the ability's controller (190.6.d); the
  // kernel owns deck-top order and the Burn Out continuation.
  assert.equal(burn.targets, undefined);
  assert.equal(burn.picks, undefined);
  assert.equal(burn.linkedTo, undefined);
  assert.equal(burn.condition, undefined);
});

test("ven-165-166 Shadow Temple golden: [Burn 3] moves the top 3 of the Main Deck to the trash in order", () => {
  const kernel = world().deck(["top", "second", "third", "fourth"]).build();

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["shadow-temple.burn-3", "executed"]
  ]);
  // 441.1: exactly the top three cards, in top-to-bottom order (id order is
  // deliberately not lexical order).
  assert.deepEqual(trashIds(kernel), ["top", "second", "third"]);
  assert.deepEqual(deckIds(kernel), ["fourth"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["mill"]);
  // The linked values come from the primitive the card names, not from a
  // hand-rolled fixture settlement.
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 3);
  assert.deepEqual(
    outcome.results[0].result.linkedValues.burned.map(ref => ref.id),
    ["top", "second", "third"]
  );
});

test("ven-165-166 Shadow Temple golden: a short Main Deck burns as many as possible (CR 441.4)", () => {
  const kernel = world().deck(["only-card"]).build();

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 1);
  assert.deepEqual(trashIds(kernel), ["only-card"]);
  assert.deepEqual(deckIds(kernel), []);
});

test("ven-165-166 Shadow Temple golden: a replaced burn negates the instruction without touching the deck", () => {
  const kernel = world().deck(["top", "second", "third", "fourth"]).build();
  kernel.addReplacement(action => action.type === "mill" ? "prevented" : null);

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(trashIds(kernel), []);
  assert.deepEqual(deckIds(kernel), ["top", "second", "third", "fourth"]);
});

test.todo(
  "ven-165-166 Shadow Temple: the hold-here trigger runs end to end (Hold Effect → chain) — needs " +
    "scoring → chain/events hold emission and CardProgram TriggerRegistration (RIFT-76/RIFT-120, contract " +
    "§7.2 batch 5) plus 190.6 battlefield-controller resolution and the 053.3 \"here\" anchor"
);

test.todo(
  "ven-165-166 Shadow Temple: a Burn that empties the Main Deck and triggers Burn Out (CR 432.1-432.5, " +
    "recycle + randomize + point gain + re-burn) — owned by the kernel's Burn Out replacement, which the " +
    "reference test kernel does not model"
);
