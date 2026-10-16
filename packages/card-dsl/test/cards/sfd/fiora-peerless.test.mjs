import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const cardId = "card.hash-6bde2e2c542ff8fc1a7a2f9204df7e6c58a05a53ad98c0a31d69927be053b77f";
const program = cardProgramsById.get(cardId);

test("fiora-peerless program is registered and validates", () => {
  assert.ok(program, "fiora-peerless must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("fiora-peerless structure: attack/defend triggers with one-on-one predicate", () => {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("one-on-one"), "judgeReason must cite the one-on-one predicate");
  assert.equal(program.abilities.length, 2);

  const [attack, defend] = program.abilities;
  assert.equal(attack.kind, "triggered");
  assert.equal(attack.trigger.at, "attack-declared");
  assert.equal(attack.trigger.filter.event, "attack-declared");
  assert.equal(attack.trigger.filter.filter.source, "self");
  assert.equal(attack.trigger.once, "per-combat");
  assert.equal(attack.optional, false);
  assert.equal(attack.body[0].op, "effect.buff");
  assert.equal(attack.body[0].id, "double-might-attack");
  assert.equal(attack.body[0].args.mode.value, "buff");
  assert.equal(attack.body[0].args.target.value, "self");

  assert.equal(defend.kind, "triggered");
  assert.equal(defend.trigger.at, "defense-declared");
  assert.equal(defend.trigger.filter.event, "defense-declared");
  assert.equal(defend.trigger.filter.filter.source, "self");
  assert.equal(defend.trigger.once, "per-combat");
  assert.equal(defend.body[0].op, "effect.buff");
  assert.equal(defend.body[0].id, "double-might-defend");
});

test.todo(
  "one-on-one predicate, trigger.combat filter, and continuous.might doubling with combat duration (blocked on layers/predicate/duration, RIFT-89..91)"
);
