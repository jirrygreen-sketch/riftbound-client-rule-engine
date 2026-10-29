// RIFT-1140 K-a: Reflexive triggers must create a real Pending Item through
// the production binding and chain, with its own Finalize choice and Resolve.
//
// Official evidence: Riftbound Core Rules v1.5, published 2026-10-09.
// URL: https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Local copy: /root/swarm-rift/shared/rules/CR-v1.5.txt.
// - CR 388.1 recognizes "Do this"; CR 388.2 makes the preceding condition
//   part of the Reflexive Trigger.
// - CR 389.1 creates the new ability as a Pending Item; CR 389.2 preserves
//   the order of a newly-created Pending wave.
// - CR 355.5.b keeps the Reflexive target choice out of the triggering item's
//   Finalize and places it in the new item's own Finalize.
// - CR 394-398 define linked abilities as components of the same printed
//   effect, and limit a linked component to objects associated with that set.
//   The child therefore uses only the Burn result and target bound by this
//   Forgotten Relic ability, never unrelated chain history.
// Timeline: parent Resolve -> condition snapshot and ordered child Pending
// publication -> both players receive the response window -> child Finalize
// locks its target -> two passes resolve -> Cleanup.
//
// Card text/printing: Forgotten Relic ven-108-166,
// card.hash-15ff48d601dbbf88a4e20335d5fed2db90642596b505780338ee6d79f6623847.
// Its Power is null (no printed Power); this fixture never rewrites it to zero.
import assert from "node:assert/strict";
import test from "node:test";

import forgottenRelic from "../../../card-dsl/dist/cards/ven/forgotten-relic.js";
import { AwaitChoice } from "../../dist/effects/contract.js";
import { world } from "../../dist/effects/testing/index.js";
import {
  hasReflexivePendingRuntime,
  installReflexivePendingRuntime,
} from "../../dist/effects/reflexive/runtime.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { createProgramBinding } from "../../dist/programs/index.js";

const executable = program => ({ ...program, status: "executable", judgeReason: undefined });

function responseProgram(id, body) {
  return {
    canonicalCardId: id,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "Synthetic response probe.",
    abilities: [{
      kind: "activated",
      timing: "reaction",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust", object: "self" }],
      },
      body,
    }],
  };
}

function runtime({ deck = ["burned"], burnedTypes = ["unit"], might = 3, responseBody, install = "after" } = {}) {
  const program = executable(forgottenRelic);
  const builder = world().player("A", { energy: 5 }).player("B");
  builder.unit("relic", {
    cardId: program.canonicalCardId,
    types: ["gear"],
    energy: 5,
    power: null,
  });
  builder.unit("friend", { owner: "A", might: 2, location: { type: "battlefield", id: "bf" } });
  const response = responseBody === undefined
    ? undefined
    : responseProgram("test:rift_1140:response", responseBody);
  if (response !== undefined) {
    builder.unit("responder", {
      cardId: response.canonicalCardId,
      types: ["gear"],
      energy: null,
      power: null,
      owner: "B",
      controller: "B",
    });
  }
  if (deck.length) builder.deck(deck, { owner: "A", types: burnedTypes, might });
  const kernel = builder.build();
  const asked = [];
  const choose = request => {
    asked.push(structuredClone(request));
    if (request.id === "target:forgotten-relic.friendly-unit") return [kernel.ref("friend")];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: response === undefined ? [program] : [program, response] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  // install: "after" (explicit call after the lifecycle), "before" (caller
  // installs first and keeps ownership) or "none" (default assembly only).
  const preinstalled = install === "before" ? installReflexivePendingRuntime(engine) : undefined;
  const lifecycle = binding.attachLifecycle(engine, error => { throw error; });
  const pendingRuntime = install === "after" ? installReflexivePendingRuntime(engine) : preinstalled;
  if (pendingRuntime !== undefined) {
    assert.equal(installReflexivePendingRuntime(engine), pendingRuntime, "install is idempotent per Chain");
  }
  // Setup predates lifecycle attachment. Bind this exact Board incarnation's
  // normal trigger surface before the first rules event, as a match host does.
  binding.registerProgramTriggers(engine, kernel.getObject("relic"));
  if (response !== undefined) binding.registerProgramTriggers(engine, kernel.getObject("responder"));
  return { binding, engine, kernel, lifecycle, pendingRuntime, asked };
}

function mightOf(f, id) {
  f.engine.layers.setObjects(f.kernel.objects);
  return f.engine.layers.evaluate(f.kernel.ref(id)).might;
}

function beginTurn(f) {
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  assert.deepEqual(f.engine.items.map(item => [item.id, item.status]), [["trigger:1", "finalized"]]);
  assert.deepEqual(f.asked, [], "the original Burn chooses neither a target nor a may option");
  f.engine.pass("A");
  f.engine.pass("B");
  f.engine.advance();
}

test("RIFT-1140 Forgotten Relic creates an ordered Reflexive Pending item from the real Burn", () => {
  const f = runtime();
  beginTurn(f);

  assert.deepEqual(f.kernel.zone("A", "trash").map(ref => ref.id), ["burned"]);
  const childId = "reflexive:trigger:1:forgotten-relic.burned-card:1";
  const [child] = f.engine.items;
  assert.deepEqual([child?.id, child?.status, child?.controller], [childId, "finalized", "A"]);
  assert.deepEqual(child?.body.map(instruction => instruction.op), ["continuous.might"]);
  assert.deepEqual(child?.targetPlans.map(plan => plan.selected.map(ref => ref.id)), [["friend"]]);
  assert.deepEqual(f.asked.map(request => request.id), ["target:forgotten-relic.friendly-unit"]);
  assert.equal(f.engine.priority, "A", "the child owns the response window after its Finalize");
  assert.deepEqual(f.pendingRuntime.snapshots[0]?.matched, [f.kernel.ref("burned")]);
  assert.equal(f.pendingRuntime.snapshots[0]?.conditionResult, true);

  const childPending = f.engine.trace.findIndex(entry => entry.step === "pending" && entry.item === childId);
  const parentResolved = f.engine.trace.findIndex(entry => entry.step === "resolved" && entry.item === "trigger:1");
  const childFinalized = f.engine.trace.findIndex(entry => entry.step === "finalized" && entry.item === childId);
  assert.ok(childPending >= 0 && childPending < parentResolved, "CR 389.1: child Pending appears during parent Resolve");
  assert.ok(parentResolved < childFinalized, "CR 355.5.b: child target locks only at the child's own Finalize");
  assert.deepEqual(
    f.engine.pipeline.events.filter(event => event.details?.item === childId).map(event => event.timingPoint),
    ["chain-item-pending", "chain-item-finalize"],
  );

  f.engine.pass("A");
  f.engine.pass("B");
  assert.equal(f.engine.trace.filter(entry => entry.step === "resolved" && entry.item === childId).length, 1);
  assert.equal(f.engine.items.length, 0);
  assert.equal(mightOf(f, "friend"), 5);
  assert.deepEqual(f.engine.layers.registry.snapshot().map(entry => ({
    kind: entry.effect.effect.kind,
    amount: entry.effect.effect.amount,
    duration: entry.duration,
  })), [{ kind: "continuous.might", amount: 3, duration: { type: "end-of-turn" } }]);
  f.lifecycle.detach();
  f.pendingRuntime.detach();
});

test("RIFT-1145 the default program lifecycle installs Reflexive Pending without an explicit call", () => {
  const f = runtime({ install: "none" });
  assert.equal(hasReflexivePendingRuntime(f.engine), true, "attachLifecycle installs the runtime");
  beginTurn(f);

  const childId = "reflexive:trigger:1:forgotten-relic.burned-card:1";
  assert.deepEqual(f.engine.items.map(item => [item.id, item.status]), [[childId, "finalized"]]);
  f.engine.pass("A");
  f.engine.pass("B");
  assert.equal(f.engine.items.length, 0);
  assert.equal(mightOf(f, "friend"), 5);

  f.lifecycle.detach();
  assert.equal(hasReflexivePendingRuntime(f.engine), false, "detaching the lifecycle removes the runtime it installed");
});

test("RIFT-1145 a Reflexive runtime installed before the lifecycle stays installed after lifecycle detach", () => {
  const f = runtime({ install: "before" });
  f.lifecycle.detach();
  assert.equal(hasReflexivePendingRuntime(f.engine), true, "the caller still owns its runtime");
  f.pendingRuntime.detach();
  assert.equal(hasReflexivePendingRuntime(f.engine), false);
});

test("RIFT-1140 an empty Burn creates no Reflexive Pending item", () => {
  const f = runtime({ deck: [] });
  beginTurn(f);
  assert.deepEqual(f.engine.items, []);
  assert.deepEqual(f.asked, []);
  assert.deepEqual(f.pendingRuntime.snapshots, []);
  assert.equal(mightOf(f, "friend"), 2);
  f.lifecycle.detach();
  f.pendingRuntime.detach();
});

test("RIFT-1140 a replaced Burn creates no Reflexive Pending item", () => {
  const f = runtime();
  f.kernel.addReplacement(action => action.type === "mill" ? "prevented" : null);
  beginTurn(f);
  assert.deepEqual(f.engine.items, []);
  assert.deepEqual(f.asked, []);
  assert.deepEqual(f.pendingRuntime.snapshots, []);
  assert.equal(f.kernel.zone("A", "trash").length, 0);
  assert.equal(mightOf(f, "friend"), 2);
  f.lifecycle.detach();
  f.pendingRuntime.detach();
});

test("RIFT-1140 a Reflexive target moved before Response is rechecked and ignored at Resolve", () => {
  const f = runtime();
  beginTurn(f);
  const child = f.engine.items[0];
  assert.equal(child?.status, "finalized");
  assert.deepEqual(child?.targetPlans.map(plan => plan.selected.map(ref => ref.id)), [["friend"]]);
  assert.equal(f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("friend"),
    to: "hand",
  }).status, "done");
  f.engine.advance();
  f.engine.pass("A");
  f.engine.pass("B");
  assert.deepEqual(f.engine.layers.registry.snapshot(), []);
  assert.equal(mightOf(f, "friend"), 2);
  assert.equal(f.kernel.getObject("friend")?.zone, "hand");
  f.lifecycle.detach();
  f.pendingRuntime.detach();
});

test("RIFT-1140 a Reaction response can join above the child and resolves first", () => {
  const responseBody = [{
    id: "test:rift_1140:response.draw",
    op: "effect.draw",
    args: { amount: { kind: "constant", value: 1 } },
  }];
  const f = runtime({ responseBody });
  beginTurn(f);
  const childId = "reflexive:trigger:1:forgotten-relic.burned-card:1";
  assert.equal(f.engine.items[0]?.id, childId);
  assert.equal(f.engine.priority, "A");

  // The window exposes the child's own Finalize state before either response.
  const responder = f.kernel.getObject("responder");
  const responseDraft = f.binding.describeActivate(responder, "B", 0);
  assert.deepEqual(responseDraft.body.map(instruction => instruction.op), ["effect.draw"]);
  assert.equal(responseDraft.speed, "reaction");
  assert.equal(f.engine.priority, "A");
  f.engine.pass("A");
  assert.equal(f.engine.priority, "B");
  f.engine.execute(responseDraft);
  assert.deepEqual(f.engine.items.map(item => [item.id, item.status]), [
    [childId, "finalized"],
    [responseDraft.id, "finalized"],
  ]);
  f.engine.pass("B");
  f.engine.pass("A");
  f.engine.pass("A");
  f.engine.pass("B");
  const responseResolved = f.engine.trace.findIndex(entry => entry.step === "resolved" && entry.item === responseDraft.id);
  const childResolved = f.engine.trace.findIndex(entry => entry.step === "resolved" && entry.item === childId);
  assert.ok(responseResolved >= 0 && responseResolved < childResolved,
    "the Reaction Pending item resolves before the child it responded to");
  assert.equal(f.engine.items.length, 0);
  assert.equal(mightOf(f, "friend"), 5);
  f.lifecycle.detach();
  f.pendingRuntime.detach();
});

test("RIFT-1140 a single Reflexive declaration materializes its ordered multi-item wave", () => {
  const cardId = "test:rift_1140:wave";
  const childBody = [{
    id: "test:rift_1140:child.draw",
    op: "effect.draw",
    args: { amount: { kind: "constant", value: 1 } },
  }];
  const program = {
    ...executable(forgottenRelic),
    canonicalCardId: cardId,
    abilities: [{
      kind: "activated",
      timing: "action",
      cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] },
      body: [{
        id: "test:rift_1140:wave.reflexive",
        op: "trigger.reflexive",
        args: {
          body: { kind: "constant", value: childBody },
          count: { kind: "constant", value: 2 },
          linkKey: { kind: "constant", value: "wave" },
        },
      }],
    }],
  };
  const builder = world().player("A", { energy: 10 }).player("B");
  builder.unit("source", { cardId, types: ["gear"], energy: null, power: null });
  builder.deck(["first", "second"], { owner: "A" });
  const kernel = builder.build();
  const asked = [];
  const choose = request => {
    asked.push(structuredClone(request));
    if (request.type === "select-objects") return [...request.options];
    if (request.type === "mode") return request.options[request.options.length - 1];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const lifecycle = binding.attachLifecycle(engine, error => { throw error; });
  const pendingRuntime = installReflexivePendingRuntime(engine);
  const source = kernel.getObject("source");
  const draft = binding.describeActivate(source, "A", 0);
  engine.execute(draft);
  engine.advance();
  engine.pass("A");
  engine.pass("B");
  engine.advance();
  const childIds = engine.trace
    .filter(entry => entry.step === "pending" && entry.item?.startsWith(`reflexive:${draft.id}:`))
    .map(entry => entry.item);
  assert.deepEqual(childIds, [
    `reflexive:${draft.id}:wave:1`,
    `reflexive:${draft.id}:wave:2`,
  ]);
  assert.deepEqual(engine.items.filter(item => item.id.startsWith("reflexive:")).map(item => item.id), childIds);
  assert.equal(kernel.player("A").handCount, 0, "children have not Resolved during the response window");
  engine.pass("A");
  engine.pass("B");
  engine.advance();
  engine.pass("A");
  engine.pass("B");
  engine.advance();
  assert.equal(kernel.player("A").handCount, 2);
  assert.equal(engine.items.length, 0);
  engine.layers.setObjects(kernel.objects);
  lifecycle.detach();
  pendingRuntime.detach();
});
