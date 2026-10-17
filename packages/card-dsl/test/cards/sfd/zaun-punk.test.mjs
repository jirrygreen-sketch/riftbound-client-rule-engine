// Golden test for Zaun Punk (sfd-160-221).
//
// status = judge-required (see the program's judgeReason). Three links are
// still open:
//   (1) no merged consumer turns the card's static cost.additional declaration
//       into CostPlanInput / a trigger cost;
//   (2) the "dynamic:friendly-gear" option placeholder is never resolved to the
//       exact runtime ObjectRefs cost/plan-values.ts requires;
//   (3) the finalized { plan, receipt } of the played card never reaches the
//       card-played trigger's condition evaluation, so the real wave throws
//       MissingInformation (asserted below).
// The merged parts are exercised for real: the result predicate reads a genuine
// buildCostPlan/payCostPlan receipt and gates the merged effect.kill primitive;
// the declared kill charge is really planned and paid with a Finalize-locked
// friendly-gear pick; declining leaves every gear on the Board.
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
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { MissingInformation } from "../../../../engine-core/dist/effects/interpreter/values.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CARD_ID = "card.hash-5433b0927a4bc2a2f4e5d52590d57b1bec38882780434c5aed6ac38f5eb85c16";
const SOURCE_TEXT =
  "You may kill a friendly gear as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, kill a gear.";

const constant = value => ({ kind: "constant", value });
const PENALTY_CONDITION = {
  kind: "result",
  result: "additional-cost-paid",
  id: "zaun-punk.additional-cost"
};

const [costAbility, playTrigger] = program.abilities;
const [killInstruction] = playTrigger.body;
const [payment] = costAbility.effect.payments;

/** Only the shipped status blocks the registry; IR and filters under test are shipped. */
const executablePunk = { ...program, status: "executable", judgeReason: undefined };

function punkWorld() {
  const base = world()
    .player("A", { energy: 5 })
    .unit("punk", { cardId: CARD_ID, zone: "board", energy: 3, power: null, owner: "A", controller: "A" })
    .unit("friendly-gear", { zone: "board", types: ["gear"], owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("enemy-gear", { zone: "board", types: ["gear"], owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .build();
  return base.clone({ source: base.ref("punk"), sourceSnapshot: base.getObject("punk") });
}

/** Resolve the card's declared kill charge through the merged cost layer for real. */
function payDeclaredAdditional(selected) {
  const kernel = punkWorld();
  const friendlyGear = kernel.ref("friendly-gear");
  kernel.setPicks("zaun-punk.friendly-gear", [friendlyGear]);
  const resolvedPayment = {
    ...payment,
    choice: { ...payment.choice, options: [friendlyGear] }
  };
  const plan = buildCostPlan(kernel, {
    id: "cost:zaun-punk",
    cost: { energy: constant(3) },
    optionalAdditional: [
      {
        id: costAbility.effect.id,
        kind: "additional",
        selected,
        cost: { payments: [resolvedPayment] }
      }
    ]
  });
  return { kernel, plan, friendlyGear, receipt: payCostPlan(kernel, plan) };
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
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /static cost\.additional/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /CostPlanInput/);
  assert.match(program.judgeReason, /dynamic:friendly-gear/);
  assert.match(program.judgeReason, /result 谓词/);
  assert.match(program.judgeReason, /cost\/plan-values\.ts/);
  assert.match(program.judgeReason, /item\.payment/);
  assert.match(program.judgeReason, /MissingInformation/);
  // The stale "the frozen Condition has no cost-result predicate" claim is gone:
  // RIFT-359 merged the `result` condition and the probe below proves it reads a
  // real receipt, so only the three named wiring links remain.
  assert.doesNotMatch(program.judgeReason, /Condition 只有 always/);
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
  assert.equal(payment.kind, "kill");
  assert.deepEqual(payment.amount, constant(1));
  assert.equal(payment.choice.id, "zaun-punk.friendly-gear");
  assert.equal(payment.choice.selection, "one");
  assert.equal(payment.choice.filter.type, "gear");
  assert.equal(payment.choice.filter.controller, "controller");
});

test("sfd-160-221 Zaun Punk: the production binding registers the self card-played trigger with the paid-receipt condition", () => {
  // 383.4.a Play Effect + 383.2.a.1: "if you paid the additional cost" is part of
  // the Trigger Condition, so it is a real TriggerSpec.condition (356.4.f.1).
  const registry = new ProgramRegistry([executablePunk]);
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
  assert.deepEqual(registration.spec.condition, PENALTY_CONDITION);
  assert.deepEqual(registration.body.map(instruction => instruction.id), ["zaun-punk.kill-gear"]);
});

test("sfd-160-221 Zaun Punk: the production play path still does not consume the declared static cost", () => {
  // Evidence for gap (1): the merged program-bound play draft carries no cost
  // at all for this card, because describePlay only reads a PlayAbility's own
  // cost and this card declares its additional cost through a static ability.
  const binding = createProgramBinding({ cardPrograms: [executablePunk] });
  const kernel = punkWorld();
  const draft = binding.describePlay(
    { type: "play", player: "A", object: kernel.ref("punk") },
    kernel.getObject("punk")
  );
  assert.equal(draft.cost, undefined);
  assert.deepEqual(draft.body, []);

  // The two merged adapters that would have to carry the declaration both
  // reject the authored shape instead of approximating it.
  assert.throws(
    () => translateCost({ kind: "additional", payments: [] }, "zaun-punk", "play"),
    /Additional costs are not bound/
  );
  assert.throws(
    () => translateCost({ kind: "explicit", optional: true, payments: [] }, "zaun-punk", "play"),
    /Unsupported play cost field optional/
  );
  const kernel2 = punkWorld();
  const host = {
    checkpoint: () => null,
    restore: () => {},
    execute: () => ({ outcome: { status: "done", events: [] }, emissions: [] }),
    context: () => ({}),
    objects: () => kernel2.objects,
    choose: () => true
  };
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(costAbility, kernel2.getObject("punk")),
    /Static ability kind cost\.additional has no layer mapping/
  );
});

test("sfd-160-221 Zaun Punk: card-played self trigger targets any gear for the kill", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.deepEqual(playTrigger.trigger.condition, PENALTY_CONDITION);
  assert.equal(killInstruction.id, "zaun-punk.kill-gear");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, constant("zaun-punk.gear"));
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
  assert.equal(killInstruction.condition, undefined);
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
  const { kernel, plan, friendlyGear, receipt } = payDeclaredAdditional(true);
  assert.deepEqual(plan.selectedAdditional, [{ id: "zaun-punk.additional-cost", kind: "additional" }]);
  assert.deepEqual(plan.total.energy, 3);
  assert.deepEqual(plan.total.actions.map(entry => [entry.componentId, entry.action.type]), [
    ["zaun-punk.additional-cost", "kill"]
  ]);
  assert.deepEqual(plan.total.actions[0].action.object, friendlyGear);
  assert.equal(receipt.paid, true);
  // 356.4.f.1's receipt records the paid decision per selected component.
  assert.deepEqual(receipt.additional, [{ id: "zaun-punk.additional-cost", kind: "additional", paid: true }]);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "kill"]);
  assert.deepEqual(receipt.events.map(event => event.action), ["pay", "kill"]);
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
});

test("sfd-160-221 Zaun Punk golden: the merged result predicate reads the paid receipt and the kill really executes", () => {
  // 356.4.f.1 + 383.2.a.1: the predicate reads the finalized { plan, receipt }
  // pair supplied as Resolve cost inputs, and the merged effect.kill really runs
  // against the Finalize-locked gear once the decision to pay was made. The
  // declined branch is a false predicate (below); the trigger's own Resolve
  // inputs never receive the receipt yet, which is gap (3).
  const paid = payDeclaredAdditional(true);
  const paidEnvironment = {
    context: paid.kernel,
    event: { timingPoint: "card-played" },
    cost: { plan: paid.plan, receipt: paid.receipt },
    linked: key => paid.kernel.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.equal(evaluateCondition(PENALTY_CONDITION, paidEnvironment), true);
  paid.kernel.setTargets("zaun-punk.gear", [paid.kernel.ref("enemy-gear")]);
  const executed = resolveChainBody([killInstruction], paid.kernel, {
    cost: { plan: paid.plan, receipt: paid.receipt }
  });
  assert.deepEqual(executed.results.map(entry => [entry.result.status, entry.result.reason]), [
    ["executed", undefined]
  ]);
  assert.equal(paid.kernel.getObject("enemy-gear").zone, "trash");

  // 356.4.f.1: declining the decision is a false predicate even though the base
  // cost was paid in full, and the gear stays on the Board.
  const declined = payDeclaredAdditional(false);
  const declinedEnvironment = {
    ...paidEnvironment,
    context: declined.kernel,
    cost: { plan: declined.plan, receipt: declined.receipt }
  };
  assert.equal(evaluateCondition(PENALTY_CONDITION, declinedEnvironment), false);
  assert.equal(declined.kernel.getObject("enemy-gear").zone, "board");
});

test("sfd-160-221 Zaun Punk: the result predicate's truth is the pay decision, not the amount paid (356.4.f.1)", () => {
  const kernel = punkWorld();
  const environment = cost => ({
    context: kernel,
    event: { timingPoint: "card-played" },
    cost,
    linked: key => kernel.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  });
  assert.equal(evaluateCondition(PENALTY_CONDITION, environment({
    plan: { components: [{ id: "zaun-punk.additional-cost", stage: "optional-additional" }], selectedAdditional: [{ id: "zaun-punk.additional-cost", kind: "additional" }], declinedAdditional: [] },
    receipt: { paid: true, additional: [{ id: "zaun-punk.additional-cost", kind: "additional", paid: true }] }
  })), true);
  // 356.4.f.1: an explicitly declined optional cost is false even though the
  // base cost was still paid in full.
  assert.equal(evaluateCondition(PENALTY_CONDITION, environment({
    plan: { components: [{ id: "zaun-punk.additional-cost", stage: "optional-additional" }], selectedAdditional: [], declinedAdditional: ["zaun-punk.additional-cost"] },
    receipt: { paid: true, additional: [] }
  })), false);
});

test("sfd-160-221 Zaun Punk: the declared placeholder options cannot be charged as written", () => {
  // Evidence for gap (2): the merged planner requires exact runtime ObjectRefs,
  // so the static declaration's "dynamic:friendly-gear" option list is rejected
  // instead of silently selecting (or skipping) the cost.
  const kernel = punkWorld();
  assert.deepEqual(payment.choice.options, ["dynamic:friendly-gear"]);
  assert.throws(
    () => buildCostPlan(kernel, {
      id: "cost:zaun-punk-raw",
      cost: { energy: constant(3) },
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
  const { kernel, plan, receipt } = payDeclaredAdditional(false);
  assert.deepEqual(plan.selectedAdditional, []);
  assert.deepEqual(plan.declinedAdditional, ["zaun-punk.additional-cost"]);
  assert.deepEqual(plan.total.actions, []);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.additional, []);
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
});

test("sfd-160-221 Zaun Punk: the real card-played wave has no receipt, so the trigger aborts and the play rolls back (current gap)", () => {
  // Evidence for gap (3): the merged pipeline evaluates the registration the
  // production adapter builds, but a real card-played emission carries no cost
  // inputs, so the result predicate raises MissingInformation and the Finalize
  // transaction rolls the play back (card stays in hand, no kill happens).
  const kernel = world()
    .player("A", { energy: 5 })
    .player("B", { energy: 5 })
    .hand("punk", { cardId: CARD_ID, types: ["unit"], energy: 3, power: null, might: 3, owner: "A" })
    .unit("friendly-gear", { zone: "board", types: ["gear"], owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("enemy-gear", { zone: "board", types: ["gear"], owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .build();
  const choose = request => {
    if (request.type === "select-objects") return request.options.slice(0, request.min);
    throw new Error(`Unexpected choose ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [executablePunk] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine);
  kernel.setPicks("zaun-punk.friendly-gear", [kernel.ref("friendly-gear")]);
  kernel.setTargets("zaun-punk.gear", [kernel.ref("enemy-gear")]);

  // The play body does not carry the declared optional cost yet (gap 1), so a
  // caller-supplied locked plan is the only way to reach the trigger wave at
  // all; the wave then fails on the missing receipt (gap 3).
  const base = binding.describePlay({ type: "play", object: kernel.ref("punk"), player: "A" }, kernel.getObject("punk"));
  const locked = {
    ...base,
    cost: {
      id: "cost:play:punk",
      cost: { kind: "explicit", energy: constant(3) },
      optionalAdditional: [
        {
          id: costAbility.effect.id,
          kind: "additional",
          selected: true,
          cost: {
            payments: [
              {
                ...payment,
                choice: { ...payment.choice, options: [kernel.ref("friendly-gear")] }
              }
            ]
          }
        }
      ]
    }
  };
  assert.throws(
    () => {
      engine.execute(locked);
      let count = 0;
      while (engine.items.length) {
        if (++count > 30) throw new Error("Nonterminating chain");
        engine.pass(engine.priority);
      }
    },
    error => error instanceof MissingInformation && /Unavailable condition result/.test(error.message)
  );
  assert.equal(kernel.getObject("punk").zone, "hand");
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
});

test.todo(
  "sfd-160-221 Zaun Punk: charge the declared optional additional cost through the play procedure and gate the " +
    "kill on the 356.4.f.1 paid receipt — the production play path still does not consume static cost.additional " +
    "into CostPlanInput, never resolves dynamic:friendly-gear into Finalize-locked ObjectRefs, and does not expose " +
    "the played card's receipt to the card-played trigger condition"
);
