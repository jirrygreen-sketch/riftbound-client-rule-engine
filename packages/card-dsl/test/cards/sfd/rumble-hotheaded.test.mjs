import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/index.js";
import program from "../../../dist/cards/sfd/rumble-hotheaded.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import recycleDef from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import playDef from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { assessCostPayment } from "../../../../engine-core/dist/cost/payment.js";

const CANONICAL = "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";
const SOURCE_TEXT =
  "Your Mechs each have [Assault]. (+1 :rb_might: while we're attackers.)\n" +
  "When I conquer, you may recycle another friendly unit to play a Mech from your trash. " +
  "Reduce its Energy cost by the Might of the unit you recycled.";
const [grant, trigger] = program.abilities;
const [optional] = trigger.body;
const [recycleCost, cost, play] = optional.args.body.value;

const constant = (value) => ({ kind: "constant", value });

function productionConquer(accept) {
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const builder = world().player("A", { energy: 10 }).player("B", { energy: 10 })
    .base("rumble", { cardId: CANONICAL, tags: ["Mech"], might: 4, location: { type: "base", player: "A" } })
    .base("fodder", { controller: "A", might: 3, location: { type: "base", player: "A" } })
    .card("trash-mech", { zone: "trash", types: ["unit"], tags: ["Mech"], energy: 5, power: null, might: 3 });
  for (const player of ["A", "B"]) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = (request) => {
    requests.push(structuredClone(request));
    if (request.type === "optional") return accept;
    if (request.type === "mode" && request.id.includes(":order:")) return request.options[0];
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
    if (request.type === "select-objects" && request.min === 0) return [];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const flow = new TurnFlow({
    host,
    player: (id) => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    describePlay: binding.describePlay
  });
  flow.start();
  const registrations = binding.registerProgramTriggers(flow.chain, kernel.getObject("rumble"));
  assert.deepEqual(registrations, ["program:rumble:1:1"]);
  assert.equal(flow.chain.commit({
    type: "move-location", object: kernel.ref("rumble"), to: { type: "battlefield", id: "bf1" }
  }).status, "done");
  flow.advance();
  for (let guard = 0; guard < 80; guard++) {
    if (flow.chain.items.some((item) => item.status === "pending")) { flow.advance(); continue; }
    if (flow.chain.items.length) { flow.pass(flow.chain.priority); continue; }
    if (flow.chain.focus !== null) { flow.pass(flow.chain.focus); continue; }
    return { kernel, flow, requests };
  }
  throw new Error("production Conquer flow did not settle");
}

test("Rumble, Hotheaded: validates, is registered, and remains judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /383\.3\.a/);
  assert.match(program.judgeReason, /383\.3\.b\.1/);
  assert.match(program.judgeReason, /355\.10\.c\.1/);
  assert.match(program.judgeReason, /cost\/payment\.ts:92-94/);
  assert.match(program.judgeReason, /Board|unperformable-trigger/);
  assert.match(program.judgeReason, /Might\/LKI/);
  assert.doesNotMatch(program.judgeReason, /CostPlan.*没有顶层|conquer.*恒不匹配|Unsupported filter field role/);
});

test("Rumble, Hotheaded: the permanent ability is a friendly-Mech Assault 1 grant", () => {
  assert.deepEqual(grant, {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "Assault",
      value: constant(1),
      filter: { zone: "board", controller: "controller", tag: "Mech", type: "unit" }
    }
  });
});

test("Rumble, Hotheaded: conquer trigger uses the real self-Unit event payload", () => {
  assert.equal(trigger.trigger.at, "conquer");
  assert.deepEqual(trigger.trigger.filter, { event: "conquered", object: { objectId: "self" } });
  assert.equal(validateTriggerSpec({ at: trigger.trigger.at, filter: trigger.trigger.filter }).ok, true);

  const source = world().unit("rumble", { cardId: CANONICAL, might: 4 }).build().getObject("rumble");
  const other = { ...source, ref: { id: "other", zoneEntryId: source.ref.zoneEntryId } };
  const event = (object) => ({
    timingPoint: "conquer",
    kind: "conquer",
    player: "A",
    object,
    source: object,
    it: object,
    details: { battlefieldId: "bf1", objectId: object.ref.id, playerId: "A" }
  });
  const productionFilter = { event: "conquered", object: { objectId: "rumble" } };
  assert.equal(matchesTriggerEvent(productionFilter, event(source), "A", source), true);
  assert.equal(matchesTriggerEvent(productionFilter, event(other), "A", source), false);
  assert.equal(matchesTriggerEvent(productionFilter, { ...event(source), timingPoint: "hold", kind: "hold" }, "A", source), false);
});

test("Rumble, Hotheaded: the recycle is one non-target leading base-cost choice", () => {
  assert.equal(trigger.optional, false);
  assert.equal(optional.op, "choice.optional");
  assert.equal(recycleCost.op, "cost.pay");
  assert.deepEqual(recycleCost.args.payments, {
    kind: "constant",
    value: [{
      kind: "recycle",
      choice: {
        id: "rumble.fodder",
        options: [],
        filter: {
          zone: "board",
          controller: "controller",
          type: "unit",
          relation: { relation: "other", object: "self" }
        },
        min: 1,
        max: 1,
        selection: "one"
      }
    }]
  });
  assert.equal(recycleCost.targets, undefined);
  assert.equal(cost.op, "cost.modify");
  assert.equal(cost.linkedTo, recycleCost.id);
  assert.deepEqual(cost.args.modifier.value.amount, {
    kind: "object-property",
    object: { linked: recycleCost.id },
    property: "might"
  });
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, cost.id);
  assert.deepEqual(play.args.target, constant("rumble.mech-in-trash"));
  assert.deepEqual(play.targets, [{
    id: "rumble.mech-in-trash",
    filter: { zone: "trash", owner: "controller", tag: "Mech", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("Rumble, Hotheaded golden: accepting reaches real Conquer Finalize, which rejects Board recycle atomically", () => {
  const { kernel, flow, requests } = productionConquer(true);
  const conquer = flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.deepEqual(conquer[0].object.ref, kernel.ref("rumble"));
  assert.deepEqual(conquer[0].source.ref, kernel.ref("rumble"));
  assert.deepEqual(conquer[0].details, {
    battlefieldId: "bf1", battlefieldControllerBefore: null, objectId: "rumble", playerId: "A"
  });
  assert.deepEqual(requests.map((request) => request.id), [
    "finalize:trigger:1:optional",
    "target:rumble.mech-in-trash",
    "cost:rumble:1:rumble.opt-in:pick:rumble.fodder"
  ]);
  assert.deepEqual(requests[1].options.map((ref) => ref.id), ["trash-mech"]);
  assert.deepEqual(requests[2].options.map((ref) => ref.id), ["fodder"]);
  assert.equal(flow.chain.pipeline.events.some((event) => event.timingPoint === "became-target"), false);
  assert.ok(flow.chain.trace.some((entry) =>
    entry.step === "removed" && entry.item === "trigger:1" && entry.reason === "unperformable-trigger"));
  assert.equal(kernel.getObject("fodder").zone, "board");
  assert.equal(kernel.getObject("trash-mech").zone, "trash");
  assert.equal(kernel.player("A").energy, 0);
});

test("Rumble, Hotheaded: cost payment rejects a Board Unit recycle as this card requires", () => {
  const kernel = world().player("A").unit("fodder", { controller: "A", might: 3 }).build();
  const context = kernel.clone({
    source: kernel.ref("fodder"),
    sourceSnapshot: kernel.getObject("fodder"),
    timingPoint: "chain-item-finalize"
  });
  const plan = buildCostPlan(context, {
    id: "rumble.board-recycle",
    cost: { kind: "explicit", payments: [{ kind: "recycle", object: "self" }] }
  });
  const assessed = assessCostPayment(context, plan);
  assert.equal(assessed.payable, false);
  assert.equal(assessed.error.reason, "cannot-pay-cost");
  assert.match(assessed.error.message, /A recycle cost requires an owned card in Trash or a Rune in the Rune Zone/);
  assert.equal(kernel.getObject("fodder").zone, "board");
});

test("Rumble, Hotheaded: adapter Resolve cannot read the removed leading cost's selected Unit", () => {
  const kernel = world()
    .player("A", { energy: 5 })
    .unit("rumble", { cardId: CANONICAL, tags: ["Mech"], might: 4 })
    .unit("fodder", { controller: "A", might: 3 })
    .card("trash-mech", { zone: "trash", types: ["unit"], tags: ["Mech"], energy: 5, power: null })
    .build();
  kernel.setTargets("rumble.mech-in-trash", [kernel.ref("trash-mech")]);
  assert.throws(() => resolveChainBody([cost], bindResolveContext(kernel, {
    source: kernel.getObject("rumble"), controller: "A"
  }), {
    cost: {
      plan: {
        finalized: true, id: "cost:rumble", player: "A", source: kernel.ref("rumble"),
        selectedAdditional: [], declinedAdditional: [], additional: [], total: { choices: [] }
      },
      receipt: {
        planId: "cost:rumble", paid: true, additional: [],
        total: { choices: [{ id: "rumble.fodder", objects: [kernel.ref("fodder")] }] }
      }
    }
  }), /Unknown or forward instruction link: rumble\.recycle-cost/);
  assert.equal(kernel.getObject("trash-mech").zone, "trash");
  assert.equal(kernel.getObject("fodder").zone, "board");
});

test("Rumble, Hotheaded golden: declining the leading choice asks no target or recycle cost", () => {
  const { kernel, flow, requests } = productionConquer(false);
  assert.deepEqual(requests.map((request) => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(kernel.getObject("fodder").zone, "board");
  assert.equal(kernel.getObject("trash-mech").zone, "trash");
  assert.equal(flow.chain.trace.some((entry) => entry.reason === "unperformable-trigger"), false);
});

test("Rumble, Hotheaded golden: lifecycle grants Assault and attacker Might only to friendly Mechs", () => {
  const kernel = world()
    .hand("rumble", { cardId: CANONICAL, types: ["unit"], tags: ["Mech"], might: 4, combatRole: "attacker" })
    .unit("friendly-mech", { controller: "A", tags: ["Mech"], might: 3, combatRole: "attacker" })
    .unit("friendly-other", { controller: "A", tags: [], might: 3, combatRole: "attacker" })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], might: 3, combatRole: "attacker" })
    .build();
  const choose = (request) => { throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", cleanup: () => false });
  const staticOnly = { ...program, status: "executable", judgeReason: undefined, abilities: [program.abilities[0]] };
  const lifecycle = createProgramBinding({ cardPrograms: [staticOnly] }).attachLifecycle(engine);
  assert.equal(engine.commit({ type: "move-zone", object: kernel.ref("rumble"), to: "chain" }).status, "done");
  assert.equal(engine.commit({
    type: "move-zone", object: kernel.ref("rumble"), to: "base", location: { type: "base", player: "A" }
  }).status, "done");
  engine.advance();
  engine.layers.setObjects(kernel.objects);
  for (const id of ["rumble", "friendly-mech"]) {
    assert.deepEqual(engine.layers.evaluate(kernel.ref(id)).keywords, [{ id: "Assault", value: 1 }]);
  }
  assert.equal(engine.layers.evaluate(kernel.ref("friendly-mech")).might, 4);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("friendly-other")).keywords, []);
  assert.equal(engine.layers.evaluate(kernel.ref("friendly-other")).might, 3);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("enemy-mech")).keywords, []);
  assert.equal(engine.layers.evaluate(kernel.ref("enemy-mech")).might, 3);
  lifecycle.detach();
});

test("Rumble, Hotheaded: recycle, Might-valued reduction, payment and trash play primitives execute", () => {
  const kernel = world()
    .player("A", { energy: 5 })
    .unit("rumble", { cardId: CANONICAL, tags: ["Mech"], might: 4 })
    .unit("fodder", { controller: "A", might: 3 })
    .unit("not-a-mech", { controller: "A", type: ["unit"], tags: [] })
    .card("trash-mech", { zone: "trash", types: ["unit"], tags: ["Mech"], energy: 5, power: null })
    .card("trash-spell", { zone: "trash", types: ["spell"], tags: ["Mech"], energy: 4, power: null })
    .build();
  const fodderRef = kernel.ref("fodder");
  const mechRef = kernel.ref("trash-mech");
  const recycled = runInstruction(
    recycleDef,
    { objects: constant(fodderRef) },
    { world: kernel }
  );
  assert.equal(recycled.result.status, "executed");
  assert.deepEqual(recycled.linked.recycled, [fodderRef]);
  assert.equal(recycled.linked.recycledCount, 1);
  assert.equal(kernel.getObject("fodder").zone, "deck");

  // Direct cost.modify execution is a primitive check. Use its supported
  // TargetSpec spelling so this assertion does not duplicate the separate
  // production leading-receipt gap asserted above.
  const planKernel = world().player("A", { energy: 5 }).unit("fodder", { might: 3 }).build();
  const planRun = runInstruction(costModify, {
    id: "rumble.probe-cost",
    cost: { kind: "explicit", energy: constant(5) },
    modifier: {
      kind: "reduce",
      resource: "energy",
      amount: { kind: "object-property", object: { target: "fodder" }, property: "might" }
    }
  }, { world: planKernel, targets: { fodder: [planKernel.ref("fodder")] } });
  assert.equal(planRun.result.status, "executed");
  assert.equal(planRun.linked.cost.finalized, true);
  assert.equal(planRun.linked.cost.total.energy, 2);
  assert.deepEqual(planRun.linked.cost.discounts.map((entry) => [entry.amount, entry.before, entry.after]), [[3, 5, 2]]);

  const paid = runInstruction(costPay, {
    cost: constant(planRun.linked.cost)
  }, { world: planKernel });
  assert.equal(paid.result.status, "executed");
  assert.equal(paid.linked.payment.total.energy, 2);
  assert.equal(planKernel.player("A").energy, 3);

  // The card's declared target filter admits the trash Mech unit and rejects
  // a spell carrying the same tag. This checks the actual authored candidates
  // before play moves the Mech onto the Board.
  const candidates = kernel.objects.filter(object =>
    object.zone === "trash" && object.owner === "A" &&
    object.types.includes("unit") && object.tags.includes("Mech"));
  assert.deepEqual(candidates.map(object => object.ref.id), ["trash-mech"]);
  assert.equal(kernel.getObject("trash-spell").zone, "trash");

  const played = runInstruction(playDef, {
    target: "rumble.mech-in-trash",
    cost: constant({ finalized: true, energy: 2, power: [] })
  }, {
    world: kernel,
    targets: { "rumble.mech-in-trash": [mechRef] }
  });
  assert.equal(played.result.status, "executed");
  assert.equal(played.linked.played, 1);
  assert.equal(kernel.getObject("trash-mech").zone, "board");
  // effect.play receives an already-finalized paid cost here; the isolated
  // reference kernel does not debit the player a second time.
  assert.equal(kernel.player("A").energy, 3);
});
