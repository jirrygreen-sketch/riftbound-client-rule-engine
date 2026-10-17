import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ornns-forge.js";

test("ornns-forge: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("ornns-forge: static cost-modify structure", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost.modify/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "cost.modify");
  assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
  assert.equal(ability.effect.duration, "per-turn-first-play");
  assert.equal(ability.effect.appliesTo, "play-cost");
  assert.deepEqual(ability.effect.filter, { type: "gear", controller: "controller", isToken: false });
  assert.deepEqual(ability.condition, { kind: "always" });
});

// Cost modification is not executable: the card-static effect has no Finalize
// consumer, and the per-turn "first played" window needs history-gated expiry.
test.todo("ornns-forge: card-static cost binding into Finalize plus the per-turn first-play window");
