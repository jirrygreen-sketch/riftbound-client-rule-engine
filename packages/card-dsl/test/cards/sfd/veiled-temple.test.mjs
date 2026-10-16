import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/veiled-temple.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

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
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["veiled-temple.ready-opt"]);
  const [readyChoice] = ability.body;
  assert.equal(readyChoice.op, "choice.optional");
  assert.equal(readyChoice.args.body.kind, "constant");
  const [readyGear, detachChoice] = readyChoice.args.body.value;
  assert.deepEqual(readyChoice.args.body.value.map(instruction => instruction.id), [
    "veiled-temple.ready-gear",
    "veiled-temple.detach-opt"
  ]);
  assert.equal(readyGear.op, "effect.ready");
  assert.equal(readyGear.linkedTo, undefined);
  assert.equal(readyGear.targets.length, 1);
  assert.equal(readyGear.targets[0].id, "veiled-temple.gear");
  assert.deepEqual(readyGear.targets[0].filter, { type: "gear", controller: "controller" });
  assert.equal(detachChoice.op, "choice.optional");
  assert.equal(detachChoice.linkedTo, "veiled-temple.ready-gear");
  assert.equal(detachChoice.args.body.kind, "constant");
  assert.equal(detachChoice.args.body.value.length, 1);
  const [detach] = detachChoice.args.body.value;
  assert.equal(detach.op, "effect.detach");
  assert.equal(detach.linkedTo, undefined);
  assert.equal(detach.picks[0].id, "veiled-temple.detached-gear");
  assert.deepEqual(detach.picks[0].options, [{ kind: "linked-value", instructionId: "veiled-temple.ready-gear", key: "readied" }]);
});

test("veiled-temple: declining ready skips ready, detach prompt and detach", () => {
  const kernel = world().unit("gear-1", { types: ["gear"], exhausted: true }).build();
  kernel.setAnswers({ "veiled-temple.ready-opt/optional": false });
  const outcome = runAbilityBody(program.abilities[0].body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["veiled-temple.ready-opt"]);
  assert.equal(kernel.getObject("gear-1").exhausted, true);
  assert.deepEqual(kernel.events, []);
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
