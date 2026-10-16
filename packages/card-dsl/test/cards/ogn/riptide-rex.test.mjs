import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/riptide-rex.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-48a9eb2aa99eeb51f17ab56a8ac367f90457aafe2f94b3280638ca8e269f2cf8";

test("Riptide Rex program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "When you play me, deal 6 to an enemy unit at a battlefield.");
});

test("Riptide Rex structure: self card-played trigger with one enemy battlefield unit target", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "riptide-rex.deal-6");
  assert.equal(instruction.op, "effect.damage");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 6 });
  assert.deepEqual(instruction.args.target, {
    kind: "constant",
    value: "enemy-unit-at-battlefield"
  });
  // No explicit source: the deal's source defaults to the ability source (418.6.a).
  assert.equal(instruction.args.source, undefined);
  assert.equal(instruction.args.combat, undefined);

  assert.equal(instruction.targets.length, 1);
  assert.deepEqual(instruction.targets[0], {
    id: "enemy-unit-at-battlefield",
    filter: { type: "unit", controller: "opponent", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("Riptide Rex golden: deal 6 marks six damage on the targeted enemy unit", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", might: 6, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const targetRef = kernel.ref("enemy-unit");
  const [instruction] = program.abilities[0].body;
  const run = runInstruction(
    damage,
    { amount: instruction.args.amount, target: "enemy-unit-at-battlefield" },
    { world: kernel, targets: { "enemy-unit-at-battlefield": [targetRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 6);
  assert.equal(run.linked.dealtCount, 1);
  assert.deepEqual(run.linked.dealtTo, [{ target: targetRef, amount: 6 }]);
  assert.equal(kernel.getObject("enemy-unit").damage, 6);
});

test("Riptide Rex golden: a target that left the battlefield before resolution is ignored (CR 359.3.e.7)", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", might: 6, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  const [instruction] = program.abilities[0].body;
  const run = runInstruction(
    damage,
    { amount: instruction.args.amount, target: "enemy-unit-at-battlefield" },
    { world: kernel, targets: { "enemy-unit-at-battlefield": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "Riptide Rex target legality at Finalize: 'an enemy unit at a battlefield' is selected by the merged TargetPlan " +
    "(controller opponent + location battlefield) and rechecked at Resolve, including Pending-chain exclusion (RIFT-90)"
);
