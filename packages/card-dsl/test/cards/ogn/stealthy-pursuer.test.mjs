import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/stealthy-pursuer.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-ba317497fb11f0057ab92dddc2368fdcdf29656f88954eb40ed97277241324c5";
const [ability] = program.abilities;
const [instruction] = ability.body;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /fromLocationId/);
  assert.match(program.judgeReason, /ObjectSelector/);
  assert.match(program.judgeReason, /object-moved/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.equal(
    program.sourceText,
    "When a friendly unit moves from my location, I may be moved with it."
  );
});

test("trigger subscribes to object-moved for a friendly unit and is optional ('I may', 383.3.a)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.equal(ability.optional, true);
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { controller: "self", type: "unit", fromSameLocationAs: "self" }
  });
});

test("body records the follow-up Move of self with its payload-derived destination", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "stealthy-pursuer.move-with-it");
  assert.equal(instruction.op, "effect.move");
  assert.deepEqual(instruction.args.objects, { kind: "constant", value: "self" });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "moved-with-it" });
  // Nominal destination: the real destination is the moved unit's to-location
  // from the object-moved payload, which no IR selector can read yet.
  assert.deepEqual(instruction.args.to, {
    kind: "constant",
    value: { type: "battlefield", id: "event-destination" }
  });
});

test("Stealthy Pursuer: trigger validation rejects the unsupported object-moved event and nominal nested filter", () => {
  const result = validateTriggerSpec(ability.trigger);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      path: "trigger.filter.filter",
      code: "unknown-field",
      message: "EventPattern 不允许此字段。"
    },
    {
      path: "trigger.filter.event",
      code: "invalid-event-type",
      message: "值必须属于 zone-entered, zone-left, object-entered-zone, object-left-zone, card-played, object-targeted, became-target, object-killed, object-readied, object-exhausted, attack-declared, defense-declared, combat-damage-before, combat-damage-after, showdown-opened, showdown-closed, combat-ended, chain-item-pending, chain-item-finalized, chain-item-resolved, control-established, control-lost, conquered, held, scored, final-point。"
    }
  ]);
});

test.todo(
  "match 'moves from my location' against the object-moved payload's fromLocationId/fromKind compared with " +
    "the host's current location; the closed ObjectFilter has only sameLocationAs (current locations) and the " +
    "EventPattern vocabulary and matcher still need the object-moved event and its host-relative from-location predicate"
);
test.todo(
  "move Stealthy Pursuer to the moved unit's destination: the IR needs an event-payload selector for " +
    "effect.move's to argument (contract change request in this task's reply)"
);
