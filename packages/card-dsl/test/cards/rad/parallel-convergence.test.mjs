import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/parallel-convergence.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { translateObjectFilter, translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { readCost } from "../../../../engine-core/dist/cost/plan-values.js";

const CANONICAL = "card.hash-84ee715c26888cfa3850f44083e64823f41b5db0dc23a4f0511c4eb127d52175";
const [play] = program.abilities;
const [dealInstruction] = play.body;
const targetSpec = dealInstruction.targets[0];

test("rad-051-167 Parallel Convergence: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "As an additional cost to play this, return a friendly unit to its owner's hand.\n" +
      "Deal 5 to a unit at a battlefield."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-051-167 Parallel Convergence: judgeReason names the missing return-to-hand cost kind", () => {
  // The reason names the printed clause plus the two structural gaps.
  assert.match(program.judgeReason, /return a friendly unit to its owner's hand/);
  assert.match(program.judgeReason, /355\.1\.a/);
  assert.match(program.judgeReason, /356\.2\.b\.1/);
  assert.match(program.judgeReason, /Unsupported cost kind: additional/);
  assert.match(program.judgeReason, /Additional costs are not bound/);
  assert.match(program.judgeReason, /Structured location filters need a concrete location identity/);
  assert.equal(/RIFT-89|RIFT-261/.test(program.judgeReason), false);
  // The damage half is merged and executed; it must not be presented as a gap.
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /真实执行证据/);
});

test("rad-051-167 Parallel Convergence: the program's cost never reaches the plan (355.1.a / 356.2.b.1)", () => {
  // 356.2.b.1 mandatory additional costs belong in the Finalize plan, but the
  // production adapter refuses the whole authored CostSpec before that: the
  // card data's cost kind "additional" is not a kind it can bind. This is the
  // first of the two recorded gates.
  assert.throws(
    () => translateCost(play.cost, "parallel-convergence", "play"),
    error => error.code === "judge-required" && /Additional costs are not bound for parallel-convergence/.test(error.message)
  );

  // Second gate: even a hand-built plan cannot post this cost, because
  // readCost rejects both the kind and the payment kind; the frozen GameAction
  // set has no return-to-hand action either.
  const kernel = world().unit("ally", { might: 2 }).build();
  assert.throws(
    () => readCost(kernel, { kind: "additional", energy: { kind: "constant", value: 2 }, power: { kind: "constant", value: 1 } }, { id: "x" }, "cost"),
    error => error.name === "CostPlanError" && /Unsupported cost kind: additional/.test(error.message)
  );
  assert.throws(
    () => readCost(
      kernel,
      {
        energy: { kind: "constant", value: 2 },
        payments: [{ kind: "return-to-hand", choice: { id: "returned-unit", options: [], min: 1, max: 1, selection: "one" } }]
      },
      { id: "x" },
      "cost"
    ),
    error => error.name === "CostPlanError" && /Unsupported payment kind: return-to-hand/.test(error.message)
  );
});

test("rad-051-167 Parallel Convergence: the battlefield target filter cannot bind in the production translator", () => {
  // The damage half executes (below), but its "at a battlefield" restriction is
  // a structured location filter: programs/filters.ts needs a concrete
  // battlefield identity, so the Finalize target plan cannot be built from the
  // authored spec even though the instruction itself is merged.
  assert.deepEqual(targetSpec.filter, { type: "unit", location: { type: "battlefield" } });
  assert.throws(
    () => translateObjectFilter(targetSpec.filter),
    error => error.code === "judge-required" &&
      /Structured location filters need a concrete location identity/.test(error.message)
  );
  assert.throws(
    () => translateInstructionTargets(play.body),
    error => error.code === "judge-required" &&
      /Structured location filters need a concrete location identity/.test(error.message)
  );
  // The interpreter-side location vocabulary does understand battlefield
  // locations; the gap is the production filter translation.
  assert.equal(typeof translateInstructionTargets, "function");
});

test("rad-051-167 Parallel Convergence: structure — printed cost plus the mandatory additional cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "additional");
  // Printed: energy 2 and 1 power.
  assert.deepEqual(play.cost.energy, { kind: "constant", value: 2 });
  assert.deepEqual(play.cost.power, { kind: "constant", value: 1 });
  assert.equal(play.cost.payments.length, 1);
  const [additional] = play.cost.payments;
  // The payment kind has no representation in the frozen cost plan
  // (exhaust/discard/recycle/kill/reveal/spend-buff only), and the CostSpec
  // kind "additional" itself is not a stage the plan accepts — both are what
  // judgeReason records.
  assert.equal(additional.kind, "return-to-hand");
  assert.deepEqual(additional.choice, {
    id: "returned-unit",
    options: ["friendly-unit-you-control"],
    filter: { type: "unit", controller: "you", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-051-167 Parallel Convergence: structure — one damage instruction targeting a unit at a battlefield", () => {
  assert.equal(play.body.length, 1);
  assert.equal(dealInstruction.id, "parallel-convergence.deal-5");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(dealInstruction.args.target, { kind: "constant", value: "unit-at-battlefield" });
  assert.equal(dealInstruction.linkedTo, undefined);
  assert.equal(dealInstruction.picks, undefined);

  // "a unit at a battlefield": one target unit pinned to a battlefield
  // location ("at a battlefield" is a targeting restriction, 355.10.b).
  assert.equal(dealInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "unit-at-battlefield");
  assert.deepEqual(targetSpec.filter, { type: "unit", location: { type: "battlefield" } });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test("rad-051-167 Parallel Convergence: the damage half deals 5 to the locked battlefield unit", () => {
  const kernel = world()
    .unit("battlefield-unit")
    .base("base-unit")
    .build();
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("battlefield-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 5);
  assert.equal(kernel.getObject("base-unit").damage, 0);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
  assert.equal(run.result.linkedValues.dealt, 5);
  assert.equal(run.result.linkedValues.dealtCount, 1);
});

test("rad-051-167 Parallel Convergence: a stale battlefield target is ignored, not redirected (359.3.e)", () => {
  const kernel = world().unit("battlefield-unit").unit("other-unit").build();
  const stale = kernel.ref("battlefield-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("other-unit").damage, 0);
});

test.todo(
  "rad-051-167 Parallel Convergence: collecting the mandatory additional cost 'return a friendly " +
    "unit to its owner's hand' during Finalize needs a return-to-hand cost payment kind and the " +
    "mandatory-additional stage in the cost plan (cost/plan-values.ts readCost accepts only " +
    "exhaust/discard/recycle/kill/reveal/spend-buff and rejects kind additional)."
);
