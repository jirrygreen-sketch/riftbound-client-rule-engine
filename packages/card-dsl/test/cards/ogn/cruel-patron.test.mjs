// RIFT-703 execution evidence for the printed play procedure lives in
// test/cards/templates/play-703.test.mjs (parameter row keyed by this
// canonicalCardId). The program stays judge-required: the printed mandatory
// additional kill cost is still unbound by programs/play.ts, which is pinned
// there against the real adapter. Every assertion below is retained.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/cruel-patron.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [payment] = ability.cost.payments;
const constant = value => ({ kind: "constant", value });

function costWorld(energy = 4) {
  const kernel = world()
    .player("A", { energy })
    .hand("patron", {
      cardId: program.canonicalCardId, types: ["unit"], energy: 4, power: null, might: 6
    })
    .unit("fodder", { owner: "B", controller: "A" })
    .unit("spare", { owner: "A" })
    .unit("enemy", { owner: "B" })
    .hand("off-board", { types: ["unit"] })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("patron") });
}

// Exercise only the merged cost layer: its caller supplies exact runtime refs.
// This does not implement the missing CardProgram -> mandatoryAdditional or
// descriptor -> legal options adapters, and does not play the card.
function boundCostArgs(kernel, optionIds = ["fodder", "spare"]) {
  return {
    id: "cruel-patron.cost",
    cost: { kind: "printed" },
    mandatoryAdditional: [{
      id: "cruel-patron.kill",
      cost: {
        payments: [{
          ...payment,
          choice: { ...payment.choice, options: optionIds.map(id => kernel.ref(id)) }
        }]
      }
    }]
  };
}

function lockCost(kernel, args = boundCostArgs(kernel), selected = "fodder") {
  const run = runInstruction(costModify, args, {
    world: kernel, picks: { [payment.choice.id]: [kernel.ref(selected)] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events, []);
  return run.linked.cost;
}

test("ogn-208-298 Cruel Patron: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-ea1f0540f042966387899650fa2fbb3646f2d1d8ad7264dd83eb0fee4bd953de"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /programs\/play\.ts.*translateCost/);
  assert.match(program.judgeReason, /CostPlanInput\.mandatoryAdditional/);
  assert.match(program.judgeReason, /choiceObjects.*PickSpec\.options.*ObjectRef/);
  assert.match(program.judgeReason, /355\.10\.c/);
  assert.match(program.judgeReason, /356\.2\.a\.1 \/ 357\.2/);
  assert.match(program.judgeReason, /cost kind|additional/);
  assert.equal(
    program.sourceText,
    "As an additional cost to play me, kill a friendly unit."
  );
});

test("ogn-208-298 Cruel Patron: a mandatory additional kill cost on the play ability with an empty body", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "play");
  assert.equal(ability.restriction, undefined);
  assert.equal(ability.requirements, undefined);
  // The printed ability is a cost, not an effect: nothing resolves after the
  // card is played.
  assert.deepEqual(ability.body, []);

  // CR 356 / 355.10.c: the kill is an additional cost; its object selection is a
  // non-targeting cost choice (picks do not trigger "becomes a target").
  assert.equal(ability.cost.kind, "additional");
  assert.equal(ability.cost.payments.length, 1);
  const [payment] = ability.cost.payments;
  assert.equal(payment.kind, "kill");
  assert.equal(payment.choice.id, "friendly-unit");
  assert.equal(payment.choice.selection, "one");
  assert.equal(payment.choice.min, 1);
  assert.equal(payment.choice.max, 1);
  assert.deepEqual(payment.choice.options, ["friendly-unit-on-board"]);
  // The filter keys describe the legal set ("a friendly unit"); contract 3.6
  // forbids runtime ObjectRefs in static IR, so the engine must expand the
  // option placeholder from these descriptors.
  assert.equal(payment.choice.type, "unit");
  assert.equal(payment.choice.zone, "board");
  assert.equal(payment.choice.controller, "controller");
});

test("ogn-208-298 Cruel Patron: bound cost asks a non-target pick and pays 4 Energy plus one friendly unit (CR 355.10.c / 356.2.a.1 / 357.2)", () => {
  const kernel = costWorld();
  const args = boundCostArgs(kernel);
  const before = kernel.snapshot();
  const pending = runInstruction(costModify, args, { world: kernel });
  assert.equal(pending.result, null);
  assert.deepEqual(pending.asked.request, {
    id: "cruel-patron.cost:pick:friendly-unit",
    type: "select-objects",
    chooser: "A",
    visibility: "chooser-only",
    options: [kernel.ref("fodder"), kernel.ref("spare")],
    min: 1,
    max: 1
  });
  assert.deepEqual(kernel.snapshot(), before);
  assert.equal(kernel.linked("cost"), undefined);

  const chosen = kernel.ref("fodder");
  const planned = runInstruction(costModify, args, {
    world: kernel,
    answers: { [pending.asked.request.id]: [chosen] }
  });
  assert.equal(planned.result.status, "executed");
  assert.equal(planned.asked, null);
  assert.deepEqual(planned.events, []);
  const plan = planned.linked.cost;
  assert.deepEqual(plan.printed, { energy: 4, power: null });
  assert.equal(plan.base.energy, 4);
  assert.deepEqual(plan.base.power, []);
  assert.deepEqual(plan.components.map(component => [component.id, component.stage]), [
    ["base", "base"], ["cruel-patron.kill", "mandatory-additional"]
  ]);
  assert.equal(plan.total.energy, 4);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.total.actions.map(entry => entry.action), [{ type: "kill", object: chosen }]);
  assert.deepEqual(plan.selectedAdditional, []);

  const paid = runInstruction(costPay, { cost: constant(plan) }, { world: kernel });
  assert.equal(paid.result.status, "executed");
  assert.equal(paid.linked.payment.paid, true);
  assert.deepEqual(paid.linked.payment.actions.map(entry => [entry.action.type, entry.status]), [
    ["pay", "done"], ["kill", "done"]
  ]);
  assert.deepEqual(paid.events.map(event => event.action), ["pay", "kill"]);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject("fodder").zone, "trash");
  assert.deepEqual(kernel.objectsInZone("B", "trash").map(ref => ref.id), ["fodder"]);
  assert.equal(kernel.object(chosen), null);
  assert.equal(kernel.getObject("spare").zone, "board");
  assert.equal(kernel.getObject("enemy").zone, "board");
  assert.equal(kernel.getObject("patron").zone, "hand");
  assert.equal(kernel.getObject("patron").power, null);
});

test("ogn-208-298 Cruel Patron: ignoring the printed base cost still requires the bound kill payment (CR 356.1.b.3)", () => {
  const kernel = costWorld(0);
  const args = {
    ...boundCostArgs(kernel),
    baseModifications: [{ kind: "ignore-base", ignore: "resources" }]
  };
  const plan = lockCost(kernel, args);
  assert.deepEqual(plan.printed, { energy: 4, power: null });
  assert.equal(plan.base.energy, 4);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.total.actions.map(entry => entry.action), [
    { type: "kill", object: kernel.ref("fodder") }
  ]);
  const paid = runInstruction(costPay, { cost: constant(plan) }, { world: kernel });
  assert.equal(paid.result.status, "executed");
  assert.equal(paid.linked.payment.paid, true);
  assert.deepEqual(paid.events.map(event => event.action), ["pay", "kill"]);
  assert.equal(kernel.getObject("fodder").zone, "trash");
  assert.equal(kernel.player("A").energy, 0);
});

test("ogn-208-298 Cruel Patron: an unpaid bound cost commits no resources, kill, events or receipt (CR 203.3)", async t => {
  for (const [name, energy, selected] of [
    ["insufficient Energy", 3, "fodder"],
    ["opponent-controlled unit", 4, "enemy"],
    ["unit outside the Board", 4, "off-board"]
  ]) {
    await t.test(name, () => {
      const kernel = costWorld(energy);
      const plan = lockCost(kernel, boundCostArgs(kernel, [selected]), selected);
      const before = kernel.snapshot();
      const links = kernel.linkedSnapshot();
      assert.throws(
        () => runInstruction(costPay, { cost: constant(plan) }, { world: kernel }),
        error => error.reason === "cannot-pay-cost"
      );
      assert.deepEqual(kernel.snapshot(), before);
      assert.deepEqual(kernel.linkedSnapshot(), links);
      assert.equal(kernel.linked("payment"), undefined);
      assert.equal(kernel.player("A").energy, energy);
      assert.equal(kernel.getObject("fodder").zone, "board");
      assert.equal(kernel.getObject("patron").zone, "hand");
      assert.deepEqual(kernel.events, []);
    });
  }
});

test("ogn-208-298 Cruel Patron: no bound friendly-unit candidate prevents planning the mandatory cost", () => {
  const kernel = costWorld();
  const before = kernel.snapshot();
  assert.throws(
    () => runInstruction(costModify, boundCostArgs(kernel, []), { world: kernel }),
    error => error.reason === "invalid-cost-plan"
  );
  assert.deepEqual(kernel.snapshot(), before);
  assert.equal(kernel.linked("cost"), undefined);
  assert.equal(kernel.linked("payment"), undefined);
});

test.todo(
  "ogn-208-298 Cruel Patron: pay the printed 4 energy plus the mandatory kill cost on a friendly unit " +
    "through CardProgram Finalize (CR 356.2.a.1 / 357.2, 203.3 rollback) — " +
    "programs/play.ts 尚未将 additional 绑定为印刷基础费用 + mandatoryAdditional；" +
    "cost/plan-values.ts 尚未将静态费用选择展开并校验为运行时友方 Board 单位选项；费用层执行已覆盖"
);
