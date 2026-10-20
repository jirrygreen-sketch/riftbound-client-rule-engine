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

// --- Production goldens: the original registry program through the generic
// scenario harness (ProgramBinding -> ChainEngine play, card-played trigger,
// Finalize target lock, Resolve). Printed: Unit, Body, 2 Energy, Might 2.
// The +1 Might a Buff contributes (CR 703) is a rules-engine layer concern
// tracked by RIFT-888; these goldens assert the Buff counter this card places.
const { runCardScenario } = await import(new URL("effects/testing/scenario/index.js", engineCore));

const BASE_A = { type: "base", player: "A" };
const BASE_B = { type: "base", player: "B" };
const rookie = { id: "rookie", cardId: program.canonicalCardId, program, types: ["unit"], zone: "hand", energy: 2, power: [], might: 2 };
const playAndResolve = [
  { type: "play", object: "rookie", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];
const buffsOf = (result, id) => result.state.objects.find(object => object.ref.id === id).buffs;

test("ogn-136-298 Pit Rookie buffs the only other friendly unit, never itself or an enemy", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 2 } },
    objects: [
      rookie,
      { id: "ally", owner: "A", types: ["unit"], zone: "board", location: BASE_A, might: 2 },
      { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: BASE_B, might: 2 },
    ],
    operations: playAndResolve,
    expect: { objects: { rookie: { zone: "board" } }, players: { A: { energy: 0 } } },
  });
  result.asserts();
  assert.equal(buffsOf(result, "ally"), 1);
  assert.equal(buffsOf(result, "rookie"), 0);
  assert.equal(buffsOf(result, "enemy"), 0);
  assert.deepEqual(result.state.chain, []);
});

test("ogn-136-298 Pit Rookie buffs exactly the chosen one of two other friendly units", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 2 } },
    answers: { "target:other-unit": ["ally-2"] },
    objects: [
      rookie,
      { id: "ally-1", owner: "A", types: ["unit"], zone: "board", location: BASE_A, might: 2 },
      { id: "ally-2", owner: "A", types: ["unit"], zone: "board", location: BASE_A, might: 3 },
    ],
    operations: playAndResolve,
  });
  assert.equal(buffsOf(result, "ally-2"), 1);
  assert.equal(buffsOf(result, "ally-1"), 0);
  assert.equal(buffsOf(result, "rookie"), 0);
});

test("ogn-136-298 Pit Rookie with no other friendly unit resolves its play and buffs nothing", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 2 } },
    objects: [rookie, { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: BASE_B, might: 2 }],
    operations: [{ type: "play", object: "rookie", player: "A" }],
    expect: { objects: { rookie: { zone: "board" } } },
  });
  result.asserts();
  assert.equal(buffsOf(result, "rookie"), 0);
  assert.equal(buffsOf(result, "enemy"), 0);
  assert.deepEqual(result.state.chain, []);
});

test("ogn-136-298 Pit Rookie on an already-buffed friendly unit does not stack a second Buff (CR 702.3.a)", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 2 } },
    objects: [rookie, { id: "ally", owner: "A", types: ["unit"], zone: "board", location: BASE_A, might: 2, buffs: 1 }],
    operations: playAndResolve,
  });
  assert.equal(buffsOf(result, "ally"), 1);
  assert.deepEqual(result.state.chain, []);
});
