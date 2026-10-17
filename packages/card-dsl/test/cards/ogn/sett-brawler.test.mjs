import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/sett-brawler.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { createLayerEngine, createContinuousEffectRegistry, expireContinuousEffectsAt } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7f8a999072e7b65566be686c006f6ade129a206d08922b9e25ebe2d9167d26ae";
const SOURCE_TEXT =
  "When I'm played and when I conquer, buff me. (If I don't have a buff, I get a +1 :rb_might: buff.)\n" +
  "Spend my buff: Give me +4 :rb_might: this turn.";

const [played, conquered, spendBuff] = program.abilities;

/**
 * The reference kernel binds "self" to the context source (the ability host),
 * so the Sett unit is installed as the source snapshot.
 */
function settWorld({ buffs = 0 } = {}) {
  const kernel = world().unit("sett", { buffs, might: 4 }).build();
  kernel.setTargets("sett.self", [kernel.ref("sett")]);
  Object.defineProperty(kernel, "source", { value: kernel.getObject("sett") });
  return kernel;
}

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The refreshed reason: the +4 Might half now executes (continuous.might,
  // RIFT-258); the remaining gaps are the trigger-binding ones.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-21/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("both buff triggers are mandatory and self-scoped (383.4.a, 471.1/473.2.a)", () => {
  assert.equal(program.abilities.length, 3);

  assert.equal(played.kind, "triggered");
  assert.equal(played.trigger.at, "card-played");
  assert.deepEqual(played.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(played.optional, false);

  assert.equal(conquered.kind, "triggered");
  assert.equal(conquered.trigger.at, "conquer");
  assert.deepEqual(conquered.trigger.filter, { event: "conquer", filter: { source: "self" } });
  assert.equal(conquered.optional, false);

  for (const ability of [played, conquered]) {
    assert.equal(ability.body.length, 1);
    const instruction = ability.body[0];
    assert.equal(instruction.op, "effect.buff");
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "buff" });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: "sett.self" });
    assert.deepEqual(instruction.targets, [
      {
        id: "sett.self",
        filter: { object: "self", type: "unit" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("the third ability is the activated 'spend my buff' with a spend-buff cost and a +4 Might effect", () => {
  assert.equal(spendBuff.kind, "activated");
  assert.equal(spendBuff.timing, "action");
  assert.deepEqual(spendBuff.cost, {
    kind: "activated",
    payments: [
      {
        kind: "spend-buff",
        object: "self",
        amount: { kind: "constant", value: 1 }
      }
    ]
  });
  assert.equal(spendBuff.body.length, 1);
  const [grant] = spendBuff.body;
  assert.equal(grant.id, "sett.grant-might");
  assert.equal(grant.op, "continuous.might");
  assert.deepEqual(grant.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
  // "me" is the ability source, not a chosen target: the primitive's
  // appliesTo "self" selector resolves the effect to the host, so no
  // TargetSpec is authored (355.7).
  assert.deepEqual(grant.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(grant.targets, undefined);
});

test("golden: 'when I'm played, buff me' adds exactly one Buff counter (702.2.a/702.3)", () => {
  const kernel = settWorld({ buffs: 0 });
  const outcome = resolveChainBody(played.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("sett").buffs, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["buff"]);
});

test("golden: a second buff on an already-buffed Sett is not placed (702.3.a)", () => {
  const kernel = settWorld({ buffs: 1 });
  const outcome = resolveChainBody(conquered.body, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("sett").buffs, 1);
});

test("golden: the spend-buff cost pays one Buff through the cost plan (702.2.b)", () => {
  const kernel = settWorld({ buffs: 1 });
  const plan = buildCostPlan(kernel, { id: "sett.spend", cost: spendBuff.cost });
  assert.deepEqual(plan.total.actions.map(entry => entry.action.type), ["spend-buff"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "spend-buff"]);
  assert.equal(kernel.getObject("sett").buffs, 0);
});

test("golden: the cost cannot be paid without a Buff (702.2.b.1)", () => {
  const kernel = settWorld({ buffs: 0 });
  const plan = buildCostPlan(kernel, { id: "sett.spend", cost: spendBuff.cost });
  assert.throws(
    () => payCostPlan(kernel, plan),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost"
  );
  assert.equal(kernel.getObject("sett").buffs, 0);
});

test("golden: the activated +4 Might registers an end-of-turn arithmetic effect on the source and expires at turn-end", () => {
  const kernel = settWorld({ buffs: 1 });
  const outcome = resolveChainBody(spendBuff.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["sett.grant-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478 / 478.1.a: Might modifications live in the arithmetic layer; the
  // end-of-turn duration ("this turn") is resolved to the turn-end window.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 4);
  assert.equal(registration.effect.filter.objectId, "sett");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // The layer engine applies the +4 on top of the printed Might. CR 703 notes
  // a Buff contributes its own +1 Might as a layers derivation; the merged
  // layers/engine.ts moves only the Buff counter, so this assertion pins the
  // modification itself (4 -> 8) rather than the separate 703 derivation.
  const registrations = kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));
  assert.equal(createLayerEngine(kernel.objects, registrations).evaluate(kernel.ref("sett")).might, 8);

  // Expiry: the effect is gone at turn-end, so the Might returns to printed.
  const registry = createContinuousEffectRegistry(registrations);
  assert.equal(expireContinuousEffectsAt(registry, "turn-end", (ref) => kernel.object(ref)).length, 1);
  assert.equal(createLayerEngine(kernel.objects, registry.list()).evaluate(kernel.ref("sett")).might, 4);
});
test.todo(
  "conquer trigger end-to-end: object-killed/conquer timing subscription with last-known source capture (RIFT-90/820)"
);
