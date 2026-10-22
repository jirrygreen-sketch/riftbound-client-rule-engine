import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/index.js";
import program, { RUMBLE_OFFICIAL_EFFECT_ORDER_EVIDENCE } from "../../../dist/cards/sfd/rumble-hotheaded.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
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
import keywordDef from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
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

test("Rumble, Hotheaded: validates, is registered, and records the Finalize receipt bridge gap", () => {
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
  assert.match(program.judgeReason, /RIFT-929/);
  assert.match(program.judgeReason, /leading-choice\.ts:29-44/);
  assert.match(program.judgeReason, /object-property\.object\.linked/);
  assert.match(program.judgeReason, /mistargeted/);
  assert.match(program.judgeReason, /linked-ignored/);
  assert.match(program.judgeReason, /支付前 Might/);
  assert.doesNotMatch(program.judgeReason, /CostPlan.*没有顶层|conquer.*恒不匹配|Unsupported filter field role/);
  assert.doesNotMatch(program.judgeReason, /cost\/payment\.ts:92-94/);
  assert.doesNotMatch(program.judgeReason, /Unknown or forward instruction link/);
});

test("Rumble, Hotheaded: official effect-order evidence records sources, timing, Priority/Focus, and response windows", () => {
  const evidence = RUMBLE_OFFICIAL_EFFECT_ORDER_EVIDENCE;
  assert.equal(evidence.canonicalCardId, CANONICAL);
  assert.deepEqual(evidence.sources.coreRules, {
    version: "1.5",
    published: "2026-10-09",
    effective: "2026-10-16",
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
    patchNotesUrl: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
    sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
  });
  assert.equal(evidence.sources.radianceRulings.published, "2026-10-09");
  assert.equal(evidence.sources.radianceRulings.effective, "2026-10-16");
  assert.match(evidence.sources.radianceRulings.url, /^https:\/\/playriftbound\.com\//);
  assert.equal(evidence.sources.spiritforgedErrata.published, "2026-01-14");
  assert.equal(evidence.sources.spiritforgedErrata.effective, null);
  assert.equal(evidence.sources.spiritforgedErrata.url,
    "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/");
  assert.equal(evidence.rulingStatus, "no-card-specific-ruling",
    "neither official rulings source contains a Rumble-specific entry");
  assert.deepEqual(evidence.interactions.map(entry => entry.id), [
    "assault-grant",
    "conquer-leading-recycle-play"
  ]);
  for (const interaction of evidence.interactions) {
    assert.equal(interaction.canonicalCardId, CANONICAL);
    assert.ok(interaction.ruleRefs.length > 0);
    assert.ok(interaction.timeline.length >= 3);
    assert.match(interaction.priorityFocus, /Priority/);
    assert.match(interaction.responseWindow, /response|window|discretionary|continuous effect|deterministic/i);
  }
  const conquer = evidence.interactions[1];
  assert.ok(conquer.ruleRefs.includes("312.1.b.1"));
  assert.ok(conquer.ruleRefs.includes("359.3.e.13"));
  assert.ok(conquer.timeline.some(line => line.includes("A then B receive Priority")));
  assert.ok(conquer.productionAssertions.some(name => name.includes("mistargeted") || name.includes("cannot bind")));
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

test("Rumble, Hotheaded: the grant primitive snapshots Assault 1 in the ability layer", () => {
  const kernel = world().unit("mech", { owner: "A", controller: "A", tags: ["Mech"] }).build();
  const run = runInstruction(keywordDef, {
    keyword: grant.effect.keyword,
    value: grant.effect.value.value,
    filter: { tags: ["Mech"], zone: "board" }
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registered] = kernel.continuousEffects;
  assert.equal(registered.effect.layer, "ability");
  assert.equal(registered.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registered.effect.effect.keyword, "Assault");
  assert.equal(registered.effect.effect.keywordValue, 1);
  assert.deepEqual(registered.effect.filter.objectId, "mech");
  assert.deepEqual(translateObjectFilter(grant.effect.filter), {
    zone: "board", controller: "self", tags: ["Mech"], type: "unit"
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

test("Rumble, Hotheaded production golden: accepting Conquer Finalize recycles the Board unit and prompts for the Mech target", () => {
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
  assert.deepEqual(
    flow.chain.pipeline.events.filter((event) => event.timingPoint === "became-target").map(event => event.target.ref.id),
    ["trash-mech"],
    "the play target is a target; the recycle cost choice is not"
  );
  assert.ok(flow.chain.trace.some((entry) => entry.step === "finalized" && entry.item === "trigger:1"));
  assert.equal(flow.chain.trace.some(entry =>
    entry.step === "removed" && entry.item === "trigger:1" && entry.reason === "unperformable-trigger"), false);

  const trace = flow.chain.trace;
  const showdownOpen = trace.findIndex(entry => entry.timingPoint === "showdown-open");
  const firstFocus = trace.findIndex(entry => entry.step === "focus-granted" && entry.player === "A");
  const firstFocusPass = trace.findIndex(entry => entry.step === "focus-pass" && entry.player === "A");
  const secondFocus = trace.findIndex(entry => entry.step === "focus-granted" && entry.player === "B");
  const secondFocusPass = trace.findIndex(entry => entry.step === "focus-pass" && entry.player === "B");
  const showdownClose = trace.findIndex(entry => entry.timingPoint === "showdown-close");
  const conquerEvent = trace.findIndex(entry => entry.timingPoint === "conquer");
  const pending = trace.findIndex(entry => entry.item === "trigger:1" && entry.step === "pending");
  const finalized = trace.findIndex(entry => entry.item === "trigger:1" && entry.step === "finalized");
  const priorityA = trace.findIndex((entry, index) => index > finalized && entry.step === "pass" && entry.player === "A");
  const priorityB = trace.findIndex((entry, index) => index > priorityA && entry.step === "pass" && entry.player === "B");
  const resolve = trace.findIndex(entry => entry.item === "trigger:1" && entry.step === "resolve-start");
  assert.ok(showdownOpen >= 0 && showdownOpen < firstFocus && firstFocus < firstFocusPass);
  assert.ok(firstFocusPass < secondFocus && secondFocus < secondFocusPass && secondFocusPass < showdownClose);
  assert.ok(showdownClose < conquerEvent && conquerEvent < pending && pending < finalized);
  assert.ok(finalized < priorityA && priorityA < priorityB && priorityB < resolve,
    "A then B must pass after Finalize and before Resolve; Focus is not a bypass");
  assert.equal(kernel.getObject("fodder").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").at(-1), kernel.ref("fodder"));
  assert.equal(kernel.getObject("trash-mech").zone, "trash");
  // The test flow pays its two starting runes into the pool, and the recycle
  // trigger has no Energy resource cost. The blocked play never charges the
  // Mech's reduced, non-zero cost.
  assert.equal(kernel.player("A").energy, 0);
});

test("Rumble, Hotheaded: cost payment accepts the friend's Board recycle and rejects an enemy Board Unit", () => {
  const kernel = world().player("A").player("B")
    .unit("fodder", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 3 })
    .build();
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
  assert.equal(assessed.payable, true);
  assert.equal(assessed.prepared.actions.at(-1).action.type, "recycle");
  assert.equal(kernel.getObject("fodder").zone, "board");

  const enemyPlan = buildCostPlan(context, {
    id: "rumble.enemy-board-recycle",
    cost: { kind: "explicit", payments: [{ kind: "recycle", object: kernel.ref("enemy") }] }
  });
  const enemy = assessCostPayment(context, enemyPlan);
  assert.equal(enemy.payable, false);
  assert.equal(enemy.error.reason, "cannot-pay-cost");
  assert.equal(kernel.getObject("enemy").zone, "board");
});

test("Rumble, Hotheaded: the registered Resolve body cannot bind the chosen object or Might from the Finalize receipt", () => {
  const kernel = world()
    .player("A", { energy: 5 })
    .unit("rumble", { cardId: CANONICAL, tags: ["Mech"], might: 4 })
    .unit("fodder", { controller: "A", might: 3 })
    .card("trash-mech", { zone: "trash", types: ["unit"], tags: ["Mech"], energy: 5, power: null })
    .build();
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const [registration] = triggerRegistrations(
    new ProgramRegistry([lifted]),
    kernel.getObject("rumble")
  );
  assert.ok(registration);
  assert.equal(registration.cost?.id, "cost:rumble:1:rumble.opt-in");
  const engine = new ChainEngine({
    host: createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose: request => { throw new Error(`Unexpected choice ${request.id}`); },
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
    }),
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    cleanup: () => false
  });
  assert.deepEqual(binding.registerProgramTriggers(engine, kernel.getObject("rumble")), ["program:rumble:1:1"]);
  // Leading-choice Finalize removes the payment instruction and its direct
  // linkedTo gate from the body actually registered for Resolve.
  const registeredBody = registration.body;
  assert.deepEqual(registeredBody.map(instruction => instruction.id), [
    "rumble.mech-cost",
    "rumble.play-mech"
  ]);
  assert.equal(recycleCost.id, "rumble.recycle-cost");

  kernel.setTargets("rumble.mech-in-trash", [kernel.ref("trash-mech")]);
  const outcome = resolveChainBody(registeredBody, bindResolveContext(kernel, {
    source: kernel.getObject("rumble"), controller: "A", timingPoint: "chain-item-resolve"
  }), {
    cost: {
      plan: {
        finalized: true,
        id: "cost:rumble:1:rumble.opt-in",
        player: "A",
        source: kernel.ref("rumble"),
        selectedAdditional: [],
        declinedAdditional: [],
        total: { energy: 0, power: [], xp: 0, actions: [], choices: [
          { id: "rumble.fodder", kind: "recycle", min: 1, max: 1, count: 1, objects: [kernel.ref("fodder")] }
        ] }
      },
      receipt: {
        planId: "cost:rumble:1:rumble.opt-in",
        paid: true,
        additional: [],
        total: { energy: 0, power: [], xp: 0, actions: [], choices: [
          { id: "rumble.fodder", kind: "recycle", min: 1, max: 1, count: 1, objects: [kernel.ref("fodder")] }
        ] }
      }
    }
  });
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["rumble.mech-cost", "ignored", "mistargeted"],
    ["rumble.play-mech", "ignored", "linked-ignored"]
  ]);
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
  assert.equal(engine.layers.registry.list().length, 0);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("friendly-mech")).keywords, []);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("friendly-other")).keywords, []);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("enemy-mech")).keywords, []);
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
  assert.deepEqual(recycled.events.map(event => event.action), ["recycle"]);

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
  assert.deepEqual(paid.events.map(event => event.action), ["pay"]);

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
  assert.deepEqual(played.events.map(event => event.action), ["pay", "play"]);
  // effect.play receives an already-finalized paid cost here; the isolated
  // reference kernel does not debit the player a second time.
  assert.equal(kernel.player("A").energy, 3);
});
