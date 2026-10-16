import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ravenbloom-conservatory.js";

test("ravenbloom: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("ravenbloom: triggered defend structure with reveal and two branches", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /array-contains/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "defense-declared");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.optional, false);
  const ids = ability.body.map(instruction => instruction.id);
  assert.deepEqual(ids, [
    "ravenbloom.reveal",
    "ravenbloom.mode"
  ]);
  // Reveal reads the deck top.
  assert.equal(ability.body[0].op, "effect.reveal");
  assert.deepEqual(ability.body[0].args.count, { kind: "constant", value: 1 });
  // Each branch owns its instructions; links read the enclosing reveal.
  const mode = ability.body[1];
  assert.equal(mode.op, "choice.mode");
  assert.equal(mode.linkedTo, "ravenbloom.reveal");
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.equal(mode.args.modes.kind, "constant");
  const [spell, other] = mode.args.modes.value;
  assert.equal(spell.id, "ravenbloom.spell-mode");
  assert.equal(other.id, "ravenbloom.other-mode");
  assert.equal(spell.body.length, 1);
  assert.equal(other.body.length, 1);
  const [toHand] = spell.body;
  const [recycle] = other.body;
  assert.equal(toHand.id, "ravenbloom.to-hand");
  assert.equal(toHand.linkedTo, "ravenbloom.reveal");
  assert.equal(toHand.condition, undefined);
  assert.equal(toHand.op, "effect.zone");
  assert.deepEqual(toHand.args.to, { kind: "constant", value: "hand" });
  assert.equal(recycle.id, "ravenbloom.recycle");
  assert.equal(recycle.linkedTo, "ravenbloom.reveal");
  assert.equal(recycle.condition, undefined);
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "ravenbloom.reveal",
    key: "revealed"
  });
});

// The reveal itself uses the merged effect.reveal primitive, but the golden
// branch execution is gated on the "if it's a spell" discriminator, which has
// no array-contains operator in Condition; and effect.reveal's ctx.query read
// does not guarantee zone order (deck-top). Both are RIFT-81~91 concerns.
test.todo("ravenbloom: reveal top-of-deck ordering via zoneSlice (RIFT-81~91)");
test.todo("ravenbloom: spell/non-spell branch execution via array-contains condition (RIFT-81~91)");
