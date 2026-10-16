import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/raging-firebrand.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-6a44ecaa1f76158a92ecce63e4d3e2d347cc32014c448f13003d9f2500cb3de7";

test("ogn-031-298 Raging Firebrand: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /one-shot/);
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
  assert.deepEqual(ability.trigger.filter, { self: true });
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

test("ogn-031-298 Raging Firebrand: the unmerged cost.modify instruction is not a registered opcode", () => {
  // Guards against a silent no-op standing in for the discount: running the body
  // against the merged interpreter must fail loudly until cost.modify lands.
  const kernel = world().build();
  assert.throws(
    () => runAbilityBody(program.abilities[0].body, kernel),
    /Unregistered instruction opcode: cost\.modify/
  );
  assert.equal(kernel.events.length, 0);
});

test.todo(
  "ogn-031-298 Raging Firebrand: execute the discount (register a one-shot next-spell cost " +
    "modification, assert the following spell's finalized cost plan is 5 energy cheaper and that a " +
    "second spell costs full) once cost.modify and one-shot cost windows land (RIFT-89 follow-up); " +
    "no execution evidence may be claimed before that."
);
