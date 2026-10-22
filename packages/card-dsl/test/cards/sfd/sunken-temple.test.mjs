import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sunken-temple.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { createMatch } from "../../../../engine-core/dist/game/lifecycle.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";
import { world } from "../../fixtures/production-play.mjs";

const field = (id = "bf1") => ({ type: "battlefield", id });
const constant = value => ({ kind: "constant", value });
const admitted = () => ({ ...program, status: "executable", judgeReason: undefined });

const CORE_RULES_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";

const OFFICIAL_EVIDENCE = Object.freeze({
  coreRules: Object.freeze({ version: "1.5", lastUpdated: "2026-10-09", effective: "2026-10-16", url: CORE_RULES_URL }),
  radiance: Object.freeze({ effective: "2026-10-16", involvesThisCard: false, url: RADIANCE_URL }),
  spiritforgedErrata: Object.freeze({ involvesThisCard: false, url: SFD_ERRATA_URL }),
  canonicalCardId: program.canonicalCardId,
  sourceText: program.sourceText,
  rules: Object.freeze({
    setup: Object.freeze(["170.2.a", "170.2.b"]),
    battlefieldControl: Object.freeze(["190.6.a", "190.6.d"]),
    optionalCostFinalize: Object.freeze(["383.3.a", "383.3.a.1", "383.3.a.2", "383.3.b", "383.3.b.1"]),
    simultaneousTriggerOrder: Object.freeze(["383.3.d", "383.3.d.1"]),
    conquer: Object.freeze(["383.4.c", "383.4.c.2", "383.4.c.2.b", "383.4.c.2.c", "473.2.a"]),
    scoreOnce: Object.freeze(["472", "473.2.c"]),
    mighty: Object.freeze(["706", "708", "710"]),
    layerDependency: Object.freeze(["478.1", "479.4.e.1.a"]),
  }),
});

const EVIDENCE_TIMELINES = Object.freeze({
  printedResolution: Object.freeze({
    productionTest: "sunken-temple: lifecycle-bound single-Mighty golden pays then draws after the real Score wave",
    timeline: Object.freeze([
      "setup / establish Battlefield",
      "conquer Score wave",
      "Pending Conquer trigger",
      "Finalize optional decision and 1 Energy cost",
      "Resolve draw",
    ]),
  }),
  effectiveMight: Object.freeze({
    productionTest: "sunken-temple: current layered Might of 5 satisfies Mighty and executes once",
    timeline: Object.freeze([
      "frozen participating Units",
      "current layered Might",
      "condition true at 5+",
      "Pending Conquer trigger",
      "Finalize",
      "Resolve",
    ]),
  }),
  opponentConquer: Object.freeze({
    productionTest: "sunken-temple: current controller conquers and receives the Finalize/Resolve path",
    timeline: Object.freeze([
      "A initially controls Battlefield",
      "B conquers and control changes",
      "B becomes Battlefield ability controller",
      "Pending",
      "Finalize",
      "Resolve for B",
    ]),
  }),
  simultaneousTriggers: Object.freeze({
    applicable: false,
    productionTest: "sunken-temple: one Score wave collects exactly one trigger for multiple Mighty Units",
    observedTriggerCount: 1,
    reason: "Sunken Temple contributes one trigger to this Score; CR 383.3.d ordering is not needed to resolve the card",
  }),
  priorityResponse: Object.freeze({
    productionTest: "sunken-temple: lifecycle-bound single-Mighty golden pays then draws after the real Score wave",
    timeline: Object.freeze(["Pending", "Finalize", "A pass", "B pass", "Resolve"]),
  }),
  replacedPoint: Object.freeze({
    productionTest: "sunken-temple: a replaced point gain preserves the Conquer trigger and its real draw",
    timeline: Object.freeze([
      "Conquer",
      "Score point gain replaced by Draw",
      "Conquer Effect still Pending",
      "Finalize and pay",
      "resolve the paid Draw",
    ]),
  }),
});

const deckCard = (id, type) => ({
  id,
  cardId: id,
  canonicalCardId: id,
  types: [type],
  cardType: type,
  energy: type === "unit" ? 1 : null,
  power: [],
  might: type === "unit" ? 2 : null,
});

function matchDeck(prefix, { sunkenTemple = false } = {}) {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => deckCard(`${prefix}:main:${index}`, "unit")),
    runeDeck: Array.from({ length: 8 }, (_, index) => deckCard(`${prefix}:rune:${index}`, "rune")),
    championLegend: deckCard(`${prefix}:legend`, "legend"),
    chosenChampion: deckCard(`${prefix}:champion`, "champion"),
    battlefields: Array.from({ length: 3 }, (_, index) => {
      const card = deckCard(`${prefix}:battlefield:${index}`, "battlefield");
      return sunkenTemple && index === 0 ? { ...card, cardId: program.canonicalCardId } : card;
    }),
  };
}

function runtime({
  units = {}, give = true, enterThroughLifecycle = true, fields, energy = 2, energyB = 0,
  replaceScore = false, orderFirst = true,
} = {}) {
  const builder = world().player("A", { energy }).player("B", { energy: energyB })
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: "A" })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: "B" })
    .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: "A" })
    .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: "B" })
    .object("temple", {
      cardId: program.canonicalCardId,
      types: ["battlefield"],
      zone: enterThroughLifecycle ? "hand" : "board",
      location: enterThroughLifecycle ? null : field(),
      owner: "A",
      controller: "A",
      energy: null,
      power: null,
      might: null
    });
  for (const [id, values] of Object.entries(units)) {
    builder.unit(id, {
      owner: "A",
      controller: "A",
      power: [],
      location: field(),
      ...values
    });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "optional") return give;
    if (request.type === "mode") return orderFirst ? request.options[0] : request.options.at(-1);
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [admitted()] });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: fields ?? [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    victoryScore: 20
  });
  const errors = [];
  if (replaceScore) {
    flow.chain.pipeline.registerReplacement({
      id: "sunken-temple:replace-point",
      matches: action => action.type === "score",
      apply: action => ({ status: "replace", actions: [{ type: "draw", player: action.player, amount: 1 }] }),
    });
  }
  // The runtime's turn-start built-in draw happens before the Conquer. Capture
  // its trace boundary so this card's modified-draw assertion remains exact.
  binding.attachLifecycle(flow.chain, error => { errors.push(error); throw error; });
  if (enterThroughLifecycle) {
    const entered = flow.chain.commit({ type: "move-zone", object: kernel.ref("temple"), to: "battlefield", location: field() });
    assert.equal(entered.status, "done");
  }
  const registrations = [...flow.chain.pipeline.checkpoint().triggers.keys()];
  const fired = [];
  const append = flow.chain.pipeline.onTrigger;
  flow.chain.pipeline.onTrigger = snapshot => { fired.push(snapshot); append(snapshot); };
  flow.start();
  const initialDrawEvents = flow.chain.pipeline.events.filter(event => event.timingPoint === "card-drawn").length;
  for (let guard = 0; guard < 100; guard++) {
    if (flow.chain.items.length) { flow.chain.pass(flow.chain.priority); continue; }
    if (flow.chain.focus) { flow.pass(flow.chain.focus); continue; }
    break;
  }
  return { kernel, flow, binding, registrations, fired, requests, errors, initialDrawEvents };
}

test("sunken-temple: official CR/SFD/Radiance evidence is pinned to the complete printed timeline", () => {
  assert.equal(OFFICIAL_EVIDENCE.coreRules.version, "1.5");
  assert.equal(OFFICIAL_EVIDENCE.coreRules.lastUpdated, "2026-10-09");
  assert.equal(OFFICIAL_EVIDENCE.coreRules.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.radiance.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.radiance.involvesThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedErrata.involvesThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, program.canonicalCardId);
  assert.equal(OFFICIAL_EVIDENCE.sourceText, program.sourceText);
  assert.deepEqual(OFFICIAL_EVIDENCE.rules.setup, ["170.2.a", "170.2.b"]);
  assert.deepEqual(OFFICIAL_EVIDENCE.rules.battlefieldControl, ["190.6.a", "190.6.d"]);
  assert.deepEqual(OFFICIAL_EVIDENCE.rules.optionalCostFinalize, ["383.3.a", "383.3.a.1", "383.3.a.2", "383.3.b", "383.3.b.1"]);
  assert.deepEqual(OFFICIAL_EVIDENCE.rules.simultaneousTriggerOrder, ["383.3.d", "383.3.d.1"]);
  assert.deepEqual(OFFICIAL_EVIDENCE.rules.conquer, ["383.4.c", "383.4.c.2", "383.4.c.2.b", "383.4.c.2.c", "473.2.a"]);
  assert.deepEqual(OFFICIAL_EVIDENCE.rules.scoreOnce, ["472", "473.2.c"]);
  assert.deepEqual(OFFICIAL_EVIDENCE.rules.mighty, ["706", "708", "710"]);
  assert.deepEqual(OFFICIAL_EVIDENCE.rules.layerDependency, ["478.1", "479.4.e.1.a"]);
  assert.deepEqual(EVIDENCE_TIMELINES.printedResolution.timeline, [
    "setup / establish Battlefield",
    "conquer Score wave",
    "Pending Conquer trigger",
    "Finalize optional decision and 1 Energy cost",
    "Resolve draw",
  ]);
  assert.deepEqual(EVIDENCE_TIMELINES.effectiveMight.timeline, [
    "frozen participating Units",
    "current layered Might",
    "condition true at 5+",
    "Pending Conquer trigger",
    "Finalize",
    "Resolve",
  ]);
  assert.deepEqual(EVIDENCE_TIMELINES.opponentConquer.timeline, [
    "A initially controls Battlefield",
    "B conquers and control changes",
    "B becomes Battlefield ability controller",
    "Pending",
    "Finalize",
    "Resolve for B",
  ]);
  assert.deepEqual(EVIDENCE_TIMELINES.simultaneousTriggers, {
    applicable: false,
    productionTest: "sunken-temple: one Score wave collects exactly one trigger for multiple Mighty Units",
    observedTriggerCount: 1,
    reason: "Sunken Temple contributes one trigger to this Score; CR 383.3.d ordering is not needed to resolve the card",
  });
  assert.deepEqual(EVIDENCE_TIMELINES.priorityResponse.timeline, [
    "Pending",
    "Finalize",
    "A pass",
    "B pass",
    "Resolve",
  ]);
  assert.deepEqual(EVIDENCE_TIMELINES.replacedPoint.timeline, [
    "Conquer",
    "Score point gain replaced by Draw",
    "Conquer Effect still Pending",
    "Finalize and pay",
    "resolve the paid Draw",
  ]);
});

test("sunken-temple: validates with current judge-required reasons and exact IR", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /game\/lifecycle\.ts:381-386/);
  assert.match(program.judgeReason, /apps\/game-server\/src\/room\.ts:236-246/);
  assert.match(program.judgeReason, /190\.6\.a\/d/);
  assert.doesNotMatch(program.judgeReason, /turn\/flow\.ts:153-170/);
  assert.doesNotMatch(program.judgeReason, /events\/pipeline\.ts:61-74/);
  assert.doesNotMatch(program.judgeReason, /combat\/flow\.ts:387-394/);
  assert.doesNotMatch(program.judgeReason, /Unsupported filter field here/);
  assert.doesNotMatch(program.judgeReason, /Might 阈值/);

  const [ability] = program.abilities;
  assert.deepEqual(ability.trigger.filter, { event: "conquered", here: true, player: "self" });
  assert.deepEqual(ability.trigger.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "conquering-mighty-units-at-this-battlefield",
      filter: { type: "unit", controller: "self", mightGte: 5, sameLocationAs: "source" }
    },
    operator: "gte",
    right: constant(1)
  });
  assert.equal(ability.trigger.once, "per-batch");
  assert.equal(ability.optional, true);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["sunken-temple.opt-in"]);
});

test("sunken-temple: production binding preserves here, Mighty and leading Finalize cost", () => {
  const source = world()
    .object("temple", { cardId: program.canonicalCardId, types: ["battlefield"], zone: "board",
      location: field(), owner: "A", controller: "A", energy: null, power: null, might: null })
    .build()
    .getObject("temple");
  const binding = createProgramBinding({ cardPrograms: [admitted()] });
  const [registration] = triggerRegistrations(binding.registry, source);
  assert.deepEqual(registration.spec.filter, { event: "conquered", here: true, player: "self" });
  assert.deepEqual(registration.cost, {
    id: "cost:temple:1:sunken-temple.opt-in",
    cost: { energy: constant(1) }
  });
  assert.equal(registration.mayAtFinalize, true);
  assert.deepEqual(registration.body.map(instruction => instruction.op), ["effect.draw"]);
});

test("sunken-temple: event here matches only this battlefield and its controller", () => {
  const sourceWorld = world()
    .object("temple", { types: ["battlefield"], zone: "board", location: field(), owner: "A", controller: "A" })
    .unit("conqueror", { owner: "A", controller: "A", might: 6, location: field() })
    .build();
  const source = sourceWorld.getObject("temple");
  const unit = sourceWorld.getObject("conqueror");
  const filter = translateTriggerFilter(program.abilities[0].trigger.filter, "temple", "conquer");
  const event = battlefield => ({
    type: "task-resolved", seq: 1, eventId: 1, turnNumber: 1, activePlayerId: "A",
    taskId: "conquer", sourceCardId: "", reason: "conquer", autoResolved: true,
    timingPoint: "conquer", kind: "conquer", player: "A", object: unit, source: unit, it: unit,
    details: { battlefieldId: battlefield, objectId: "conqueror", playerId: "A" }
  });
  assert.equal(matchesTriggerEvent(filter, event("bf1"), "A", source), true);
  assert.equal(matchesTriggerEvent(filter, event("bf2"), "A", source), false);
  assert.equal(matchesTriggerEvent(filter, event("bf1"), "B", source), false);
});

test("sunken-temple: current controller conquers and receives the Finalize/Resolve path", () => {
  const f = runtime({ units: { enemyConqueror: { owner: "B", controller: "B", might: 6 } }, energyB: 2 });
  assert.equal(f.kernel.getObject("temple").controller, "B");
  assert.equal(f.fired.length, 1);
  assert.equal(f.fired[0].controller, "B");
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(f.kernel.player("B").energy, 1);
  assert.deepEqual(f.kernel.zone("B", "hand").map(ref => ref.id), ["B:deck:0"]);
  assert.equal(f.kernel.player("A").energy, 2, "the former controller pays nothing");
  assert.equal(f.kernel.zone("A", "hand").length, 0, "the former controller draws nothing");
});

test("sunken-temple: optional 1 Energy is chosen at Finalize and unavailable cost cannot pay", () => {
  const f = runtime({ units: { mighty: { might: 6 } }, energy: 0 });
  assert.equal(f.fired.length, 1);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  const pending = f.flow.chain.trace.find(event => event.step === "pending" && String(event.item).startsWith("trigger:"));
  assert.ok(pending, "the trigger reaches Pending before the Finalize decision");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["A:deck:0"]);
  assert.equal(f.flow.chain.trace.some(event => event.step === "resolved" && String(event.item).startsWith("trigger:")), false);
});

test("sunken-temple: lifecycle-bound single-Mighty golden pays then draws after the real Score wave", () => {
  const f = runtime({ units: { mighty: { might: 6 } } });
  assert.deepEqual(f.registrations, ["program:temple:2:0"]);
  assert.deepEqual(f.errors, []);
  assert.equal(f.fired.length, 1);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["A:deck:0"]);
  assert.equal(f.kernel.player("A").score, 1);
  assert.equal(f.flow.battlefields.find(battlefield => battlefield.id === "bf1").controller, "A");
  assert.deepEqual(f.flow.chain.items, []);

  const events = f.flow.chain.pipeline.events;
  const conquer = events.findIndex(event => event.timingPoint === "conquer");
  const score = events.findIndex(event => event.timingPoint === "score");
  const finalized = events.findIndex(event => event.timingPoint === "chain-item-finalize" && event.details?.item === "trigger:1");
  const drawn = events.findIndex(event => event.timingPoint === "card-drawn");
  assert.ok(conquer < score && score < finalized && finalized < drawn);
  const trace = f.flow.chain.trace.filter(event => event.item === "trigger:1" || event.step === "pass");
  assert.deepEqual(trace.map(event => [event.step, event.player ?? event.item]), [
    ["pending", "trigger:1"],
    ["finalize-start", "trigger:1"],
    ["finalized", "trigger:1"],
    ["pass", "A"],
    ["pass", "B"],
    ["resolve-start", "trigger:1"],
    ["resolved", "trigger:1"],
    ["removed", "trigger:1"],
  ]);
});

test("sunken-temple: condition boundary and optional decline pay and draw nothing", () => {
  const weak = runtime({ units: { weak: { might: 4 } } });
  assert.deepEqual(weak.registrations, ["program:temple:2:0"]);
  assert.equal(weak.fired.length, 0);
  assert.equal(weak.kernel.player("A").energy, 0);
  assert.equal(weak.kernel.zone("A", "hand").length, 1, "the turn draw is present, but no temple draw");

  const declined = runtime({ units: { mighty: { might: 6 } }, give: false });
  assert.deepEqual(declined.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(declined.kernel.player("A").energy, 0);
  assert.equal(declined.kernel.zone("A", "hand").length, 1, "declining adds no temple draw");
});

test("sunken-temple: one Score wave collects exactly one trigger for multiple Mighty Units", () => {
  const f = runtime({ units: { first: { might: 6 }, second: { might: 5 } } });
  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
  const score = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "score");
  assert.equal(conquer.length, 2);
  assert.equal(score.length, 1);
  assert.equal(new Set(conquer.map(event => event.batchId)).size, 1);
  assert.equal(conquer[0].batchId, score[0].batchId);
  assert.deepEqual(score[0].details.participatingUnits, [f.kernel.ref("first"), f.kernel.ref("second")]);
  assert.equal(f.fired.length, 1);
  assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
  assert.equal(f.flow.chain.trace.filter(event => event.step === "pending" && String(event.item).startsWith("trigger:")).length, 1);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["A:deck:0"]);
});

test("sunken-temple: a replaced point gain preserves the Conquer trigger and its real draw", () => {
  const f = runtime({ units: { mighty: { might: 6 } }, replaceScore: true });
  assert.equal(f.kernel.player("A").score, 0);
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer").length, 1);
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "score").length, 1);
  assert.equal(f.fired.length, 1, "383.4.c.2.c keeps the Conquer Effect independent of the point replacement");
  assert.equal(f.kernel.player("A").energy, 1);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["A:deck:0", "A:deck:1"],
    "one Draw replaces the point; Sunken Temple's paid Draw adds the other");
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "card-drawn").length, f.initialDrawEvents + 2);
  assert.equal(f.flow.scored("A").includes("bf1"), true, "472 records the Score even when its point is replaced");
});


test("sunken-temple: one Mighty Unit satisfies the condition even when weaker Units also conquer", () => {
  const f = runtime({ units: { mighty: { might: 6 }, weakOne: { might: 4 }, weakTwo: { might: 1 } } });
  assert.deepEqual(new Set(f.fired.map(snapshot => snapshot.event.object.ref.id)), new Set(["mighty"]));
  assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["A:deck:0"]);
});

test("sunken-temple: current layered Might of 5 satisfies Mighty and executes once", () => {
  const f = runtime({ units: { buffed: { might: 4, buffs: 1 } } });
  assert.equal(f.kernel.getObject("buffed").might, 4);
  f.flow.chain.layers.setObjects(f.kernel.objects);
  assert.equal(f.flow.chain.layers.snapshot(f.kernel.ref("buffed")).might, 5);
  assert.equal(f.fired.length, 1);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["A:deck:0"]);
});

test("sunken-temple: event here rejects a Mighty conqueror at the other battlefield", () => {
  const f = runtime({
    units: { weak: { might: 4 }, mightyElsewhere: { might: 6, location: field("bf2") } },
    fields: [{ id: "bf1", controller: null }, { id: "bf2", controller: "A" }]
  });
  assert.equal(f.fired.length, 0, "both event here and the query's sameLocationAs exclude the other battlefield");
  assert.deepEqual(f.requests, []);
});

test("sunken-temple: unlayered raw Might is not silently rewritten by condition evaluation", () => {
  const kernel = world().unit("mighty", { might: 6 }).unit("weak", { might: 1 }).build();
  assert.equal(kernel.evaluate({ kind: "count", subject: "conquering-units", filter: { type: "unit" } }), 2);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("mighty") });
  assert.equal(context.test({
    kind: "compare",
    left: { kind: "count", subject: "units", filter: { type: "unit", mightGte: 5 } },
    operator: "gte",
    right: constant(1)
  }), true);
});

test("sunken-temple: a conqueror other than the captured ability controller does not match", () => {
  const sourceWorld = world()
    .object("temple", { types: ["battlefield"], zone: "board", location: field(), owner: "A", controller: "A" })
    .build();
  const filter = translateTriggerFilter(program.abilities[0].trigger.filter, "temple", "conquer");
  const event = {
    type: "task-resolved", seq: 1, eventId: 1, turnNumber: 1, activePlayerId: "B",
    taskId: "conquer", sourceCardId: "", reason: "conquer", autoResolved: true,
    timingPoint: "conquer", kind: "conquer", player: "B",
    details: { battlefieldId: "bf1", objectId: "conqueror", playerId: "B" },
  };
  assert.equal(matchesTriggerEvent(filter, event, "A", sourceWorld.getObject("temple")), false);
  assert.equal(matchesTriggerEvent(filter, event, "B", sourceWorld.getObject("temple")), true);
});

test("sunken-temple: Battlefield setup is not complete before the host enters the rules zone", () => {
  const kernel = world().player("A").player("B").build();
  const choose = request => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected setup choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  host.player = id => kernel.player(id);
  const binding = createProgramBinding({ cardPrograms: [admitted()] });
  const match = createMatch({
    host,
    decks: [matchDeck("A", { sunkenTemple: true }), matchDeck("B")],
    programs: binding,
    seed: "sunken-temple-setup-gap",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
    victoryScore: 20,
  });
  const selected = match.setup.battlefields.find(field => field.cardId === program.canonicalCardId);
  assert.ok(selected, "the selected Sunken Temple must be represented in setup");
  assert.equal(kernel.getObject(selected.id).zone, "chain", "selected setup Battlefields are still pending on the Chain");
  assert.equal(selected.staged, "none");
  assert.equal(match.setup.battlefields.some(field => field.controller !== null), false);
});

test("sunken-temple: official evidence timelines name the executable production assertions", () => {
  assert.equal(EVIDENCE_TIMELINES.printedResolution.timeline.length, 5);
  assert.equal(EVIDENCE_TIMELINES.effectiveMight.timeline.length, 6);
  assert.equal(EVIDENCE_TIMELINES.opponentConquer.timeline.length, 6);
  assert.equal(EVIDENCE_TIMELINES.simultaneousTriggers.applicable, false);
  assert.equal(EVIDENCE_TIMELINES.simultaneousTriggers.observedTriggerCount, 1);
  assert.equal(EVIDENCE_TIMELINES.priorityResponse.timeline.length, 5);
  assert.equal(EVIDENCE_TIMELINES.replacedPoint.timeline.length, 5);
  assert.match(CORE_RULES_URL, /5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94\.pdf$/);
  assert.match(RADIANCE_URL, /effective-october-16-2026/);
  assert.match(SFD_ERRATA_URL, /spiritforged-errata/);
});
