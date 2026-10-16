import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const cardId = "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82";
const program = cardProgramsById.get(cardId);

test("plundering-poro program is registered and validates", () => {
  assert.ok(program, "plundering-poro must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("plundering-poro structure: conquer trigger, judge-required body", () => {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("effect.token"), "judgeReason must cite the missing primitive");
  assert.ok(program.judgeReason.includes("Gold"), "judgeReason must cite the Gold token gap");
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.trigger.filter.event, "conquer");
  assert.equal(ability.trigger.filter.filter.source, "self");
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.args.token.kind, "constant");
  assert.equal(instruction.args.token.value, "gold");
  assert.equal(instruction.args.mode.value, "play");
  assert.equal(instruction.args.entersExhausted.value, true);
});

test.todo(
  "play a Gold gear token exhausted through the chain (blocked on token play-mode + Gold definition + exhausted entry, RIFT-82)"
);
