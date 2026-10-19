import assert from "node:assert/strict";
import test from "node:test";

import move from "../../dist/effects/instructions/effect.move.js";
import swap from "../../dist/effects/instructions/effect.swap-location.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { queryMoveDestinations } from "../../dist/target/location/candidates.js";
import { createLayerEngine } from "../../dist/layers/engine.js";
import { AwaitChoice, cardProgram, createProgramBinding, fixture as programFixture, settle } from "../rules/keywords/support.mjs";
import { runInstruction, world } from "../../dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { createContractActionCapability } from "../../dist/events/contract-actions/bridge.js";
import { EventPipeline } from "../../dist/events/pipeline.js";
import { performRecall } from "../../dist/zones/recall.js";
import conscription from "../../../card-dsl/dist/cards/unl/conscription.js";
import glowstone from "../../../card-dsl/dist/cards/ven/glowstone.js";
import smokeAndMirrors from "../../../card-dsl/dist/cards/unl/smoke-and-mirrors.js";

const c = value => ({ kind: "constant", value });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const second = { type: "battlefield", id: "battlefield-2" };
const contested = { type: "battlefield", id: "battlefield-3" };
const base = player => ({ type: "base", player });
const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const recallArgs = (to = "controller-base") => ({
  objects: c({ target: "units" }), to: c(to), mode: c("recall"), linkKey: c("recalled"),
});

function scenario() {
  return withSource(world()
    .unit("hero", { might: 4, damage: 2, exhausted: true, stunned: true, buffs: 1 })
    .unit("anchor", { location: second })
    .unit("enemy", { owner: "B" })
    .hand("kept")
    .build(), "hero");
}

const targets = kernel => ({ units: [kernel.ref("hero")] });

function layeredRecall({ aura = false, keyword = false, persistent = false } = {}) {
  const builder = world().player("A").player("B")
    .unit("hero", {
      might: 2, location: battlefield,
      ...(persistent ? {
        damage: 2, exhausted: true, stunned: true, buffs: 2, energy: null, power: null,
      } : {}),
    })
    .unit("source", { location: battlefield });
  const kernel = builder.build();
  if (persistent) {
    kernel.perform({ type: "empower", object: kernel.ref("hero"), amount: 2 });
    kernel.perform({ type: "add-counter", object: kernel.ref("hero"), counter: "mark", amount: 3 });
  }
  if (aura) kernel.addContinuous({
    id: "battlefield-aura", source: kernel.ref("source"), layer: "arithmetic",
    filter: { objectId: "hero", location: battlefield },
    effect: { kind: "continuous.might", amount: 2 },
  }, { type: "permanent" });
  if (keyword) kernel.addContinuous({
    id: "battlefield-keyword", source: kernel.ref("source"), layer: "ability",
    filter: { objectId: "hero", location: battlefield },
    effect: { kind: "continuous.grant-keyword", keyword: "Assault" },
  }, { type: "permanent" });
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  const object = ref => {
    layers.setObjects(kernel.objects);
    return layers.evaluate(ref);
  };
  const context = overrides => bindResolveContext(kernel, {
    source: kernel.getObject("source"), controller: "A", object,
    contractActions: createContractActionCapability(action => kernel.performContract(action)),
    ...overrides,
  });
  return { kernel, layers, object, context };
}

test("EG-RECALL accepts real LayerEngine snapshots and leaves location-bound derived effects", () => {
  for (const { aura, keyword } of [
    { aura: false, keyword: false }, { aura: true, keyword: false }, { aura: false, keyword: true },
  ]) {
    const { kernel, object, context } = layeredRecall({ aura, keyword });
    const ref = kernel.ref("hero");
    const before = object(ref);
    assert.equal(before.might, aura ? 4 : 2);
    assert.equal(before.keywords.some(item => item.id === "Assault"), keyword);

    const outcome = performRecall(context(), ref);
    const after = object(ref);

    assert.equal(outcome.status, "done");
    assert.equal(outcome.count, 1);
    assert.equal(outcome.receipt.status, "committed");
    assert.deepEqual(outcome.receipt.actions, [{ type: "recall", status: "done" }]);
    assert.equal(outcome.events.length, 1);
    assert.equal(outcome.events[0].action, "recall");
    assert.deepEqual(outcome.events[0].details, { recall: true, from: battlefield, to: base("A") });
    assert.deepEqual(kernel.getObject("hero").ref, ref);
    assert.deepEqual(kernel.getObject("hero").location, base("A"));
    assert.equal(kernel.history({ action: "recall", object: ref }), 1);
    assert.equal(kernel.history({ action: "move-location", object: ref }), 0);
    assert.equal(after.might, 2);
    assert.equal(after.keywords.some(item => item.id === "Assault"), false);
    assert.deepEqual(after.printed.location, base("A"));
    assert.deepEqual(after.location, base("A"));
  }
});

test("EG-RECALL preserves every persistent status and resource through layered recomputation", () => {
  const { kernel, object, context } = layeredRecall({ aura: true, keyword: true, persistent: true });
  const ref = kernel.ref("hero");
  const raw = kernel.getObject("hero");
  assert.deepEqual({
    damage: raw.damage, exhausted: raw.exhausted, stunned: raw.stunned,
    buffs: raw.buffs, empowered: raw.empowered, counters: [...raw.counters],
  }, { damage: 2, exhausted: true, stunned: true, buffs: 2, empowered: 2, counters: [["mark", 3]] });

  const outcome = performRecall(context(), ref);
  const after = kernel.getObject("hero");
  assert.equal(outcome.status, "done");
  assert.equal(outcome.count, 1);
  assert.deepEqual(after.ref, ref);
  assert.equal(after.damage, 2);
  assert.equal(after.exhausted, true);
  assert.equal(after.stunned, true);
  assert.equal(after.buffs, 2);
  assert.equal(after.empowered, 2);
  assert.deepEqual([...after.counters], [["mark", 3]]);
  assert.equal(object(ref).might, 2);
  assert.equal(object(ref).keywords.some(item => item.id === "Assault"), false);
});

test("EG-RECALL restores a failed consumer only through a real transaction boundary", () => {
  const { kernel, context } = layeredRecall({ persistent: true });
  const ref = kernel.ref("hero");
  const checkpoint = kernel.snapshot();
  const before = kernel.stateForTest();
  const invalid = overrides => bindResolveContext(kernel, {
    source: kernel.getObject("source"), controller: "A",
    contractActions: {
      version: "riftbound.contract-actions.v1",
      perform: action => {
        kernel.perform({ type: "move-location", object: action.object, to: base("A") });
        return { status: "impossible", events: [] };
      },
    },
    ...overrides,
  });
  assert.throws(() => performRecall(invalid(), ref), { name: "RecallAtomicityError" });
  assert.deepEqual(kernel.getObject("hero").location, base("A"));
  kernel.restore(checkpoint);
  assert.deepEqual(kernel.stateForTest(), before);

  let calls = 0;
  const transaction = run => {
    calls += 1;
    const state = kernel.snapshot();
    try {
      return run();
    } catch (error) {
      kernel.restore(state);
      throw error;
    }
  };
  const rolledBack = performRecall(invalid({ transaction }), ref);
  assert.equal(calls, 1);
  assert.equal(rolledBack.status, "impossible");
  assert.equal(rolledBack.count, 0);
  assert.deepEqual(rolledBack.events, []);
  assert.match(rolledBack.blockedReason, /changed persistent state/);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.history({ action: "move-location" }), 0);
  assert.equal(kernel.history({ action: "recall" }), 0);
});

test("EG-RECALL never reports impossible after a throwing consumer, and transaction restores its write", () => {
  const { kernel } = layeredRecall({ persistent: true });
  const ref = kernel.ref("hero");
  const checkpoint = kernel.snapshot();
  const consumer = {
    version: "riftbound.contract-actions.v1",
    perform: action => {
      kernel.perform({ type: "move-location", object: action.object, to: base("A") });
      throw new Error("consumer threw after writing");
    },
  };
  const baseContext = { source: kernel.getObject("source"), controller: "A", contractActions: consumer };

  assert.throws(() => performRecall(bindResolveContext(kernel, baseContext), ref), /consumer threw after writing/);
  assert.deepEqual(kernel.getObject("hero").location, base("A"));
  assert.equal(kernel.history({ action: "move-location" }), 1);
  assert.equal(kernel.history({ action: "recall" }), 0);
  kernel.restore(checkpoint);

  const transaction = run => {
    const state = kernel.snapshot();
    try {
      return run();
    } catch (error) {
      kernel.restore(state);
      throw error;
    }
  };
  assert.throws(() => performRecall(bindResolveContext(kernel, { ...baseContext, transaction }), ref),
    /consumer threw after writing/);
  assert.deepEqual(kernel.getObject("hero").location, battlefield);
  assert.equal(kernel.history({ action: "move-location" }), 0);
  assert.equal(kernel.history({ action: "recall" }), 0);
});

test("EG-RECALL keeps unsupported-consumer and invalid-receipt refusals side-effect free", () => {
  const failures = [
    new TypeError("consumer does not support Recall"),
    new Error("Unknown action type: recall before write"),
  ];
  for (const failure of failures) {
    const { kernel } = layeredRecall({ persistent: true });
    const ref = kernel.ref("hero");
    const before = kernel.stateForTest();
    const outcome = performRecall(bindResolveContext(kernel, {
      source: kernel.getObject("source"), controller: "A",
      contractActions: createContractActionCapability(() => { throw failure; }),
    }), ref);
    assert.equal(outcome.status, "impossible");
    assert.equal(outcome.count, 0);
    assert.deepEqual(outcome.events, []);
    assert.match(outcome.blockedReason, /consumer unavailable/);
    assert.deepEqual(kernel.stateForTest(), before);
  }

  const { kernel } = layeredRecall({ persistent: true });
  const ref = kernel.ref("hero");
  const before = kernel.stateForTest();
  const outcome = performRecall(bindResolveContext(kernel, {
    source: kernel.getObject("source"), controller: "A",
    contractActions: createContractActionCapability(() => ({
      status: "done", events: [],
      receipt: { status: "rolled-back", actions: [{ type: "recall", status: "impossible" }] },
    })),
  }), ref);
  assert.equal(outcome.status, "impossible");
  assert.equal(outcome.count, 0);
  assert.deepEqual(outcome.events, []);
  assert.match(outcome.blockedReason, /did not commit a preserved Recall/);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL never hides a committed Recall behind post-write Error, TypeError, or Unknown action", () => {
  const cases = [
    {
      label: "Error",
      error: new Error("consumer failed after authoritative recall"),
      expected: { name: "Error", message: "consumer failed after authoritative recall" },
    },
    {
      label: "TypeError",
      error: new TypeError("consumer failed after authoritative recall"),
      expected: { name: "RecallAtomicityError", message: /changed persistent state/ },
    },
    {
      label: "UnknownActionError",
      error: new Error("Unknown action type: recall after authoritative commit"),
      expected: { name: "RecallAtomicityError", message: /changed persistent state/ },
    },
  ];
  for (const { label, error, expected } of cases) {
    const { kernel } = layeredRecall({ persistent: true });
    const ref = kernel.ref("hero");
    const checkpoint = kernel.snapshot();
    const context = bindResolveContext(kernel, {
      source: kernel.getObject("source"), controller: "A",
      contractActions: createContractActionCapability(action => {
        kernel.performContract(action);
        throw error;
      }),
    });

    assert.throws(() => performRecall(context, ref), expected, label);
    assert.deepEqual(kernel.getObject("hero").ref, ref);
    assert.deepEqual(kernel.getObject("hero").location, base("A"));
    assert.equal(kernel.getObject("hero").damage, 2);
    assert.equal(kernel.getObject("hero").exhausted, true);
    assert.equal(kernel.getObject("hero").stunned, true);
    assert.equal(kernel.getObject("hero").buffs, 2);
    assert.equal(kernel.getObject("hero").empowered, 2);
    assert.deepEqual([...kernel.getObject("hero").counters], [["mark", 3]]);
    assert.equal(kernel.history({ action: "recall", object: ref }), 1);
    assert.equal(kernel.history({ action: "move-location", object: ref }), 0);
    assert.equal(kernel.events.filter(event => event.action === "recall").length, 1);
    kernel.restore(checkpoint);
  }
});

test("EG-RECALL transaction restores a committed Recall after TypeError/Unknown action and permits retry", () => {
  for (const error of [
    new TypeError("consumer failed after authoritative recall"),
    new Error("Unknown action type: recall after authoritative commit"),
  ]) {
    const { kernel } = layeredRecall({ persistent: true });
    const ref = kernel.ref("hero");
    const before = kernel.stateForTest();
    let fail = true;
    const transaction = run => {
      const state = kernel.snapshot();
      const linked = kernel.clone();
      try {
        return run();
      } catch (caught) {
        kernel.restore(state);
        kernel.copyLinkedFrom(linked);
        throw caught;
      }
    };
    const context = bindResolveContext(kernel, {
      source: kernel.getObject("source"), controller: "A", transaction,
      contractActions: createContractActionCapability(action => {
        const outcome = kernel.performContract(action);
        if (fail) {
          fail = false;
          throw error;
        }
        return outcome;
      }),
    });

    const rolledBack = performRecall(context, ref);
    assert.equal(rolledBack.status, "impossible");
    assert.equal(rolledBack.count, 0);
    assert.deepEqual(rolledBack.events, []);
    assert.match(rolledBack.blockedReason, /consumer unavailable/);
    assert.deepEqual(kernel.getObject("hero").location, battlefield);
    assert.equal(kernel.history({ action: "recall" }), 0);
    assert.equal(kernel.history({ action: "move-location" }), 0);
    // TestWorld.snapshot() includes the two setup actions and their events.
    // Those historical observations remain; the failed Recall publishes none.
    assert.deepEqual(kernel.stateForTest(), before);
    assert.equal(kernel.events.filter(event => event.action === "recall").length, 0);

    const retried = performRecall(context, ref);
    assert.equal(retried.status, "done");
    assert.equal(retried.count, 1);
    assert.equal(retried.receipt.status, "committed");
    assert.deepEqual(retried.receipt.actions, [{ type: "recall", status: "done" }]);
    assert.equal(retried.events.length, 1);
    assert.equal(retried.events[0].action, "recall");
    assert.deepEqual(kernel.getObject("hero").location, base("A"));
    assert.deepEqual(kernel.getObject("hero").ref, ref);
    assert.equal(kernel.history({ action: "recall", object: ref }), 1);
    assert.equal(kernel.history({ action: "move-location", object: ref }), 0);
    assert.equal(kernel.events.filter(event => event.action === "recall").length, 1);
  }
});

test("EG-RECALL rejects a fake transaction that restores location but leaves Recall writes", () => {
  const { kernel } = layeredRecall({ persistent: true });
  const ref = kernel.ref("hero");
  const transaction = run => {
    try {
      return run();
    } catch (caught) {
      // Simulate an incomplete rollback that only puts the object back.
      kernel.perform({ type: "move-location", object: ref, to: battlefield });
      throw caught;
    }
  };
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("source"), controller: "A", transaction,
    contractActions: createContractActionCapability(action => {
      kernel.performContract(action);
      throw new TypeError("consumer failed after authoritative recall");
    }),
  });

  assert.throws(() => performRecall(context, ref), { name: "RecallAtomicityError" });
  assert.deepEqual(kernel.getObject("hero").location, battlefield);
  assert.deepEqual(kernel.getObject("hero").ref, ref);
  assert.equal(kernel.history({ action: "recall", object: ref }), 1);
  assert.equal(kernel.history({ action: "move-location", object: ref }), 1);
  assert.equal(kernel.events.filter(event => event.action === "recall").length, 1);
  assert.equal(kernel.events.filter(event => event.action === "move-location").length, 1);
});

test("EG-RECALL moves a Board Permanent to its controller Base without a destination choice", () => {
  const kernel = scenario();
  const before = kernel.getObject("hero");
  const run = runInstruction(move, recallArgs(), { world: kernel, targets: targets(kernel) });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.recalled.receipt.actions, [{ type: "recall", status: "done" }]);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].details.recall, true);
  assert.deepEqual(run.events[0].details.from, battlefield);
  assert.deepEqual(run.events[0].details.to, base("A"));
  assert.deepEqual(kernel.getObject("hero"), { ...before, location: base("A") });
  assert.equal(kernel.history({ action: "move-location", object: before.ref }), 0);
  assert.deepEqual(run.linked.recalled, {
    count: 1,
    objects: [before.ref],
    movements: [{ object: before.ref, from: battlefield, to: base("A") }],
    mode: "recall",
    receipt: { status: "committed", actions: [{ type: "recall", status: "done" }] },
  });
});

test("EG-RECALL preserves statuses and relocates only its bound selection", () => {
  const kernel = scenario();
  const anchor = kernel.getObject("anchor");
  const enemy = kernel.getObject("enemy");
  const run = runInstruction(move, recallArgs(), { world: kernel, targets: targets(kernel) });
  assert.equal(kernel.getObject("hero").exhausted, true);
  assert.equal(kernel.getObject("hero").damage, 2);
  assert.equal(kernel.getObject("hero").stunned, true);
  assert.equal(kernel.getObject("hero").buffs, 1);
  assert.deepEqual(kernel.getObject("anchor"), anchor);
  assert.deepEqual(kernel.getObject("enemy"), enemy);
  assert.deepEqual(run.result.linkedValues.recalled.count, 1);
});

test("EG-RECALL recalls an enemy unit to its current controller Base (B's Base)", () => {
  const kernel = scenario();
  const run = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("enemy")] },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recalled.receipt.actions[0].type, "recall");
  assert.deepEqual(kernel.getObject("enemy").location, base("B"));
  assert.deepEqual(run.linked.recalled.movements, [{ object: kernel.ref("enemy"), from: battlefield, to: base("B") }]);
});

test("EG-RECALL rejects an explicit destination that is not the object's controller Base", () => {
  for (const to of [{ type: "base", player: "B" }, second]) {
    const kernel = scenario();
    const before = kernel.stateForTest();
    const run = runInstruction(move, recallArgs(to), { world: kernel, targets: targets(kernel) });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, "impossible");
    assert.deepEqual(run.linked.recalled, { count: 0, objects: [], movements: [], mode: "recall" });
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("EG-RECALL honors an explicit controller Base destination only for the matching controller", () => {
  const kernel = scenario();
  const run = runInstruction(move, recallArgs({ type: "base", player: "A" }), {
    world: kernel, targets: targets(kernel),
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("hero").location, base("A"));
});

test("EG-RECALL ignores non-Board zones and non-permanent types", () => {
  const kernel = scenario();
  const spell = kernel.getObject("hero");
  spell.types = ["spell"];
  kernel.addObject(spell, "board");
  const before = kernel.stateForTest();
  const spellRun = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("hero")] },
  });
  assert.equal(spellRun.result.status, "negated");
  assert.equal(spellRun.result.reason, "impossible");
  const staleRun = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("kept")] },
  });
  assert.equal(staleRun.result.status, "ignored");
  assert.equal(staleRun.result.reason, "mistargeted");
  assert.deepEqual(kernel.stateForTest(), before);
  assert.equal(kernel.getObject("hero").types.includes("spell"), true);
  assert.equal(kernel.getObject("kept").zone, "hand");
});


test("EG-RECALL treats an object already at its controller Base as no recall outcome", () => {
  const kernel = withSource(world().unit("home", { location: base("A") }).build(), "home");
  const before = kernel.stateForTest();
  const run = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("home")] },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.recalled, { count: 0, objects: [], movements: [], mode: "recall" });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL recalls a Gear permanent to its controller Base", () => {
  const kernel = withSource(world().unit("gear", { types: ["gear"], might: 2, damage: 1 }).build(), "gear");
  const run = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: { units: [kernel.ref("gear")] },
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("gear").location, base("A"));
  assert.equal(kernel.getObject("gear").damage, 1);
  assert.deepEqual(run.linked.recalled.count, 1);
});

test("EG-RECALL zero amount performs no object choice, action or destination lookup", () => {
  const kernel = scenario();
  const before = kernel.stateForTest();
  const run = runInstruction(move, { ...recallArgs("controller-base"), amount: c(0) }, {
    world: kernel, targets: targets(kernel),
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.recalled, { count: 0, objects: [], movements: [], mode: "recall" });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL never chooses a Recall destination because Recall is not a Move (CR 457)", () => {
  const kernel = scenario();
  const before = kernel.stateForTest();
  assert.throws(() => runInstruction(move, recallArgs({ kind: "choose", id: "destination", options: [second] }), {
    world: kernel, targets: targets(kernel),
  }), /cannot choose a destination/);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL keeps Move restrictions on effect.move while Recall bypasses them (CR 458.3)", () => {
  const kernel = scenario();
  kernel.addContinuous({
    id: "restrict-hero", layer: "ability", source: kernel.ref("hero"), filter: {},
    effect: { kind: "movement", restrictions: ["cannot-move"] },
  }, { type: "permanent" });
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  const restricted = queryMoveDestinations(kernel, [kernel.ref("hero")], {}, { registry: layers.registry });
  assert.deepEqual(restricted, []);
  const target = kernel.clone();
  target.setTargets("units", [target.ref("hero")]);
  const context = bindResolveContext(target, {
    object: ref => layers.evaluate(ref),
    layers: { registry: layers.registry },
    contractActions: createContractActionCapability(action => target.performContract(action)),
  });
  const blockedMove = {
    result: move.execute(context, move.argsSchema.parse({ objects: c({ target: "units" }), to: c(second) })),
  };
  kernel.restore(target.snapshot());
  assert.equal(blockedMove.result.status, "negated");
  assert.equal(blockedMove.result.reason, "impossible");
  assert.deepEqual(blockedMove.result.events, []);
  assert.deepEqual(kernel.getObject("hero").location, battlefield);
  const recall = runInstruction(move, recallArgs("controller-base"), {
    world: kernel, targets: targets(kernel),
  });
  assert.equal(recall.result.status, "executed");
  assert.equal(recall.events.length, 1);
  assert.equal(recall.events[0].details.recall, true);
  assert.equal(kernel.history({ action: "recall", object: kernel.ref("hero") }), 1);
  assert.equal(kernel.history({ action: "move-location", object: kernel.ref("hero") }), 0);
  assert.deepEqual(kernel.getObject("hero").location, base("A"));
});


test("EG-RECALL swap executes one atomic action with receipts and unchanged zone entries", () => {
  const kernel = scenario();
  const a = kernel.getObject("hero");
  const b = kernel.getObject("anchor");
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel,
    targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("hero").location, second);
  assert.deepEqual(kernel.getObject("anchor").location, battlefield);
  assert.equal(kernel.getObject("hero").ref.zoneEntryId, a.ref.zoneEntryId);
  assert.equal(kernel.getObject("anchor").ref.zoneEntryId, b.ref.zoneEntryId);
  assert.equal(kernel.getObject("hero").damage, 2);
  assert.equal(run.linked.swapped.status, "committed");
  assert.equal(run.linked.swapped.count, 2);
  assert.equal(run.linked.swapped.actionReceipt.status, "committed");
  assert.equal(kernel.history({ action: "move-location", object: a.ref }), 2);
  assert.equal(kernel.history({ action: "move-location", object: b.ref }), 2);
});

test("EG-RECALL swap of same-location objects performs no action", () => {
  const kernel = scenario();
  const a = kernel.getObject("hero");
  const b = kernel.getObject("anchor");
  kernel.addObject({ ...b, location: battlefield }, "board");
  const before = kernel.stateForTest();
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.swapped, { count: 0, objects: [a.ref, b.ref], movements: [] });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL swap rejects two references to the same object", () => {
  const kernel = scenario();
  const a = kernel.getObject("hero");
  const before = kernel.stateForTest();
  assert.throws(() => runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("hero")] },
  }), /two distinct objects/);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-RECALL swap rejects selector lists whose length is not exactly two", () => {
  const kernel = scenario();
  for (const objects of [[{ target: "a" }], [{ target: "a" }, { target: "b" }, { target: "hero" }], [{ id: "a", zoneEntryId: 1 }, { id: "b", zoneEntryId: 1 }]]) {
    assert.throws(() => runInstruction(swap, { objects: c(objects) }, {
      world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
    }), TypeError);
  }
});

test("EG-RECALL swap negates impossible destinations before committing either relocation", () => {
  const kernel = scenario();
  // CR 451.2 needs two other controllers represented: A's mover is bound to
  // second, which already holds B's anchor; C's units make that destination
  // held by two players other than the mover.
  kernel.addPlayer("C", {});
  const enemy = kernel.getObject("enemy");
  kernel.addObject({ ...enemy, ref: { id: "raider", zoneEntryId: 1 }, location: second }, "board");
  kernel.addObject({ ...enemy, ref: { id: "neutral", zoneEntryId: 1 }, owner: "C", controller: "C", location: second }, "board");
  const hero = kernel.getObject("hero");
  const anchor = kernel.getObject("anchor");
  const before = kernel.stateForTest();
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel,
    targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(kernel.getObject("hero").location, hero.location);
  assert.deepEqual(kernel.getObject("anchor").location, anchor.location);
});


test("EG-RECALL swap rolls back the first relocation when the second is prevented", () => {
  const kernel = scenario();
  const hero = kernel.getObject("hero");
  const anchor = kernel.getObject("anchor");
  const before = kernel.stateForTest();
  kernel.addReplacement(action => action.type === "move-location" && action.object.id === "anchor" ? "prevented" : null);
  const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
    world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.deepEqual(kernel.getObject("hero"), hero);
  assert.deepEqual(kernel.getObject("anchor"), anchor);
  assert.deepEqual(kernel.stateForTest(), before);
});

for (const behavior of ["first-rewrite", "first-prevent", "first-replace", "second-rewrite", "second-prevent", "throw"]) {
  test("EG-RECALL swap never reports committed for batch behavior " + behavior, () => {
    const kernel = scenario();
    const a = kernel.getObject("hero");
    const b = kernel.getObject("anchor");
    const before = kernel.stateForTest();
    kernel.addReplacement(action => {
      if (action.type !== "move-location") return null;
      const target = behavior.startsWith("first") ? "hero" : "anchor";
      if (action.object.id !== target) return null;
      if (behavior === "throw") throw new Error("batch leaf failed");
      if (behavior.endsWith("rewrite")) {
        const current = kernel.getObject(action.object.id).location;
        return { status: "rewrite", action: { ...action, to: current } };
      }
      if (behavior.endsWith("replace")) return "replaced";
      return "prevented";
    });
    const run = runInstruction(swap, { objects: c([{ target: "a" }, { target: "b" }]) }, {
      world: kernel, targets: { a: [kernel.ref("hero")], b: [kernel.ref("anchor")] },
    });
    assert.equal(run.result.status, "negated");
    assert.notEqual(run.result.reason, "executed");
    assert.deepEqual(kernel.getObject("hero"), a);
    assert.deepEqual(kernel.getObject("anchor"), b);
    assert.deepEqual(kernel.stateForTest(), before);
  });
}

test("EG-RECALL swap rolls back a real rejected second leg and retries through the production ChainEngine", () => {
  const program = cardProgram("test:swap-rollback", [{
    id: "swap", op: "effect.swap-location",
    args: { objects: c([{ target: "a" }, { target: "b" }]) },
    targets: [
      { id: "a", filter: { objectId: "a" }, min: 1, max: 1 },
      { id: "b", filter: { objectId: "b" }, min: 1, max: 1 },
    ],
  }]);
  const f = programFixture({
    programs: [program], energy: { A: 0 }, power: { A: [] },
    setup(builder) {
      builder.hand("spell-a", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.hand("spell-b", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("a", { location: battlefield });
      builder.unit("b", { location: second });
    },
  });
  const a = f.ref("a");
  const b = f.ref("b");
  let rejectSecondLeg = true;
  f.kernel.addReplacement(action => {
    if (action.type !== "move-location" || action.object.id !== "b" || !rejectSecondLeg) return null;
    rejectSecondLeg = false;
    return "prevented";
  });

  f.play("spell-a");
  f.engine.pass("A");
  f.engine.pass("B");
  const rejected = f.kernel.linked("swap.swapped");
  assert.equal(rejected.status, "blocked");
  assert.equal(rejected.count, 0);
  assert.deepEqual(rejected.objects, [a, b]);
  assert.deepEqual(rejected.movements, []);
  assert.equal(rejected.actionReceipt.status, "rolled-back");
  assert.deepEqual(rejected.actionReceipt.actions, [
    { type: "move-location", status: "done" },
    { type: "move-location", status: "prevented" },
  ]);
  assert.deepEqual(f.get("a").location, battlefield);
  assert.deepEqual(f.get("b").location, second);
  assert.deepEqual(f.get("a").ref, a);
  assert.deepEqual(f.get("b").ref, b);
  assert.equal(f.kernel.history({ action: "move-location", object: a }), 0);
  assert.equal(f.kernel.history({ action: "move-location", object: b }), 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
  assert.deepEqual(f.engine.items, []);

  f.play("spell-b");
  f.engine.pass("A");
  f.engine.pass("B");
  const retried = f.kernel.linked("swap.swapped");
  assert.equal(retried.status, "committed");
  assert.equal(retried.count, 2);
  assert.deepEqual(retried.objects, [a, b]);
  assert.equal(retried.actionReceipt.status, "committed");
  assert.deepEqual(retried.actionReceipt.actions, [
    { type: "move-location", status: "done" },
    { type: "move-location", status: "done" },
  ]);
  assert.deepEqual(f.get("a").location, second);
  assert.deepEqual(f.get("b").location, battlefield);
  assert.deepEqual(f.get("a").ref, a);
  assert.deepEqual(f.get("b").ref, b);
  assert.equal(f.kernel.history({ action: "move-location", object: a }), 1);
  assert.equal(f.kernel.history({ action: "move-location", object: b }), 1);
  assert.deepEqual(f.engine.items, []);

  // The Chain fixture above validates the state transaction and retry. Exercise
  // the same action through the production EventPipeline bridge as well so a
  // failed second leg publishes no timing and a successful retry publishes both
  // moves in one simultaneous batch.
  const piped = world().unit("a", { location: battlefield }).unit("b", { location: second }).build();
  piped.setTargets("a", [piped.ref("a")]);
  piped.setTargets("b", [piped.ref("b")]);
  let rejectPipedSecondLeg = true;
  piped.addReplacement(action => {
    if (action.type !== "move-location" || action.object.id !== "b" || !rejectPipedSecondLeg) return null;
    rejectPipedSecondLeg = false;
    return "prevented";
  });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: piped.snapshot(), links: piped.clone() }),
    restore: saved => { piped.restore(saved.state); piped.copyLinkedFrom(saved.links); },
    objects: () => piped.objects,
    perform: action => piped.perform(action),
    performContract: action => piped.performContract(action),
    choose: request => { throw new AwaitChoice(request); },
    context: (source, controller, timingPoint) =>
      bindResolveContext(piped, { source, controller, timingPoint }),
    testTrigger: registration => piped.test(registration.spec.condition),
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const context = bindResolveContext(host.context(piped.getObject("a"), "A", "chain-item-resolve"), {
    perform: action => pipeline.commit(action),
    contractActions: createContractActionCapability(action => pipeline.commitContract(action)),
  });
  const body = [{
    id: "swap", op: "effect.swap-location",
    args: { objects: c([{ target: "a" }, { target: "b" }]) },
  }];
  const pipedBefore = piped.stateForTest();
  const failed = resolveChainBody(body, context);
  assert.equal(failed.results[0].result.status, "negated");
  assert.equal(failed.results[0].result.reason, "skipped");
  assert.deepEqual(piped.stateForTest(), pipedBefore);
  assert.equal(pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
  assert.equal(piped.history({ action: "move-location" }), 0);
  assert.equal(failed.linkedValues["swap.swapped"].actionReceipt.status, "rolled-back");

  const succeeded = resolveChainBody(body, context);
  assert.equal(succeeded.results[0].result.status, "executed");
  const published = pipeline.events.filter(event => event.timingPoint === "object-moved");
  assert.equal(published.length, 2);
  assert.deepEqual(published.map(event => event.details.objectId), ["a", "b"]);
  assert.equal(new Set(published.map(event => event.batchId)).size, 1);
  assert.equal(piped.history({ action: "move-location" }), 2);
  assert.deepEqual(piped.getObject("a").location, second);
  assert.deepEqual(piped.getObject("b").location, battlefield);
});

test("EG-RECALL swap invalid destination in production rejects the whole instruction before any relocation", () => {
  const kernel = world()
    .unit("a", { location: battlefield })
    .unit("b", { location: second })
    .unit("c", { location: contested })
    .build();
  // Same CR 451.2 shape as the primitive case above: B's and C's units hold
  // b's origin, so A's mover cannot enter the swap's first destination.
  kernel.addPlayer("C", {});
  const enemy = kernel.getObject("b");
  kernel.addObject({ ...enemy, ref: { id: "raider", zoneEntryId: 1 }, owner: "B", controller: "B", location: second }, "board");
  kernel.addObject({ ...enemy, ref: { id: "neutral", zoneEntryId: 1 }, owner: "C", controller: "C", location: second }, "board");
  const source = kernel.getObject("a");
  const before = kernel.stateForTest();
  const outcome = resolveChainBody([{ id: "swap", op: "effect.swap-location", args: { objects: c([{ target: "a" }, { target: "b" }]) } }],
    kernel.clone({ sourceSnapshot: source, targets: new Map([["a", [kernel.ref("a")]], ["b", [kernel.ref("b")]]]) }));
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.deepEqual(outcome.linkedValues.swap, undefined);
  assert.deepEqual(kernel.stateForTest(), before);
});


test("EG-RECALL executes the complete original Conscription program through the production adapter composition", () => {
  const ability = conscription.abilities.find(item => item.kind === "play");
  const recall = ability.body[2];
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "conscription.take-control", "conscription.exhaust", "conscription.recall",
  ]);
  assert.deepEqual(ability.body[0].targets[0].filter, {
    type: "unit", zone: "board", controller: "opponent", location: "battlefield", mightLte: 3,
  });
  assert.equal(ability.body[1].linkedTo, "conscription.take-control");
  assert.equal(recall.linkedTo, "conscription.exhaust");
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.args.mode.value, "recall");
  assert.deepEqual(recall.args.to, c("controller-base"));
  // Keep the original program, static optional XP cost, complete printed body,
  // target/link relationships, and the two-Chaos printed base cost. Only the
  // registry admission flag is overlaid for this execution test; the card
  // program itself remains judge-required in card-dsl.
  const program = { ...conscription, status: "executable", judgeReason: undefined };
  assert.equal(conscription.status, "judge-required");
  assert.equal(conscription.abilities[0].effect.kind, "cost.additional");
  assert.equal(conscription.abilities[0].effect.optional, true);
  assert.equal(conscription.abilities[0].effect.stage, "optional-additional");
  assert.deepEqual(conscription.abilities[0].effect.payments, [{
    kind: "xp", amount: c(5),
  }]);
  assert.deepEqual(ability.cost, {
    kind: "cost.printed", energy: c(5), power: c(2),
  });
  const kernel = world()
    .player("A", { energy: 5, power: ["Chaos", "Chaos"], xp: 5 })
    .player("B")
    .hand("spell", {
      cardId: program.canonicalCardId, types: ["spell"], energy: 5, power: ["Chaos"],
    })
    .unit("enemy", { owner: "B", controller: "B", might: 2 })
    .build();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const asked = [];
  const actions = [];
  const choose = request => {
    asked.push(request);
    if (request.type === "optional") return false;
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => {
      actions.push(structuredClone(action));
      return kernel.perform(action);
    },
    performContract: action => {
      actions.push(structuredClone(action));
      return kernel.performContract(action);
    },
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    describePlay: binding.describePlay, cleanup: () => false,
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  const source = kernel.getObject("spell");
  const draft = binding.describePlay({ type: "play", player: "A", object: source.ref }, source);
  // The trusted server catalog's numeric printed Power is attached here, as
  // the existing Accelerate production tests do, without changing the card
  // program.
  draft.cost = {
    ...draft.cost,
    printed: {
      id: "unl-140-219", cardType: "Spell", domains: ["Chaos"], energy: 5, power: 2,
    },
  };
  engine.execute(draft);
  assert.equal(asked[0].id, "target:conscription.enemy-unit");
  assert.deepEqual(asked[0].options, [kernel.ref("enemy")]);
  assert.ok(asked.some(request => request.type === "optional" && request.chooser === "A" &&
    /optional:conscription\.additional-cost$/.test(request.id)));
  settle(engine);
  assert.deepEqual(kernel.getObject("enemy").ref, { id: "enemy", zoneEntryId: 1 });
  assert.equal(kernel.getObject("enemy").controller, "A");
  assert.equal(kernel.getObject("enemy").exhausted, true);
  assert.deepEqual(kernel.getObject("enemy").location, base("A"));
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.player("A").power, []);
  assert.equal(kernel.player("A").xp, 5);
  assert.ok(actions.some(action => action.type === "take-control" && action.object.id === "enemy"));
  assert.ok(actions.some(action => action.type === "exhaust" && action.object.id === "enemy"));
  assert.deepEqual(actions.filter(action => action.type === "recall"), [{
    type: "recall", object: { id: "enemy", zoneEntryId: 1 }, player: "A",
  }]);
  const recalled = kernel.linked("conscription.recall.recalled");
  assert.equal(recalled.count, 1);
  assert.deepEqual(recalled.objects, [kernel.ref("enemy")]);
  assert.deepEqual(recalled.movements, [{
    object: kernel.ref("enemy"), from: battlefield, to: base("A"),
  }]);
  assert.equal(recalled.mode, "recall");
  assert.equal(recalled.receipt.status, "committed");
  assert.deepEqual(recalled.receipt.actions, [{ type: "recall", status: "done" }]);
  assert.equal(recalled.blockedReason, undefined);
  assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
  assert.equal(kernel.history({ action: "move-location", object: kernel.ref("enemy") }), 0);
  assert.equal(kernel.history({ action: "recall", object: kernel.ref("enemy") }), 1);
  assert.deepEqual(engine.items, []);
  assert.deepEqual(errors, []);
});

test("EG-RECALL runs the original Glowstone recall instruction through the default production assembly", () => {
  const ability = glowstone.abilities.find(item => item.kind === "activated");
  const recall = ability.body[1];
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.args.objects.value, "source");
  assert.equal(recall.args.to.value, "controller-base");
  assert.equal(recall.args.mode.value, "recall");
  // Keep the complete activated ability and its printed Disempower cost.
  const program = { ...glowstone, abilities: [ability] };
  const f = programFixture({
    programs: [program], energy: { A: 0 }, power: { A: [] },
    setup(builder) { builder.unit("glow", { cardId: program.canonicalCardId, energy: 0, power: [] }); },
  });
  assert.throws(() => f.activate("glow"), /Unsupported payment kind|disempower/i);
  assert.deepEqual(f.get("glow").location, battlefield);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
});

test("EG-RECALL keeps the complete original Smoke and Mirrors body fail-closed before a partial swap", () => {
  const ability = smokeAndMirrors.abilities.find(item => item.kind === "play");
  const swap = ability.body[0];
  assert.equal(swap.op, "effect.swap-location");
  assert.deepEqual(swap.args.objects.value, [{ target: "smoke-and-mirrors.unit-a" }, { target: "smoke-and-mirrors.unit-b" }]);
  // Keep the complete printed body and its exclude/locationRelation targets.
  // RIFT-853 normalizes the relation, so this full-body admission reaches the
  // default TargetPlan. That plan still lacks the prior selected-target binding
  // required to evaluate the cross-target relationship and fails closed.
  const program = cardProgram("test:swap-smoke-and-mirrors", ability.body);
  const f = programFixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    answers: { "target:smoke-and-mirrors.unit-a": ["one"] },
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("one");
      builder.unit("two", { location: second });
      builder.object("destination", { types: ["battlefield"], energy: null, power: null });
    },
  });
  assert.throws(() => f.play("spell"), error =>
    error?.name === "TargetSelectionError" && error.code === "no-legal-targets" &&
    error.message === "The required target count is not available");
  assert.deepEqual(f.asked.map(request => request.id), ["target:smoke-and-mirrors.unit-a"]);
  assert.deepEqual(f.asked[0].options, [f.ref("one"), f.ref("two")]);
  assert.deepEqual(f.get("one").location, battlefield);
  assert.deepEqual(f.get("two").location, second);
  assert.equal(f.kernel.history({ action: "move-location" }), 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
});

