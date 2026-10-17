// Golden test for Lady of Luminosity, Starter (ogs-021-024).
//
// The trigger is the card-played timing point (contract 3.5; chain/engine.ts
// emits it after a spell/unit/gear resolves) and the effect is the merged
// effect.draw. What is missing is the cost gate: CR 206 requires the PRINTED
// (or copied) cost, but no pipeline event carries a played card's cost, and
// the frozen filter shapes have no cost-gte predicate. The runnable evidence
// is therefore validation/identity/structure plus a real execution of the
// card's own effect.draw instructions.
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
  // The cost gate has no predicate of its own; it rides on the event payload
  // key that the current pipeline never sets (see judgeReason and the TODO).
  assert.deepEqual(ability.trigger.filter.details, { printedEnergyCostAtLeast: 5 });
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

test("ogs-021-024 Lady of Luminosity, Starter golden: a real played spell emits card-played with no cost payload", () => {
  // 复核 2026-10-17: drive the production chain. The emitted card-played event
  // carries the played spell object and player only; details is undefined, so
  // this card's cost gate cannot match and the gate must not be relaxed to
  // "any spell". A spell of printed cost 5 is used to make the intent explicit.
  let captured = null;
  const f = fixture({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    energy: 20,
    cards: [{ id: "five-cost-spell", types: ["spell"], energy: 5, power: [] }]
  });
  f.engine.pipeline.registerTrigger({
    id: "lady.watch",
    source: f.kernel.getObject("source"),
    controller: "A",
    spec: { at: "card-played", filter: {} },
    body: [],
    activeZones: ["chain", "board", "trash"]
  });
  f.engine.pipeline.onTrigger = (snapshot) => { captured = snapshot.event; };
  f.engine.execute(f.card("five-cost-spell", {
    cost: {
      id: "cost:five-cost-spell",
      cost: { kind: "explicit", energy: { kind: "constant", value: 5 }, power: { kind: "constant", value: [] } }
    }
  }));
  resolveAll(f.engine);
  assert.ok(captured, "the merged chain emits card-played for a played spell");
  assert.equal(captured.timingPoint, "card-played");
  assert.equal(captured.object.types.includes("spell"), true);
  assert.equal(captured.player, "A");
  assert.equal(captured.details, undefined, "no printed-cost payload is attached");
  assert.equal("action" in captured, false);
  assert.equal(matchesTriggerEvent(ability.trigger.filter, captured, "A"), false);
});

test.todo(
  "Lady of Luminosity, Starter: trigger only for a spell whose PRINTED (or copied) Energy cost is 5+ " +
    "(CR 206) — blocked because PipelineEvent/TimingEmission carry no printed cost or cost plan and the " +
    "frozen ObjectFilter/EventPattern have no cost-gte predicate (cost-gte / condition.value; the " +
    "existing continuous-effect instructions do not read costs, " +
    "same gap as sfd/sunken-temple and sfd/show-of-strength); the card-played event's details never " +
    "contain printedEnergyCostAtLeast today, so the trigger cannot fire truthfully"
);

test.todo(
  "Lady of Luminosity, Starter: the trigger registers at card-played for this spell's controller and " +
    "enters the chain (contract 3.5) — the trigger registration path exists, but the Legend source zone " +
    "(CR 107.4.c / 174.2.b) is not a frozen ZoneId (default activeZones is ['board'])"
);

test.todo(
  "Lady of Luminosity, Starter: CR 206.1 scope — the gate ignores cost increases/discounts and only " +
    "reads the printed or copied cost (Sky Splitter example) once the payload/predicate exists"
);
