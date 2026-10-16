// Golden test for Ferrous Forerunner (sfd-021-221).
// Deathknell body is expressed as an explicit object-killed trigger; only the
// token-creation shape is executable today, so the printed "Play ... tokens"
// form is asserted against the frozen effect.token play-mode boundary.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram } from "../../../../../packages/card-dsl/dist/ir/index.js";
import program from "../../../../../packages/card-dsl/dist/cards/sfd/ferrous-forerunner.js";
import tokenDef from "../../../../../packages/engine-core/dist/effects/instructions/effect.token.js";
import { world, runInstruction } from "../../../../../packages/engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3";

test("program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason ?? "", /440\.2\.c/);
  assert.match(program.judgeReason ?? "", /RIFT-82/);
  assert.match(program.sourceText, /\[Deathknell\]/);
});

test("Deathknell is modeled as a mandatory object-killed trigger on self", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, { event: "object-killed", filter: { role: "self" } });
  assert.equal(ability.body.length, 1);
});

test("body instruction plays two 3-might Mech tokens to the controller base", () => {
  const [instruction] = program.abilities[0].body;
  assert.equal(instruction.id, "ferrous-forerunner.play-tokens");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
});

test("reference kernel: creating the two Mech tokens lands them on the controller base", () => {
  const testWorld = world().build();
  const run = runInstruction(
    tokenDef,
    {
      token: { kind: "constant", value: "mech" },
      amount: { kind: "constant", value: 2 },
      mode: { kind: "constant", value: "create" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "mechTokens" }
    },
    { world: testWorld }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked["mechTokens.amount"], 2);
  const tokens = testWorld.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    assert.equal(token.name, "Mech");
    assert.equal(token.might, 3);
    assert.deepEqual(token.location, { type: "base", player: "A" });
  }
});

test("reference kernel: the printed play-a-new-token form is blocked by the frozen contract", () => {
  const [instruction] = program.abilities[0].body;
  const testWorld = world().build();
  const run = runInstruction(tokenDef, instruction.args, { world: testWorld });
  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "impossible");
  // The instruction performs nothing, so no tokens enter play.
  assert.equal(run.linked["mechTokens.amount"], 0);
  assert.deepEqual(run.linked["mechTokens.objects"], []);
  assert.equal(testWorld.objects.filter(object => object.isToken).length, 0);
});

test.todo(
  "resolve Ferrous Forerunner Deathknell through the real chain once token play (CR 440.2.c on-chain creation) exists; keyword expansion owned by RIFT-82"
);
