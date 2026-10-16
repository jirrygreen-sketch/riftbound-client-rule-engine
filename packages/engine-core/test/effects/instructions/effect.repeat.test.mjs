import assert from "node:assert/strict";
import test from "node:test";
import repeat from "../../../dist/effects/instructions/effect.repeat.js";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";

const expr = value => ({ kind: "constant", value });
const draw = (amount, count = 1) => ({
  count: expr(count),
  actions: [{ type: "draw", values: { player: expr("A"), amount: expr(amount) } }]
});

test("effect.repeat executes a spell action twice and links actual results", () => {
  const kernel = world().deck("one").deck("two").deck("three").build();
  const run = runInstruction(repeat, draw(1, 2), { world: kernel });

  assert.equal(run.result?.status, "executed");
  assert.equal(kernel.player("A").handSize, 2);
  assert.deepEqual(run.linked.results, [1, 1]);
  assert.equal(run.linked.result, 2);
  assert.equal(run.linked.repeats, 2);
});

test("effect.repeat resolves every selected target for one repeated effect", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const run = runInstruction(repeat, {
    actions: [{
      type: "buff",
      values: { amount: expr(1) },
      targets: { object: "friendly-units" }
    }]
  }, {
    world: kernel,
    targets: { "friendly-units": [kernel.ref("u1"), kernel.ref("u2")] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(kernel.getObject("u1")?.buffs, 1);
  assert.equal(kernel.getObject("u2")?.buffs, 1);
  assert.equal(run.linked.performed, 2);
});

test("effect.repeat returns negated when a repeated action is replaced", () => {
  const kernel = world().build();
  kernel.addReplacement(action => action.type === "gain-energy" ? "replaced" : null);
  const run = runInstruction(repeat, {
    actions: [{ type: "gain-energy", values: { player: expr("A"), amount: expr(1) } }]
  }, { world: kernel });

  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "replaced");
  assert.equal(kernel.player("A").energy, 0);
});

test("effect.repeat returns negated for prevented or impossible actions", () => {
  const prevented = world().player("A", { xp: 0 }).build();
  const preventedRun = runInstruction(repeat, {
    actions: [{ type: "spend-xp", values: { player: expr("A"), amount: expr(1) } }]
  }, { world: prevented });
  assert.equal(preventedRun.result?.status, "negated");
  assert.equal(preventedRun.result?.reason, "impossible");

  const impossible = world().build();
  const impossibleRun = runInstruction(repeat, {
    actions: [{ type: "draw", values: { player: expr("A"), amount: expr(-1) } }]
  }, { world: impossible });
  assert.equal(impossibleRun.result?.status, "negated");
  assert.equal(impossibleRun.result?.reason, "impossible");
});

test("effect.repeat ignores a target whose old zoneEntryId is invalid", () => {
  const kernel = world().unit("target").build();
  const stale = kernel.ref("target");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const run = runInstruction(repeat, {
    actions: [{ type: "buff", values: { amount: expr(1) }, targets: { object: "target-choice" } }]
  }, {
    world: kernel,
    targets: { "target-choice": [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("target")?.buffs, 0);
});

test("effect.repeat handles zero repetitions and an amount beyond available cards", () => {
  const zero = world().deck("one").build();
  const zeroRun = runInstruction(repeat, draw(1, 0), { world: zero });
  assert.equal(zeroRun.result?.status, "executed");
  assert.equal(zero.player("A").handSize, 0);
  assert.deepEqual(zeroRun.linked.results, []);

  const limited = world().deck("one").deck("two").deck("three").build();
  const limitedRun = runInstruction(repeat, draw(5, 2), { world: limited });
  assert.equal(limitedRun.result?.status, "executed");
  assert.deepEqual(limitedRun.linked.results, [3, 0]);
  assert.equal(limitedRun.linked.result, 3);
  assert.equal(limited.player("A").handSize, 3);
});

test("effect.repeat suspends a choice and commits when the answer replays", () => {
  const kernel = world().build();
  const args = {
    choices: [{ id: "repeat-amount", field: "amount", type: "number", min: expr(1), max: expr(2) }],
    actions: [{ type: "gain-energy", values: { player: expr("A") } }]
  };
  const asked = runInstruction(repeat, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(kernel.player("A").energy, 0);

  const answered = runInstruction(repeat, args, { world: kernel, answers: { "repeat-amount": 2 } });
  assert.equal(answered.result?.status, "executed");
  assert.equal(kernel.player("A").energy, 2);
  assert.equal(answered.linked.result, 2);
});

test("effect.repeat models Blood Rush SFD-003/221 as a repeated Assault 2 effect", () => {
  const kernel = world().unit("friendly-unit").build();
  const run = runInstruction(repeat, {
    count: expr(1),
    actions: [{ type: "buff", values: { amount: expr(2) }, targets: { object: "blood-rush-unit" } }]
  }, {
    world: kernel,
    targets: { "blood-rush-unit": [kernel.ref("friendly-unit")] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(kernel.getObject("friendly-unit")?.buffs, 2);
  assert.equal(run.linked.result, 2);
});

test("effect.repeat models Bonds of Strength SFD-151/221 on two friendly units", () => {
  const kernel = world().unit("first").unit("second").build();
  const run = runInstruction(repeat, {
    count: expr(1),
    actions: [{ type: "buff", values: { amount: expr(1) }, targets: { object: "bonds-friendly-units" } }]
  }, {
    world: kernel,
    targets: { "bonds-friendly-units": [kernel.ref("first"), kernel.ref("second")] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(kernel.getObject("first")?.buffs, 1);
  assert.equal(kernel.getObject("second")?.buffs, 1);
  assert.equal(run.linked.performed, 2);
});
