// Template execution scenarios: ../templates/play-effect-damage-659.test.mjs.
// Cost/condition execution below proves supported parts, not full card play.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/shimmering-swimmer.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const COST_PICK = "shimmering-swimmer.additional-cost";
const DAMAGE_ID = "shimmering-swimmer.deal-2";
const DAMAGE_TARGET = "shimmering-swimmer.unit";

const [play, ability] = program.abilities;
const [damageInstruction] = ability.body;

test("rad-014-167 Shimmering Swimmer: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-05acd78d132bf8780fd8fba892925f17226694182298a6fdeac69e8a824941e1"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "You may kill a friendly unit or gear as an additional cost to play me.\n" +
      "When you play me, if you paid the additional cost, deal 2 to a unit."
  );
  assert.match(program.judgeReason, /Unsupported play cost field optional/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /card-played/);
  assert.match(program.judgeReason, /计划\/回执/);
  assert.doesNotMatch(program.judgeReason, /没有 paid\/费用结果谓词/);
});

test("rad-014-167: play cost declares the optional kill additional cost via a non-target pick", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body, []);
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.optional, true);
  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "kill");
  // 费用内的对象选择不是目标（355.10.c），所以是 PickSpec 而不是 TargetSpec。
  assert.equal(payment.choice.id, COST_PICK);
  assert.deepEqual(payment.choice.filter, {
    controller: "controller",
    type: ["unit", "gear"],
    zone: "board"
  });
  assert.deepEqual(payment.choice.options, ["friendly-unit-or-gear"]);
  assert.equal(payment.choice.min, 1);
  assert.equal(payment.choice.max, 1);
  assert.equal(payment.choice.selection, "one");
});

test("rad-014-167: 'if you paid the additional cost' is the merged result predicate", () => {
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  assert.equal(damageInstruction.id, DAMAGE_ID);
  assert.equal(damageInstruction.op, "effect.damage");
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(damageInstruction.args.target, { kind: "constant", value: DAMAGE_TARGET });
  // 356.2.b.1: the finalized plan/receipt decides whether the branch runs.
  assert.deepEqual(ability.trigger.condition, {
    kind: "result",
    result: "additional-cost-paid",
    id: COST_PICK
  });
  assert.equal(damageInstruction.condition, undefined, "383.2.a.1 gates the trigger before targets are chosen");
  assert.equal(damageInstruction.targets.length, 1);
  const [spec] = damageInstruction.targets;
  assert.equal(spec.id, DAMAGE_TARGET);
  assert.deepEqual(spec.filter, { zone: "board", type: "unit" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("rad-014-167: the kill additional cost is executable through the real effect.kill primitive", () => {
  const kernel = world()
    .object("friendly-gear", {
      name: "friendly-gear",
      types: ["gear"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      energy: null,
      power: null
    })
    .unit("friendly-unit", { might: 3 })
    .build();
  const run = runInstruction(
    kill,
    { picks: COST_PICK, reason: "additional-cost" },
    { world: kernel, picks: { [COST_PICK]: [kernel.ref("friendly-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  assert.equal(kernel.getObject("friendly-unit").zone, "board");
  assert.deepEqual(run.linked.killed, [{ id: "friendly-gear", zoneEntryId: 1 }]);
});

test("rad-014-167: the damage instruction deals 2 to a locked unit", () => {
  const kernel = world().unit("enemy", { owner: "B", might: 4 }).build();
  const run = runInstruction(
    damage,
    { amount: damageInstruction.args.amount, target: DAMAGE_TARGET },
    { world: kernel, targets: { [DAMAGE_TARGET]: [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.equal(run.linked.dealt, 2);
  assert.equal(run.linked.dealtCount, 1);
});

/** Build a real optional cost plan for this card's declared additional cost. */
function planWithOptionalCost({ selected }) {
  const kernel = world()
    .player("A", { energy: 10, power: ["Fury"] })
    .unit("swimmer", { energy: 3, power: null, might: 3 })
    .object("victim", {
      name: "victim",
      types: ["gear"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      energy: null,
      power: null
    })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  const pickId = "swimmer:cost:pick:" + COST_PICK;
  if (selected) kernel.setAnswers({ [pickId]: [kernel.ref("victim")] });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("swimmer") });
  const payment = play.cost.payments[0];
  const plan = buildCostPlan(scoped, {
    id: "swimmer:cost",
    cost: { kind: "printed" },
    optionalAdditional: [{
      id: COST_PICK,
      kind: "additional",
      selected,
      cost: {
        payments: [{
          kind: payment.kind,
          choice: { ...payment.choice, options: [kernel.ref("victim")] }
        }]
      }
    }]
  });
  const receipt = payCostPlan(scoped, plan);
  return { kernel, scoped, plan, receipt };
}

function paidConditionValue({ plan, receipt, scoped }) {
  return evaluateCondition(ability.trigger.condition, {
    context: scoped,
    cost: { plan, receipt },
    linked: (key) => scoped.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  });
}

test("rad-014-167: paying the optional kill cost really kills the chosen gear and opens the damage branch", () => {
  const { kernel, scoped, plan, receipt } = planWithOptionalCost({ selected: true });
  assert.deepEqual(plan.selectedAdditional, [{ id: COST_PICK, kind: "additional" }]);
  assert.equal(receipt.paid, true);
  assert.equal(plan.printed.power, null);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(receipt.additional, [{ id: COST_PICK, kind: "additional", paid: true }]);
  assert.equal(scoped.getObject("victim").zone, "trash");
  assert.equal(kernel.getObject("victim").zone, "board", "the reference kernel clone owns the payment");
  assert.equal(paidConditionValue({ plan, receipt, scoped }), true);
});

test("rad-014-167: declining the optional cost leaves the gear alive and closes the damage branch", () => {
  const { kernel, scoped, plan, receipt } = planWithOptionalCost({ selected: false });
  assert.deepEqual(plan.selectedAdditional, []);
  assert.deepEqual(plan.declinedAdditional, [COST_PICK]);
  assert.equal(scoped.getObject("victim").zone, "board");
  assert.equal(kernel.getObject("victim").zone, "board");
  assert.equal(paidConditionValue({ plan, receipt, scoped }), false);
});

test("rad-014-167: the paid-cost predicate gates the trigger, whose original body deals 2", () => {
  const declined = planWithOptionalCost({ selected: false });
  assert.equal(paidConditionValue(declined), false);
  assert.equal(declined.scoped.getObject("enemy").damage, 0);
  assert.equal(declined.kernel.getObject("victim").damage, 0);

  // A supported-body probe, not a substitute for the missing trigger receipt
  // bridge: test the exact trigger predicate against real payment receipts.
  const paid = planWithOptionalCost({ selected: true });
  assert.equal(paidConditionValue(paid), true);
  paid.scoped.setTargets(DAMAGE_TARGET, [paid.scoped.ref("enemy")]);
  const executed = resolveChainBody(ability.body, paid.scoped);
  assert.equal(executed.results[0].result.status, "executed");
  assert.equal(paid.scoped.getObject("enemy").damage, 2);
});

test("rad-014-167: production play binding exposes the declared additional cost", () => {
  // The card stays judge-required until programs/play.ts translates
  // CostSpec kind:"additional" into CostPlanInput.optionalAdditional. The
  // shipped program is lifted in memory only to drive the real binding.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const kernel = world()
    .card("swimmer", { cardId: program.canonicalCardId, types: ["unit"], energy: 3, power: null, might: 3, zone: "hand" })
    .build();
  const draft = binding.describePlay(
    { type: "play", object: kernel.ref("swimmer"), player: "A" },
    kernel.getObject("swimmer")
  );
  assert.deepEqual(draft.cost.optionalAdditional.map(option => option.kind), ["additional"]);
  assert.deepEqual(draft.cost.optionalAdditional[0].cost.payments.map(payment => payment.kind), ["kill"]);
});

test.todo(
  "rad-014-167 Shimmering Swimmer: 可选附加费用的打出翻译桥——buildCostPlan 已支持 optionalAdditional 且 kill 付款已可支付，" +
    "但 programs/play.ts 的 translateCost 拒绝 optional 附加费用，且 card-played 触发项未携带原打出付款结果"
);
