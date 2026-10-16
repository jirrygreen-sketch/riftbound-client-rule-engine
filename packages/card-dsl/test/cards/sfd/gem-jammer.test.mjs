// Golden test for Gem Jammer (sfd-007-221).
// The Ganking grant is a duration-bounded continuous keyword effect; no
// registered primitive can land it yet, so execution assertions stay todo.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram } from "../../../../../packages/card-dsl/dist/ir/index.js";
import program from "../../../../../packages/card-dsl/dist/cards/sfd/gem-jammer.js";

const CANONICAL = "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9";

test("program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason ?? "", /continuous\.grant-keyword/);
  assert.match(program.judgeReason ?? "", /RIFT-91/);
  assert.match(program.judgeReason ?? "", /RIFT-83/);
  assert.match(program.sourceText, /give a unit \[Ganking\] this turn/);
});

test("trigger fires when the card itself is played", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.equal(ability.trigger.condition, undefined);
});

test("body grants Ganking to exactly one unit until end of turn", () => {
  const [instruction] = program.abilities[0].body;
  assert.equal(instruction.id, "gem-jammer.grant-ganking");
  assert.equal(instruction.op, "continuous.grant-keyword");
  assert.deepEqual(instruction.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(instruction.targets?.length, 1);
  assert.deepEqual(instruction.targets?.[0], {
    id: "gem-jammer.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test.todo(
  "execute the Ganking grant once continuous.grant-keyword (RIFT-91) and the Ganking keyword expansion (RIFT-83) are registered"
);
