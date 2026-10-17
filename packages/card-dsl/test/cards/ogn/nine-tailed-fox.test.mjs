import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/nine-tailed-fox.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-1e014c6eec053a33481b4f7adeabd0de2ec5684e450291208a419881b3d6aa9c";
const SOURCE_TEXT =
  "When an enemy unit attacks a battlefield you control, give it -1 :rb_might: this turn, " +
  "to a minimum of 1 :rb_might:.";

const [ability] = program.abilities;
const [debuff] = ability.body;

test("ogn-255-298 Nine-Tailed Fox: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-255-298 Nine-Tailed Fox: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /478\.1\.c/);
  // Re-sweep: the Might op and trigger registration are merged; the remaining
  // gaps are the attack timing producer, battlefield-control payload, and
  // event-object selector.
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /466\.2/);
});

test("ogn-255-298 Nine-Tailed Fox: attack-declared trigger for an enemy unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.e / 323.2: the closed "attack-declared" timing point.
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    object: { type: "unit", controller: "opponent" }
  });
  // “When an enemy unit attacks …”: mandatory, not “you may”.
  assert.equal(ability.optional, false);
  // “a battlefield you control” needs battlefield control state, which the
  // merged attack-declared payload does not carry (see judgeReason).
  assert.equal(ability.trigger.condition, undefined);
});

test("ogn-255-298 Nine-Tailed Fox: -1 Might this turn with the printed minimum of 1", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(debuff.id, "nine-tailed-fox.debuff-attacker");
  // The debuff is a temporary Might modification: continuous.might belongs to
  // the layers system (RIFT-83/84) and is not a merged instruction opcode; the
  // golden documents the intended shape and its failure evidence.
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(debuff.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(debuff.args.minimum, { kind: "constant", value: 1 });
  assert.equal(debuff.linkedTo, undefined);

  // “it” = the attacking unit from the trigger event; the merged
  // ObjectSelector set has no event-object selector, so the TargetSpec is a
  // shape-only anchor (383.2.c.3.b / 359.3.f.3).
  assert.equal(debuff.targets.length, 1);
  assert.deepEqual(debuff.targets[0], {
    id: "attacking-unit",
    filter: { type: "unit", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-255-298 Nine-Tailed Fox: the merged Might op registers the -1 this-turn modification", () => {
  // The re-sweep verified that continuous.might (RIFT-258) now performs the
  // temporary Might modification the card prints, including the end-of-turn
  // duration and the printed minimum of 1. The card's own args are driven
  // through the merged primitive against a scanned reference kernel.
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);

  const kernel = world()
    .unit("attacker", { owner: "B", controller: "B", zone: "board", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("attacking-unit", [kernel.ref("attacker")]);
  // Finalize-time target locking is supplied by the caller, so the golden
  // drops only the TargetSpec and runs the card's authored instruction (see
  // pit-rookie's golden for the convention).
  const { targets, ...authored } = debuff;
  const outcome = runAbilityBody([authored], kernel);

  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["nine-tailed-fox.debuff-attacker", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  // The registered effect also carries the runtime per-object condition
  // function, so only the authored fields are asserted.
  const registered = kernel.continuousEffects[0].effect.effect;
  assert.equal(registered.kind, "continuous.might");
  assert.equal(registered.amount, -1);
  assert.equal(registered.minimum, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });

  const engine = createLayerEngine(
    [kernel.getObject("attacker")],
    kernel.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("attacker")).might, 3);
  // CR 317.2.c: the modification expires at the turn-end timing point.
  assert.deepEqual(engine.advance({ id: "turn-end" }), [kernel.continuousEffects[0].effect.id]);
  assert.equal(engine.evaluate(kernel.ref("attacker")).might, 4);
});

test("ogn-255-298 Nine-Tailed Fox: the printed minimum of 1 clamps a 1-Might attacker", () => {
  const kernel = world()
    .unit("attacker", { owner: "B", controller: "B", zone: "board", might: 1, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("attacking-unit", [kernel.ref("attacker")]);
  const { targets, ...authored } = debuff;
  const outcome = runAbilityBody([authored], kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  // CR 478.1.c: buildMightSpec snapshots the limited delta (max(-1, 1-1)=0), so
  // the modification cannot take a 1-Might unit below its printed minimum.
  const registered = kernel.continuousEffects[0].effect.effect;
  assert.equal(registered.kind, "continuous.might");
  assert.equal(registered.amount, 0);
  assert.equal(registered.minimum, 1);
  const engine = createLayerEngine(
    [kernel.getObject("attacker")],
    kernel.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("attacker")).might, 1);
});

test.todo(
  "ogn-255-298: the card-level execution — attack-declared has no producer yet (combat/flow.ts " +
    "throws TurnCombatBlockedError for the combat-start role transaction, CR 466.2), the payload " +
    "does not carry the battlefield-control state, and 'it' needs an event-object selector"
);

test.todo(
  "ogn-255-298: restrict the trigger to a battlefield the controller controls and bind “it” to the " +
    "attacking unit from the event (383.2.c.3.b / 359.3.f.3) — attack-declared payload control state (RIFT-124 " +
    "follow-up) and event-object selector (contract)"
);
