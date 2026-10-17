import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/demacian-illuminators.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [triggered] = program.abilities;
const [buffInstruction] = triggered.body;

// The reference kernel compares filter values literally, so the card's
// Finalize-time TargetSpec placeholders (controller: "self") cannot be resolved
// by it. The golden tests therefore execute the program's own body with the
// Finalize-locked target set supplied by the kernel (same approach as
// test/cards/ogn/pit-rookie.test.mjs).
const bodyWithoutTargets = triggered.body.map(({ targets, ...rest }) => rest);
const runBody = (kernel) => runAbilityBody(bodyWithoutTargets, kernel);

const TARGET_ID = buffInstruction.targets[0].id;
const lockTargets = (kernel, refs) => kernel.setTargets(TARGET_ID, refs);

test("rad-131-167 Demacian Illuminators: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-f6f48abbdfa8b29547d87803b943b002bce1b314d44763556dcb0f98a9b19c86"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When one or more friendly units die, [Buff] a friendly unit. " +
      "(Give it a +1 :rb_might: buff if it doesn't have one.)"
  );
});

test("rad-131-167 Demacian Illuminators: judgeReason names the batch-death gap", () => {
  assert.match(program.judgeReason, /one or more/);
  assert.match(program.judgeReason, /370\.1\.a\.2/);
  assert.match(program.judgeReason, /simultaneousGroup/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /effect\.buff/);
});

test("rad-131-167 Demacian Illuminators: structure — death trigger plus one Buff instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", controller: "self" }
  });
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["demacian-illuminators.buff"]);

  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffInstruction.args.target, {
    kind: "constant",
    value: "demacian-illuminators.friendly-unit"
  });
  assert.equal(buffInstruction.linkedTo, undefined);
  assert.equal(buffInstruction.targets.length, 1);
  const [target] = buffInstruction.targets;
  assert.equal(target.id, "demacian-illuminators.friendly-unit");
  assert.deepEqual(target.filter, { type: "unit", controller: "self" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("rad-131-167 Demacian Illuminators: the Buff half really places a Buff counter (427.3)", () => {
  const kernel = world()
    .player("A")
    .unit("ally", { might: 2 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  lockTargets(kernel, [kernel.ref("ally")]);
  const outcome = runBody(kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.buffedCount, 1);
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(kernel.getObject("enemy").buffs, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["buff"]);
});

test("rad-131-167 Demacian Illuminators: an already-Buffed unit is not Buffed again (427.1.b.1)", () => {
  const kernel = world().player("A").unit("ally", { might: 2, buffs: 1 }).build();
  lockTargets(kernel, [kernel.ref("ally")]);
  const outcome = runBody(kernel);
  // 427.1.c / 427.3: the unit stays a legal choice and simply is not Buffed.
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.deepEqual(kernel.events, []);
});

test("rad-131-167 Demacian Illuminators: a unit that left the board makes the instruction ignored (359.3.e.7)", () => {
  const kernel = world().player("A").unit("ally", { might: 2 }).build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  lockTargets(kernel, [stale]);
  const outcome = runBody(kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

test.todo(
  "rad-131-167 Demacian Illuminators: 'one or more friendly units die' must trigger once per " +
    "simultaneous death batch (CR 370.1.a.2 / 383.1) — the merged trigger pipeline scans once per " +
    "object-killed event even though emissions carry simultaneousGroup, and TriggerSpec.once still has no " +
    "per-batch lifetime (events/trigger contract change)"
);
