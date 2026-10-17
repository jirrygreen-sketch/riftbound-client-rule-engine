// Golden test for Might of Demacia, Starter (ogs-023-024).
//
// The card is judge-required: the conquer timing point is never emitted into
// the single event pipeline, the conquer payload carries no "that battlefield"
// referent (CR 359.3.f) to count units against, and no producer registers a
// CardProgram's triggered ability as a pipeline TriggerRegistration. The
// runnable evidence is validation/identity/structure plus a real execution of
// the card's own effect.draw body.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/might-of-demacia-starter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { getTimingPoint, isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-befcf314a3bbe2053ad3e09a6000efe606106fb3dcd65a480a200abe436f4085";
const SOURCE_TEXT = "When you conquer, if you have 4+ units at that battlefield, draw 2.";
const [ability] = program.abilities;
const [drawInstruction] = ability.body;

test("ogs-023-024 Might of Demacia, Starter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-023-024 Might of Demacia, Starter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /turn\/flow\.ts/);
  assert.match(program.judgeReason, /that battlefield/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-023-024 Might of Demacia, Starter: conquer trigger with the 4+ units clause as a trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // "When you conquer" is a Conquer Effect (CR 383.4.c / 383.4.c.1) at the
  // closed conquer timing point (rule refs 468.5.d / 471.1 / 473.2.a).
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(getTimingPoint("conquer").triggerable ?? true, true);
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
  // The closed EventPattern vocabulary spells this event "conquered" and
  // pipeline-match aliases it to the `conquer` timing point. (Older sfd cards
  // ship event: "conquer", a spelling the engine's own validateTriggerSpec
  // rejects; this program uses the contract spelling.)
  assert.deepEqual(ability.trigger.filter, { event: "conquered", player: "self" });
  // The filter is matched with the engine's real trigger matcher: an event at
  // the `conquer` timing point for this controller's conquer matches; other
  // timings and the opponent's conquer do not.
  assert.equal(matchesTriggerEvent(ability.trigger.filter, { timingPoint: "conquer", player: "A" }, "A"), true);
  assert.equal(matchesTriggerEvent(ability.trigger.filter, { timingPoint: "conquer", player: "B" }, "A"), false);
  assert.equal(matchesTriggerEvent(ability.trigger.filter, { timingPoint: "hold", player: "A" }, "A"), false);
  assert.equal(isTimingPointId("conquer"), true);
  // The whole trigger spec must pass the engine's own validator.
  const validated = validateTriggerSpec(ability.trigger);
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.issues));
});

test("ogs-023-024 Might of Demacia, Starter: the if-clause is part of the trigger condition (383.2.a.1)", () => {
  // "if you have 4+ units at that battlefield" immediately follows the trigger
  // condition, so CR 383.2.a.1 puts it in the Trigger Condition, not the effect.
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 4 });
  assert.equal(condition.left.kind, "count");
  // The counted set is the controller's units at the battlefield the conquer
  // event happened at (CR 359.3.f: "that battlefield" referent).
  assert.equal(condition.left.subject, "conquering-battlefield-units");
  assert.deepEqual(condition.left.filter, { type: "unit", controller: "self" });
  // The body is not gated on the count: the clause is not an "if you do" link.
  assert.equal(drawInstruction.condition, undefined);
});

test("ogs-023-024 Might of Demacia, Starter: body is a single unlinked Draw 2", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.id, "might-of-demacia.draw-2");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("ogs-023-024 Might of Demacia, Starter: the Draw 2 body draws two cards on the reference kernel", () => {
  const kernel = world().deck(["card-1", "card-2", "card-3"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("ogs-023-024 Might of Demacia, Starter: an empty or short deck draws only what exists (CR 414.4)", () => {
  const kernel = world().deck("only-card").build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("ogs-023-024 Might of Demacia, Starter: the merged Score wave emits conquer for the scoring player", () => {
  // turn/flow.ts publishes the whole Score trigger wave atomically for a
  // committed score action (CR 383.4.c / 471.1 / 473.2.a); the conquer emission
  // carries the conquered battlefield as details.battlefieldId. The card-side
  // gap is the battlefield-relative counting condition and the CardProgram
  // trigger binding, not the emission itself (see judgeReason).
  const conquer = getTimingPoint("conquer");
  assert.equal(conquer.emittedBy, "scoring");
  assert.deepEqual(conquer.ruleRefs, ["468.5.d", "471.1", "473.2.a"]);
});

test.todo(
  "Might of Demacia, Starter: count your units at THAT battlefield from the conquer event " +
    "(CR 383.2.a.1 trigger condition + 359.3.f referent + 355.10.d automatic selection) — blocked " +
    "because TimingEmission/PipelineEvent carry no battlefield referent and there is no " +
    "event-location counting condition; the details payload of the current conquer event has no " +
    "battlefield id either"
);

test.todo(
  "Might of Demacia, Starter: the trigger registers from the Legend Zone (CR 107.4.c / 174.2.b) and " +
    "enters the chain as a Pending Item — blocked because no producer turns a CardProgram's triggered " +
    "ability into a pipeline TriggerRegistration and the frozen ZoneId has no legend zone (contract 3.5)"
);
