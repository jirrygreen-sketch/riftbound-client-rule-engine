// Supported trigger/damage execution evidence: ../templates/triggered-attack-declared-effect-damage-706.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/anivia-primal.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-16533ecf815a70951a42e970169c16d046dab7f738d0ebd375b47d6b456479cf";
const TARGET_ID = "anivia.enemy-units-here";

const damageInstruction = program.abilities[0].body[0];

/**
 * Run the card's own instruction with a test-side locked set. The program
 * deliberately has no TargetSpec for the "all enemy units here" set (CR v1.5
 * 355.10.d: the set is programmatically selected, never chosen, so it is not a
 * target), so the reference kernel must be handed the set directly. This is a
 * primitive-level check of the card's numbers and target handling, not proof
 * that the card is executable end to end.
 */
function dealWithLockedSet(kernel, refs) {
  return runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: refs } }
  );
}

test("ogn-148-298 Anivia, Primal: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "When I attack, deal 3 to all enemy units here.");
});

test("ogn-148-298 Anivia, Primal: judgeReason names the attack-emission and set-damage gaps", () => {
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /combat-start-transaction|combat/);
});

test("ogn-148-298 Anivia, Primal: one attack trigger with a fixed 3 damage body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "anivia.damage-enemy-units-here");
  assert.equal(instruction.op, "effect.damage");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 3 });
  // The "all enemy units here" set is NOT a target (355.10.d), so the program
  // deliberately declares no TargetSpec for it: the value is a descriptive
  // placeholder for the missing untargeted set-damage form, and the gap is
  // recorded in judgeReason and the test.todo below.
  assert.deepEqual(instruction.args.target, {
    kind: "literal",
    value: "anivia.enemy-units-here"
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test("ogn-148-298 Anivia, Primal: the fixed 3 damage primitive hits every locked unit here (418.1.c/d)", () => {
  const kernel = world()
    .unit("enemy-one", { owner: "B" })
    .unit("enemy-two", { owner: "B" })
    .build();
  const run = dealWithLockedSet(kernel, [kernel.ref("enemy-one"), kernel.ref("enemy-two")]);

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-one").damage, 3);
  assert.equal(kernel.getObject("enemy-two").damage, 3);
  assert.equal(run.result.linkedValues.dealt, 6);
  assert.equal(run.result.linkedValues.dealtCount, 2);
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage"]);
});

test("ogn-148-298 Anivia, Primal: a member leaving its zone is dropped, the rest still takes 3 (359.3.e.8)", () => {
  const kernel = world().unit("staying", { owner: "B" }).unit("leaving", { owner: "B" }).build();
  const stale = kernel.ref("leaving");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const run = dealWithLockedSet(kernel, [kernel.ref("staying"), stale]);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("staying").damage, 3);
  assert.equal(run.result.linkedValues.dealt, 3);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("ogn-148-298 Anivia, Primal: with no locked set the primitive mistargets — the set is not part of the program", () => {
  const kernel = world().unit("enemy", { owner: "B" }).build();
  const run = dealWithLockedSet(kernel, []);

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test.todo(
  "ogn-148-298 Anivia, Primal: emit attack-declared from the combat start/designation transaction (CR 466.2/383.4.e.2); combat-start-transaction still blocks that producer."
);
test.todo(
  "ogn-148-298 Anivia, Primal: effect.damage needs a non-target enemy/here set query at resolution (CR 355.10.d/355.10.d.1), without creating TargetSpecs or became-target events."
);
