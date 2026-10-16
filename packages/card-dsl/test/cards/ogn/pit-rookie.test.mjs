import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/pit-rookie.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const findBuffInstruction = () => {
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  const instruction = ability.body[0];
  assert.equal(instruction.op, "effect.buff");
  return instruction;
};

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, sourceText", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-e2638655ff5ed3a1e60a501be3c23d74e46ef7f1900bed31b436f1a579b316ed"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "When you play me, buff another friendly unit. (If it doesn't have a buff, it gets a +1 :rb_might: buff.)"
  );
});

test("trigger: 'when you play me' at the card-played timing point, filtered to self, mandatory", () => {
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { role: "self" });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("target: one other friendly unit (target spec, min=max=1, selection one)", () => {
  const instruction = findBuffInstruction();
  assert.equal(instruction.targets.length, 1);
  const target = instruction.targets[0];
  assert.equal(target.id, "other-unit");
  assert.deepEqual(target.filter, { type: "unit", controller: "controller", other: true });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(instruction.picks, undefined);
});

test("buff instruction body resolves through the interpreter and reference kernel", () => {
  // The instruction body (without the TargetSpec) runs through the default
  // registry; Finalize-time target locking is supplied to the kernel directly.
  const body = program.abilities[0].body.map(({ targets, ...rest }) => rest);
  const kernel = world()
    .unit("pit-rookie", { might: 2 })
    .unit("ally", { might: 1 })
    .build();
  kernel.setTargets("other-unit", [kernel.ref("ally")]);
  const run = runAbilityBody(body, kernel);
  assert.equal(run.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].op, "effect.buff");
  assert.equal(run.results[0].result.status, "executed");
  assert.equal(run.results[0].result.linkedValues.buffedCount, 1);
});

test("a unit that already has a buff is not buffed again (CR 702.3.a)", () => {
  const body = program.abilities[0].body.map(({ targets, ...rest }) => rest);
  const kernel = world()
    .unit("pit-rookie", { might: 2 })
    .unit("ally", { might: 1, buffs: 1 })
    .build();
  kernel.setTargets("other-unit", [kernel.ref("ally")]);
  const outcome = runAbilityBody(body, kernel);
  // effect.buff reports the no-op as negated/skipped; nothing was placed.
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("ally").buffs, 1);
});

test("a target that left its zone before resolution makes the instruction ignored (CR 359.3.e.7)", () => {
  const body = program.abilities[0].body.map(({ targets, ...rest }) => rest);
  const kernel = world()
    .unit("pit-rookie", { might: 2 })
    .unit("ally", { might: 1 })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("other-unit", [stale]);
  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
});

test.todo(
  "Target legality at Finalize: exclude Pending chain items and re-check 'another friendly unit' " +
    "when the trigger goes on the chain (RIFT-8x target/chain workstream)"
);
