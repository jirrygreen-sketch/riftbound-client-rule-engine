import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/blind-monk.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-2ea191d1465e7251d43eb6e67e9cbb86d9e05e26dd213006d4d95001a73df327";
const SOURCE_TEXT =
  ":rb_energy_1:, :rb_exhaust:: Buff a friendly unit. (If it doesn't have a buff, " +
  "it gets a +1 :rb_might: buff.)";

const [ability] = program.abilities;
const [buffUnit] = ability.body;
const targetSpec = buffUnit.targets[0];

test("ogn-257-298 Blind Monk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-257-298 Blind Monk: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  // Executable per README §2: the cost plan, target Finalize/Resolve, the
  // interpreter and effect.buff are all merged, and the golden executes them.
  // The card-program → ChainDraft adapter is engine wiring (see the todos),
  // matching the merged assembly-rig / grand-duelist precedent.
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-257-298 Blind Monk: 1 Energy + Exhaust activation at Action speed", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 174.8 / 376: Legends can have activated abilities; no [Reaction] is
  // printed, so the ability uses the default Action timing (338.1.a.1).
  assert.equal(ability.timing, "action");
  // 404.1.a / 415.5: “1 Energy, :rb_exhaust:” = 1 Energy + Exhaust me.
  assert.deepEqual(ability.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(ability.restriction, undefined);
});

test("ogn-257-298 Blind Monk: Buff one friendly unit (single target, effect.buff)", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(buffUnit.id, "blind-monk.buff-friendly-unit");
  assert.equal(buffUnit.op, "effect.buff");
  assert.deepEqual(buffUnit.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "friendly-unit" }
  });
  // 355.10: “a friendly unit” is a single chosen target, not a pick.
  assert.deepEqual(targetSpec, {
    id: "friendly-unit",
    filter: { type: "unit", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(buffUnit.picks, undefined);
  assert.equal(buffUnit.linkedTo, undefined);
});

test("ogn-257-298 Blind Monk: the printed cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 3 })
    .unit("monk", { zone: "board", types: ["legend"], controller: "A", exhausted: false })
    .unit("ally", { might: 2 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("monk")) });
  const plan = buildCostPlan(ctx, { id: "blind-monk", cost: ability.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 1);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(ctx.player("A").energy, 2);
  assert.equal(ctx.object(ctx.ref("monk")).exhausted, true);

  // An already exhausted source cannot pay the Exhaust cost (415.4 / 415.1.b).
  const exhausted = world()
    .player("A", { energy: 3 })
    .unit("monk", { zone: "board", types: ["legend"], controller: "A", exhausted: true })
    .build();
  const exhaustedCtx = exhausted.clone({ sourceSnapshot: exhausted.object(exhausted.ref("monk")) });
  assert.throws(
    () => payCostPlan(exhaustedCtx, buildCostPlan(exhaustedCtx, { id: "blind-monk", cost: ability.cost })),
    error => error?.reason === "cannot-pay-cost"
  );
});

test("ogn-257-298 Blind Monk: Buff resolves on the locked friendly unit through the interpreter", () => {
  // The locked target comes from the real TargetPlan surface: the kernel's
  // query/filter spelling is used for the target spec here (the program's
  // "controller" anchor is the RIFT-90 gap), while the instruction body is the
  // program's own data minus nothing — only targets are re-declared because
  // runAbilityBody re-selects targets itself.
  const kernel = world()
    .player("A", { energy: 3 })
    .unit("monk", { zone: "board", types: ["legend"], controller: "A" })
    .unit("ally", { might: 2 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("monk")) });
  ctx.setTargets(targetSpec.id, [ctx.ref("ally")]);
  const body = [{ id: buffUnit.id, op: buffUnit.op, args: buffUnit.args }];
  const outcome = runAbilityBody(body, ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["blind-monk.buff-friendly-unit", "executed"]
  ]);
  assert.equal(ctx.object(ctx.ref("ally")).buffs, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.buffed, [ctx.ref("ally")]);

  // 427.1.c / 702.3.a: an already-buffed unit is still a legal choice but no
  // second Buff is placed; the merged primitive reports negated/skipped.
  const already = world().unit("buffed-ally", { might: 2, buffs: 1 }).build();
  const alreadyCtx = already.clone({ sourceSnapshot: already.object(already.ref("buffed-ally")) });
  alreadyCtx.setTargets(targetSpec.id, [alreadyCtx.ref("buffed-ally")]);
  const noop = runAbilityBody(body, alreadyCtx);
  assert.deepEqual(noop.results.map(result => [result.result.status, result.result.reason]), [
    ["negated", "skipped"]
  ]);
  assert.equal(alreadyCtx.object(alreadyCtx.ref("buffed-ally")).buffs, 1);
});

test("ogn-257-298 Blind Monk: a stale locked target makes the Buff ignored (359.3.e.5–e.7)", () => {
  const kernel = world().unit("ally", { might: 2 }).build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets(targetSpec.id, [stale]);
  const run = runInstruction(
    buff,
    { mode: buffUnit.args.mode.value, target: targetSpec.id },
    { world: kernel }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo(
  "ogn-257-298: resolve the “controller” anchor of the friendly-unit filter against the ability controller in " +
    "the production filter/target pipeline (merged layers/filter.ts only maps self/opponent/any/playerId — RIFT-90)"
);

test.todo(
  "ogn-257-298: wire a CardProgram activated ability into a ChainDraft (cost plan + finalized targets + body) " +
    "and consume the 338.1.a.1 default Action-timing permission (engine play-adapter work, RIFT-89/90)"
);
