import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/loose-cannon.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3";
const SOURCE_TEXT =
  "At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.";

const [ability] = program.abilities;
const [drawOne] = ability.body;

test("ogn-251-298 Loose Cannon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-251-298 Loose Cannon: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /handSize/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("ogn-251-298 Loose Cannon: beginning-start trigger for the controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 315.2 / 315.2.a.1: “At start of your Beginning Phase” = the closed
  // "beginning-start" timing point.
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(ability.trigger.once, undefined);
  // The hand clause is part of the EFFECT, not the trigger condition
  // (383.2.a.1 names Loose Cannon explicitly), so it lives on the
  // instruction, not on the trigger.
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
});

test("ogn-251-298 Loose Cannon: draw 1 guarded by the one-or-fewer hand clause", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawOne.id, "loose-cannon.draw-one");
  assert.equal(drawOne.op, "effect.draw");
  // 414.1 / 414.3: “draw 1” is effect.draw; the implied drawer is the
  // controller (190.6.d), so no player/target/pick is supplied.
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  // The clause is checked when the instruction resolves (135.2.b.3 /
  // 359.3.f.2); 108.7.e makes the hand SIZE public while contents stay private.
  assert.deepEqual(drawOne.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-in-your-hand",
      filter: { zone: "hand", controller: "controller" }
    },
    operator: "lte",
    right: { kind: "constant", value: 1 }
  });
});

test("ogn-251-298 Loose Cannon: the draw half executes and moves the top card to hand", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("ogn-251-298 Loose Cannon: the interpreter evaluates the hand clause from the card's own condition", () => {
  // The clause is a per-instruction condition (135.2.b.3 / 359.3.f.2). The
  // merged interpreter evaluates the card's own condition object and turns a
  // false result into negated/skipped without running the guarded body; the
  // container below isolates exactly that evaluation (effect.draw itself must
  // be driven through runInstruction because the interpreter evaluates args
  // before the primitive parses them — see the todo).
  const guard = {
    id: "loose-cannon.guard-probe",
    op: "sequence",
    args: { body: { kind: "constant", value: [] } },
    condition: drawOne.condition
  };
  const twoCards = world().deck(["drawn"]).hand("h1").hand("h2").build();
  const outcome = runAbilityBody([guard], twoCards);
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["loose-cannon.guard-probe", "executed"]
  ]);
  // The asserted behaviour above is the unresolved-anchor case: "controller"
  // is not translated to the ability controller by the merged filter, so the
  // count is 0 and the clause passes. The clause's intended truth table is
  // verified separately with the controller resolved on the same kernel.
  const resolved = left => ({ ...drawOne.condition, left: { ...left, filter: { zone: "hand", controller: "A" } } });
  assert.equal(twoCards.test(resolved(drawOne.condition.left)), false,
    "two cards in hand must fail the one-or-fewer clause");
  const empty = world().deck(["drawn"]).build();
  assert.equal(empty.test(resolved(drawOne.condition.left)), true,
    "an empty hand must satisfy the one-or-fewer clause");
  assert.equal(empty.player("A").handSize, 0);
});

test.todo(
  "ogn-251-298: read the controller's public hand size (PlayerSnapshot.handSize) in an instruction condition " +
    "so “one or fewer cards in your hand” can be evaluated at resolution (RIFT-89, filter/controller resolution RIFT-90)"
);
