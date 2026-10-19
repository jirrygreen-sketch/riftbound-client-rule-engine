import assert from "node:assert/strict";
import test from "node:test";

import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import {
  AwaitChoice,
  CONTRACT_ACTION_CAPABILITY_VERSION,
  requireContractActionCapability
} from "../../dist/effects/contract.js";
import { runAbilityBody } from "../../dist/effects/interpreter.js";
import { world } from "../../dist/effects/testing/index.js";
import {
  bindResolveContext,
  createActionPipelineHost
} from "../../dist/events/action-adapter.js";
import { createContractActionCapability } from "../../dist/events/contract-actions/bridge.js";
import { EventPipeline } from "../../dist/events/pipeline.js";
import { triggerEventObjectBinding } from "../../dist/events/pipeline-types.js";

const c = value => ({ kind: "constant", value });
const field = id => ({ type: "battlefield", id });
const base = player => ({ type: "base", player });
const one = field("battlefield-1");
const two = field("battlefield-2");

function runtime({ replacements = [] } = {}) {
  const kernel = world()
    .player("A")
    .player("B")
    .base("source")
    .unit("recalled", { location: one, damage: 2, exhausted: true, stunned: true })
    .unit("a", { location: one })
    .unit("b", { location: two })
    .build();
  for (const replacement of replacements) kernel.addReplacement(replacement);
  // Resolve consumes the Finalize-locked target incarnations. Bind those same
  // authoritative refs here instead of letting the interpreter make choices.
  kernel.setTargets("units", [kernel.ref("recalled")]);
  kernel.setTargets("a", [kernel.ref("a")]);
  kernel.setTargets("b", [kernel.ref("b")]);

  const answers = new Map();
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) return structuredClone(answers.get(request.id));
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  let transactionCalls = 0;
  const transaction = run => {
    transactionCalls += 1;
    const hostCheckpoint = host.checkpoint();
    const pipelineCheckpoint = pipeline.checkpoint();
    try {
      return run();
    } catch (error) {
      host.restore(hostCheckpoint);
      pipeline.restore(pipelineCheckpoint);
      throw error;
    }
  };
  const context = (overrides = {}) => bindResolveContext(
    host.context(kernel.getObject("source"), "A", "chain-item-resolve"),
    {
      perform: action => pipeline.commit(action),
      contractActions: createContractActionCapability(action => pipeline.commitContract(action)),
      transaction,
      ...overrides
    }
  );
  return {
    kernel,
    pipeline,
    context,
    answers,
    asked,
    transactionCalls: () => transactionCalls
  };
}

const recallInstruction = () => ({
  id: "recall",
  op: "effect.move",
  args: {
    objects: c({ target: "units" }),
    to: c("controller-base"),
    mode: c("recall"),
    linkKey: c("recalled")
  },
  targets: [{ id: "units", filter: { objectId: "recalled", type: "unit", zone: "board" }, min: 1, max: 1 }]
});

const swapInstruction = () => ({
  id: "swap",
  op: "effect.swap-location",
  args: { objects: c([{ target: "a" }, { target: "b" }]) },
  targets: [
    { id: "a", filter: { objectId: "a", type: "unit", zone: "board" }, min: 1, max: 1 },
    { id: "b", filter: { objectId: "b", type: "unit", zone: "board" }, min: 1, max: 1 }
  ]
});

test("resolveChainBody Recall preserves the outer transaction while committing one Recall without a Move", () => {
  const f = runtime();
  const before = f.kernel.getObject("recalled");
  const context = f.context();
  const outcome = context.transaction(() => resolveChainBody([{
    id: "outer",
    op: "sequence",
    args: { body: c([recallInstruction()]) }
  }], context));

  assert.equal(outcome.status, "executed");
  // A caller-owned transaction may enclose Recall's primitive-owned seam. The
  // number of wrapper invocations is host behavior, not a CR rule; the
  // committed receipt, exact object identity, and final state are authoritative.
  const after = f.kernel.getObject("recalled");
  assert.deepEqual(after.ref, before.ref);
  assert.deepEqual(after.location, base("A"));
  assert.equal(after.damage, before.damage);
  assert.equal(after.exhausted, before.exhausted);
  assert.equal(after.stunned, before.stunned);
  assert.equal(f.kernel.history({ action: "recall", object: before.ref }), 1);
  assert.equal(f.kernel.history({ action: "move-location", object: before.ref }), 0);
  assert.equal(f.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
  const observation = outcome.events.find(event => event.action === "recall");
  assert.equal(observation?.reason, "recall");
  assert.deepEqual(outcome.linkedValues["outer/recall.recalled"], {
    count: 1,
    objects: [before.ref],
    movements: [{ object: before.ref, from: one, to: base("A") }],
    mode: "recall",
    receipt: {
      transactionId: "contract:recall:1",
      status: "committed",
      actions: [{ type: "recall", status: "done" }]
    }
  });
});

test("resolveChainBody Swap commits one two-leg atomic batch through the real pipeline bridge", () => {
  const f = runtime();
  const a = f.kernel.getObject("a");
  const b = f.kernel.getObject("b");
  const context = f.context();
  const outcome = resolveChainBody([swapInstruction()], context);

  assert.equal(outcome.status, "executed");
  // CR 448.3 makes the location change instantaneous. The installed
  // BatchAction capability owns the all-or-nothing boundary; an optional
  // transaction wrapper count is not itself a game-rule requirement.
  assert.deepEqual(f.kernel.getObject("a").location, two);
  assert.deepEqual(f.kernel.getObject("b").location, one);
  assert.deepEqual(f.kernel.getObject("a").ref, a.ref);
  assert.deepEqual(f.kernel.getObject("b").ref, b.ref);
  assert.equal(f.kernel.history({ action: "move-location", object: a.ref }), 1);
  assert.equal(f.kernel.history({ action: "move-location", object: b.ref }), 1);
  const moved = f.pipeline.events.filter(event => event.timingPoint === "object-moved");
  assert.equal(moved.length, 2);
  assert.equal(new Set(moved.map(event => event.batchId)).size, 1);
  const receipt = outcome.linkedValues["swap.swapped"];
  assert.equal(receipt.status, "committed");
  assert.equal(receipt.actionReceipt.status, "committed");
  assert.deepEqual(receipt.actionReceipt.actions, [
    { type: "move-location", status: "done" },
    { type: "move-location", status: "done" }
  ]);
});

test("a rejected second Swap leg rolls back the whole Batch while preserving the preceding instruction", () => {
  const f = runtime({
    replacements: [action => action.type === "move-location" && action.object.id === "b" ? "prevented" : null]
  });
  const before = f.kernel.stateForTest();
  const a = f.kernel.getObject("a");
  const b = f.kernel.getObject("b");
  const context = f.context();
  const outcome = resolveChainBody([
    { id: "first", op: "effect.xp", args: { amount: c(1) } },
    swapInstruction()
  ], context);

  // A rejected Swap reports a normal negated instruction and its Batch receipt
  // proves rollback. The preceding instruction is not inside that inner Batch,
  // so it remains committed under CR 303.1 and 340.1.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(f.kernel.getObject("a").location, a.location);
  assert.deepEqual(f.kernel.getObject("b").location, b.location);
  assert.equal(f.kernel.player("A").xp, 1);
  assert.equal(f.kernel.linked("first.gained"), 1);
  const swap = outcome.results.find(entry => entry.id === "swap").result;
  assert.deepEqual(swap, { status: "negated", reason: "skipped", events: [] });
  const receipt = outcome.linkedValues["swap.swapped"];
  assert.equal(receipt.status, "blocked");
  assert.equal(receipt.count, 0);
  assert.deepEqual(receipt.movements, []);
  assert.equal(receipt.blockedReason, "Atomic BatchAction did not commit both relocations");
  assert.deepEqual(receipt.actionReceipt, {
    transactionId: "swap:a:1:b:1",
    status: "rolled-back",
    actions: [
      { type: "move-location", status: "done" },
      { type: "move-location", status: "prevented" }
    ]
  });
  assert.equal(f.kernel.history({ action: "move-location" }), 0);
  assert.equal(f.pipeline.events.filter(event => event.timingPoint === "object-moved").length, 0);
  assert.equal(f.pipeline.events.filter(event => event.timingPoint === "xp-gained").length, 1);
});

test("AwaitChoice retries the whole outer transaction and rolls back prior linked/event writes", () => {
  const f = runtime();
  const body = [{
    id: "outer",
    op: "sequence",
    args: { body: c([
      { id: "gain", op: "effect.xp", args: { amount: c(1) } },
      {
        id: "pause",
        op: "choice.optional",
        args: { body: c([{ id: "inner", op: "effect.xp", args: { amount: c(1) } }]) }
      }
    ]) }
  }];
  const context = f.context();

  assert.throws(() => context.transaction(() => resolveChainBody(body, context)), AwaitChoice);
  assert.equal(f.kernel.player("A").xp, 0);
  assert.equal(f.kernel.linked("outer/gain.gained"), undefined);
  assert.equal(f.pipeline.events.length, 0);
  assert.equal(f.transactionCalls(), 1);

  f.answers.set("outer/pause/optional", true);
  const retried = context.transaction(() => resolveChainBody(body, context));
  assert.equal(retried.status, "executed");
  assert.equal(f.kernel.player("A").xp, 2);
  assert.equal(f.kernel.linked("outer/gain.gained"), 1);
  assert.equal(f.kernel.linked("outer/pause/inner.gained"), 1);
  assert.equal(f.pipeline.events.filter(event => event.timingPoint === "xp-gained").length, 2);
  assert.equal(f.transactionCalls(), 2);
});

test("missing Recall capability and an unsupported capability version fail closed before action submission", () => {
  const f = runtime();
  const before = f.kernel.stateForTest();
  const missing = f.context({ contractActions: undefined });
  const blocked = resolveChainBody([recallInstruction()], missing);
  assert.equal(blocked.results[0].result.status, "negated");
  assert.equal(blocked.results[0].result.reason, "impossible");
  assert.match(blocked.linkedValues["recall.recalled"].blockedReason, /RecallAction consumer unavailable/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.pipeline.events.length, 0);

  let performCalls = 0;
  const wrongVersion = {
    version: "riftbound.contract-actions.v2",
    perform() {
      performCalls += 1;
      return { status: "done", events: [], receipt: { status: "committed", actions: [] } };
    }
  };
  const requireInstruction = {
    op: "test.require-contract-actions",
    argsSchema: { parse: value => value },
    execute(context) {
      requireContractActionCapability(context);
      return { status: "executed", events: [] };
    }
  };
  const wrongContext = f.context({ contractActions: wrongVersion });
  assert.throws(
    () => runAbilityBody([{ id: "require", op: requireInstruction.op, args: {} }], wrongContext,
      new Map([[requireInstruction.op, requireInstruction]])),
    /unavailable or unsupported/
  );
  assert.equal(performCalls, 0);
  assert.deepEqual(f.kernel.stateForTest(), before);
});

test("instruction contexts preserve capability identity, version, and receiver-bound optional methods", () => {
  const kernel = world().unit("source").build();
  const eventBinding = {
    eventId: 11,
    role: "it",
    ref: kernel.ref("source"),
    snapshot: kernel.getObject("source")
  };
  const capability = {
    version: CONTRACT_ACTION_CAPABILITY_VERSION,
    calls: 0,
    perform() {
      assert.equal(this, capability);
      this.calls += 1;
      return { status: "done", events: [], receipt: { status: "committed", actions: [] } };
    }
  };
  let eventReceiver;
  let transactionReceiver;
  let transactionCalls = 0;
  let baseContext;
  baseContext = bindResolveContext(kernel, {
    source: kernel.getObject("source"),
    controller: "A",
    timingPoint: "buff-added",
    contractActions: capability,
    eventObject(role) {
      eventReceiver = this;
      return role === "it" ? eventBinding : null;
    },
    transaction(run) {
      transactionReceiver = this;
      transactionCalls += 1;
      return run();
    }
  });
  const definitions = new Map([
    ["test.capability", {
      op: "test.capability",
      argsSchema: { parse: value => value },
      execute(context) {
        assert.equal(context.contractActions, capability);
        assert.equal(context.contractActions.version, CONTRACT_ACTION_CAPABILITY_VERSION);
        assert.equal(requireContractActionCapability(context).perform({
          type: "recall",
          object: kernel.ref("source"),
          player: "A"
        }).status, "done");
        return { status: "executed", events: [] };
      }
    }],
    ["test.transaction", {
      op: "test.transaction",
      argsSchema: { parse: value => value },
      execute(context) {
        return context.transaction(() => ({ status: "executed", events: [], linkedValues: { inside: true } }));
      }
    }],
    ["condition.value", {
      op: "condition.value",
      argsSchema: { parse: value => value },
      execute(context, args) {
        assert.equal(context.eventObject("it"), eventBinding);
        return {
          status: "executed",
          events: [],
          linkedValues: { value: context.evaluate(args.value) }
        };
      }
    }]
  ]);
  const outcome = runAbilityBody([
    { id: "capability", op: "test.capability", args: {} },
    { id: "transaction", op: "test.transaction", args: {} },
    {
      id: "event",
      op: "condition.value",
      args: { value: { kind: "object-property", object: { event: "it" }, property: "might" } }
    }
  ], baseContext, definitions);

  assert.equal(outcome.status, "executed");
  assert.equal(capability.calls, 1);
  assert.equal(transactionCalls, 1);
  assert.equal(eventReceiver, baseContext);
  assert.equal(transactionReceiver, baseContext);
  assert.equal(outcome.linkedValues["transaction.inside"], true);
  assert.equal(outcome.linkedValues["event.value"], eventBinding.snapshot.might);
});

test("the three optional capabilities remain absent and callers fail closed when the base context omits them", () => {
  const kernel = world().unit("source").build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("source"),
    controller: "A",
    timingPoint: "main-start"
  });
  const definitions = new Map([
    ["test.optional-capabilities", {
      op: "test.optional-capabilities",
      argsSchema: { parse: value => value },
      execute(current) {
        assert.equal(current.contractActions, undefined);
        assert.equal(current.eventObject, undefined);
        assert.equal(current.transaction, undefined);
        assert.throws(() => requireContractActionCapability(current), /unavailable or unsupported/);
        return { status: "executed", events: [] };
      }
    }]
  ]);
  const outcome = runAbilityBody([
    { id: "optional", op: "test.optional-capabilities", args: {} }
  ], context, definitions);
  assert.equal(outcome.status, "executed");
});

test("event-it from a real trigger keeps the frozen incarnation across a later re-entry and never chooses a target", () => {
  const kernel = world()
    .base("source")
    .unit("event-unit", { exhausted: true, location: one })
    .build();
  let chooseCalls = 0;
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => {
      chooseCalls += 1;
      throw new Error("event:it must not choose");
    },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose: () => { throw new Error("event:it must not choose"); }
    })
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const snapshots = [];
  pipeline.onTrigger = snapshot => snapshots.push(snapshot);
  pipeline.registerTrigger({
    id: "event-it-observer",
    source: kernel.getObject("source"),
    controller: "A",
    spec: { at: "buff-added", filter: {} },
    body: []
  });

  const oldEventSnapshot = structuredClone(kernel.getObject("event-unit"));
  pipeline.emitBatch([{
    timingPoint: "buff-added",
    kind: "buff-added",
    object: oldEventSnapshot,
    it: oldEventSnapshot,
    player: "A"
  }]);
  const oldBinding = triggerEventObjectBinding(snapshots[0], "it");
  assert.ok(oldBinding);
  assert.equal(Object.isFrozen(oldBinding), true);
  assert.equal(Object.isFrozen(oldBinding.snapshot), true);
  const body = [{
    id: "read-event",
    op: "condition.value",
    args: { value: { kind: "object-property", object: { event: "it" }, property: "exhausted" } }
  }];
  const oldContext = bindResolveContext(host.context(kernel.getObject("source"), "A", "buff-added"), {
    eventObject: role => role === "it" ? oldBinding : null
  });
  assert.equal(resolveChainBody(body, oldContext).linkedValues["read-event.value"], true);

  const missingBinding = resolveChainBody(body, host.context(kernel.getObject("source"), "A", "buff-added"));
  assert.equal(missingBinding.results[0].result.status, "ignored");
  assert.equal(missingBinding.linkedValues["read-event.value"], undefined);

  const newIncarnation = { ...oldEventSnapshot, ref: { id: "event-unit", zoneEntryId: oldEventSnapshot.ref.zoneEntryId + 1 }, exhausted: false };
  kernel.addObject(newIncarnation, "board");
  assert.equal(resolveChainBody(body, oldContext).linkedValues["read-event.value"], true);
  pipeline.emitBatch([{
    timingPoint: "buff-added",
    kind: "buff-added",
    object: newIncarnation,
    it: newIncarnation,
    player: "A"
  }]);
  const newBinding = triggerEventObjectBinding(snapshots[1], "it");
  assert.equal(newBinding.ref.zoneEntryId, oldBinding.ref.zoneEntryId + 1);
  const newContext = bindResolveContext(host.context(kernel.getObject("source"), "A", "buff-added"), {
    eventObject: role => role === "it" ? newBinding : null
  });
  assert.equal(resolveChainBody(body, newContext).linkedValues["read-event.value"], false);

  const wrongRole = bindResolveContext(host.context(kernel.getObject("source"), "A", "buff-added"), {
    eventObject: () => ({ ...oldBinding, role: "source" })
  });
  assert.equal(resolveChainBody(body, wrongRole).results[0].result.status, "ignored");
  assert.equal(chooseCalls, 0);
  assert.equal(pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
  assert.ok(pipeline.events.every(event => event.timingPoint !== "became-target"));
});
