import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/super-mega-death-rocket-jinx.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-a5df5886eb5ce4de01ecdbffd7bd2e4840f75ad0546a27a1428d719100e5f2ad";

const play = program.abilities.find(ability => ability.kind === "play");
const conquer = program.abilities.find(ability => ability.kind === "triggered");
const damageInstruction = play.body[0];
const targetSpec = damageInstruction.targets[0];
const discardCost = conquer.body[0];
const returnInstruction = conquer.body[1];

test("ogn-252-298 Super Mega Death Rocket!: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Deal 5 to a unit.\n" +
      "When you conquer, you may discard 1 to return this from your trash to your hand."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-252-298 Death Rocket judgeReason names the trash-zone, cost.discard and source-selector gaps", () => {
  assert.match(program.judgeReason, /366\.1/);
  assert.match(program.judgeReason, /cost\.discard/);
  assert.match(program.judgeReason, /423\.3/);
  assert.match(program.judgeReason, /source\/self/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ogn-252-298 Death Rocket structure: Deal 5 play plus a conquer trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);

  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, { kind: "literal", value: 5 });
  assert.deepEqual(damageInstruction.args.target, { kind: "literal", value: "rocket-unit" });
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.equal(damageInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "rocket-unit");
  assert.deepEqual(targetSpec.filter, { type: "unit" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("ogn-252-298 Death Rocket structure: optional conquer trigger with the discard-1 cost and return", () => {
  assert.equal(conquer.trigger.at, "conquer");
  assert.deepEqual(conquer.trigger.filter, { event: "conquer", player: "controller" });
  // "you may discard 1 to return this ...": the may is the trigger's optionality
  // (contract 3.1) and the discard is the cost of the clause (355.10.c.1).
  assert.equal(conquer.optional, true);
  assert.deepEqual(conquer.body.map(instruction => instruction.id), [
    "rocket-discard-cost",
    "rocket-return"
  ]);

  assert.equal(discardCost.op, "cost.discard");
  assert.deepEqual(discardCost.args.amount, { kind: "literal", value: 1 });
  assert.deepEqual(discardCost.args.player, { kind: "literal", value: "controller" });
  assert.equal(discardCost.linkedTo, undefined);

  // The return is linked: it only happens after the discard cost is paid.
  assert.equal(returnInstruction.op, "effect.zone");
  assert.equal(returnInstruction.linkedTo, "rocket-discard-cost");
  assert.deepEqual(returnInstruction.args.to, { kind: "literal", value: "hand" });
  assert.equal(returnInstruction.picks.length, 1);
  assert.equal(returnInstruction.picks[0].id, "rocket-source");
  assert.deepEqual(returnInstruction.picks[0].options, ["dynamic:this-card-in-trash"]);
  assert.equal(returnInstruction.targets, undefined);
});

test("ogn-252-298 Death Rocket golden: the Deal 5 half marks 5 damage on the locked unit", () => {
  const kernel = world().unit("rocket-target", { might: 9 }).build();
  const locked = kernel.ref("rocket-target");

  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [locked] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("rocket-target").damage, 5);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
  assert.equal(run.result.linkedValues.dealt, 5);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("ogn-252-298 Death Rocket golden: a target that left the board is ignored, not re-dealt", () => {
  const kernel = world().unit("leaving-target", { might: 9 }).build();
  const stale = kernel.ref("leaving-target");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(run.events.length, 0);
});

test.todo(
  "Death Rocket: the conquer trigger works from the Trash (CR 366.1), which needs a declared " +
    "activation zone for triggered abilities; the trigger pipeline defaults a source's active " +
    "zone to ['board'] (events/pipeline.ts)."
);

test.todo(
  "Death Rocket: 'discard 1' as the clause's cost needs a merged cost.discard primitive " +
    "(423.3, RIFT-89); effect.discard is the effect-discard form of 423.4 and cannot stand in."
);

test.todo(
  "Death Rocket: 'return this from your trash to your hand' needs contract 3.6's source/self " +
    "ObjectSelector to reach a zone-moving primitive; effect.zone only accepts target/pick ids."
);
