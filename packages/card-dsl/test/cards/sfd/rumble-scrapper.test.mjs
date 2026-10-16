import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const cardId = "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c";
const program = cardProgramsById.get(cardId);

test("rumble-scrapper program is registered and validates", () => {
  assert.ok(program, "rumble-scrapper must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("rumble-scrapper structure: static might aura + hold trigger token body", () => {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("layers"), "judgeReason must cite layers engine");
  assert.equal(program.abilities.length, 2);

  const [aura, hold] = program.abilities;
  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  assert.equal(aura.effect.filter.tag, "Mech");
  assert.equal(aura.effect.filter.controller, "controller");
  assert.equal(aura.effect.value.value, 1);

  assert.equal(hold.kind, "triggered");
  assert.equal(hold.trigger.at, "hold");
  assert.equal(hold.trigger.filter.event, "hold");
  assert.equal(hold.trigger.filter.filter.source, "self");
  assert.equal(hold.optional, false);
  assert.equal(hold.body.length, 1);
  const [instruction] = hold.body;
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.args.token.value, "mech");
  assert.equal(instruction.args.amount.value, 1);
  assert.equal(instruction.args.mode.value, "create");
  assert.deepEqual(instruction.args.location.value, { type: "base", player: "controller" });
});

test.todo(
  "static might aura through layers engine + hold trigger token creation (blocked on layers/continuous.might, RIFT-86..88)"
);
