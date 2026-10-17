import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/parallel-convergence.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /Unsupported cost kind: additional/);
  // The damage half is merged and executed; it must not be presented as a gap.
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /真实执行证据/);
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
    "exhaust/discard/recycle/kill/reveal/spend-buff and rejects kind additional) — RIFT-261 " +
    "(cost.pay / cost.modify) and the RIFT-89 cost pipeline."
);
