// Golden test for Sanctum Conservator (rad-030-167).
//
// executable: the merged event-object printed-characteristic
// condition (CR 206/206.1) and chain/engine.ts publishes the played card's
// printed Energy on the card-played event. The trigger condition reads that
// printed snapshot directly; the >=7 and 6 cases run through the real
// production play binding and the source really readies.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/sanctum-conservator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-6028fb37be26fd7565a2496f62a0ae6299311f364579011da70ce8cdbb0ddd08";
const SOURCE_TEXT =
  "When you play a card with Energy cost :rb_energy_7: or more, ready me.";
const BIG = "card.probe.sanctum-conservator.big";
const SMALL = "card.probe.sanctum-conservator.small";
const NO_COST = "card.probe.sanctum-conservator.no-cost";

const [triggered] = program.abilities;
const [readyInstruction] = triggered.body;

const emptyProgram = (canonicalCardId, sourceText) => ({
  canonicalCardId,
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [],
  sourceText
});

function board({ cards }) {
  const binding = createProgramBinding({
    cardPrograms: [program, emptyProgram(BIG, "probe big"), emptyProgram(SMALL, "probe small"), emptyProgram(NO_COST, "probe no cost")]
  });
  const game = fixture({ cards, describePlay: binding.describePlay });
  binding.attachLifecycle(game.engine, (error) => { throw error; });
  game.engine.commit({ type: "play", object: game.kernel.ref("conservator"), player: "A" });
  game.engine.advance();
  resolveAll(game.engine);
  return game;
}

const conservatorCard = {
  id: "conservator",
  cardId: CANONICAL,
  types: ["unit"],
  energy: 5,
  power: [],
  might: 5
};

test("rad-030-167 Sanctum Conservator: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-030-167 Sanctum Conservator: identity, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-030-167 Sanctum Conservator: one card-played trigger with the printed-Energy condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  // CR 383.4.a / 383.4.a.4: this watches another card being played, not its own entry.
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", player: "self" });
  // CR 206: "a card with Energy cost 7 or more" reads the printed Energy cost of
  // the played event object, never the amount actually paid.
  assert.deepEqual(triggered.trigger.condition, {
    kind: "event-printed",
    object: "object",
    characteristic: "energy",
    operator: "gte",
    right: { kind: "constant", value: 7 }
  });
  assert.equal(triggered.optional, false);
  assert.equal(program.judgeReason, undefined);
});

test("rad-030-167 Sanctum Conservator: the body is exactly 'ready me'", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(readyInstruction.id, "sanctum-conservator.ready-self");
  assert.equal(readyInstruction.op, "effect.ready");
  // "ready me": effect.ready defaults to the ability source (416.1), so no
  // objects/amount/linkKey arguments and no target specifications are needed.
  assert.deepEqual(readyInstruction.args, {});
  assert.equal(readyInstruction.targets, undefined);
  assert.equal(readyInstruction.picks, undefined);
  assert.equal(readyInstruction.linkedTo, undefined);
});

test("rad-030-167 Sanctum Conservator: 'ready me' really readies the exhausted source (416.1)", () => {
  const kernel = world().unit("conservator", { might: 5, exhausted: true }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("conservator") });
  const run = runInstruction(ready, readyInstruction.args, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 1);
  assert.equal(scoped.getObject("conservator").exhausted, false);
});

test("rad-030-167 Sanctum Conservator: an already-ready source produces no extra event (416.1.c)", () => {
  const kernel = world().unit("conservator", { might: 5, exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("conservator") });
  const eventCount = scoped.events.length;
  const run = runInstruction(ready, readyInstruction.args, { world: scoped });
  // Nothing additional happens: no ready action is submitted.
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.equal(scoped.events.length, eventCount);
  assert.equal(scoped.getObject("conservator").exhausted, false);
});

test("rad-030-167 Sanctum Conservator: binding registers the trigger with the merged condition", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .card("conservator", { cardId: CANONICAL, types: ["unit"], energy: 5, power: [], zone: "hand" })
    .build();
  binding.inspect({ cardId: CANONICAL, keywords: [] });
  const [registration] = triggerRegistrations(binding.registry, kernel.getObject("conservator"));
  assert.equal(registration.spec.at, "card-played");
  assert.deepEqual(registration.spec.filter, { event: "card-played", player: "self" });
  assert.deepEqual(registration.spec.condition, {
    kind: "event-printed",
    object: "object",
    characteristic: "energy",
    operator: "gte",
    right: { kind: "constant", value: 7 }
  });
  assert.deepEqual(registration.activeZones, ["board"]);
});

test("rad-030-167 Sanctum Conservator: playing a 7-Energy card really readies it through the production chain", () => {
  const game = board({
    cards: [conservatorCard, { id: "big", cardId: BIG, types: ["unit"], energy: 7, power: [], might: 2 }]
  });
  assert.equal(game.kernel.getObject("conservator").zone, "board");
  // Own play: the played card is the conservator itself (printed Energy 5), so
  // the condition is false and no ready happens.
  assert.equal(game.kernel.getObject("conservator").exhausted, true);

  assert.equal(game.engine.commit({ type: "play", object: game.kernel.ref("big"), player: "A" }).status, "done");
  game.engine.advance();
  resolveAll(game.engine);

  const played = game.engine.pipeline.events.filter((event) => event.timingPoint === "card-played");
  assert.deepEqual(played.map((event) => event.object.ref.id), ["conservator", "big"]);
  assert.equal(game.engine.items.length, 0);
  assert.equal(game.kernel.getObject("conservator").exhausted, false);
});

test("rad-030-167 Sanctum Conservator: a 6-Energy card does not trigger the printed-Energy gate", () => {
  const game = board({
    cards: [conservatorCard, { id: "small", cardId: SMALL, types: ["unit"], energy: 6, power: [], might: 2 }]
  });
  assert.equal(game.kernel.getObject("conservator").exhausted, true);
  assert.equal(game.engine.commit({ type: "play", object: game.kernel.ref("small"), player: "A" }).status, "done");
  game.engine.advance();
  resolveAll(game.engine);
  assert.equal(game.engine.items.length, 0, "no trigger is created below the printed-Energy threshold");
  assert.equal(game.kernel.getObject("conservator").exhausted, true);
});

test("rad-030-167 Sanctum Conservator: a card without a printed Energy cost is never coerced to 0", () => {
  const game = board({
    cards: [conservatorCard, { id: "nullcard", cardId: NO_COST, types: ["unit"], energy: null, power: null, might: 2 }]
  });
  assert.equal(game.kernel.getObject("conservator").exhausted, true);
  // A direct card-played event for a card with no printed Energy cost must
  // fail closed inside the condition rather than compare null as 0. This drives
  // the real matcher against a real event payload with energy: null.
  const game2 = board({ cards: [conservatorCard] });
  const source = game2.kernel.getObject("conservator");
  const event = {
    timingPoint: "card-played",
    kind: "card-played",
    eventId: 99,
    object: { ...source, ref: { id: "nullcard", zoneEntryId: 3 }, zone: "chain", energy: null },
    source,
    player: "A",
    details: { printed: { energy: null, power: null, might: 2 } }
  };
  assert.throws(
    () => evaluateCondition(triggered.trigger.condition, {
      context: game2.kernel,
      event,
      linked: (key) => game2.kernel.linked(key),
      canLookBack: () => true,
      isIgnored: () => false
    }),
    (error) => /Printed characteristic|printed .* characteristic/i.test(error.message)
  );
  assert.equal(game2.kernel.getObject("conservator").exhausted, true);
});
