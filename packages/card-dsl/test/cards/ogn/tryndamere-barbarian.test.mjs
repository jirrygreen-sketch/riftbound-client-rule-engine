import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/tryndamere-barbarian.js";

const CARD_ID = "card.hash-6ba12b26451c240435ee3952db1009ed8f8cb3d1db061aef3df6e51c359883aa";

test("ogn-034-298 Tryndamere, Barbarian: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.score/);
  assert.match(program.judgeReason, /RIFT-115/);
});

test("ogn-034-298 Tryndamere, Barbarian: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you score 1 point."
  );
});

test("ogn-034-298 Tryndamere, Barbarian: self conquer trigger whose condition counts 5+ excess damage assigned this attack", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", filter: { source: "self" } });
  assert.equal(ability.optional, false);

  // "if you assigned 5 or more excess damage to enemy units" immediately
  // follows the trigger condition, so it is part of the condition (383.2.a.1),
  // not an instruction in the body.
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "excess-damage-assigned-this-combat");
  assert.deepEqual(condition.left.filter, { targetController: "opponent", scope: "this-attack" });
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "tryndamere-barbarian.score-1");
  assert.equal(instruction.op, "effect.score");
  assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(instruction.linkedTo, undefined);
});

test.todo(
  "ogn-034-298 Tryndamere, Barbarian: the conquer trigger body ('score 1 point' through the " +
    "`score` game action) cannot execute until effect.score lands (RIFT-115); it must not be faked by " +
    "writing to player score directly."
);
test.todo(
  "ogn-034-298 Tryndamere, Barbarian: the 'assigned 5 or more excess damage' trigger condition needs " +
    "the combat-damage assignment statistic (CR 467.2.c.4) exposed on the conquer event or through " +
    "history (RIFT-31/RIFT-33)."
);
