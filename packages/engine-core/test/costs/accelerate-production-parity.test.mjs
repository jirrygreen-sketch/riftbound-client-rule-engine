// RIFT-854: the original Fury printings reach the production CardProgram cost
// binding, Finalize transaction and Unit-entry lifecycle. These tests admit the
// shipped IR only in a test registry; the CardProgram itself stays
// judge-required until the production owner closes the remaining gaps.
import assert from "node:assert/strict";
import test from "node:test";
import blazingScorcher from "../../../card-dsl/dist/cards/ogn/blazing-scorcher.js";
import legionRearguard from "../../../card-dsl/dist/cards/ogn/legion-rearguard.js";
import { AwaitChoice } from "../../dist/effects/contract.js";
import { world } from "../../dist/effects/testing/index.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { CostPlanError } from "../../dist/cost/plan-types.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { createProgramBinding } from "../../dist/programs/index.js";

const admitted = program => ({ ...program, status: "executable", judgeReason: undefined });

function scene(program, { energy = 3, power = ["Fury"], invalidateBeforeFinalize = false } = {}) {
  const id = program === legionRearguard ? "ogn-010-298" : "ogn-001-298";
  const printedEnergy = program === legionRearguard ? 2 : 5;
  const kernel = world()
    .player("A", { energy, power })
    .player("B", { energy: 0 })
    .hand(id, {
      cardId: program.canonicalCardId,
      types: ["unit"],
      energy: printedEnergy,
      power: ["Fury"],
      might: program === legionRearguard ? 2 : 5,
    })
    .deck(["A:deck:1"], { owner: "A" })
    .deck(["B:deck:1"], { owner: "B" })
    .build();
  const asked = [];
  const performed = [];
  let decision;
  const choose = request => {
    asked.push(request);
    if (request.type === "optional" && decision !== undefined) return decision;
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => {
      performed.push(action);
      return kernel.perform(action);
    },
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: () => false,
  });
  const binding = createProgramBinding({ cardPrograms: [admitted(program)] });
  let invalidated = false;
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: current => {
      if (!invalidateBeforeFinalize || invalidated) return false;
      const chained = kernel.objects.find(object => object.ref.id === id && object.zone === "chain");
      if (!chained) return false;
      invalidated = true;
      assert.equal(current.commit({ type: "move-zone", object: chained.ref, to: "trash" }).status, "done");
      return true;
    },
    describePlay: binding.describePlay,
  });
  let finalized = null;
  const pipelineOnEvent = engine.pipeline.onEvent;
  engine.pipeline.onEvent = event => {
    pipelineOnEvent?.(event);
    if (event.timingPoint === "chain-item-finalize") {
      const item = engine.items[0];
      finalized = item ? {
        object: item.object,
        targetPlans: item.targetPlans,
        plan: item.costPlan,
        receipt: item.payment,
      } : null;
    }
  };
  const source = kernel.getObject(id);
  const described = binding.describePlay(
    {
      type: "play",
      player: "A",
      object: source.ref,
      location: { type: "base", player: "A" },
    },
    source,
  );
  // Only the trusted catalog base metadata is added here. The optional cost
  // remains exactly the component produced by the default CardProgram binding.
  const draft = {
    ...described,
    cost: {
      ...described.cost,
      printed: {
        id,
        cardType: "Unit",
        domains: ["Fury"],
        energy: printedEnergy,
        power: null,
      },
    },
  };
  return {
    id, source, described, draft, kernel, engine, asked, performed,
    finalized: () => finalized,
    setDecision(value) { decision = value; },
  };
}

test("original Accelerate programs preserve judge-required status and expand to the real optional cost", () => {
  for (const program of [blazingScorcher, legionRearguard]) {
    assert.equal(program.status, "judge-required");
    const f = scene(program, { energy: 20 });
    assert.equal(f.described.cost.cost.kind, "printed");
    assert.deepEqual(f.described.cost.domains, ["Fury"]);
    assert.equal(f.described.cost.optionalAdditional.length, 1);
    assert.equal(f.described.cost.optionalAdditional[0].kind, "accelerate");
    assert.deepEqual(f.described.cost.optionalAdditional[0].cost, {
      payments: [
        { kind: "energy", amount: { kind: "constant", value: 1 } },
        { kind: "power", amount: { kind: "constant", value: 1 } },
      ],
    });
    assert.equal(f.draft.cost.optionalAdditional, f.described.cost.optionalAdditional);
  }
});

test("Legion Rearguard pay/decline use the Finalize choice, exact resources, receipts and entry state", () => {
  const paid = scene(legionRearguard);
  assert.throws(() => paid.engine.execute(paid.draft), AwaitChoice);
  assert.equal(paid.asked.length, 1);
  assert.deepEqual(
    { type: paid.asked[0].type, chooser: paid.asked[0].chooser, visibility: paid.asked[0].visibility },
    { type: "optional", chooser: "A", visibility: "public" },
  );
  assert.equal(paid.source.ref.zoneEntryId, 1);
  assert.equal(paid.kernel.getObject(paid.id).ref.zoneEntryId, 1);
  paid.setDecision(true);
  paid.engine.execute(paid.draft);
  assert.equal(paid.asked.length, 2);
  assert.equal(paid.asked[1].id, paid.asked[0].id);
  assert.equal(paid.kernel.player("A").energy, 0);
  assert.deepEqual(paid.kernel.player("A").power, []);
  assert.equal(paid.kernel.getObject(paid.id).exhausted, false);
  assert.deepEqual(paid.kernel.getObject(paid.id).location, { type: "base", player: "A" });
  assert.deepEqual(paid.performed.filter(action => action.type === "pay"), [{
    type: "pay", player: "A", plan: { finalized: true, energy: 3, power: ["Fury"] },
  }]);
  const paidFinalize = paid.finalized();
  assert.ok(paidFinalize);
  assert.deepEqual(paidFinalize.plan.source, paid.source.ref);
  assert.deepEqual(paidFinalize.object, { id: paid.source.ref.id, zoneEntryId: paid.source.ref.zoneEntryId + 1 });
  assert.deepEqual(paidFinalize.targetPlans, [], "the original Accelerate units have no TargetSpec");
  assert.deepEqual(paidFinalize.plan.selectedAdditional, [{
    id: paid.described.cost.optionalAdditional[0].id, kind: "accelerate",
  }]);
  assert.deepEqual(paidFinalize.plan.declinedAdditional, []);
  assert.deepEqual(paidFinalize.plan.total, {
    energy: 3,
    power: [{ allowedDomains: ["Fury"], amount: 1 }],
    xp: 0,
    actions: [],
  });
  assert.deepEqual(paidFinalize.receipt, {
    planId: paidFinalize.plan.id,
    player: "A",
    paid: true,
    total: paidFinalize.plan.total,
    power: { power: [{ requirementIndex: 0, from: "Fury", amount: 1 }] },
    additional: [{ id: paid.described.cost.optionalAdditional[0].id, kind: "accelerate", paid: true }],
    actions: [{
      id: `${paidFinalize.plan.id}:resources`,
      action: { type: "pay", player: "A", plan: { finalized: true, energy: 3, power: ["Fury"] } },
      status: "done",
    }],
    events: [{
      type: "task-resolved",
      seq: 2,
      turnNumber: 1,
      activePlayerId: "A",
      taskId: "effect:pay:2",
      sourceCardId: "test-kernel",
      reason: "pay",
      autoResolved: true,
      timingPoint: "main-start",
      action: "pay",
      energy: 3,
      power: ["Fury"],
      xp: 0,
    }],
  });
  assert.equal(paid.performed.filter(action => action.type === "ready").length, 1);
  assert.equal(paid.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length, 0);
  assert.equal(paid.engine.pipeline.events.filter(event => event.timingPoint === "object-enters-board").length, 1);

  const declined = scene(legionRearguard);
  assert.throws(() => declined.engine.execute(declined.draft), AwaitChoice);
  declined.setDecision(false);
  declined.engine.execute(declined.draft);
  assert.equal(declined.asked.length, 2);
  assert.equal(declined.asked[1].id, declined.asked[0].id);
  assert.equal(declined.kernel.player("A").energy, 1);
  assert.deepEqual(declined.kernel.player("A").power, ["Fury"]);
  assert.equal(declined.kernel.getObject(declined.id).exhausted, true);
  assert.deepEqual(declined.performed.filter(action => action.type === "pay"), [{
    type: "pay", player: "A", plan: { finalized: true, energy: 2, power: [] },
  }]);
  const declinedFinalize = declined.finalized();
  assert.ok(declinedFinalize);
  assert.deepEqual(declinedFinalize.plan.selectedAdditional, []);
  assert.deepEqual(declinedFinalize.plan.declinedAdditional, [declined.described.cost.optionalAdditional[0].id]);
  assert.deepEqual(declinedFinalize.receipt.total, {
    energy: 2, power: [], xp: 0, actions: [],
  });
  assert.deepEqual(declinedFinalize.receipt.additional, []);
  assert.equal(declined.performed.filter(action => action.type === "exhaust").length, 1);
  assert.equal(declined.performed.filter(action => action.type === "ready").length, 0);
});

test("Blazing Scorcher uses its five-Energy base cost plus the same Fury Accelerate payment", () => {
  const f = scene(blazingScorcher, { energy: 6 });
  assert.throws(() => f.engine.execute(f.draft), AwaitChoice);
  f.setDecision(true);
  f.engine.execute(f.draft);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject(f.id).exhausted, false);
  assert.deepEqual(f.performed.filter(action => action.type === "pay"), [{
    type: "pay", player: "A", plan: { finalized: true, energy: 6, power: ["Fury"] },
  }]);
});

test("insufficient Energy and unmatched Power fail atomically instead of becoming a decline", () => {
  for (const [energy, power] of [[2, ["Fury"]], [3, ["Calm"]]]) {
    const f = scene(legionRearguard, { energy, power });
    assert.throws(() => f.engine.execute(f.draft), AwaitChoice);
    const before = f.kernel.snapshot();
    f.setDecision(true);
    assert.throws(
      () => f.engine.execute(f.draft),
      error => error instanceof CostPlanError && error.reason === "cannot-pay-cost",
    );
    assert.deepEqual(f.kernel.snapshot(), before);
    assert.equal(f.kernel.getObject(f.id).zone, "hand");
    assert.equal(f.kernel.player("A").energy, energy);
    assert.deepEqual(f.kernel.player("A").power, power);
    assert.equal(f.performed.filter(action => action.type === "pay").length, 0);
  }
});

test("declining needs only the printed base cost and remains available without extra Fury Power", () => {
  const f = scene(legionRearguard, { energy: 2, power: [] });
  assert.throws(() => f.engine.execute(f.draft), AwaitChoice);
  f.setDecision(false);
  f.engine.execute(f.draft);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject(f.id).exhausted, true);
  assert.equal(f.kernel.getObject(f.id).zone, "board");
});

test("a reused finalized Play cannot pay or enter twice, and a replaced incarnation stays unpayable", () => {
  const f = scene(legionRearguard);
  assert.throws(() => f.engine.execute(f.draft), AwaitChoice);
  f.setDecision(true);
  f.engine.execute(f.draft);
  const after = f.kernel.snapshot();
  const payments = f.performed.filter(action => action.type === "pay").length;
  assert.throws(() => f.engine.execute(f.draft), /reused chain identity/);
  assert.deepEqual(f.kernel.snapshot(), after);
  assert.equal(f.performed.filter(action => action.type === "pay").length, payments);

  const stale = scene(legionRearguard, { invalidateBeforeFinalize: true });
  const oldRef = stale.source.ref;
  const before = stale.kernel.snapshot();
  stale.setDecision(true);
  assert.throws(() => stale.engine.execute(stale.draft), /no longer its Finalize incarnation|no longer exists/);
  assert.deepEqual(stale.kernel.snapshot(), before);
  assert.equal(stale.performed.filter(action => action.type === "pay").length, 0);
});
