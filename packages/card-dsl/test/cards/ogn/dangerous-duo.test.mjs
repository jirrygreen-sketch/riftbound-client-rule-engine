// Golden test for Dangerous Duo (ogn-016-298).
// The Legion gate is expressed as a trigger condition over the cards-finalized
// history; the +2 Might body needs continuous.might (RIFT-91), so execution
// assertions stay todo.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram } from "../../../../../packages/card-dsl/dist/ir/index.js";
import program from "../../../../../packages/card-dsl/dist/cards/ogn/dangerous-duo.js";

const CANONICAL = "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91";

test("program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason ?? "", /continuous\.might/);
  assert.match(program.judgeReason ?? "", /RIFT-82/);
  assert.match(program.sourceText, /\[Legion\]/);
});

test("Legion gate is a trigger condition requiring another card finalized this turn", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.deepEqual(ability.trigger.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-finalized-this-turn",
      filter: { player: "controller", exclude: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("body grants +2 Might to exactly one unit until end of turn", () => {
  const [instruction] = program.abilities[0].body;
  assert.equal(instruction.id, "dangerous-duo.grant-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(instruction.targets?.length, 1);
  assert.deepEqual(instruction.targets?.[0], {
    id: "dangerous-duo.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test.todo(
  "expand the Legion dependent-keyword gate (RIFT-82) against the history query once condition.history lands"
);
test.todo(
  "execute the +2 Might grant once continuous.might is registered through the layers work (RIFT-91)"
);
