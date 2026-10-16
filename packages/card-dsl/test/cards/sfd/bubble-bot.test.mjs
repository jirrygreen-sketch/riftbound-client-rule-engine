import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const cardId = "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389";
const program = cardProgramsById.get(cardId);

test("bubble-bot program is registered and validates", () => {
  assert.ok(program, "bubble-bot must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("bubble-bot structure: trigger, target, body", () => {
  assert.equal(program.status, "executable");
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.trigger.filter.event, "card-played");
  assert.equal(ability.trigger.filter.filter.source, "self");
  assert.equal(ability.trigger.filter.filter.player, "controller");
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args, {});
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "other-friendly-mech");
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(target.filter.tag, "Mech");
  assert.equal(target.filter.controller, "controller");
  assert.equal(target.filter.other, true);
});

test.todo(
  "execute ready-mech through the merged effect.ready primitive with a friendly Mech target (blocked on target resolution, RIFT-81)"
);
