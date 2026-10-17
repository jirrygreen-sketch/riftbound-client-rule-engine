import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/imposing-challenger.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-fda3e6799f2fd63235520803dbabc0e2093d7da103c78cd4af3d14b11d20c2f8";
const SOURCE_TEXT =
  "When I move, you may move an enemy unit here with less Might than me to a different battlefield.";

const [ability] = program.abilities;
const [moveOption] = ability.body;
const [moveEnemy] = moveOption.args.body.value;

test("unl-105-219 Imposing Challenger: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-105-219 Imposing Challenger: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /143\.2\.a\.1/);
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /449\.2/);
  // The program binding is merged; the reason must name the remaining movement
  // payload/position/comparison gaps.
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /movement.*载荷|toLocationId/);
  assert.doesNotMatch(program.judgeReason, /RIFT-90|RIFT-120|RIFT-257|RIFT-270/);
});

test("unl-105-219 Imposing Challenger: 'When I move' subscribes to the object-moved timing point", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1: a Move is defined by Origin and Destination; 458 keeps a
  // Recall out of Move triggers, which is why the closed timing point is
  // object-moved (events/timing-points.ts).
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { object: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
});

test("unl-105-219 Imposing Challenger: 'you may' is choice.optional with the move inside its body (contract 3.9)", () => {
  assert.equal(ability.optional, true);
  assert.equal(ability.body.length, 1);
  assert.equal(moveOption.id, "imposing-challenger.move-opt");
  assert.equal(moveOption.op, "choice.optional");
  assert.deepEqual(moveOption.args.prompt, {
    kind: "constant",
    value: "Move an enemy unit here to a different battlefield?"
  });
  assert.equal(moveOption.args.body.kind, "constant");
  assert.equal(moveOption.linkedTo, undefined);
  // No bare choice plus linkedTo follower: the chosen instruction is wrapped.
  assert.equal(moveOption.args.body.value.length, 1);
  assert.equal(moveEnemy.linkedTo, undefined);
});

test("unl-105-219 Imposing Challenger: the move targets one enemy unit here with the placeholder Might gate", () => {
  assert.equal(moveEnemy.id, "imposing-challenger.move-enemy");
  assert.equal(moveEnemy.op, "effect.move");
  assert.deepEqual(moveEnemy.args.objects, {
    kind: "constant",
    value: { target: "imposing-challenger.enemy-here" }
  });
  // 355.4 / 355.4.a: the destination is the chosen other Battlefield. The
  // dynamic set has no merged spelling, so the printed destination intent is
  // recorded and fails closed in the primitive's own schema (see judgeReason).
  assert.deepEqual(moveEnemy.args.to, { kind: "constant", value: "different-battlefield" });
  assert.deepEqual(moveEnemy.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveEnemy.args.mode, undefined);

  assert.equal(moveEnemy.targets.length, 1);
  const [spec] = moveEnemy.targets;
  assert.equal(spec.id, "imposing-challenger.enemy-here");
  // 053.3 “here” uses the contract 3.6 sameLocationAs anchor; the Might
  // comparison placeholder is a descriptive key with no consumer.
  assert.deepEqual(spec.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "self",
    mightLessThan: "self"
  });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("unl-105-219 Imposing Challenger: declining the option moves nothing", () => {
  const kernel = world()
    .unit("imposing-challenger", { controller: "A", might: 5 })
    .unit("enemy-here", { controller: "B", might: 3, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setAnswers({ "imposing-challenger.move-opt/optional": false });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("imposing-challenger") });

  const outcome = runAbilityBody([moveOption], context);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(context.events, []);
  assert.deepEqual(context.getObject("enemy-here").location, {
    type: "battlefield",
    id: "battlefield-1"
  });
});

test("unl-105-219 Imposing Challenger golden: accepting the option tries the recorded destination and moves nothing", () => {
  // The accepting branch reaches effect.move with the card's own objects
  // selection and recorded destination; the merged primitive rejects that
  // destination before any relocation, so the enemy unit stays where it was and
  // no guessed battlefield is used.
  const kernel = world()
    .unit("imposing-challenger", { controller: "A", might: 5 })
    .unit("enemy-here", { controller: "B", might: 3, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  kernel.setAnswers({ "imposing-challenger.move-opt/optional": true });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("imposing-challenger") });

  // The same selection the card declares, executed through the merged primitive.
  assert.throws(
    () =>
      runInstruction(
        move,
        { objects: moveEnemy.args.objects, to: moveEnemy.args.to, amount: moveEnemy.args.amount },
        { world: context, targets: { "imposing-challenger.enemy-here": [context.ref("enemy-here")] } }
      ),
    /effect\.move to must be a location/
  );
  assert.deepEqual(context.getObject("enemy-here").location, {
    type: "battlefield",
    id: "battlefield-1"
  });
});

test.todo(
  "unl-105-219 Imposing Challenger: evaluate 'less Might than me' by comparing the candidate's Effective Might (143.2.a.1) with the host's — no merged ObjectFilter / Expr compares against another object's characteristic (same gap as sfd/soraka-wanderer)"
);
test.todo(
  "unl-105-219 Imposing Challenger: resolve 'to a different battlefield' by enumerating Battlefields other than the unit's current location (355.4.a / 449.2) — effect.move accepts only literal LocationRefs, 'controller-base' or a literal option list"
);
test.todo(
  "unl-105-219 Imposing Challenger: trigger on the Move Destination ('here' = the event's toLocationId) — " +
    "the movement event still lacks the from/to payload and the production matcher has no location anchor"
);
