// Golden test for Yordle Explorer (sfd-100-221).
//
// status = judge-required (see the program's judgeReason): the printed-Power
// cost gate of "with Power cost [[A]][[A]] or more" (CR 135.2.e.5 / 206.1,
// applied as a 383.2.a.1 trigger condition) still lacks a production payload.
// EventPattern.details, matching, trigger binding, and the effect.draw body are
// exercised for real below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/yordle-explorer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import {
  EVENT_PATTERN_TYPES,
  validateEventPattern,
  validateTriggerSpec
} from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0bf2f78a39c15787c743ca80bf9a8a0faa2ab20b9e055830b9d7e280dd5469ed";
const SOURCE_TEXT =
  "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1.";

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("sfd-100-221 Yordle Explorer: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-100-221 Yordle Explorer: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: the reason names the missing producer and the governing rules.
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /206\.1/);
  assert.match(program.judgeReason, /card-played/);
  assert.match(program.judgeReason, /Unsupported filter field details/);
  assert.match(program.judgeReason, /printed.*Power cost/);
  assert.match(program.judgeReason, /fail-closed/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-100-221 Yordle Explorer: a card-played trigger scoped to the controller's plays", () => {
  // 383.1 / 383.4.a.4: "When you play a card" fires after any play the ability's
  // controller completes; 190.6.d makes "you" the ability controller.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.filter.event, "card-played");
  assert.equal(ability.trigger.filter.player, "self");
  // The "Power cost 2+" clause rides on the closed EventPattern payload shape
  // (383.2.a.1 + 206.1); see the program's judgeReason for the missing producer.
  assert.deepEqual(ability.trigger.filter.details, { printedPowerCostAtLeast: 2 });
  assert.equal(ability.trigger.filter.filter, undefined);
  assert.equal(ability.trigger.filter.object, undefined);
});

test("sfd-100-221 Yordle Explorer: the trigger filter passes the engine's own EventPattern/TriggerSpec validation", () => {
  // Contract 3.5: the card's filter must be a real engine EventPattern, not a
  // card-local vocabulary. "card-played" is a registered event name here.
  assert.ok(EVENT_PATTERN_TYPES.includes("card-played"));
  const pattern = validateEventPattern(ability.trigger.filter);
  assert.equal(pattern.ok, true, JSON.stringify(pattern.ok ? [] : pattern.issues));
  const spec = validateTriggerSpec(ability.trigger);
  assert.equal(spec.ok, true, JSON.stringify(spec.ok ? [] : spec.issues));
});

test("sfd-100-221 Yordle Explorer: the merged matcher evaluates the cost predicate from the event payload", () => {
  // The merged matcher compares EventPattern.details against the event's own
  // details key, so the predicate is a real gate: it matches a play whose
  // printed Power cost reaches the threshold and stays closed for a play below
  // it or without the payload. This is the execution semantics the production
  // card-played payload has to feed (see judgeReason), not an approximation.
  const playedEvent = details => ({
    timingPoint: "card-played",
    object: {
      ref: { id: "played-card", zoneEntryId: 1 },
      cardId: "card:played-card",
      types: ["spell"],
      controller: "A",
      owner: "A",
      zone: "chain",
      tags: []
    },
    player: "A",
    ...(details === undefined ? {} : { details })
  });
  assert.equal(matchesTriggerEvent(ability.trigger.filter, playedEvent(), "A"), false);
  assert.equal(
    matchesTriggerEvent(ability.trigger.filter, playedEvent({ printedPowerCostAtLeast: 2 }), "A"),
    true
  );
  // A card below the threshold does not match (206.1's printed value is the gate).
  assert.equal(
    matchesTriggerEvent(ability.trigger.filter, playedEvent({ printedPowerCostAtLeast: 1 }), "A"),
    false
  );
  // "you play" binds the ability controller (190.6.d).
  assert.equal(
    matchesTriggerEvent(ability.trigger.filter, { ...playedEvent({ printedPowerCostAtLeast: 2 }), player: "B" }, "A"),
    false
  );
});

test("sfd-100-221 Yordle Explorer: body is one unlinked effect.draw of exactly 1", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "yordle-explorer.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("sfd-100-221 Yordle Explorer golden: the body draws 1 for the ability controller", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["yordle-explorer.draw-1", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.equal(outcome.linkedValues["yordle-explorer.draw-1.drawn"], 1);
  assert.equal(outcome.linkedValues["yordle-explorer.draw-1.drawnTo"], "A");
});

test("sfd-100-221 Yordle Explorer golden: the draw follows the ability controller, not a fixed seat", () => {
  const kernel = world().deck(["top-card", "second-card"], { owner: "B" }).build();
  Object.defineProperty(kernel, "controller", { value: "B" });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(outcome.linkedValues["yordle-explorer.draw-1.drawnTo"], "B");
});

test("sfd-100-221 Yordle Explorer golden: an empty deck links the actual drawn count of 0 (414.4)", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(outcome.linkedValues["yordle-explorer.draw-1.drawn"], 0);
});

test.todo(
  "sfd-100-221 Yordle Explorer: preserve EventPattern.details through the production trigger adapter and " +
    "carry the played card's PRINTED (or copied) Power cost so the details predicate fires only for 2+ " +
    "(CR 135.2.e.5 / 206.1 / 383.2.a.1) — the adapter currently routes details through ObjectFilter and " +
    "the chain emission does not derive that payload, so the merged filter stays fail-closed"
);
