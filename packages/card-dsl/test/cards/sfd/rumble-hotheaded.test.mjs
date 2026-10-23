import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/index.js";
import program, { RUMBLE_OFFICIAL_EFFECT_ORDER_EVIDENCE } from "../../../dist/cards/sfd/rumble-hotheaded.js";
import { cardProgramsById, cardRegistryById } from "../../../dist/cards/registry.generated.js";
import breakneckMech from "../../../dist/cards/sfd/breakneck-mech.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import keywordDef from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import recycleDef from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import playDef from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { buildEffectPlayCostPlan } from "../../../../engine-core/dist/effects/play/index.js";
import { matchesObjectPredicates } from "../../../../engine-core/dist/effects/filters/predicates.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { assessCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { bindDuelPrintedCost } from "../../../../engine-core/dist/cost/printed-costs.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL = "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";
const SOURCE_TEXT =
  "Your Mechs each have [Assault]. (+1 :rb_might: while we're attackers.)\n" +
  "When I conquer, you may recycle another friendly unit to play a Mech from your trash. " +
  "Reduce its Energy cost by the Might of the unit you recycled.";
const RULES_URL = RUMBLE_OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.coreRules.url;
const OFFICIAL_EFFECT_ORDER_EVIDENCE = {
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CANONICAL,
  rulingStatus: "no-card-specific-ruling",
  sources: {
    coreRules: {
      version: "1.5",
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RULES_URL,
      patchNotesUrl: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
      sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec",
    },
    radianceRulings: {
      published: "2026-10-09",
      effective: "2026-10-16",
      url: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
      involvesThisCard: false,
    },
    spiritforgedErrata: {
      published: "2026-01-14",
      effective: null,
      url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/",
      involvesThisCard: false,
    },
    spiritforgedRules: {
      published: "2025-12-05",
      effective: "2025-12-12",
      url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-core-rules-spiritforged-patch-notes/",
    },
  },
  interactions: [
    {
      id: "assault-grant",
      canonicalCardId: CANONICAL,
      clauses: ["Your Mechs each have [Assault].", "(+1 [M] while we're attackers.)"],
      ruleRefs: ["475", "478", "479.3", "801.3.a", "807.1.c", "807.1.d", "807.1.d.1"],
      timeline: [
        "Continuous layer evaluation discovers the on-Board Rumble static ability.",
        "The controller-relative Mech filter grants Assault 1 only to a friendly Mech.",
        "Assault contributes +1 Might only while that Mech holds the attacker designation; a defender, non-Mech, or enemy Mech gains no contribution.",
      ],
      priorityFocus: "Continuous effect; it creates no Chain item and neither consumes nor transfers Priority or Focus.",
      responseWindow: "No response window is created by a continuously applied static effect.",
      productionAssertion: "Rumble, Hotheaded production golden: attacker-only Assault Might for the controller's Mechs",
    },
    {
      id: "conquer-leading-recycle-play",
      canonicalCardId: CANONICAL,
      clauses: [
        "When I conquer, you may recycle another friendly unit to play a Mech from your trash.",
        "Reduce its Energy cost by the Might of the unit you recycled.",
      ],
      ruleRefs: [
        "131.2", "131.3", "204.1.c", "204.3.a", "303.2.a", "312.1", "313.2", "329", "334", "337.1.a", "338",
        "355.10.c.1", "356.1.c", "356.4.c", "356.4.g", "357.1", "359.3.e.13", "383.3.a", "383.3.b.1", "404.1.b.1", "417.1.c",
      ],
      timeline: [
        "Conquer establishes control and emits the real ownership/source payload for Rumble.",
        "Rumble's Triggered Ability becomes Pending; its leading may and recycle cost are decided during Finalize.",
        "Finalize selects the Trash Mech target and another friendly Board unit as a non-target cost choice, then atomically pays the recycle to its owner's Main Deck bottom.",
        "The payment receipt preserves the recycled unit's pre-move Might. The Play descriptor declares base: printed so Finalize can use the target's complete trusted printed Energy and Power; after A then B pass the Closed-State Priority window, Resolve reduces only the Energy component and Power remains payable. A production golden with Breakneck's complete printed metadata pays 5 Energy and 2 Mind Power.",
        "RIFT-985 resolves the selected target's canonicalCardId through the ProgramBinding's trusted printed catalog after Finalize targets lock and before the recycle leaves Board. The default Rumble IR therefore carries no fixed card projection and fails closed when the binding catalog omits the selected Mech.",
      ],
      priorityFocus: "Focus belongs to the preceding Showdown. Finalize does not pass Priority; A then B receive Closed-State Priority in turn order, and both passes precede Resolve.",
      responseWindow: "After Finalize, the Closed-State window permits legally timed Reactions before Resolve. The production golden verifies the A-to-B Priority order and subsequent Resolve without inventing a Reaction card.",
      productionAssertions: [
        "Rumble, Hotheaded production component: Finalize recycles, preserves pre-move Might, and reaches the nested Play",
        "Rumble, Hotheaded production golden: binding catalog plays real Breakneck for 5 Energy plus 2 Mind Power",
        "Rumble, Hotheaded cost-plan boundary: missing numeric Power provenance fails closed",
        "Rumble, Hotheaded production boundary: missing binding catalog stays fail-closed",
      ],
    },
  ],
};

const constant = (value) => ({ kind: "constant", value });
const [grant, trigger] = program.abilities;
const [optional] = trigger.body;
const [recycleCost, play] = optional.args.body.value;
const playCost = play.args.cost.value;
const TRASH_MECH_PROGRAM = {
  canonicalCardId: "synthetic:RIFT-957-trash-mech",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Synthetic RIFT-957 Trash Mech used to traverse the production Play path.",
  abilities: [{
    kind: "play",
    cost: { kind: "cost.printed", energy: constant(0), power: constant(0) },
    body: [],
  }],
};
const admitted = { ...program, status: "executable", judgeReason: undefined };
const BREAKNECK_CATALOG_PRINTED = {
  id: "sfd-071-221",
  canonicalCardId: breakneckMech.canonicalCardId,
  cardType: "Unit",
  domains: ["Mind"],
  energy: 8,
  power: 2,
};
function productionConquer({
  accept = true,
  energy = 0,
  power = [],
  fodderMight = 3,
  fodderOwner = "A",
  mechEnergy = 5,
  trashProgram = TRASH_MECH_PROGRAM,
  printedCatalog,
  rumbleProgram = { ...program, status: "executable", judgeReason: undefined },
  fodder = true,
  onFinalize = () => {},
} = {}) {
  const builder = world().player("A", { power }).player("B", { energy: 10 })
    .base("rumble", {
      cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], tags: ["Mech"], might: 4,
      location: { type: "base", player: "A" },
    })
    .card("trash-mech", {
      cardId: trashProgram.canonicalCardId, owner: "A", zone: "trash", types: ["unit"], tags: ["Mech"],
      energy: mechEnergy, power: trashProgram === TRASH_MECH_PROGRAM ? null : ["Mind"], might: 3,
    })
    .card("trash-spell", {
      owner: "A", zone: "trash", types: ["spell"], tags: ["Mech"], energy: 4, power: null,
    })
    .base("enemy-unit", {
      owner: "B", controller: "B", types: ["unit"], might: 3,
      location: { type: "base", player: "B" },
    });
  if (fodder) {
    builder.base("fodder", {
      owner: fodderOwner, controller: "A", types: ["unit"], might: fodderMight,
      location: { type: "base", player: "A" },
    });
  }
  for (const player of ["A", "B"]) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const previousCatalogProgram = cardProgramsById.get(trashProgram.canonicalCardId);
  cardProgramsById.set(trashProgram.canonicalCardId, trashProgram);
  let catalogRestored = false;
  const restoreCatalogProgram = () => {
    if (catalogRestored) return;
    catalogRestored = true;
    if (previousCatalogProgram === undefined) cardProgramsById.delete(trashProgram.canonicalCardId);
    else cardProgramsById.set(trashProgram.canonicalCardId, previousCatalogProgram);
  };
  const requests = [];
  let finalizedOnce = false;
  let flow;
  const choose = (request) => {
    requests.push(structuredClone(request));
    if (request.type === "optional") {
      if (accept && request.id.startsWith("finalize:") && !finalizedOnce) {
        finalizedOnce = true;
        onFinalize(kernel, flow);
      }
      return accept;
    }
    if (request.type === "mode" && request.id.includes(":order:")) return request.options[0];
    if (request.type === "select-objects") {
      if (request.id === "target:rumble.mech-in-trash") {
        return request.options.filter((ref) => ref.id === "trash-mech");
      }
      if (request.id.endsWith(":pick:rumble.fodder")) {
        return request.options.filter((ref) => ref.id === "fodder");
      }
      if (request.min === 0) return [];
    }
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
    testTrigger: (registration) => kernel.test(registration.spec.condition),
  });
  const binding = createProgramBinding({
    cardPrograms: [rumbleProgram, trashProgram],
    ...(printedCatalog === undefined ? {} : { printedCatalog }),
  });
  flow = new TurnFlow({
    host,
    player: (id) => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(flow.chain, (error) => { throw error; });
  flow.start();
  assert.equal(flow.chain.commit({ type: "gain-energy", player: "A", amount: energy }).status, "done");
  if (power.length > 0) {
    assert.equal(flow.chain.commit({ type: "gain-power", player: "A", power }).status, "done");
  }
  const energyBeforeConquer = kernel.player("A").energy;
  assert.deepEqual(binding.registerProgramTriggers(flow.chain, kernel.getObject("rumble")), ["program:rumble:1:1"]);
  assert.equal(flow.chain.commit({
    type: "move-location", object: kernel.ref("rumble"), to: { type: "battlefield", id: "bf1" },
  }).status, "done");
  flow.advance();
  const settle = () => {
    for (let guard = 0; guard < 200; guard++) {
      if (flow.chain.items.some((item) => item.status === "pending")) { flow.advance(); continue; }
      if (flow.chain.items.length) { flow.pass(flow.chain.priority); continue; }
      if (flow.chain.focus !== null) { flow.pass(flow.chain.focus); continue; }
      if (flow.chain.priority !== null) { flow.pass(flow.chain.priority); continue; }
      if (flow.combat.active) { flow.advance(); continue; }
      return;
    }
    throw new Error("production Conquer flow did not settle");
  };
  return { kernel, flow, binding, requests, energyBeforeConquer, settle, restoreCatalogProgram };
}

function playedPlans(fixture, instructionId = "rumble.play-mech") {
  return Object.entries(fixture.kernel.linkedSnapshot())
    .filter(([key]) => key === `${instructionId}.playedCostPlans` || key.endsWith(`:${instructionId}.playedCostPlans`))
    .flatMap(([, value]) => Array.isArray(value) ? value : []);
}

function withCatalogProgram(program, run) {
  const previous = cardProgramsById.get(program.canonicalCardId);
  cardProgramsById.set(program.canonicalCardId, program);
  try {
    return run();
  } finally {
    if (previous === undefined) cardProgramsById.delete(program.canonicalCardId);
    else cardProgramsById.set(program.canonicalCardId, previous);
  }
}

test("Rumble, Hotheaded: validates and remains registered as executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal("judgeReason" in program, false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Rumble, Hotheaded: official effect-order evidence names the exact source, timing, Priority/Focus, and LKI", () => {
  const evidence = RUMBLE_OFFICIAL_EFFECT_ORDER_EVIDENCE;
  assert.deepEqual(evidence, OFFICIAL_EFFECT_ORDER_EVIDENCE);
  assert.equal(evidence.contract, "riftbound.official-effect-order-evidence.v1");
  assert.equal(evidence.canonicalCardId, CANONICAL);
  assert.deepEqual(evidence.sources.coreRules, {
    version: "1.5", published: "2026-10-09", effective: "2026-10-16", url: RULES_URL,
    patchNotesUrl: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
    sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec",
  });
  assert.equal(evidence.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(evidence.sources.radianceRulings.involvesThisCard, false);
  assert.equal(evidence.sources.spiritforgedErrata.involvesThisCard, false);
  assert.deepEqual(evidence.interactions.map((entry) => entry.id), ["assault-grant", "conquer-leading-recycle-play"]);
  const conquer = evidence.interactions[1];
  for (const rule of [
    "131.2", "131.3", "204.1.c", "204.3.a", "355.10.c.1", "356.1.c", "356.4.c", "356.4.g",
    "357.1", "383.3.a", "383.3.b.1", "404.1.b.1", "417.1.c",
  ]) {
    assert.ok(conquer.ruleRefs.includes(rule), `cites CR ${rule}`);
  }
  assert.ok(conquer.timeline.some((line) => /pre-move Might/u.test(line)));
  assert.ok(conquer.timeline.some((line) => /Energy component/u.test(line)));
  assert.ok(conquer.timeline.some((line) => /Power remains payable/u.test(line)));
  assert.ok(conquer.timeline.some((line) => /RIFT-985.*ProgramBinding.*printed catalog/u.test(line)));
  assert.ok(conquer.timeline.some((line) => /fails closed/u.test(line)));
  assert.match(conquer.priorityFocus, /A then B/u);
  assert.match(conquer.responseWindow, /Reaction/u);
  assert.ok(conquer.productionAssertions.some((line) => /pre-move Might/u.test(line)));
});

test("Rumble, Hotheaded: the Trash Play target admits only a controller-owned Mech unit", () => {
  assert.deepEqual(play.targets, [{
    id: "rumble.mech-in-trash",
    filter: { zone: "trash", owner: "controller", tag: "Mech", type: "unit" },
    min: 1,
    max: 1,
    selection: "one",
  }]);

  const filter = translateObjectFilter(play.targets[0].filter);
  const kernel = world().player("A").player("B")
    .unit("rumble", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .card("trash-mech", { owner: "A", zone: "trash", types: ["unit"], tags: ["Mech"] })
    .card("enemy-mech", { owner: "B", zone: "trash", types: ["unit"], tags: ["Mech"] })
    .card("trash-spell", { owner: "A", zone: "trash", types: ["spell"], tags: ["Mech"] })
    .build();
  const source = kernel.getObject("rumble");
  const eligible = (id) => matchesObjectPredicates(filter, kernel.getObject(id), {
    controller: "A",
    anchor: source,
  });
  assert.equal(eligible("trash-mech"), true);
  assert.equal(eligible("enemy-mech"), false, "owner is controller-relative");
  assert.equal(eligible("trash-spell"), false, "a Mech-tagged spell is not a unit");
});

test("Rumble, Hotheaded: the permanent grant covers friendly Mechs with Assault 1", () => {
  assert.deepEqual(grant, {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "Assault",
      value: constant(1),
      filter: { zone: "board", controller: "controller", tag: "Mech", type: "unit" },
    },
  });
  assert.deepEqual(translateObjectFilter(grant.effect.filter), {
    zone: "board", controller: "self", tags: ["Mech"], type: "unit",
  });
});

test("Rumble, Hotheaded: the grant primitive snapshots Assault 1 in the ability layer", () => {
  const kernel = world().unit("mech", { owner: "A", controller: "A", tags: ["Mech"] }).build();
  const run = runInstruction(keywordDef, {
    keyword: grant.effect.keyword,
    value: grant.effect.value.value,
    filter: { tags: ["Mech"], zone: "board" },
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registered] = kernel.continuousEffects;
  assert.equal(registered.effect.layer, "ability");
  assert.equal(registered.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registered.effect.effect.keyword, "Assault");
  assert.equal(registered.effect.effect.keywordValue, 1);
  assert.deepEqual(registered.effect.filter.objectId, "mech");
});

test("Rumble, Hotheaded: the conquer trigger matches only this source's real Conquer wave", () => {
  assert.equal(trigger.trigger.at, "conquer");
  assert.deepEqual(trigger.trigger.filter, { event: "conquered", object: { objectId: "self" } });
  assert.equal(validateTriggerSpec({ at: trigger.trigger.at, filter: trigger.trigger.filter }).ok, true);
  const source = world().unit("rumble", { cardId: CANONICAL, might: 4 }).build().getObject("rumble");
  const other = { ...source, ref: { id: "other", zoneEntryId: source.ref.zoneEntryId } };
  const event = (object) => ({
    timingPoint: "conquer", kind: "conquer", player: "A", object, source: object, it: object,
    details: { battlefieldId: "bf1", objectId: object.ref.id, playerId: "A" },
  });
  const productionFilter = { event: "conquered", object: { objectId: "rumble" } };
  assert.equal(matchesTriggerEvent(productionFilter, event(source), "A", source), true);
  assert.equal(matchesTriggerEvent(productionFilter, event(other), "A", source), false);
  assert.equal(matchesTriggerEvent(productionFilter, { ...event(source), kind: "hold", timingPoint: "hold" }, "A", source), false);
});

test("Rumble, Hotheaded: leading may wraps one non-target recycle cost and the linked discount/play body", () => {
  assert.equal(trigger.optional, false);
  assert.equal(optional.op, "choice.optional");
  assert.equal(recycleCost.op, "cost.pay");
  assert.equal(recycleCost.targets, undefined, "the recycle cost choice is not a target");
  assert.deepEqual(recycleCost.args.payments.value[0], {
    kind: "recycle",
    choice: {
      id: "rumble.fodder",
      options: [],
      filter: {
        zone: "board", controller: "controller", type: "unit",
        relation: { relation: "other", object: "self" },
      },
      min: 1, max: 1, selection: "one",
    },
  });
  assert.equal(play.linkedTo, recycleCost.id);
  assert.equal(playCost.base, "printed");
  assert.deepEqual(playCost.cost.energy, {
    kind: "object-property", object: { target: "rumble.mech-in-trash" }, property: "energy",
  });
  assert.deepEqual(playCost.modifier.amount, {
    kind: "object-property", object: { linked: recycleCost.id }, property: "might",
  });
  assert.deepEqual(play.args.cost, constant(playCost));
  assert.deepEqual(play.targets, [{
    id: "rumble.mech-in-trash",
    filter: { zone: "trash", owner: "controller", tag: "Mech", type: "unit" },
    min: 1, max: 1, selection: "one",
  }]);
});

test("Rumble, Hotheaded production component: Finalize recycles and emits [pay, play]", () => {
  const fixture = productionConquer({ energy: 10 });
  try {
    fixture.settle();
  const { kernel, flow, requests } = fixture;
  const conquer = flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.deepEqual(conquer[0].object.ref, kernel.ref("rumble"));
  assert.deepEqual(conquer[0].source.ref, kernel.ref("rumble"));
  assert.deepEqual(conquer[0].details, {
    battlefieldId: "bf1",
    battlefieldControllerBefore: null,
    objectId: "rumble",
    playerId: "A",
  });

  const finalize = requests.filter((request) => request.id === "finalize:trigger:1:optional");
  const target = requests.filter((request) => request.id === "target:rumble.mech-in-trash");
  const fodder = requests.filter((request) => request.id.endsWith(":pick:rumble.fodder"));
  assert.equal(finalize.length, 1);
  assert.equal(target.length, 1);
  assert.equal(fodder.length, 1);
  assert.deepEqual(target[0].options.map((ref) => ref.id), ["trash-mech"]);
  assert.deepEqual(fodder[0].options.map((ref) => ref.id), ["fodder"]);
  assert.deepEqual(
    flow.chain.pipeline.events.filter((event) => event.timingPoint === "became-target").map((event) => event.target.ref.id),
    ["trash-mech"],
    "only the Trash Mech is targeted; the recycle cost choice is not",
  );

  const trace = flow.chain.trace;
  const showdownOpen = trace.findIndex((entry) => entry.timingPoint === "showdown-open");
  const focusA = trace.findIndex((entry) => entry.step === "focus-granted" && entry.player === "A");
  const focusPassA = trace.findIndex((entry) => entry.step === "focus-pass" && entry.player === "A");
  const focusB = trace.findIndex((entry) => entry.step === "focus-granted" && entry.player === "B");
  const focusPassB = trace.findIndex((entry) => entry.step === "focus-pass" && entry.player === "B");
  const showdownClose = trace.findIndex((entry) => entry.timingPoint === "showdown-close");
  const conquerWave = trace.findIndex((entry) => entry.timingPoint === "conquer");
  const pending = trace.findIndex((entry) => entry.item === "trigger:1" && entry.step === "pending");
  const finalized = trace.findIndex((entry) => entry.item === "trigger:1" && entry.step === "finalized");
  const priorityA = trace.findIndex((entry, index) => index > finalized && entry.step === "priority-granted" && entry.player === "A");
  const priorityB = trace.findIndex((entry, index) => index > priorityA && entry.step === "priority-granted" && entry.player === "B");
  const closedPassA = trace.findIndex((entry, index) => index > finalized && entry.step === "pass" && entry.player === "A");
  const closedPassB = trace.findIndex((entry, index) => index > closedPassA && entry.step === "pass" && entry.player === "B");
  const resolve = trace.findIndex((entry) => entry.item === "trigger:1" && entry.step === "resolve-start");
  assert.ok(showdownOpen >= 0 && showdownOpen < focusA && focusA < focusPassA);
  assert.ok(focusPassA < focusB && focusB < focusPassB && focusPassB < showdownClose);
  assert.ok(showdownClose < conquerWave && conquerWave < pending && pending < finalized);
  assert.ok(finalized < priorityA && priorityA < closedPassA);
  assert.ok(closedPassA < priorityB && priorityB < closedPassB && closedPassB < resolve);
  assert.ok(trace.some((entry) => entry.item === "trigger:1" && entry.step === "resolved"));

  assert.equal(kernel.getObject("fodder").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").at(-1), kernel.ref("fodder"), "recycle goes to its owner's Main Deck bottom");
  assert.equal(kernel.getObject("trash-mech").zone, "board");
  assert.equal(kernel.getObject("trash-mech").controller, "A");
  assert.equal(kernel.getObject("trash-mech").exhausted, false);
  const plans = playedPlans(fixture);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].energy, 2, "5 target Energy minus the recycled Unit's Might 3");
  assert.deepEqual(plans[0].power, []);
  assert.equal(plans[0].parameters.costPlan.discounts[0].amount, 3);
  assert.equal(fixture.kernel.history({ action: "move-zone" }) >= 1, true,
    "the nested Play reaches a real Board-entry move");
    assert.equal(fixture.energyBeforeConquer, 10);
    assert.equal(kernel.player("A").energy, 0, "TurnFlow empties the Rune Pool after the resolved Play");
  } finally {
    fixture.restoreCatalogProgram();
  }
});

test("Rumble, Hotheaded production component: the discount uses the recycled Unit's current Might", () => {
  const fixture = productionConquer({ energy: 10, fodderMight: 2, mechEnergy: 6 });
  try {
    fixture.settle();
    const plans = playedPlans(fixture);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].energy, 4, "6 target Energy minus the recycled Unit's Might 2");
    assert.equal(plans[0].parameters.costPlan.discounts[0].amount, 2);
    assert.equal(fixture.kernel.getObject("trash-mech").zone, "board");
  } finally {
    fixture.restoreCatalogProgram();
  }
});

test("Rumble, Hotheaded production golden: binding catalog plays real Breakneck for 5 Energy plus 2 Mind Power", () => {
  assert.equal(breakneckMech.abilities.some((ability) => ability.kind === "play"), false);
  const trusted = bindDuelPrintedCost(BREAKNECK_CATALOG_PRINTED);
  assert.equal(trusted.kind, "numeric");
  assert.equal(trusted.cost.energy, 8);
  assert.deepEqual(trusted.cost.power, [{ amount: 2, allowedDomains: ["Mind"] }]);

  const fixture = productionConquer({
    energy: 10,
    power: ["Mind", "Mind"],
    mechEnergy: 8,
    trashProgram: breakneckMech,
    printedCatalog: [BREAKNECK_CATALOG_PRINTED],
  });
  try {
    fixture.settle();
    const plans = playedPlans(fixture);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].energy, 5);
    assert.deepEqual(plans[0].power, ["Mind", "Mind"]);
    assert.deepEqual(plans[0].parameters.costPlan.base.power, [
      { amount: 2, allowedDomains: ["Mind"] },
    ]);
    assert.equal(plans[0].parameters.costPlan.discounts[0].amount, 3);
    assert.equal(fixture.kernel.getObject("trash-mech").zone, "board");
    assert.equal(plans[0].parameters.costPlan.printed.energy, 8);
    assert.equal(plans[0].parameters.costPlan.printed.power, 2);
    assert.deepEqual(fixture.kernel.player("A").power, []);
    assert.equal(fixture.kernel.history({ action: "move-zone" }) >= 1, true,
      "the nested Play reaches a real Board-entry move");
  } finally {
    fixture.restoreCatalogProgram();
  }
});

test("Rumble, Hotheaded production boundary: missing binding catalog stays fail-closed", () => {
  const withoutPlayCost = {
    ...breakneckMech,
    abilities: breakneckMech.abilities,
  };
  withCatalogProgram(withoutPlayCost, () => {
    const kernel = world().player("A", { energy: 10, power: ["Mind", "Mind"] })
      .card("trash-mech", {
        cardId: withoutPlayCost.canonicalCardId, owner: "A", zone: "trash",
        types: ["unit"], tags: ["Mech"], energy: 8, power: ["Mind"], might: 7,
      })
      .build();
    const snapshot = kernel.getObject("trash-mech");
    assert.equal(snapshot.cardId, breakneckMech.canonicalCardId);
    assert.deepEqual(snapshot.power, ["Mind"], "the snapshot holds one Domain, never the numeric printed count 2");
    assert.equal(withoutPlayCost.abilities.some((ability) => ability.kind === "play"), false);
    const printedPlay = play.args.cost.value;
    assert.equal(printedPlay.base, "printed");
    assert.equal(printedPlay.cost.power, undefined, "the Domain set must never be promoted to Power 1 or Power 2");
    assert.throws(() => buildEffectPlayCostPlan(bindResolveContext(kernel, {
      source: snapshot, controller: "A", timingPoint: "chain-item-finalize",
    }), { object: kernel.ref("trash-mech"), player: "A", cost: {
      kind: "cost.modify", base: "printed", id: "rumble.mech-cost",
      cost: { kind: "explicit", energy: constant(8) },
      modifier: { kind: "reduce", resource: "energy", amount: constant(3) },
    } }), (error) => /complete numeric Energy and Power programme|exact numeric Power cost/u.test(error.message),
    "a missing numeric Power programme is fail-closed, never a free or one-Power Play");
    assert.equal(kernel.getObject("trash-mech").zone, "trash");
    assert.deepEqual(kernel.player("A").power, ["Mind", "Mind"], "the failed nested Play consumes no Power");
  });
});

test("Rumble, Hotheaded production boundary: absent binding catalog cannot invent printed Power", () => {
  const fixture = productionConquer({
    energy: 10,
    power: ["Mind", "Mind"],
    mechEnergy: 8,
    trashProgram: breakneckMech,
  });
  try {
    assert.equal(playCost.printed, undefined,
      "the default card cannot carry one fixed Mech projection for every legal Trash target");
    assert.throws(
      () => fixture.settle(),
      (error) => /judge-required|complete numeric Energy and Power programme/u.test(error.message),
    );
    assert.equal(fixture.kernel.getObject("trash-mech").zone, "trash");
    assert.deepEqual(fixture.kernel.player("A").power, ["Mind", "Mind"]);
    assert.equal(playedPlans(fixture).length, 0);
  } finally {
    fixture.restoreCatalogProgram();
  }
});

test("Rumble, Hotheaded production golden: recycle uses control, then places the Unit in its owner's Main Deck", () => {
  const fixture = productionConquer({ energy: 10, fodderOwner: "B" });
  try {
    fixture.settle();
    assert.equal(fixture.kernel.getObject("fodder").zone, "deck");
    assert.deepEqual(fixture.kernel.zone("B", "deck").at(-1), fixture.kernel.ref("fodder"),
      "CR 417.1.c follows ownership, not the controlling player");
    assert.equal(fixture.kernel.zone("A", "deck").some((ref) => ref.id === "fodder"), false);
    assert.equal(fixture.kernel.getObject("trash-mech").zone, "board");
    assert.equal(playedPlans(fixture)[0].energy, 2);
  } finally {
    fixture.restoreCatalogProgram();
  }
});

test("Rumble, Hotheaded production boundary: declining Finalize neither selects nor recycles a Unit", () => {
  const fixture = productionConquer({ accept: false, energy: 10 });
  try {
    fixture.settle();
    assert.deepEqual(fixture.requests.map((request) => request.id), ["finalize:trigger:1:optional"]);
    assert.equal(fixture.kernel.getObject("fodder").zone, "board");
    assert.equal(fixture.kernel.getObject("trash-mech").zone, "trash");
    assert.ok(fixture.flow.chain.trace.some((entry) =>
      entry.item === "trigger:1" && entry.step === "removed" && entry.reason === "declined"));
  } finally {
    fixture.restoreCatalogProgram();
  }
});

test("Rumble, Hotheaded production boundary: without another friendly Unit Finalize rejects the unpayable recycle", () => {
  const fixture = productionConquer({ energy: 10, fodder: false });
  try {
    assert.throws(() => fixture.settle(), (error) =>
      /Cost choice cannot be completed from the current zone/u.test(error.message));
    assert.deepEqual(fixture.requests.map((request) => request.id), [
      "finalize:trigger:1:optional",
      "target:rumble.mech-in-trash",
    ]);
    assert.equal(fixture.kernel.getObject("trash-mech").zone, "trash");
    assert.equal(fixture.kernel.player("A").energy, 10);
  } finally {
    fixture.restoreCatalogProgram();
  }
});

test("Rumble, Hotheaded production boundary: an unpayable reduced Play does not become a free Play", () => {
  const fixture = productionConquer({ energy: 1 });
  try {
    fixture.settle();
    assert.notEqual(fixture.kernel.getObject("trash-mech").zone, "board", "the reduced cost never becomes a free Play");
    assert.equal(fixture.kernel.getObject("fodder").zone, "deck", "the leading recycle was already paid at Finalize");
    assert.equal(fixture.kernel.player("A").energy, 0, "the failed nested Play pays no additional Energy");
    assert.equal(playedPlans(fixture).length, 0);
    assert.equal(fixture.flow.chain.pipeline.events.some((event) => event.action?.type === "play"), false);
  } finally {
    fixture.restoreCatalogProgram();
  }
});

test("Rumble, Hotheaded: Board recycle payment accepts a friendly Unit and rejects an enemy Unit", () => {
  const kernel = world().player("A").player("B")
    .unit("rumble", { owner: "A", controller: "A", might: 4 })
    .unit("fodder", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 3 })
    .build();
  const context = kernel.clone({
    source: kernel.ref("rumble"),
    sourceSnapshot: kernel.getObject("rumble"),
    timingPoint: "chain-item-finalize",
  });
  const friendly = assessCostPayment(context, buildCostPlan(context, {
    id: "rumble.board-recycle",
    cost: { kind: "explicit", payments: [{ kind: "recycle", object: kernel.ref("fodder") }] },
  }));
  assert.equal(friendly.payable, true);
  assert.equal(friendly.prepared.actions.at(-1).action.type, "recycle");
  assert.equal(kernel.getObject("fodder").zone, "board");

  const enemy = assessCostPayment(context, buildCostPlan(context, {
    id: "rumble.enemy-board-recycle",
    cost: { kind: "explicit", payments: [{ kind: "recycle", object: kernel.ref("enemy") }] },
  }));
  assert.equal(enemy.payable, false);
  assert.equal(enemy.error.reason, "cannot-pay-cost");
  assert.equal(kernel.getObject("enemy").zone, "board");
});

test("Rumble, Hotheaded: recycle, Might-valued reduction, payment and Trash Mech Play primitives execute", () => {
  const kernel = world()
    .player("A", { energy: 5 })
    .unit("rumble", { cardId: CANONICAL, tags: ["Mech"], might: 4 })
    .unit("fodder", { controller: "A", might: 3 })
    .card("trash-mech", { zone: "trash", types: ["unit"], tags: ["Mech"], energy: 5, power: null })
    .card("trash-spell", { zone: "trash", types: ["spell"], tags: ["Mech"], energy: 4, power: null })
    .build();
  const fodderRef = kernel.ref("fodder");
  const mechRef = kernel.ref("trash-mech");
  const recycled = runInstruction(recycleDef, { objects: constant(fodderRef) }, { world: kernel });
  assert.equal(recycled.result.status, "executed");
  assert.deepEqual(recycled.linked.recycled, [fodderRef]);
  assert.equal(recycled.linked.recycledCount, 1);
  assert.equal(kernel.getObject("fodder").zone, "deck");
  assert.deepEqual(recycled.events.map((event) => event.action), ["recycle"]);

  const planKernel = world().player("A", { energy: 5 }).unit("fodder", { might: 3 }).build();
  const planRun = runInstruction(costModify, {
    id: "rumble.probe-cost",
    cost: { kind: "explicit", energy: constant(5) },
    modifier: {
      kind: "reduce", resource: "energy",
      amount: { kind: "object-property", object: { target: "fodder" }, property: "might" },
    },
  }, { world: planKernel, targets: { fodder: [planKernel.ref("fodder")] } });
  assert.equal(planRun.result.status, "executed");
  assert.equal(planRun.linked.cost.finalized, true);
  assert.equal(planRun.linked.cost.total.energy, 2);
  assert.deepEqual(planRun.linked.cost.discounts.map((entry) => [entry.amount, entry.before, entry.after]), [[3, 5, 2]]);

  const paid = runInstruction(costPay, { cost: constant(planRun.linked.cost) }, { world: planKernel });
  assert.equal(paid.result.status, "executed");
  assert.equal(paid.linked.payment.total.energy, 2);
  assert.equal(planKernel.player("A").energy, 3);
  assert.deepEqual(paid.events.map((event) => event.action), ["pay"]);

  const played = runInstruction(playDef, {
    target: "rumble.mech-in-trash",
    cost: constant({ finalized: true, energy: 2, power: [] }),
  }, { world: kernel, targets: { "rumble.mech-in-trash": [mechRef] } });
  assert.equal(played.result.status, "executed");
  assert.equal(played.linked.played, 1);
  assert.equal(kernel.getObject("trash-mech").zone, "board");
  assert.deepEqual(played.events.map((event) => event.action), ["pay", "play"]);
  assert.equal(kernel.getObject("trash-spell").zone, "trash");
});

test("Rumble, Hotheaded production golden: Assault adds Might only to friendly Mechs while attacking", () => {
  const kernel = world()
    .hand("rumble", { cardId: CANONICAL, types: ["unit"], tags: ["Mech"], might: 4 })
    .unit("friendly-mech", { owner: "A", controller: "A", types: ["unit"], tags: ["Mech"], might: 3, combatRole: "attacker" })
    .unit("friendly-defender", { owner: "A", controller: "A", types: ["unit"], tags: ["Mech"], might: 3, combatRole: "defender" })
    .unit("friendly-other", { owner: "A", controller: "A", types: ["unit"], tags: [], might: 3, combatRole: "attacker" })
    .unit("enemy-mech", { owner: "B", controller: "B", types: ["unit"], tags: ["Mech"], might: 3, combatRole: "attacker",
      location: { type: "base", player: "B" } })
    .build();
  const choose = (request) => { throw new Error(`Unexpected production choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  const flow = new TurnFlow({
    host, player: (id) => kernel.player(id), turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    describePlay: binding.describePlay,
  });
  const lifecycle = binding.attachLifecycle(flow.chain, (error) => { throw error; });
  assert.equal(flow.chain.commit({ type: "move-zone", object: kernel.ref("rumble"), to: "base", location: { type: "base", player: "A" } }).status, "done");
  flow.chain.advance();
  const evaluate = (id) => {
    flow.chain.layers.setObjects(kernel.objects);
    return flow.chain.layers.evaluate(kernel.ref(id));
  };
  assert.deepEqual(evaluate("rumble").keywords, [{ id: "Assault", value: 1 }]);
  assert.deepEqual(evaluate("friendly-mech").keywords, [{ id: "Assault", value: 1 }]);
  assert.equal(evaluate("friendly-mech").might, 4);
  assert.deepEqual(evaluate("friendly-defender").keywords, [{ id: "Assault", value: 1 }]);
  assert.equal(evaluate("friendly-defender").might, 3, "Assault is inactive while defending");
  assert.deepEqual(evaluate("friendly-other").keywords, []);
  assert.deepEqual(evaluate("enemy-mech").keywords, []);
  assert.equal(flow.chain.commit({ type: "move-zone", object: kernel.ref("rumble"), to: "hand" }).status, "done");
  flow.chain.advance();
  assert.deepEqual(evaluate("friendly-mech").keywords, []);
});

test("Rumble, Hotheaded static lifecycle: isolated Assault grant survives in layers and is cleared by detach", () => {
  const kernel = world()
    .hand("rumble", {
      cardId: CANONICAL, owner: "A", types: ["unit"], tags: ["Mech"], might: 4,
      combatRole: "attacker", energy: null, power: null,
    })
    .unit("friendly-mech", {
      owner: "A", controller: "A", types: ["unit"], tags: ["Mech"], might: 3,
      combatRole: "attacker", location: { type: "base", player: "A" },
    })
    .unit("friendly-defender", {
      owner: "A", controller: "A", types: ["unit"], tags: ["Mech"], might: 3,
      combatRole: "defender", location: { type: "base", player: "A" },
    })
    .unit("friendly-other", {
      owner: "A", controller: "A", types: ["unit"], tags: [], might: 3,
      combatRole: "attacker", location: { type: "base", player: "A" },
    })
    .unit("enemy-mech", {
      owner: "B", controller: "B", types: ["unit"], tags: ["Mech"], might: 3,
      combatRole: "attacker", location: { type: "base", player: "B" },
    })
    .build();
  const choose = (request) => { throw new Error(`Unexpected production choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({
    host, turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", cleanup: () => false,
  });
  const staticOnly = { ...admitted, abilities: [program.abilities[0]] };
  const lifecycle = createProgramBinding({ cardPrograms: [staticOnly] }).attachLifecycle(engine);
  assert.equal(engine.commit({ type: "move-zone", object: kernel.ref("rumble"), to: "chain" }).status, "done");
  assert.equal(engine.commit({
    type: "move-zone", object: kernel.ref("rumble"), to: "base",
    location: { type: "base", player: "A" },
  }).status, "done");
  engine.advance();
  const evaluate = (id) => {
    engine.layers.setObjects(kernel.objects);
    return engine.layers.evaluate(kernel.ref(id));
  };
  const registrations = engine.layers.registry.list();
  assert.equal(registrations.length, 1, "the static-only program registers exactly its Assault grant");
  assert.match(registrations[0].effect.id, /^program-static:rumble:/u);
  assert.equal(registrations[0].effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registrations[0].effect.effect.keyword, "Assault");
  assert.equal(registrations[0].effect.effect.value.value, 1);
  assert.deepEqual(evaluate("rumble").keywords, [{ id: "Assault", value: 1 }]);
  assert.deepEqual(evaluate("friendly-mech").keywords, [{ id: "Assault", value: 1 }]);
  assert.equal(evaluate("friendly-mech").might, 4);
  assert.deepEqual(evaluate("friendly-defender").keywords, [{ id: "Assault", value: 1 }]);
  assert.equal(evaluate("friendly-defender").might, 3);
  assert.deepEqual(evaluate("friendly-other").keywords, []);
  assert.equal(evaluate("friendly-other").might, 3);
  assert.deepEqual(evaluate("enemy-mech").keywords, []);
  assert.equal(evaluate("enemy-mech").might, 3);

  lifecycle.detach();
  assert.equal(engine.layers.registry.list().length, 0);
  assert.deepEqual(evaluate("rumble").keywords, []);
  assert.deepEqual(evaluate("rumble").might, 4);
  assert.deepEqual(evaluate("friendly-mech").keywords, []);
  assert.equal(evaluate("friendly-mech").might, 3);
  assert.deepEqual(evaluate("friendly-defender").keywords, []);
  assert.equal(evaluate("friendly-defender").might, 3);
  assert.deepEqual(evaluate("friendly-other").keywords, []);
  assert.deepEqual(evaluate("enemy-mech").keywords, []);
});
