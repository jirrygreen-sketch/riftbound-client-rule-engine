// Golden test for Yordle Explorer (sfd-100-221).
//
// Whole-card execution evidence (the 2-Power gate and the Draw 1 body through
// the real chain path) lives in
// test/cards/templates/triggered-card-played-effect-draw-656.test.mjs. This file
// keeps validation, identity, structure and the remaining power: null gap.
//
// status = judge-required (see the program's judgeReason). The printed-Power
// cost gate of "with Power cost [[A]][[A]] or more" (CR 135.2.e.5 / 206.1,
// applied as a 383.2.a.1 trigger condition) is now the merged event-printed
// condition predicate (RIFT-359): pipeline.ts evaluates it against the real
// card-played payload that chain/engine.ts emits (played object + printed
// snapshot). The golden plays the card through the production ChainEngine and
// shows the trigger firing for a 2-Power play and staying closed for a 1-Power
// play. The one remaining gap is the power: null card: numericPrinted throws
// MissingInformation instead of evaluating "no Power cost" as false, so that
// wave aborts with the card still on the Chain (asserted below).
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
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { MissingInformation } from "../../../../engine-core/dist/effects/interpreter/values.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0bf2f78a39c15787c743ca80bf9a8a0faa2ab20b9e055830b9d7e280dd5469ed";
const PLAYED_SPELL_ID = "card:played-spell";
const SOURCE_TEXT =
  "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1.";

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

const constant = value => ({ kind: "constant", value });

/** An executable filler spell program so the played card can go through describePlay. */
const PLAYED_SPELL = {
  canonicalCardId: PLAYED_SPELL_ID,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities: [{ kind: "play", body: [] }],
  sourceText: "synthetic played spell"
};

/** Only the shipped status blocks the registry; IR and filters under test are the shipped ones. */
const executableYordle = { ...program, status: "executable", judgeReason: undefined };

/** The merged card-program adapter used by every execution test below. */
const BINDING = createProgramBinding({ cardPrograms: [executableYordle, PLAYED_SPELL] });

/**
 * A real ChainEngine fixture: Yordle Explorer sits on the Board with its real
 * production registration (programs/triggers.ts) and the played spell is played
 * through programs/play.ts. The turn player has the Power to pay the spell's
 * printed cost so the play itself is legal.
 */
function fixture(power) {
  const kernel = world()
    .player("A", { energy: 20, power: ["Body", "Body"] })
    .player("B", { energy: 20 })
    .deck(["A:deck:1", "A:deck:2", "A:deck:3"], { owner: "A" })
    .base("yordle", {
      cardId: CARD_ID,
      types: ["unit"],
      zone: "board",
      energy: 4,
      power: null,
      might: 4,
      owner: "A",
      controller: "A",
      location: { type: "base", player: "A" }
    })
    .hand("played", {
      cardId: PLAYED_SPELL_ID,
      types: ["spell"],
      energy: 0,
      power,
      owner: "A"
    })
    .build();
  const choose = request => {
    throw new Error(`Unexpected choose ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    // The merged card-program adapter is the only play path used here.
    describePlay: BINDING.describePlay
  });
  const yordleSource = kernel.getObject("yordle");
  for (const registration of triggerRegistrations(BINDING.registry, yordleSource)) {
    engine.pipeline.registerTrigger(registration);
  }
  return { engine, kernel };
}

function resolveAll(engine) {
  let count = 0;
  while (engine.items.length) {
    if (++count > 50) throw new Error("Nonterminating chain");
    engine.pass(engine.priority);
  }
}

function play({ engine, kernel }) {
  const source = kernel.getObject("played");
  engine.execute(BINDING.describePlay({ type: "play", object: source.ref, player: "A" }, source));
  resolveAll(engine);
}

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
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README §2: the reason names the current gap and the governing rules.
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /206\.1/);
  assert.match(program.judgeReason, /131\.3\.b/);
  assert.match(program.judgeReason, /power: null/);
  // The event-payload producer and the payload predicate are merged now; the
  // only open link is the missing-printed-characteristic semantics.
  assert.match(program.judgeReason, /numericPrinted/);
  assert.match(program.judgeReason, /MissingInformation/);
  assert.doesNotMatch(program.judgeReason, /chain\/engine\.ts 的 resolve 发射只带 object\/player/);
  assert.doesNotMatch(program.judgeReason, /EventPattern\.details/);
});

test("sfd-100-221 Yordle Explorer: the trigger is a card-played condition scoped to the controller's plays", () => {
  // 383.1 / 383.4.a.4: "When you play a card" fires after any play the ability's
  // controller completes; 190.6.d makes "you" the ability controller.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  assert.deepEqual(ability.trigger.filter, { event: "card-played", player: "self" });
  // The old payload-key spelling is gone: the 2+ Power clause moved from
  // EventPattern.details to the merged event-printed Trigger Condition, so the
  // filter no longer carries a payload predicate of its own.
  assert.equal(ability.trigger.filter.details, undefined);
  assert.equal(ability.trigger.filter.object, undefined);
  // 383.2.a.1: the "2+ Power" clause is part of the Trigger Condition, not the
  // effect, and 206.1 makes it read the printed/copied base cost.
  assert.deepEqual(ability.trigger.condition, {
    kind: "event-printed",
    object: "object",
    characteristic: "power",
    operator: "gte",
    right: constant(2)
  });
});

test("sfd-100-221 Yordle Explorer: the trigger filter and condition pass the engine's own validation", () => {
  // Contract 3.5: the card's filter must be a real engine EventPattern and the
  // condition a real engine Condition, not a card-local vocabulary.
  assert.ok(EVENT_PATTERN_TYPES.includes("card-played"));
  const pattern = validateEventPattern(ability.trigger.filter);
  assert.equal(pattern.ok, true, JSON.stringify(pattern.ok ? [] : pattern.issues));
  const spec = validateTriggerSpec(ability.trigger);
  assert.equal(spec.ok, true, JSON.stringify(spec.ok ? [] : spec.issues));
});

test("sfd-100-221 Yordle Explorer: the merged predicate compares printed Power carried by the event payload", () => {
  // 206.1: the gate reads the printed/copied Power carried on the event, never
  // the object's current Power. The merged evaluator is exercised directly here.
  const kernel = world().unit("yordle", { energy: 4, power: null, might: 4 }).build();
  const environment = payload => ({
    context: kernel,
    event: { timingPoint: "card-played", ...payload },
    linked: key => kernel.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  });
  const played = power => ({
    object: { ...kernel.getObject("yordle"), ref: { id: "played", zoneEntryId: 9 }, types: ["spell"], zone: "chain", power },
    details: { printed: { energy: 0, power, might: null } }
  });
  assert.equal(evaluateCondition(ability.trigger.condition, environment(played(["Body", "Body"]))), true);
  assert.equal(evaluateCondition(ability.trigger.condition, environment(played(["Body"]))), false);
  assert.equal(evaluateCondition(ability.trigger.condition, environment(played([]))), false);
  // The remaining gap in one place: power: null throws instead of comparing false.
  assert.throws(
    () => evaluateCondition(ability.trigger.condition, environment(played(null))),
    error => error instanceof MissingInformation && /Printed characteristic/.test(error.message)
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

test("sfd-100-221 Yordle Explorer: the production adapter keeps the printed-Power condition", () => {
  const registry = new ProgramRegistry([executableYordle]);
  const kernel = world().unit("yordle", {
    cardId: CARD_ID, types: ["unit"], owner: "A", controller: "A", zone: "board", energy: 4, power: null, might: 4
  }).build();
  const yordle = kernel.getObject("yordle");
  const [registration] = triggerRegistrations(registry, yordle);
  assert.deepEqual(registration.spec.filter, { event: "card-played", player: "self" });
  assert.deepEqual(registration.spec.condition, ability.trigger.condition);
  assert.deepEqual(registration.activeZones, ["board"]);
  assert.equal(registration.controller, "A");
  assert.equal(registration.boundToIncarnation, true);
  // The registration is bound to the source incarnation the adapter was given.
  assert.equal(registration.source.ref.id, yordle.ref.id);
  // 190.6.d: "you" binds the ability controller, so the shipped filter matches
  // only plays by that controller (checked against a real pipeline event).
  const played = {
    timingPoint: "card-played",
    object: { ...yordle, ref: { id: "played", zoneEntryId: 9 }, types: ["spell"], zone: "chain" },
    player: "A"
  };
  assert.equal(matchesTriggerEvent(registration.spec.filter, played, "A"), true);
  assert.equal(matchesTriggerEvent(registration.spec.filter, { ...played, player: "B" }, "A"), false);
  // The registered body is the card's own draw instruction, not a stub.
  assert.deepEqual(registration.body.map(instruction => instruction.id), [
    "yordle-explorer.draw-1"
  ]);
});

test("sfd-100-221 Yordle Explorer golden: a real 2-Power play fires the trigger and draws 1", () => {
  const fixtureState = fixture(["Body", "Body"]);
  play(fixtureState);
  // The played spell resolved and left the Chain; its printed 2 Power satisfied
  // the 383.2.a.1 condition and the trigger really drew.
  assert.equal(fixtureState.kernel.getObject("played").zone, "trash");
  assert.equal(fixtureState.kernel.zone("A", "hand").map(ref => ref.id).includes("A:deck:1"), true);
  const timings = fixtureState.engine.pipeline.events.map(event => event.timingPoint);
  assert.equal(timings.includes("card-played"), true);
  assert.equal(timings.includes("card-drawn"), true);
  assert.equal(
    fixtureState.engine.trace.some(entry => entry.step === "pending" && entry.item.startsWith("trigger:")),
    true
  );
});

test("sfd-100-221 Yordle Explorer golden: a real 1-Power play does not satisfy the gate", () => {
  const fixtureState = fixture(["Body"]);
  play(fixtureState);
  assert.equal(fixtureState.kernel.getObject("played").zone, "trash");
  const timings = fixtureState.engine.pipeline.events.map(event => event.timingPoint);
  assert.equal(timings.includes("card-played"), true);
  assert.equal(timings.includes("card-drawn"), false);
  assert.equal(
    fixtureState.engine.trace.some(entry => entry.step === "pending" && entry.item.startsWith("trigger:")),
    false
  );
});

test("sfd-100-221 Yordle Explorer: a power: null play aborts on the missing printed characteristic (current gap)", () => {
  // 131.3.b says a card's Power cost section may be absent; deck-catalog encodes
  // that as power: null. numericPrinted treats null as MissingInformation, so
  // the wave throws with the played card still on the Chain. Until the predicate
  // can evaluate "no Power cost" as false, the card cannot be executable.
  const fixtureState = fixture(null);
  assert.throws(
    () => play(fixtureState),
    error => error instanceof MissingInformation && /Printed characteristic/.test(error.message)
  );
  assert.equal(fixtureState.kernel.getObject("played").zone, "chain");
});

test.todo(
  "sfd-100-221 Yordle Explorer: define the missing-printed-Power semantics (power: null / 131.3.b) so the " +
    "383.2.a.1 gate evaluates false instead of throwing MissingInformation — helpers.ts numericPrinted currently " +
    "treats null as unavailable information"
);
