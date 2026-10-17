// Golden test for Lady of Luminosity, Starter (ogs-021-024).
//
// Whole-card execution evidence (the printed-cost gate, the "you play" gate
// and the Draw 1 body through the real chain path) lives in
// test/cards/templates/triggered-card-played-effect-draw-656.test.mjs. This file
// keeps validation, identity, structure and the remaining Legend Zone gap.
//
// The merged event-printed predicate reads the production card-played cost
// snapshot. These tests execute the trigger's actual gate and Draw 1 body;
// registering a Legend in its own zone remains explicitly blocked.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/lady-of-luminosity-starter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import {
  EVENT_PATTERN_TYPES,
  validateEventPattern,
  validateTriggerSpec
} from "../../../../engine-core/dist/events/trigger-spec.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-6f04b2b3d826c60923e569bd93f6bfbe953076e0f78f137d2db69f5b53e10948";
const SOURCE_TEXT = "When you play a spell that costs :rb_energy_5: or more, draw 1.";
const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("ogs-021-024 Lady of Luminosity, Starter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-021-024 Lady of Luminosity, Starter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /206/);
  assert.match(program.judgeReason, /cost/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.match(program.judgeReason, /card-played/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-021-024 Lady of Luminosity, Starter: card-played trigger filtered to spells you played", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.trigger.optional, undefined);
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);

  // The trigger filter is an EventPattern (the only shape with `object`).
  assert.equal(ability.trigger.filter.event, "card-played");
  assert.deepEqual(ability.trigger.filter.object, { type: "spell" });
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.trigger.filter.details, undefined);
  assert.deepEqual(ability.trigger.condition, {
    kind: "event-printed", object: "object", characteristic: "energy",
    operator: "gte", right: { kind: "constant", value: 5 }
  });
});

test("ogs-021-024 Lady of Luminosity, Starter: the trigger filter is a valid engine EventPattern", () => {
  // "card-played" must be a registered event name and the pattern shape must
  // pass the engine's own validator (contract 3.5). This pins the structure to
  // the real contract instead of the card's own vocabulary.
  assert.ok(EVENT_PATTERN_TYPES.includes("card-played"));
  const result = validateEventPattern(ability.trigger.filter);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  const spec = validateTriggerSpec(ability.trigger);
  assert.equal(spec.ok, true, JSON.stringify(spec.ok ? [] : spec.issues));
});

test("ogs-021-024 Lady of Luminosity, Starter: body is a single unlinked Draw 1", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "lady-of-luminosity.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  // The implied drawer is the ability controller (190.6.d); no target/pick.
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("ogs-021-024 Lady of Luminosity, Starter: the Draw 1 body draws one card on the reference kernel", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("ogs-021-024 Lady of Luminosity, Starter: the printed Energy cost is never rewritten to 0", () => {
  // The card itself prints no cost (legend); the cost belongs to the played
  // spell and CR 206 reads its printed/copied value. The program must not
  // encode a numeric stand-in for the played spell's cost anywhere.
  assert.equal(drawInstruction.args.amount.value, 1);
  const serialized = JSON.stringify(program);
  assert.equal(/\"energy\"\s*:/.test(serialized), false);
  assert.equal(/\"power\"\s*:/.test(serialized), false);
});

function playThroughGate({ printed = 5, paid = printed, types = ["spell"], player = "A" } = {}) {
  const f = fixture({
    turnPlayer: player,
    energy: 20,
    cards: [{ id: "played-card", types, energy: printed, power: [], owner: player, controller: player }]
  });
  // Isolate the supported trigger on a synthetic Board source. This does not
  // relocate the Legend or claim its unsupported source-zone lifecycle works.
  f.engine.pipeline.registerTrigger({
    id: "lady.cost-gate",
    source: f.kernel.getObject("source"),
    controller: "A",
    spec: ability.trigger,
    body: ability.body,
    optional: ability.optional
  });
  f.engine.execute(f.card("played-card", {
    controller: player,
    kind: types.includes("spell") ? "spell" : "unit",
    body: [],
    cost: {
      id: "cost:played-card",
      cost: { kind: "explicit", energy: { kind: "constant", value: paid }, power: { kind: "constant", value: [] } }
    }
  }));
  resolveAll(f.engine);
  const played = f.engine.pipeline.events.find(event => event.timingPoint === "card-played");
  assert.ok(played, "the real play must produce card-played");
  assert.equal(played.object.types.includes(types[0]), true);
  assert.equal(played.player, player);
  assert.equal(played.details.printed.energy, printed);
  assert.equal("action" in played, false);
  assert.equal(f.kernel.player(player).energy, 20 - paid);
  return { ...f, played };
}

test("ogs-021-024 Lady of Luminosity, Starter golden: the real printed Energy gate draws only for your 5+ cost spell", () => {
  for (const printed of [4, 5, 6]) {
    const { kernel, played } = playThroughGate({ printed });
    assert.equal(matchesTriggerEvent(ability.trigger.filter, played, "A"), true);
    assert.equal(kernel.player("A").handSize, printed >= 5 ? 1 : 0);
    assert.equal(kernel.player("A").deckSize, printed >= 5 ? 3 : 4);
    assert.equal(kernel.events.filter(event => event.action === "draw").length, printed >= 5 ? 1 : 0);
  }
  for (const options of [{ printed: 5, types: ["unit"] }, { printed: 5, player: "B" }]) {
    const { kernel, played } = playThroughGate(options);
    assert.equal(matchesTriggerEvent(ability.trigger.filter, played, "A"), false);
    assert.equal(kernel.player("A").handSize, 0);
    assert.equal(kernel.events.filter(event => event.action === "draw").length, 0);
  }
});

test("ogs-021-024 Lady of Luminosity, Starter golden: CR 206 uses printed cost despite paying less or more", () => {
  for (const [printed, paid, draws] of [[5, 1, 1], [4, 7, 0]]) {
    const { kernel, played } = playThroughGate({ printed, paid });
    assert.equal(played.details.object.printed.energy, printed);
    assert.equal(kernel.player("A").handSize, draws);
    assert.equal(kernel.events.filter(event => event.action === "draw").length, draws);
  }
});

test.todo(
  "Lady of Luminosity, Starter: the trigger registers at card-played for this spell's controller and " +
    "enters the chain (contract 3.5) — the trigger registration path exists, but the Legend source zone " +
    "(CR 107.4.c / 174.2.b) is not a frozen ZoneId (default activeZones is ['board'])"
);
