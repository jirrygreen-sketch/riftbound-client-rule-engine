import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ravenbloom-student.js";

const CANONICAL = "card.hash-1e9496baf34c0f775ffe94233c00bca385044ae51ac57ce745999144f3493a9d";

test("Ravenbloom Student program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, "When you play a spell, give me +1 :rb_might: this turn.");
});

test("Ravenbloom Student structure: a card-played trigger filtered to a spell played by the controller", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter.object, { type: "spell" });
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.trigger.once, undefined);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "ravenbloom-student.give-plus-1");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // "give me +1 [M]": the affected object is the ability source, not a chosen
  // target, so the instruction declares no TargetSpec.
  assert.equal(instruction.targets, undefined);
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

test.todo(
  "Ravenbloom Student: +1 [M] until end of turn on the source unit, expiring in cleanup (317.1.a; 478 layer arithmetic), " +
    "verified through the layers consumer (RIFT-91) once continuous.might is registered"
);

test.todo(
  "Ravenbloom Student trigger: the merged chain fires the card-played trigger for each spell its controller plays " +
    "(383.4.a) and adds the ability to the chain; card-program trigger registration is not merged"
);
