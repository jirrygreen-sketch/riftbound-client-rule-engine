import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/veiled-temple.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("veiled-temple: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("veiled-temple: optional conquer structure with ready and detach", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /array-contains/);
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.optional, true);
  const ids = ability.body.map(instruction => instruction.id);
  assert.deepEqual(ids, [
    "veiled-temple.ready-opt",
    "veiled-temple.ready-gear",
    "veiled-temple.detach-opt",
    "veiled-temple.detach"
  ]);
  assert.equal(ability.body[0].op, "choice.optional");
  assert.equal(ability.body[1].op, "effect.ready");
  assert.equal(ability.body[1].linkedTo, "veiled-temple.ready-opt");
  assert.equal(ability.body[1].targets.length, 1);
  assert.equal(ability.body[1].targets[0].id, "veiled-temple.gear");
  assert.deepEqual(ability.body[1].targets[0].filter, { type: "gear", controller: "controller" });
  assert.equal(ability.body[2].op, "choice.optional");
  assert.equal(ability.body[3].op, "effect.detach");
  assert.equal(ability.body[3].linkedTo, "veiled-temple.detach-opt");
  assert.equal(ability.body[3].picks[0].id, "veiled-temple.detached-gear");
});

test("veiled-temple: readies an exhausted friendly gear via the merged effect.ready primitive", () => {
  const kernel = world()
    .unit("gear-1", { types: ["gear"], exhausted: true })
    .build();
  const gearRef = kernel.ref("gear-1");
  assert.equal(kernel.getObject("gear-1").exhausted, true);
  const run = runInstruction(ready, {
    objects: { kind: "constant", value: { kind: "target", id: "veiled-temple.gear" } },
    amount: { kind: "constant", value: 1 }
  }, { world: kernel, targets: { "veiled-temple.gear": [gearRef] } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("gear-1").exhausted, false);
});

// The "If it's an Equipment" gate has no array-contains operator in Condition,
// so the detach branch cannot be honestly executed end-to-end (RIFT-81~91).
test.todo("veiled-temple: Equipment-tag condition on the readied gear (RIFT-81~91)");
test.todo("veiled-temple: detach of the readied Equipment via non-target pick (RIFT-81~91)");
