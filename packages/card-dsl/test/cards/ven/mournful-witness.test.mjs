import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/mournful-witness.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-9306105a8f30f0954fec4a0757dc246561b8408b00e76f9d104c939964b55bd0";
const SOURCE_TEXT =
  "When a combat that I was in ends, empower me. (I become Empowered if I'm not already.)\n" +
  "[Empowered][>] I have +2 :rb_might:.";

const [trigger, mightBonus] = program.abilities;
const [empowerSelf] = trigger.body;

const witnessWorld = () => {
  const base = world().unit("witness", { controller: "A", might: 2 }).build();
  return base.clone({ controller: "A", sourceSnapshot: base.getObject("witness") });
};

test("ven-028-166 Mournful Witness: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-028-166 Mournful Witness: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /combat-end/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /continuous\.might/);
});

test("ven-028-166 Mournful Witness: one combat-end trigger scoped to self", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.optional, false);
  // 468.7 / 468.7.b: the closed combat-end timing point (EVENT_PATTERN_TYPES
  // spells the discriminant "combat-ended").
  assert.equal(trigger.trigger.at, "combat-end");
  assert.deepEqual(trigger.trigger.filter, {
    event: "combat-ended",
    filter: { source: "self" }
  });
  assert.equal(trigger.trigger.condition, undefined);
  assert.equal(trigger.trigger.once, undefined);
});

test("ven-028-166 Mournful Witness: 'empower me' uses the merged effect.empower on the source", () => {
  assert.deepEqual(trigger.body.map((instruction) => instruction.id), [
    "mournful-witness.empower-self"
  ]);
  assert.equal(empowerSelf.op, "effect.empower");
  // 442.1 / 827.1.b.1: the source itself is empowered and is not a target.
  assert.deepEqual(empowerSelf.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(empowerSelf.targets, undefined);
  assert.equal(empowerSelf.picks, undefined);
  assert.equal(empowerSelf.linkedTo, undefined);
});

test("ven-028-166 Mournful Witness: the [Empowered] Might bonus is a gated arithmetic-layer static", () => {
  // 828.1.b.1 / 828.1.c: active only while the host is Empowered; 479 places
  // +2 Might in the arithmetic layer.
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 2 });
  assert.equal(mightBonus.effect.appliesTo, "self");
  assert.deepEqual(mightBonus.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
});

test("ven-028-166 golden: 'empower me' empowers the unit through the interpreter", () => {
  const kernel = witnessWorld();
  const outcome = runAbilityBody(trigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["mournful-witness.empower-self", "executed"]
  ]);
  assert.equal(kernel.getObject("witness").empowered, 1);
  assert.deepEqual(kernel.events.map((event) => event.action), ["empower"]);
  assert.deepEqual(outcome.linkedValues["mournful-witness.empower-self.empowered"], {
    mode: "empower",
    count: 1,
    objects: [kernel.ref("witness")]
  });
});


test("ven-028-166 golden: the empower instruction submits one real action with its receipt", () => {
  const kernel = witnessWorld();
  const outcome = runAbilityBody(trigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map((event) => event.action), ["empower"]);
  assert.equal(outcome.results[0].result.linkedValues["empowered"].count, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues["empowered"].objects, [
    kernel.ref("witness")
  ]);
});

test("ven-028-166 golden: the declared +2 Might primitive registers in the arithmetic layer", () => {
  const kernel = witnessWorld();
  const instruction = {
    id: "mournful-witness.might-bonus",
    op: "continuous.might",
    args: {
      mode: { kind: "constant", value: "add" },
      amount: mightBonus.effect.amount,
      appliesTo: { kind: "constant", value: "self" }
    }
  };
  const outcome = runAbilityBody([instruction], kernel, undefined, { host: kernel.ref("witness") });
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 2);
  assert.equal(createLayerEngine(kernel.objects, kernel.continuousEffects).evaluate(kernel.ref("witness")).might, 4);
});

test.todo(
  "ven-028-166 Mournful Witness: the combat-end timing point has no emitter, and 'a combat that I " +
    "was in' needs the Attacker/Defender designation (CR 468.7.b / 323.2 / 466.2.c.3; " +
    "ObjectSnapshot.combatRole is not in engine-core's effects/contract.ts yet)"
);
