// Golden test for Yordle Explorer (sfd-100-221).
//
// status = judge-required (see the program's judgeReason): the printed-Power
// cost gate of "with Power cost [[A]][[A]] or more" (CR 135.2.e.5 / 206.1,
// applied as a 383.2.a.1 trigger condition) rides on the EventPattern.details
// payload, and nothing merged derives that fact onto the card-played emission
// (chain/engine.ts emits object/player only). What IS merged and is exercised
// for real below: the production trigger adapter forwards details untouched,
// the registration it produces matches on that payload key, the merged
// matcher gates on it, and effect.draw executes.
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
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
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
  // The remaining gap is the event-payload producer, not the adapter: the
  // adapter forwards details since RIFT-257 (proved below).
  assert.match(program.judgeReason, /chain\/engine\.ts/);
  assert.match(program.judgeReason, /printed.*Power cost/);
  assert.match(program.judgeReason, /printedPowerCostAtLeast/);
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
  // The empty object is the event-mode anchor the production adapter needs to
  // keep details out of the ObjectFilter translation; it adds no restriction.
  assert.deepEqual(ability.trigger.filter.object, {});
  assert.equal(ability.trigger.filter.filter, undefined);
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

/**
 * Production harness for the merged trigger adapter (RIFT-257):
 * programs/filters.ts translates the card's EventPattern, programs/triggers.ts
 * turns it into a real TriggerRegistration, and the merged EventPipeline scans
 * a real card-played emission against it. The registry needs an executable
 * program to hand out (ProgramRegistry.get refuses judge-required cards), so
 * the copy below substitutes only the status; the IR and filter under test are
 * the shipped ones.
 */
function productionRegistration() {
  const registry = new ProgramRegistry([
    { ...program, status: "executable", judgeReason: undefined }
  ]);
  const source = world()
    .unit("yordle", {
      cardId: CARD_ID,
      types: ["unit"],
      owner: "A",
      controller: "A",
      zone: "board",
      energy: 4,
      power: null,
      might: 4
    })
    .build()
    .getObject("yordle");
  const [registration] = triggerRegistrations(registry, source);
  return { registration, source };
}

test("sfd-100-221 Yordle Explorer: the production adapter keeps EventPattern.details instead of rejecting it", () => {
  // Regression evidence for the removed "Unsupported filter field details"
  // claim: translateTriggerFilter is the merged production translator and now
  // preserves the payload predicate verbatim, without widening it.
  const translated = translateTriggerFilter(ability.trigger.filter, "yordle", "card-played");
  assert.deepEqual(translated, {
    event: "card-played",
    object: {},
    player: "self",
    details: { printedPowerCostAtLeast: 2 }
  });
});

test("sfd-100-221 Yordle Explorer: the registration the production adapter builds matches only 2+ Power plays", () => {
  const { registration, source } = productionRegistration();
  assert.equal(registration.spec.at, "card-played");
  // The details predicate survives into the real registration; the empty
  // object anchor adds no filter of its own.
  assert.deepEqual(registration.spec.filter, {
    event: "card-played",
    object: {},
    player: "self",
    details: { printedPowerCostAtLeast: 2 }
  });
  assert.deepEqual(registration.activeZones, ["board"]);
  assert.equal(registration.controller, "A");
  assert.equal(registration.boundToIncarnation, true);
  assert.equal(registration.source.ref.id, source.ref.id);

  // The registered body is the card's own draw instruction, not a stub.
  assert.deepEqual(registration.body.map(instruction => instruction.id), [
    "yordle-explorer.draw-1"
  ]);
});

test("sfd-100-221 Yordle Explorer golden: a real card-played wave triggers only for a payload-2+ play", () => {
  const { registration, source } = productionRegistration();
  const host = {
    checkpoint: () => null,
    restore: () => {},
    execute: () => ({ outcome: { status: "done", events: [] }, emissions: [] }),
    context: () => ({}),
    objects: () => [source],
    choose: () => {
      throw new Error("unexpected choose");
    }
  };

  const run = details => {
    const emitted = [];
    const pipeline = new EventPipeline(host, ["A", "B"], "A");
    pipeline.onTrigger = snapshot => emitted.push(snapshot);
    pipeline.registerTrigger(registration);
    const played = {
      ...source,
      ref: { id: "played-card", zoneEntryId: 99 },
      cardId: "card:played-card",
      types: ["spell"],
      zone: "chain",
      location: null,
      controller: "A",
      owner: "A"
    };
    pipeline.emit({
      timingPoint: "card-played",
      object: played,
      player: "A",
      ...(details === undefined ? {} : { details })
    });
    return emitted.length;
  };

  // 206.1's printed threshold: 2 matches, 1 does not, a missing payload fails closed.
  assert.equal(run({ printedPowerCostAtLeast: 2 }), 1);
  assert.equal(run({ printedPowerCostAtLeast: 1 }), 0);
  assert.equal(run(undefined), 0);
});

test.todo(
  "sfd-100-221 Yordle Explorer: carry the played card's PRINTED (or copied) Power cost onto the " +
    "card-played emission so the details predicate fires only for 2+ " +
    "(CR 135.2.e.5 / 206.1 / 383.2.a.1) — chain/engine.ts's resolve still emits object/player only, so the " +
    "merged registration stays fail-closed until that producer lands"
);
