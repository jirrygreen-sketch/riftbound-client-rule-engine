// Golden test for Zaun Punk (sfd-160-221).
//
// status = judge-required (see the program's judgeReason). The merged cost
// layer can plan and pay the declared kill charge when the caller passes it
// (cost/cost-plan.ts optionalAdditional + cost/plan-values.ts "kill"), and the
// merged effect.kill primitive kills the locked gear. What is missing is the
// CardProgram -> CostPlanInput wiring, the runtime resolution of the
// "dynamic:friendly-gear" option list, and the 356.4.f.1 paid receipt that must
// gate the second ability.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/zaun-punk.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CARD_ID = "card.hash-5433b0927a4bc2a2f4e5d52590d57b1bec38882780434c5aed6ac38f5eb85c16";
const SOURCE_TEXT =
  "You may kill a friendly gear as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, kill a gear.";

const [costAbility, playTrigger] = program.abilities;
const [killInstruction] = playTrigger.body;

function punkWorld() {
  const base = world()
    .player("A", { energy: 5 })
    .unit("punk", { cardId: CARD_ID, zone: "board", energy: 3, power: null, owner: "A", controller: "A" })
    .unit("friendly-gear", { zone: "board", types: ["gear"], owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("enemy-gear", { zone: "board", types: ["gear"], owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .build();
  return base.clone({ source: base.ref("punk"), sourceSnapshot: base.getObject("punk") });
}

test("sfd-160-221 Zaun Punk: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-160-221 Zaun Punk: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README §2: name the current production gaps and the governing rules.
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /static cost\.additional/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /CostPlanInput/);
  assert.match(program.judgeReason, /dynamic:friendly-gear/);
  assert.match(program.judgeReason, /condition\.result/);
  // The stale "no consumer reads a program cost" claim is gone: the cost
  // planner and its kill shape are merged, only the three named links are open.
  assert.match(program.judgeReason, /cost\/plan-values\.ts/);
});

test("sfd-160-221 Zaun Punk: optional additional cost kills one friendly gear", () => {
  // 356.2.b / 356.2.b.1: Optional Additional Cost imposed by a passive ability
  // of the card being played; the merge is a cost component (355.10.c), never a
  // target choice.
  assert.equal(costAbility.kind, "static");
  assert.equal(costAbility.effect.kind, "cost.additional");
  assert.equal(costAbility.effect.id, "zaun-punk.additional-cost");
  assert.equal(costAbility.effect.appliesTo, "self");
  assert.equal(costAbility.effect.optional, true);
  assert.equal(costAbility.effect.stage, "optional-additional");
  assert.equal(costAbility.effect.payments.length, 1);
  const [payment] = costAbility.effect.payments;
  assert.equal(payment.kind, "kill");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.equal(payment.choice.id, "zaun-punk.friendly-gear");
  assert.equal(payment.choice.selection, "one");
  assert.equal(payment.choice.filter.type, "gear");
  assert.equal(payment.choice.filter.controller, "controller");
});

test("sfd-160-221 Zaun Punk: the merged program binding registers the self card-played trigger", () => {
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const kernel = world().unit("punk", {
    cardId: CARD_ID,
    types: ["unit"],
    owner: "A",
    controller: "A",
    zone: "board"
  }).build();
  const [registration] = triggerRegistrations(registry, kernel.getObject("punk"));
  assert.equal(registration.spec.at, "card-played");
  assert.deepEqual(registration.spec.filter, {
    event: "card-played",
    object: { objectId: "punk" }
  });
});

test("sfd-160-221 Zaun Punk: the production play path still does not consume the declared static cost", () => {
  // Evidence for gap (1): the merged program-bound play draft carries no cost
  // at all for this card, because describePlay only reads a PlayAbility's own
  // cost and this card declares its additional cost through a static ability.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = punkWorld();
  const draft = binding.describePlay(
    { type: "play", player: "A", object: kernel.ref("punk") },
    kernel.getObject("punk")
  );
  assert.equal(draft.cost, undefined);
  assert.deepEqual(draft.body, []);
});

test("sfd-160-221 Zaun Punk: card-played self trigger kills one gear", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(killInstruction.id, "zaun-punk.kill-gear");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, {
    kind: "constant",
    value: "zaun-punk.gear"
  });
  // 429.6 / 355.10.a: "kill a gear" is a target; the ceiling is not qualified
  // as friendly, so both controllers' gears are legal candidates.
  assert.deepEqual(killInstruction.targets, [
    {
      id: "zaun-punk.gear",
      filter: { type: "gear", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(killInstruction.linkedTo, undefined);
});

test("sfd-160-221 Zaun Punk: the merged kill primitive kills a gear at its location", () => {
  const kernel = world()
    .unit("punk", { zone: "board" })
    .player("A")
    .unit("friendly-gear", { zone: "board", types: ["gear"], location: { type: "base", player: "A" } })
    .player("B")
    .unit("enemy-gear", { zone: "board", types: ["gear"], owner: "B", controller: "B" })
    .build();
  const run = runInstruction(
    kill,
    { target: "zaun-punk.gear" },
    { world: kernel, targets: { "zaun-punk.gear": [kernel.ref("enemy-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [{ id: "enemy-gear", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
});

test("sfd-160-221 Zaun Punk: the declared payment executes through the merged cost plan (kill a friendly gear)", () => {
  // 356.2.b/356.2.b.1 + 357.1/.2: the charge is a cost component, paid by the
  // controller; 355.10.c keeps it out of the target set. The card's declared
  // payment shape is what the golden charges here, so the open links are the
  // CardProgram -> CostPlanInput wiring and the placeholder resolution.
  const kernel = punkWorld();
  const friendlyGear = kernel.ref("friendly-gear");
  kernel.setPicks("zaun-punk.friendly-gear", [friendlyGear]);

  const [payment] = costAbility.effect.payments;
  // The card declares its candidate options with a dynamic placeholder
  // ("dynamic:friendly-gear"); the merged cost layer resolves choice options
  // into runtime ObjectRefs, so the caller supplies the resolved option set for
  // the locked pick. Producing that resolution from a card program is gap (2).
  const resolvedPayment = {
    ...payment,
    choice: { ...payment.choice, options: [friendlyGear] }
  };
  const plan = buildCostPlan(kernel, {
    id: "cost:zaun-punk",
    cost: { energy: { kind: "constant", value: 3 } },
    optionalAdditional: [
      {
        id: costAbility.effect.id,
        kind: "additional",
        selected: true,
        cost: { payments: [resolvedPayment] }
      }
    ]
  });
  assert.deepEqual(plan.selectedAdditional, [{ id: "zaun-punk.additional-cost", kind: "additional" }]);
  assert.deepEqual(plan.total.energy, 3);
  assert.deepEqual(plan.total.actions.map(entry => [entry.componentId, entry.action.type]), [
    ["zaun-punk.additional-cost", "kill"]
  ]);
  assert.deepEqual(plan.total.actions[0].action.object, friendlyGear);

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  // 356.4.f.1's receipt records the paid decision per selected component.
  assert.deepEqual(receipt.additional, [{ id: "zaun-punk.additional-cost", kind: "additional", paid: true }]);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "kill"]);
  assert.deepEqual(receipt.events.map(event => event.action), ["pay", "kill"]);
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
});

test("sfd-160-221 Zaun Punk: the declared placeholder options cannot be charged as written", () => {
  // Evidence for gap (2): the merged planner requires exact runtime ObjectRefs,
  // so the static declaration's "dynamic:friendly-gear" option list is rejected
  // instead of silently selecting (or skipping) the cost.
  const kernel = punkWorld();
  const [payment] = costAbility.effect.payments;
  assert.deepEqual(payment.choice.options, ["dynamic:friendly-gear"]);
  assert.throws(
    () => buildCostPlan(kernel, {
      id: "cost:zaun-punk-raw",
      cost: { energy: { kind: "constant", value: 3 } },
      optionalAdditional: [
        {
          id: costAbility.effect.id,
          kind: "additional",
          selected: true,
          cost: { payments: [payment] }
        }
      ]
    }),
    /Cost requires an exact object reference/
  );
});

test("sfd-160-221 Zaun Punk: declining the optional cost pays only the base cost", () => {
  // 355.1.a: the controller declares the optional cost; declining skips the
  // component (plan.declinedAdditional) and leaves every gear on the Board.
  const kernel = punkWorld();
  const [payment] = costAbility.effect.payments;
  const plan = buildCostPlan(kernel, {
    id: "cost:zaun-punk",
    cost: { energy: { kind: "constant", value: 3 } },
    optionalAdditional: [
      {
        id: costAbility.effect.id,
        kind: "additional",
        selected: false,
        cost: { payments: [payment] }
      }
    ]
  });
  assert.deepEqual(plan.selectedAdditional, []);
  assert.deepEqual(plan.declinedAdditional, ["zaun-punk.additional-cost"]);
  assert.deepEqual(plan.total.actions, []);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.additional, []);
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
});

test("sfd-160-221 Zaun Punk: the frozen Condition vocabulary has no cost-result predicate", () => {
  // Evidence for gap (3): the IR's closed Condition kind set cannot express
  // "if you paid the additional cost" (356.4.f.1). Asking the validator to
  // accept a cost-result gate is rejected outright, which is why the shipped
  // program keeps an ungated body instead of fabricating an always-true
  // condition.
  const gated = {
    ...program,
    abilities: [
      costAbility,
      {
        ...playTrigger,
        trigger: {
          ...playTrigger.trigger,
          condition: { kind: "result", result: "cost.paid", id: "zaun-punk.additional-cost" }
        }
      }
    ]
  };
  const result = validateCardProgram(gated);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(issue => issue.code === "invalid-condition-kind"),
    JSON.stringify(result.issues)
  );
  // The shipped program is ungated, not gated by a fabricated truthy condition.
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(killInstruction.condition, undefined);
});

test.todo(
  "sfd-160-221 Zaun Punk: charge the declared optional additional cost through the play procedure and gate the " +
    "kill on the 356.4.f.1 paid receipt — the production play path still does not consume static cost.additional " +
    "into CostPlanInput or resolve dynamic:friendly-gear, and the frozen Condition has no cost-result binding " +
    "(condition.result), so the second ability cannot be gated on 'if you paid the additional cost'"
);
