import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/the-syren.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("ogn-184-298 The Syren: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-184-298 The Syren: identity, version and verbatim source text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-7fd32ee4cb0ba1308e359bf310991f144892e53c69a893cec7c4205fbfc24206"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    ":rb_energy_1:, :rb_exhaust:: Move a friendly unit at a battlefield to your base."
  );
});

test("ogn-184-298 The Syren: action-speed activated ability with energy+exhaust cost and one move instruction", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.equal(ability.cost.power, undefined);
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "the-syren.move-to-base");
  assert.equal(instruction.op, "effect.move");
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { target: "the-syren.friendly-unit" }
  });
  assert.deepEqual(instruction.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "moved" });
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "the-syren.friendly-unit");
  assert.deepEqual(target.filter, {
    type: "unit",
    controller: "self",
    zone: "board",
    location: "battlefield"
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("ogn-184-298 The Syren: the move instruction relocates the unit from battlefield to its controller's base", () => {
  const battlefield = { type: "battlefield", id: "battlefield-1" };
  const base = { type: "base", player: "A" };
  const kernel = world().unit("friendly-unit", { location: battlefield, might: 2 }).build();
  const unitRef = kernel.ref("friendly-unit");
  const [instruction] = program.abilities[0].body;
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: "the-syren.friendly-unit" } },
      to: { kind: "constant", value: "controller-base" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { "the-syren.friendly-unit": [unitRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.linked.moved.movements, [
    { object: unitRef, from: battlefield, to: base }
  ]);
  assert.deepEqual(kernel.getObject("friendly-unit").location, base);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
  assert.equal(instruction.args.to.value, "controller-base");
});

test.todo(
  "The Syren: Finalize pays 1 energy plus the exhaust-this cost before the activated ability resolves " +
    "(chain cost plan, RIFT-89/90 + RIFT-120)"
);
