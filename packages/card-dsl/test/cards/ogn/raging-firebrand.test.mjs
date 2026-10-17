import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/raging-firebrand.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CARD_ID = "card.hash-6a44ecaa1f76158a92ecce63e4d3e2d347cc32014c448f13003d9f2500cb3de7";

test("ogn-031-298 Raging Firebrand: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /one-shot/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-031-298 Raging Firebrand: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When you play me, the next spell you play this turn costs :rb_energy_5: less."
  );
});

test("ogn-031-298 Raging Firebrand: card-played self trigger carrying a one-shot -5 energy cost modification", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  // The engine validator rejects the older { self: true } spelling; the played
  // card identifies itself through its canonical id.
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { canonicalCardId: CARD_ID }
  });
  const validated = validateTriggerSpec(ability.trigger);
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.issues));
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "raging-firebrand.cost-modify");
  assert.equal(instruction.op, "cost.modify");
  assert.deepEqual(instruction.args.resource, { kind: "constant", value: "energy" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -5 });
  assert.deepEqual(instruction.args.appliesTo, {
    kind: "constant",
    value: "next-spell-this-turn"
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test.todo(
  "ogn-031-298 Raging Firebrand: execute the discount — register a one-shot next-spell cost " +
    "modification, assert the following spell's finalized cost plan is 5 energy cheaper and that a " +
    "second spell costs full — once the cost.modify instruction and the one-shot cost window land " +
    "(RIFT-261 cost.pay/cost.modify; the card-program trigger binding is RIFT-257)."
);
