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
    "ravenbloom.mode",
    "ravenbloom.to-hand",
    "ravenbloom.recycle"
  ]);
  // Reveal reads the deck top.
  assert.equal(ability.body[0].op, "effect.reveal");
  assert.deepEqual(ability.body[0].args.count, { kind: "constant", value: 1 });
  // The two branches link back to the mode pick and the revealed card.
  assert.equal(ability.body[2].linkedTo, "ravenbloom.mode");
  assert.equal(ability.body[2].op, "effect.zone");
  assert.deepEqual(ability.body[2].args.to, { kind: "constant", value: "hand" });
  assert.equal(ability.body[3].linkedTo, "ravenbloom.mode");
  assert.equal(ability.body[3].op, "effect.recycle");
  assert.deepEqual(ability.body[3].args.objects, {
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
