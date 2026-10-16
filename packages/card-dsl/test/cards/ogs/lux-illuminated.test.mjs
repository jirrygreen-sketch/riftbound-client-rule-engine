import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/lux-illuminated.js";

const CANONICAL =
  "card.hash-c2754bbf1ee513e71200b5c341447c73af45af5ba81a41efde12ac2d348cbcd8";
const SOURCE_TEXT =
  "When you play a spell that costs :rb_energy_5: or more, give me +3 :rb_might: this turn.";

test("ogs-006-024 Lux, Illuminated: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-006-024 Lux, Illuminated: judgeReason names the event-payload cost gap and continuous.might", () => {
  assert.match(program.judgeReason, /ObjectSelector/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("ogs-006-024 Lux, Illuminated: card-played trigger with the descriptive energy gate and a temporary +3 Might body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  // The energy gate is a descriptive placeholder: the trigger event object (the
  // played spell) has no ObjectSelector, so the cost comparison cannot be
  // evaluated; the key is named in judgeReason as having no formal semantics.
  assert.deepEqual(ability.trigger.filter, {
    type: "spell",
    controller: "controller",
    energyGte: 5
  });
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "lux-illuminated.grant-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test.todo(
  "ogs-006-024 Lux, Illuminated: the trigger only fires for a played spell whose cost is 5+ energy " +
    "(CR 383.4.a, 420.4.a, 355.9) — the trigger event object needs an ObjectSelector and a cost " +
    "comparison in the condition path (RIFT-89/90)"
);

test.todo(
  "ogs-006-024 Lux, Illuminated: +3 Might this turn is applied by the arithmetic layer and expires at " +
    "end of turn (CR 143.2) — depends on continuous.might being consumed (RIFT-91)"
);
