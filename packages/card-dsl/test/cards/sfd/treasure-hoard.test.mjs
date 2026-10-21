import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/treasure-hoard.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { getTokenDefinition } from "../../../../engine-core/dist/effects/tokens/definitions.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { createMatch } from "../../../../engine-core/dist/game/lifecycle.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import {
  executeBasicRuneResourcePlan,
  planBasicRuneResourceActivation
} from "../../../../engine-core/dist/runes/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const CANONICAL = "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564";
const SOURCE_TEXT = "When you conquer here, you may pay :rb_energy_1: to play a Gold gear token exhausted.";
const [ability] = program.abilities;
const [optional] = ability.body;
const [pay, playGold] = optional.args.body.value;

// ProgramRegistry rejects judge-required programs. This transparent lift keeps
// the authored IR unchanged while allowing the production binder, TurnFlow,
// ChainEngine, Finalize and Resolve to execute the exact blocked card body.
const admitted = { ...program, status: "executable" };
delete admitted.judgeReason;

function settle(flow, budget = 100) {
  for (let index = 0; index < budget; index++) {
    if (flow.chain.items.length) {
      if (flow.chain.priority === null) flow.chain.advance();
      else flow.pass(flow.chain.priority);
      continue;
    }
    if (flow.chain.focus !== null) {
      flow.pass(flow.chain.focus);
      continue;
    }
    return;
  }
  throw new Error("production TurnFlow did not settle");
}

function basicRuneDeck(prefix = "A") {
  const mindRune = "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b";
  return Array.from({ length: 8 }, (_, index) => ({
    ref: { id: `${prefix}:basic-mind-rune:${index}`, zoneEntryId: 1 },
    cardId: mindRune,
    name: "Mind Rune",
    types: ["rune"],
    tags: ["Basic"],
    domains: ["Mind"],
    energy: null,
    power: null
  }));
}

function fundEnergyFromBasicRune(kernel, flow, amount = 1) {
  const identity = (cardId) => cardId === "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b"
    ? { cardId, canonicalCardId: cardId, domain: "Mind" }
    : null;
  for (let index = 0; index < amount; index++) {
    // Fund this card's payment only through the real Basic Rune priority
    // activation, whose Finalize cost exhausts the Rune and whose Add action
    // commits the one Energy.
    const rune = kernel.objectsInZone("A", "rune-zone")
      .map((ref) => kernel.getObject(ref.id))
      .find((candidate) => !candidate.exhausted && candidate.cardId === "card.hash-a8a4cb783649a0339782e2d3808d6144661c621634da7c9f79b4f87981fac97b");
    assert.ok(rune, "a ready Basic Rune must be available for real resource funding");
    const plan = planBasicRuneResourceActivation({
      chain: flow.chain,
      state: { objects: () => kernel.objects, player: (id) => kernel.player(id) },
      resolveIdentity: identity,
      request: {
        actor: "A",
        activationId: `treasure-hoard-basic-rune-${index}`,
        intent: { type: "rune-energy", runeObjectId: rune.ref.id, zoneEntryId: rune.ref.zoneEntryId },
        window: { kind: "priority" }
      }
    });
    const receipt = executeBasicRuneResourcePlan(plan);
    assert.equal(receipt.energyAdded, 1);
  }
  // Resolve the last Basic Rune Add. The pass that resolves it also advances
  // Main and may run one no-op turn, so wait for the originally pending Batch
  // identity rather than for the global items array to become empty.
  const pendingRuneBatch = flow.chain.items.at(-1)?.id;
  assert.equal(pendingRuneBatch, undefined, "Basic Rune Add finalizes and resolves immediately (CR 430.2)");
  assert.equal(kernel.player("A").energy, amount);
}

function productionScene({ accepted = true, energy = 1, sourceField = "bf1", fund = true } = {}) {
  const builder = world().player("A").player("B")
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: "A" })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: "B" })
    .unit("hoard-card", {
      cardId: CANONICAL,
      owner: "A",
      controller: "A",
      types: ["battlefield"],
      might: null,
      energy: null,
      power: null,
      location: { type: "battlefield", id: sourceField }
    })
    .unit("raider", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      might: 5,
      location: { type: "base", player: "A" }
    });
  for (const rune of basicRuneDeck("A")) builder.object(rune.ref.id, { ...rune, owner: "A", zone: "rune-zone" });
  for (const rune of basicRuneDeck("B")) builder.object(rune.ref.id, { ...rune, owner: "B", zone: "rune-zone" });
  const kernel = builder.build();
  const requests = [];
  const energyAtOptional = [];
  const choose = (request) => {
    requests.push({ id: request.id, type: request.type });
    if (request.type === "optional") {
      energyAtOptional.push(kernel.player("A").energy);
      return accepted;
    }
    if (request.type === "select-objects" && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const flow = new TurnFlow({
    host,
    player: (id) => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
  });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  const lifecycleErrors = [];
  binding.attachLifecycle(flow.chain, (error) => lifecycleErrors.push(error));
  const registered = binding.registerProgramTriggers(flow.chain, kernel.getObject("hoard-card"));
  flow.start();
  if (fund) fundEnergyFromBasicRune(kernel, flow, energy);
  const move = () => flow.execute({
    id: "treasure-hoard-production-move",
    controller: "A",
    source: kernel.getObject("raider"),
    kind: "activated",
    speed: "normal",
    body: [{
      id: "treasure-hoard-production-move-effect",
      op: "effect.move",
      args: { to: { kind: "constant", value: { type: "battlefield", id: "bf1" } } }
    }]
  });
  return { kernel, flow, registered, lifecycleErrors, requests, energyAtOptional, move, settle: () => settle(flow) };
}

function card(id, types = ["unit"], extra = {}) {
  return { id, cardId: `card:${id}`, types, ...extra };
}

function deck({ treasure = false } = {}) {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`main-${index}`)),
    runeDeck: Array.from({ length: 4 }, (_, index) => card(`rune-${index}`, ["rune"])),
    championLegend: card("legend", ["legend"]),
    chosenChampion: card("champion", ["champion"]),
    battlefields: [
      treasure
        ? { id: "treasure-hoard", cardId: "sfd-220-221", canonicalCardId: CANONICAL, types: ["battlefield"] }
        : card("ordinary-field-0", ["battlefield"]),
      card("ordinary-field-1", ["battlefield"]),
      card("ordinary-field-2", ["battlefield"])
    ]
  };
}

test("sfd-220-221 Treasure Hoard: validates, is registered and keeps the current judge-required blockers", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);

  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /definitions\.ts:83-101/);
  assert.match(program.judgeReason, /effect\.token\.ts:341-342/);
  assert.match(program.judgeReason, /Universal Power/);
  assert.match(program.judgeReason, /game\/lifecycle\.ts:250-252,373-377/);
  assert.match(program.judgeReason, /Chain-zone/);
  assert.match(program.judgeReason, /events\/pipeline-match\.ts:17-23,89-94/);
  assert.match(program.judgeReason, /location/);
  assert.match(program.judgeReason, /entersExhausted/);
  assert.match(program.judgeReason, /Finalize/);
  // These diagnoses were disproved by the current sources and must not return.
  assert.doesNotMatch(program.judgeReason, /Unsupported filter field here/);
  assert.doesNotMatch(program.judgeReason, /entry overrides? are not supported/i);
  assert.doesNotMatch(program.judgeReason, /Gold.*absent from the frozen/i);
});

test("sfd-220-221 Treasure Hoard: optional Conquer, one Energy, Gold play and exhausted entry shape", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "controller" });
  assert.equal(ability.optional, true);
  assert.equal(optional.op, "choice.optional");
  assert.deepEqual(pay, {
    id: "treasure-hoard.pay",
    op: "cost.pay",
    args: { payments: { kind: "constant", value: { energy: 1 } } }
  });
  assert.equal(playGold.op, "effect.token");
  assert.equal(playGold.linkedTo, "treasure-hoard.pay");
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playGold.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(playGold.args.location, { kind: "location", value: "ability-controller-base" });
  assert.equal(playGold.args.target, undefined);
  assert.equal(playGold.args.pick, undefined);
  assert.equal(playGold.args.locations, undefined);
});

test("sfd-220-221 Treasure Hoard: here now translates and matches only its own conquer battlefield", () => {
  const source = world().player("A").unit("hoard-card", {
    types: ["battlefield"],
    location: { type: "battlefield", id: "bf1" }
  }).build().getObject("hoard-card");
  const translated = translateTriggerFilter(ability.trigger.filter, "hoard-card", "conquer");
  assert.deepEqual(translated, { event: "conquer", here: true, player: "self" });
  const conquer = (battlefieldId) => ({
    type: "task-resolved",
    seq: 1,
    eventId: 1,
    activePlayerId: "A",
    taskId: "conquer",
    sourceCardId: "",
    reason: "conquer",
    autoResolved: true,
    timingPoint: "conquer",
    kind: "conquer",
    player: "A",
    object: source,
    details: { battlefieldId }
  });
  assert.equal(matchesTriggerEvent(translated, conquer("bf1"), "A", source), true);
  assert.equal(matchesTriggerEvent(translated, conquer("bf2"), "A", source), false);
  assert.equal(matchesTriggerEvent(translated, { ...conquer("bf1"), details: {} }, "A", source), false);
});

test("sfd-220-221 Treasure Hoard production golden: Finalize pays one Energy, then Gold fails closed before creation", () => {
  const f = productionScene();
  assert.deepEqual(f.registered, ["program:hoard-card:1:0"]);
  assert.deepEqual(f.lifecycleErrors, []);
  const energyBeforeConquer = f.kernel.player("A").energy;
  assert.ok(energyBeforeConquer > 0, "Basic Rune funding must leave a real Main-phase Energy pool");
  const payEventsBeforeConquer = f.kernel.events.filter((event) => event.action === "pay").length;

  f.move();
  f.settle();

  assert.deepEqual(f.requests, [{ id: "finalize:trigger:1:optional", type: "optional" }]);
  assert.deepEqual(f.energyAtOptional, [energyBeforeConquer], "the optional choice is made before the Finalize payment");
  assert.equal(f.kernel.player("A").energy, energyBeforeConquer - 1, "the printed one Energy is paid during Finalize");
  assert.equal(
    f.kernel.events.filter((event) => event.action === "pay").length,
    payEventsBeforeConquer + 1,
    "Finalize adds exactly one real pay event"
  );
  assert.equal(f.kernel.linked("treasure-hoard.pay"), undefined);

  const receipt = f.kernel.linked("treasure-hoard.create.goldToken");
  assert.deepEqual(receipt, {
    amount: 0,
    objects: [],
    objectsComplete: true,
    createdAmount: 0,
    createdObjects: [],
    blockedReason: "token-definition-or-abilities-judge-required"
  });
  assert.deepEqual(f.kernel.objects.filter((object) => object.isToken), []);

  const timeline = f.flow.chain.pipeline.events.map((event) => event.timingPoint);
  const conquerAt = timeline.indexOf("conquer");
  const pendingAt = timeline.indexOf("chain-item-pending", conquerAt);
  const finalizeAt = timeline.indexOf("chain-item-finalize", pendingAt);
  const resolveAt = timeline.indexOf("chain-item-resolve", finalizeAt);
  assert.ok(conquerAt >= 0 && conquerAt < pendingAt && pendingAt < finalizeAt && finalizeAt < resolveAt);
  assert.ok(f.flow.chain.trace.some((entry) => entry.step === "finalize-start"));
  assert.ok(f.flow.chain.trace.some((entry) => entry.step === "resolved"));

  const gold = getTokenDefinition("gold");
  assert.ok(gold);
  assert.deepEqual(gold.spec.types, ["gear"]);
  assert.equal(gold.spec.energy, null);
  assert.equal(gold.spec.power, null);
  assert.equal(gold.abilityBinding, "blocked");
  assert.equal(gold.blockedReason, "token-definition-or-abilities-judge-required");
});

test("sfd-220-221 Treasure Hoard production counterexample: declining Finalize pays nothing and creates no token", () => {
  const f = productionScene({ accepted: false });
  const energyBeforeConquer = f.kernel.player("A").energy;
  const payEventsBeforeConquer = f.kernel.events.filter((event) => event.action === "pay").length;
  f.move();
  f.settle();

  assert.deepEqual(f.requests, [{ id: "finalize:trigger:1:optional", type: "optional" }]);
  assert.deepEqual(f.energyAtOptional, [energyBeforeConquer]);
  assert.equal(f.kernel.player("A").energy, energyBeforeConquer);
  assert.equal(f.kernel.events.filter((event) => event.action === "pay").length, payEventsBeforeConquer);
  assert.equal(f.kernel.linked("treasure-hoard.create.goldToken"), undefined);
  assert.deepEqual(f.kernel.objects.filter((object) => object.isToken), []);
  // The triggering Move resolves normally; only the declined trigger is removed
  // without a Resolve. Do not confuse those two chain items.
  assert.equal(f.flow.chain.trace.some((entry) => entry.step === "removed" && entry.reason === "declined"), true);
});

test("sfd-220-221 Treasure Hoard production counterexample: insufficient Energy removes the trigger without a free Gold", () => {
  const f = productionScene({ energy: 0, fund: false });
  f.move();
  f.settle();

  assert.deepEqual(f.requests, [{ id: "finalize:trigger:1:optional", type: "optional" }]);
  assert.deepEqual(f.energyAtOptional, [0]);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(f.kernel.events.filter((event) => event.action === "pay").length, 0);
  assert.equal(f.kernel.linked("treasure-hoard.create.goldToken"), undefined);
  assert.deepEqual(f.kernel.objects.filter((object) => object.isToken), []);
  assert.ok(f.flow.chain.trace.some((entry) => entry.step === "removed" && entry.reason === "unperformable-trigger"));
});

test("sfd-220-221 Treasure Hoard production counterexample: conquering another battlefield does not fire here", () => {
  const f = productionScene({ sourceField: "bf2" });
  const energyBeforeConquer = f.kernel.player("A").energy;
  f.move();
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.deepEqual(f.requests, []);
  assert.equal(f.kernel.player("A").energy, energyBeforeConquer);
  assert.equal(f.kernel.linked("treasure-hoard.create.goldToken"), undefined);
  assert.deepEqual(f.kernel.objects.filter((object) => object.isToken), []);
});

test("sfd-220-221 Treasure Hoard default match setup leaves the selected Battlefield on Chain and registers no trigger", () => {
  const kernel = world().player("A").player("B").build();
  const choose = (request) => {
    throw new Error(`Match setup made an unexpected choice ${request.type} ${request.id}`);
  };
  const pipelineHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(pipelineHost)), pipelineHost, {
    player: (id) => kernel.player(id)
  });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  const match = createMatch({
    decks: [deck({ treasure: true }), deck()],
    seed: "treasure-hoard-setup",
    host,
    programs: binding,
    battlefieldChoice: [0, 0]
  });
  const lifecycleErrors = [];
  binding.attachLifecycle(match.flow.chain, (error) => lifecycleErrors.push(error));

  const battlefield = match.setup.battlefields.find((entry) => entry.cardId === "sfd-220-221");
  assert.ok(battlefield);
  const source = kernel.getObject(battlefield.id);
  assert.equal(source.cardId, CANONICAL);
  assert.equal(source.zone, "chain");
  assert.equal(source.location, null);

  const registrations = [...match.flow.chain.pipeline.checkpoint().triggers.values()]
    .filter((registration) => registration.source.cardId === CANONICAL);
  assert.deepEqual(registrations, []);
  assert.deepEqual(lifecycleErrors, []);
});
