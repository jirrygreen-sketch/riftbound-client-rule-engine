// Golden test for Ferrous Forerunner (sfd-021-221).
// Deathknell body is expressed as an explicit object-killed trigger; the
// merged effect.token play path really creates and plays the Mech tokens, while
// the Deathknell trigger registration is still owned by RIFT-257.
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
  assert.match(program.judgeReason ?? "", /LocationRef/);
  assert.match(program.judgeReason ?? "", /RIFT-82/);
  assert.match(program.judgeReason ?? "", /RIFT-257/);
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

test("golden: the printed play mode really creates and plays both 3-Might Mech tokens (440.2.c / 185.2.a)", () => {
  const testWorld = world().player("A").build();
  const [instruction] = program.abilities[0].body;
  // "to your base" has no controller-relative spelling for a literal
  // effect.token location (see judgeReason), so the acting seat substitutes the
  // printed placeholder; everything else is the card's own argument set.
  const run = runInstruction(
    tokenDef,
    { ...instruction.args, location: { kind: "constant", value: { type: "base", player: "A" } } },
    { world: testWorld }
  );

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked["mechTokens.amount"], 2);
  // The chain-creation receipts survive the play hand-off.
  assert.equal(run.linked["mechTokens.createdAmount"], 2);
  assert.equal(run.linked.mechTokens.objectsComplete, true);
  const tokens = testWorld.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    assert.equal(token.name, "Mech");
    assert.equal(token.might, 3);
    assert.deepEqual(token.location, { type: "base", player: "A" });
  }
  assert.equal(run.events.filter(event => event.action === "play").length, 2);
});

test.todo(
  "sfd-021-221 Ferrous Forerunner: resolve the Deathknell body through the real chain once the card-program " +
    "trigger registration lands and trigger.leave is merged (808.1.c; RIFT-82 keyword expansion + RIFT-257 binding)"
);

test.todo(
  "sfd-021-221 Ferrous Forerunner: 'to your base' needs a controller-relative LocationRef for effect.token " +
    "(its literal PlayerId must equal ctx.controller; only a linked/known LocationRef can name that seat) — " +
    "contract change request"
);
