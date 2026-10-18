import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../dist/programs/errors.js";

const constant = value => ({ kind: "constant", value });
const makeProgram = abilities => ({
  canonicalCardId: "scenario-regression",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Synthetic scenario harness regression",
  abilities,
});
const emptyProgram = makeProgram([]);
const passes = [{ type: "pass", player: "A" }, { type: "pass", player: "B" }];

const bindingFailures = [
  {
    name: "static",
    ability: { kind: "static", effect: { kind: "continuous.unsupported" } },
    message: "Static ability kind continuous.unsupported has no layer mapping",
  },
  {
    name: "triggered",
    ability: { kind: "triggered", trigger: { at: "card-played", filter: { here: true } }, optional: false, body: [] },
    message: "Unsupported filter field here",
  },
  {
    name: "replacement",
    ability: { kind: "replacement", replaces: { event: "object-enters-board" }, with: [{ id: "unsupported", op: "replacement.scenario-missing", args: {} }] },
    message: /Unsupported replacement opcode: replacement\.scenario-missing/,
  },
];

for (const failure of bindingFailures) {
  for (const zone of ["board", "hand"]) {
    test(`${failure.name} binding errors fail a scenario during ${zone === "board" ? "setup" : "play"}`, () => {
      const program = makeProgram([failure.ability]);
      const [row] = defineTemplateSuite("binding failure", [{
        canonicalCardId: program.canonicalCardId,
        program,
        scenario: {
          objects: [{ id: "source", program, types: ["unit"], zone, might: 3 }],
          operations: zone === "hand" ? [{ type: "play", object: "source" }] : [],
        },
      }]);
      assert.throws(row.run, error => {
        assert.ok(error instanceof Error);
        if (failure.name !== "replacement") {
          assert.ok(error instanceof ProgramBindingError);
          assert.equal(error.code, "judge-required");
          assert.equal(error.message, failure.message);
        } else {
          assert.match(error.message, failure.message);
        }
        return true;
      });
    });
  }
}

test("binding errors from an additional object's program fail the scenario", () => {
  const auxiliary = { ...makeProgram([bindingFailures[0].ability]), canonicalCardId: "auxiliary" };
  assert.throws(() => runCardScenario(emptyProgram, {
    objects: [{ id: "source", program: auxiliary, zone: "board" }],
  }), { message: bindingFailures[0].message });
});

const badInstruction = { id: "missing", op: "effect.scenario-missing", args: {} };
for (const kind of ["play", "activated", "triggered"]) {
  test(`execution errors in ${kind} bodies retain their reason`, () => {
    const ability = kind === "play"
      ? { kind, body: [badInstruction] }
      : kind === "activated"
        ? { kind, cost: { energy: constant(0) }, timing: "action", body: [badInstruction] }
        : { kind, trigger: { at: "card-played", filter: { self: true } }, optional: false, body: [badInstruction] };
    const program = makeProgram([ability]);
    const operation = kind === "play" ? { type: "play", object: "source" }
      : kind === "activated" ? { type: "activate", object: "source" }
        : { type: "trigger", timingPoint: "card-played", object: "source", player: "A" };
    assert.throws(() => runCardScenario(program, {
      objects: [{ id: "source", program, zone: kind === "play" ? "hand" : "board", types: [kind === "play" ? "spell" : "unit"], might: 3 }],
      operations: [operation, ...passes],
    }), { message: "Unregistered instruction opcode: effect.scenario-missing" });
  });
}

test("execution errors after answering a suspended choice retain their reason", () => {
  const program = makeProgram([{ kind: "play", body: [{
    id: "optional", op: "choice.optional", args: { body: constant([badInstruction]) },
  }] }]);
  assert.throws(() => runCardScenario(program, {
    objects: [{ id: "spell", program, types: ["spell"], zone: "hand" }],
    operations: [{ type: "play", object: "spell" }, ...passes, { type: "choose", id: "optional", value: true }],
  }), { message: "Unregistered instruction opcode: effect.scenario-missing" });
});

test("initial object characteristics preserve explicit null, zero, false and empty values", () => {
  const nulls = { cardId: null, location: null, combatRole: null, might: null, energy: null, power: null, attachedTo: null };
  const zeroes = { name: "", types: [], tags: [], keywords: [], might: 0, energy: 0, power: [], damage: 0, buffs: 0, exhausted: false, stunned: false, faceDown: false, isToken: false };
  const result = runCardScenario(emptyProgram, {
    objects: [{ id: "nulls", ...nulls }, { id: "zeroes", ...zeroes }, { id: "omitted" }],
    expect: { objects: {
      nulls,
      zeroes,
      omitted: { might: 1, energy: 0, power: [], combatRole: null },
    } },
  });
  result.asserts();
});

test("an explicit null card identity is not replaced by an inline program", () => {
  const result = runCardScenario(emptyProgram, {
    objects: [{ id: "anonymous", program: emptyProgram, cardId: null, zone: "board", types: ["battlefield"], might: null }],
    expect: { objects: { anonymous: { cardId: null, might: null, ref: { zoneEntryId: 1 } } } },
  });
  result.asserts();
});

test("null Might survives lifecycle setup, real play, cleanup and an unrelated draw", () => {
  const program = makeProgram([{ kind: "play", body: [{ id: "draw", op: "effect.draw", args: { amount: constant(1) } }] }]);
  const result = runCardScenario(program, {
    objects: [
      { id: "initial", program, types: ["battlefield"], zone: "board", might: null, energy: null, power: null },
      { id: "unit", program, types: ["unit"], zone: "hand", might: null },
      { id: "top", zone: "deck", might: null, energy: null, power: null },
    ],
    operations: [{ type: "play", object: "unit" }],
    expect: { objects: {
      initial: { zone: "board", might: null, energy: null, power: null },
      unit: { zone: "board", might: null },
      top: { zone: "hand", might: null, energy: null, power: null },
    }, events: { includes: [{ timingPoint: "card-drawn" }] } },
  });
  result.asserts();
});

for (const combatRole of ["attacker", "defender", null]) {
  test(`combatRole ${combatRole} reaches static condition evaluation`, () => {
    const program = makeProgram([{ kind: "static", effect: {
      kind: "continuous.might", mode: "add", amount: constant(2), appliesTo: "self",
    }, condition: {
      kind: "compare", left: { kind: "object-property", object: "self", property: "combatRole" },
      operator: "in", right: constant(["attacker", "defender"]),
    } }]);
    const result = runCardScenario(program, {
      objects: [{ id: "unit", program, zone: "board", might: 2, combatRole }],
      expect: { objects: { unit: { combatRole, might: combatRole === null ? 2 : 4 } } },
    });
    result.asserts();
  });
}
