import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import goldProgram from "../../../dist/cards/sfd/gold.js";
import program from "../../../dist/cards/sfd/treasure-hoard.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { getTokenDefinition } from "../../../../engine-core/dist/effects/tokens/definitions.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createMatchCommandAdapter } from "../../../../engine-core/dist/game/command-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { createMatch } from "../../../../engine-core/dist/game/lifecycle.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL = "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564";
const SOURCE_TEXT = "When you conquer here, you may pay :rb_energy_1: to play a Gold gear token exhausted.";
const CORE_URL = "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL = "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL = "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const [ability] = program.abilities;
const [optional] = ability.body;
const [pay, playGold] = optional.args.body.value;

// Source snapshots are pinned under shared/rules/official-order. Neither the
// Radiance patch nor the Spiritforged errata replaces or corrects Treasure Hoard
// or its Gold token, so CR v1.5 remains the governing source below.
const OFFICIAL_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CANONICAL,
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      dated: "2026-10-09",
      effective: "2026-10-16",
      url: CORE_URL,
      pdfSha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec",
      extractedTextSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_URL,
      applicableToThisCard: false,
      result: "reviewed: no Treasure Hoard or Gold token-specific ruling changes CR v1.5"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      applicableToThisCard: false,
      result: "reviewed: no Treasure Hoard or Gold token correction"
    })
  }),
  interactions: Object.freeze({
    conquerHere: Object.freeze({
      canonicalCardId: CANONICAL,
      ruleRefs: Object.freeze(["133.6.a.1", "190.6", "190.6.b", "190.6.d", "199.1", "383.4.c.2.b", "471.1"]),
      setup: "CR 133.6.a.1 requires the selected Battlefield to start on the Board; its abilities follow the current Battlefield controller under CR 190.6.",
      timeline: Object.freeze([
        "Battlefield becomes a Board Game Object at its own Location (199.1).",
        "A Unit establishes control and the real Score task publishes Conquer (383.4.c.2.b / 471.1).",
        "The matching conquer trigger becomes a Pending Chain Item; Focus/Priority follows the ordinary Chain rather than an invented priority value.",
        "LKI is not needed for the trigger condition; the emitted conquer payload identifies the exact battlefield."
      ]),
      productionAssertions: Object.freeze([
        "default createMatch places the selected Battlefield on Board at its own Location",
        "production MatchCommandAdapter binds one exact Board trigger, and repeated attachment is idempotent",
        "here matcher: a Battlefield with null location self-anchors by ObjectRef id; another field still fails closed"
      ]),
      productionTestNames: Object.freeze([
        "sfd-220-221 Treasure Hoard production golden: default setup Conquers, pays at Finalize, and plays an exhausted Gold to Base",
        "sfd-220-221 Treasure Hoard production counterexample: conquering another battlefield does not fire here",
        "sfd-220-221 Treasure Hoard production boundary: default setup and MatchCommandAdapter bind the Board Battlefield exactly once"
      ]),
      priorityFocus: "The card defines no numeric priority. Once Conquer creates the Pending trigger, the ordinary Chain grants Priority and any Showdown Focus by CR 311-313; the card adds no timing permission.",
      responseWindow: "A legal Reaction may be played in the ordinary Execute step while the triggered ability remains on the Chain (CR 338.1.a.2). No special response window is invented for this card.",
      replacement: "Treasure Hoard supplies no replacement or prevention effect. CR 383.4.c.2.c therefore has no card-specific branch; replacing the point gain would not suppress the Conquer trigger.",
      layers: "The trigger condition and payment do not depend on continuous-effect layer ordering. CR 478/479 is not consumed by this interaction.",
      lki: "The triggered ability needs the exact battlefield identity from the Conquer payload; no left-zone attributes are read for its condition.",
      simultaneousTriggers: "The production Score wave carries an explicit batch identity. A Battlefield's Conquer ability is attached to that source and, for this card, registers once rather than one trigger per participating Unit."
    }),
    optionalPaymentAndGold: Object.freeze({
      canonicalCardId: CANONICAL,
      goldCanonicalCardId: goldProgram.canonicalCardId,
      ruleRefs: Object.freeze(["135.2.e.5.a", "135.2.e.5.b", "184.1", "185.2.a", "185.2.d", "187.5", "350.2", "354", "383.3.a", "405.1", "405.2", "440.2.c"]),
      setup: "CR 133.6.a.1 / 170.2.a-b establish the selected Battlefield without playing it; CR 199.1 makes it the Game Object at its own Location.",
      timeline: Object.freeze([
        "Play/Pending: Conquer creates the triggered ability as a Pending Item.",
        "Finalize: the leading may is selected, then the printed one Energy is paid; declining or an unpayable cost removes the trigger without a free Gold.",
        "Resolve: effect.token creates the canonical Gold on the Chain with exhausted=true, then plays that same token to the controller's Base.",
        "The Gear Play resolves as its own Chain item; the stipulated exhausted entry survives and the token reaches the controller's Base exhausted."
      ]),
      productionAssertions: Object.freeze([
        "production golden: accepted Finalize pays one Energy and creates one complete canonical Gold receipt",
        "production counterexamples: declining and insufficient-Energy cases pay nothing and create no substitute Token",
        "Gold entry golden: the produced Gold resolves as its own Chain item, enters the controller's Base, and is exhausted"
      ]),
      productionTestNames: Object.freeze([
        "sfd-220-221 Treasure Hoard production golden: default setup Conquers, pays at Finalize, and plays an exhausted Gold to Base",
        "sfd-220-221 Treasure Hoard production counterexample: declining Finalize pays nothing and creates no token",
        "sfd-220-221 Treasure Hoard production counterexample: insufficient Energy removes the trigger without a free Gold",
        "sfd-220-221 Treasure Hoard production boundary: Gold's canonical intrinsic ability pays Kill this + Exhaust and adds Universal Power"
      ]),
      priorityFocus: "CR 383.3.a makes the leading may a Finalize decision. Paying the one Energy follows CR 405.1; CR 430.2.a is not applicable to this Energy payment, and this card cannot pass Priority or Focus during Finalize.",
      responseWindow: "Other players respond to the finalized triggered ability through the ordinary Chain (CR 338.1.a.2). The optional payment itself creates no separate response window.",
      replacement: "No replacement effect is involved in the choice or Energy payment. CR 405.2 governs declining an incurred triggered-ability cost: remove the Pending Ability without paying or resolving it.",
      layers: "Gold's required exhausted entry is set by the creating effect (CR 184.1 / 185.2.d) and is not a continuous-effect layer. It overrides the otherwise applicable Gear entry default for this token.",
      lki: "The template, payment, and entry state do not depend on LKI. Gold's intrinsic ability belongs to the created token incarnation and is not synthesized by Treasure Hoard."
    }),
    goldIntrinsicAbility: Object.freeze({
      canonicalCardId: goldProgram.canonicalCardId,
      sourceCanonicalCardId: CANONICAL,
      ruleRefs: Object.freeze(["135.2.e.5.a", "135.2.e.5.b", "187.5", "357.2", "415.4", "430.2.a", "430.3", "813.1.c.2"]),
      timeline: Object.freeze([
        "Gold is a Reaction Add, so its ordinary legality is evaluated without a separate card-created response window.",
        "Finalize checks and pays Exhaust this and Kill this from the created token incarnation; an already exhausted Gold cannot complete the Exhaust cost (CR 415.4).",
        "The Add resolves immediately under CR 430.2.a and places one Universal Power lot in the controller's Rune Pool."
      ]),
      productionAssertions: Object.freeze([
        "production boundary: a ready Gold pays Exhaust then Kill and adds Universal Power",
        "production counterexample: the created Gold remains exhausted, fails the 187.5 Exhaust cost with cannot-pay-cost, and rolls back Board, events and Power"
      ]),
      productionTestNames: Object.freeze([
        "sfd-220-221 Treasure Hoard production boundary: Gold's canonical intrinsic ability pays Kill this + Exhaust and adds Universal Power",
        "sfd-220-221 Treasure Hoard production counterexample: the exhausted Gold cannot pay its Exhaust cost"
      ])
    })
  })
});

function card(id, type = "unit") {
  return {
    id,
    cardId: id,
    canonicalCardId: id,
    name: id,
    types: [type],
    cardType: type,
    tags: [],
    domains: [],
    energy: type === "unit" ? 1 : null,
    power: type === "unit" ? [] : null,
    might: type === "unit" ? 5 : null
  };
}

function deck({ treasure = false } = {}) {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`main-${index}`)),
    runeDeck: Array.from({ length: 8 }, (_, index) => card(`rune-${index}`, "rune")),
    championLegend: card("legend", "legend"),
    chosenChampion: card("champion", "champion"),
    battlefields: [
      treasure
        ? {
            ...card("sfd-220-221", "battlefield"),
            cardId: "sfd-220-221",
            canonicalCardId: CANONICAL
          }
        : card("ordinary-field-0", "battlefield"),
      card("ordinary-field-1", "battlefield"),
      card("ordinary-field-2", "battlefield")
    ]
  };
}

function settleMatch(match, budget = 160) {
  const flow = match.flow;
  for (let index = 0; index < budget; index++) {
    if (flow.chain.items.length) {
      flow.pass(flow.chain.priority);
      continue;
    }
    if (flow.chain.focus !== null) {
      flow.pass(flow.chain.focus);
      continue;
    }
    return;
  }
  throw new Error("production Match did not settle");
}

function addRaider(kernel, { owner = "A", id = "raider", might = 5 } = {}) {
  return kernel.addObject({
    ref: { id, zoneEntryId: 1 },
    cardId: `synthetic:${id}`,
    canonicalCardId: `synthetic:${id}`,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner,
    controller: owner,
    zone: "board",
    location: { type: "base", player: owner },
    combatRole: null,
    might,
    energy: 1,
    power: [],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }, "board");
}

function productionMatch({ accepted = true, energy = 1 } = {}) {
  const kernel = world().player("A").player("B").build();
  const requests = [];
  const energyAtOptional = [];
  const lifecycleErrors = [];
  const choose = (request) => {
    requests.push(structuredClone(request));
    if (request.type === "optional") {
      if (request.id.startsWith("finalize:")) energyAtOptional.push(kernel.player(request.chooser).energy);
      return accepted;
    }
    if (request.type === "mode") return request.options[0];
    if (request.type === "order") return [...request.options];
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    if (request.type === "select-objects" && request.min === 0) return [];
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
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  host.player = (id) => kernel.player(id);
  const binding = createProgramBinding({ cardPrograms: [program, goldProgram] });
  const match = createMatch({
    host,
    decks: [deck({ treasure: true }), deck()],
    programs: binding,
    seed: "treasure-hoard-production",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    victoryScore: 20
  });
  const hoard = kernel.objects.find((object) => object.cardId === CANONICAL);
  assert.ok(hoard, "Treasure Hoard must enter through default Match setup");
  binding.attachLifecycle(match.flow.chain, (error) => lifecycleErrors.push(error));
  settleMatch(match);
  const player = "A";
  if (energy > 0) match.flow.chain.commit({ type: "gain-energy", player, amount: energy });
  settleMatch(match);
  return {
    kernel,
    match,
    binding,
    hoard,
    player,
    requests,
    energyAtOptional,
    lifecycleErrors,
    settle: () => settleMatch(match)
  };
}

test("sfd-220-221 Treasure Hoard: executable program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);

  assert.equal(goldProgram.status, "executable");
  assert.equal(Object.hasOwn(goldProgram, "judgeReason"), false);
});

test("sfd-220-221 Treasure Hoard: official CR, Radiance, SFD and processing evidence is pinned", () => {
  assert.deepEqual(OFFICIAL_EVIDENCE.sources.coreRules, {
    version: "1.5",
    dated: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_URL,
    pdfSha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec",
    extractedTextSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
  });
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, program.canonicalCardId);
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.conquerHere.ruleRefs, [
    "133.6.a.1", "190.6", "190.6.b", "190.6.d", "199.1", "383.4.c.2.b", "471.1"
  ]);
  assert.equal(OFFICIAL_EVIDENCE.interactions.conquerHere.canonicalCardId, program.canonicalCardId);
  assert.equal(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.canonicalCardId, program.canonicalCardId);
  assert.equal(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.goldCanonicalCardId, goldProgram.canonicalCardId);
  assert.match(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.setup, /133\.6\.a\.1.*170\.2\.a-b.*199\.1/);
  assert.match(OFFICIAL_EVIDENCE.interactions.conquerHere.priorityFocus, /311-313/);
  assert.match(OFFICIAL_EVIDENCE.interactions.conquerHere.responseWindow, /338\.1\.a\.2/);
  assert.match(OFFICIAL_EVIDENCE.interactions.conquerHere.replacement, /383\.4\.c\.2\.c/);
  assert.match(OFFICIAL_EVIDENCE.interactions.conquerHere.layers, /478\/479/);
  assert.match(OFFICIAL_EVIDENCE.interactions.conquerHere.lki, /left-zone/);
  assert.match(OFFICIAL_EVIDENCE.interactions.conquerHere.simultaneousTriggers, /batch/);
  assert.match(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.priorityFocus, /383\.3\.a/);
  assert.match(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.replacement, /405\.2/);
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.ruleRefs, [
    "135.2.e.5.a", "135.2.e.5.b", "184.1", "185.2.a", "185.2.d", "187.5", "350.2",
    "354", "383.3.a", "405.1", "405.2", "440.2.c"
  ]);
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.timeline, [
    "Play/Pending: Conquer creates the triggered ability as a Pending Item.",
    "Finalize: the leading may is selected, then the printed one Energy is paid; declining or an unpayable cost removes the trigger without a free Gold.",
    "Resolve: effect.token creates the canonical Gold on the Chain with exhausted=true, then plays that same token to the controller's Base.",
    "The Gear Play resolves as its own Chain item; the stipulated exhausted entry survives and the token reaches the controller's Base exhausted."
  ]);
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.productionAssertions, [
    "production golden: accepted Finalize pays one Energy and creates one complete canonical Gold receipt",
    "production counterexamples: declining and insufficient-Energy cases pay nothing and create no substitute Token",
    "Gold entry golden: the produced Gold resolves as its own Chain item, enters the controller's Base, and is exhausted"
  ]);
  assert.equal(OFFICIAL_EVIDENCE.interactions.optionalPaymentAndGold.ruleRefs.includes("415.4"), false,
    "CR 415.4 belongs to Gold's Exhaust cost, not Treasure Hoard's Energy payment");
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.goldIntrinsicAbility.ruleRefs, [
    "135.2.e.5.a", "135.2.e.5.b", "187.5", "357.2", "415.4", "430.2.a", "430.3", "813.1.c.2"
  ]);
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.goldIntrinsicAbility.productionAssertions, [
    "production boundary: a ready Gold pays Exhaust then Kill and adds Universal Power",
    "production counterexample: the created Gold remains exhausted, fails the 187.5 Exhaust cost with cannot-pay-cost, and rolls back Board, events and Power"
  ]);
  for (const interaction of Object.values(OFFICIAL_EVIDENCE.interactions)) {
    assert.ok(interaction.productionTestNames.length > 0);
    assert.ok(interaction.productionTestNames.every((name) => typeof name === "string" && name.length > 0));
  }
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

test("sfd-220-221 Treasure Hoard: here matches the source Battlefield by explicit location and null-location self anchor", () => {
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

  // CR v1.5 199.1: a Battlefield is also the Game Object at its own Location.
  // A setup carrier can expose a null location, so `here` must anchor it by its
  // own ObjectRef id. The different-field branch above remains fail-closed.
  const selfLocated = world().player("A").object("hoard-card", {
    cardId: CANONICAL,
    types: ["battlefield"],
    zone: "board",
    location: null
  }).build().getObject("hoard-card");
  const selfConquer = { ...conquer(selfLocated.ref.id), object: selfLocated };
  assert.equal(matchesTriggerEvent(translated, selfConquer, "A", selfLocated), true);
  assert.equal(matchesTriggerEvent(translated, { ...selfConquer, details: { battlefieldId: "bf1" } }, "A", selfLocated), false);
});

test("sfd-220-221 Treasure Hoard production golden: default setup Conquers, pays at Finalize, and plays an exhausted Gold to Base", () => {
  const f = productionMatch();
  assert.deepEqual(f.lifecycleErrors, []);
  assert.equal(f.kernel.player("A").energy, 1);
  const registrations = f.match.flow.chain.pipeline.registeredTriggers()
    .filter((registration) => registration.source.cardId === CANONICAL);
  assert.deepEqual(registrations.map((registration) => registration.id),
    [`program:${f.hoard.ref.id}:${f.hoard.ref.zoneEntryId}:0`]);
  assert.deepEqual(registrations[0].spec.filter, { event: "conquer", here: true, player: "self" });

  const raider = addRaider(f.kernel);
  const move = f.match.flow.move("A", raider, f.hoard.ref.id);
  assert.deepEqual(move.moved, [raider]);
  f.settle();

  assert.deepEqual(f.requests.map((request) => request.id), ["finalize:trigger:1:optional"]);
  assert.deepEqual(f.energyAtOptional, [1], "the leading may is decided before its Finalize payment");
  assert.equal(f.kernel.player("A").energy, 0, "Finalize pays exactly the printed one Energy");
  assert.equal(f.kernel.player("A").score, 1);
  assert.equal(f.match.flow.battlefields.find((field) => field.id === f.hoard.ref.id).controller, "A");

  const receipt = f.kernel.linked("treasure-hoard.create.goldToken");
  assert.equal(receipt.blockedReason, undefined);
  assert.equal(receipt.amount, 1);
  assert.equal(receipt.createdAmount, 1);
  assert.equal(receipt.objectsComplete, true);
  assert.equal(receipt.createdObjects.length, 1);
  const gold = f.kernel.getObject(receipt.createdObjects[0].id);
  assert.ok(gold);
  assert.equal(gold.cardId, goldProgram.canonicalCardId);
  assert.equal(gold.name, "Gold");
  assert.equal(gold.isToken, true);
  assert.deepEqual(gold.types, ["gear"]);
  assert.deepEqual(gold.location, { type: "base", player: "A" });
  assert.equal(gold.exhausted, true,
    "the created token's stipulated exhausted entry survives its production Chain Play");
  const goldDraft = f.binding.describeActivate(gold, "A", 0);
  assert.equal(goldDraft.kind, "add");
  assert.equal(goldDraft.speed, "reaction");
  assert.deepEqual(goldDraft.body.map((instruction) => instruction.op), ["effect.resources"]);

  const events = f.match.events();
  const conquerAt = events.findIndex((event) => event.timingPoint === "conquer");
  const pendingAt = events.findIndex((event, index) => index > conquerAt && event.timingPoint === "chain-item-pending");
  const finalizeAt = events.findIndex((event, index) => index > pendingAt && event.timingPoint === "chain-item-finalize" && event.details?.item === "trigger:1");
  const resolveAt = events.findIndex((event, index) => index > finalizeAt && event.timingPoint === "chain-item-resolve" && event.details?.item === "trigger:1");
  assert.ok(conquerAt >= 0 && conquerAt < pendingAt && pendingAt < finalizeAt && finalizeAt < resolveAt);
  assert.ok(f.match.flow.chain.trace.some((entry) => entry.step === "finalized" && entry.item === "trigger:1"));
  assert.ok(f.match.flow.chain.trace.some((entry) => entry.step === "resolved" && entry.item === "trigger:1"));
  const trace = f.match.flow.chain.trace.filter((entry) => entry.step === "focus-granted" || entry.step === "pass");
  assert.ok(f.match.flow.chain.trace.some((entry) =>
    entry.step === "resolved" && String(entry.item).startsWith(`play:${gold.ref.id}:`)),
  "the played Gold resolves as its own Chain item");
  assert.deepEqual(trace.slice(-4), [
    { step: "focus-granted", player: "A" },
    { step: "focus-granted", player: "B" },
    { step: "pass", player: "A" },
    { step: "pass", player: "B" }
  ], "A/B receive the ordinary Showdown Focus and post-Finalize Priority windows");

  const goldDefinition = getTokenDefinition("gold");
  assert.ok(goldDefinition);
  assert.deepEqual(goldDefinition.spec.types, ["gear"]);
  assert.equal(goldDefinition.spec.energy, null);
  assert.equal(goldDefinition.spec.power, null);
  assert.equal(goldDefinition.abilityBinding, "canonical-card-program");
});

test("sfd-220-221 Treasure Hoard production boundary: Gold's canonical intrinsic ability pays Kill this + Exhaust and adds Universal Power", () => {
  const kernel = world().player("A").player("B").build();
  const goldRef = kernel.addObject({
    ref: { id: "gold-intrinsic", zoneEntryId: 1 },
    cardId: goldProgram.canonicalCardId,
    name: "Gold",
    types: ["gear"],
    tags: ["Token"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    combatRole: null,
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: true
  }, "board");
  const requests = [];
  const choose = (request) => {
    requests.push(structuredClone(request));
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected intrinsic Gold choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const binding = createProgramBinding({ cardPrograms: [goldProgram] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  const lifecycleErrors = [];
  binding.attachLifecycle(engine, (error) => lifecycleErrors.push(error));
  const source = kernel.getObject(goldRef.id);
  const draft = binding.describeActivate(source, "A", 0);
  assert.equal(draft.kind, "add");
  assert.equal(draft.speed, "reaction");
  assert.deepEqual(draft.body.map((instruction) => instruction.id), ["gold.add-universal-power"]);
  assert.deepEqual(draft.cost.cost.payments.map((payment) => payment.kind), ["exhaust", "kill"]);

  engine.execute(draft);
  while (engine.items.length) engine.pass(engine.priority);
  assert.deepEqual(lifecycleErrors, []);
  assert.deepEqual(requests, []);
  assert.deepEqual(kernel.player("A").power, ["universal"]);
  assert.equal(kernel.getObject(goldRef.id).zone, "trash");
  assert.deepEqual(kernel.events.filter((event) => ["exhaust", "kill", "gain-power"].includes(event.action))
    .map((event) => event.action), ["exhaust", "kill", "gain-power"]);
  assert.deepEqual(kernel.linked("gold.add-universal-power.resources"), {
    player: "A",
    energy: 0,
    power: ["universal"]
  });

});

test("sfd-220-221 Treasure Hoard production counterexample: the exhausted Gold cannot pay its Exhaust cost", () => {
  const f = productionMatch();
  const raider = addRaider(f.kernel, { id: "exhausted-gold-raider" });
  f.match.flow.move("A", raider, f.hoard.ref.id);
  f.settle();
  const receipt = f.kernel.linked("treasure-hoard.create.goldToken");
  const gold = f.kernel.getObject(receipt.createdObjects[0].id);
  assert.equal(gold.location.type, "base");
  assert.equal(gold.location.player, "A");
  assert.equal(gold.exhausted, true);
  const before = f.kernel.snapshot();
  const eventsBefore = structuredClone(f.kernel.events);
  const draft = f.binding.describeActivate(gold, "A", 0);
  assert.throws(
    () => f.match.flow.chain.execute(draft),
    (error) => error?.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(f.kernel.snapshot(), before,
    "the rejected Gold activation rolls back the whole Finalize transaction");
  assert.deepEqual(f.kernel.events, eventsBefore);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject(gold.ref.id).zone, "board");
  assert.equal(f.kernel.getObject(gold.ref.id).exhausted, true);
});

test("sfd-220-221 Treasure Hoard production counterexample: finalize order is Conquer -> Pending -> Finalize -> Resolve", () => {
  const f = productionMatch();
  const raider = addRaider(f.kernel, { id: "order-raider" });
  f.match.flow.move("A", raider, f.hoard.ref.id);
  f.settle();
  const timeline = f.match.events().map((event) => event.timingPoint);
  const conquerAt = timeline.indexOf("conquer");
  const pendingAt = timeline.indexOf("chain-item-pending", conquerAt);
  const finalizeAt = timeline.indexOf("chain-item-finalize", pendingAt);
  const resolveAt = timeline.indexOf("chain-item-resolve", finalizeAt);
  assert.ok(conquerAt >= 0 && conquerAt < pendingAt && pendingAt < finalizeAt && finalizeAt < resolveAt);
  assert.ok(f.match.flow.chain.trace.some((entry) => entry.step === "finalized" && entry.item === "trigger:1"));
  assert.ok(f.match.flow.chain.trace.some((entry) => entry.step === "resolved" && entry.item === "trigger:1"));
});

test("sfd-220-221 Treasure Hoard production counterexample: declining Finalize pays nothing and creates no token", () => {
  const f = productionMatch({ accepted: false });
  const energyBeforeConquer = f.kernel.player("A").energy;
  const payEventsBeforeConquer = f.kernel.events.filter((event) => event.action === "pay").length;
  const raider = addRaider(f.kernel, { id: "decline-raider" });
  f.match.flow.move("A", raider, f.hoard.ref.id);
  f.settle();

  assert.deepEqual(f.requests.map(({ id, type }) => ({ id, type })),
    [{ id: "finalize:trigger:1:optional", type: "optional" }]);
  assert.deepEqual(f.energyAtOptional, [energyBeforeConquer]);
  assert.equal(f.kernel.player("A").energy, energyBeforeConquer);
  assert.equal(f.kernel.events.filter((event) => event.action === "pay").length, payEventsBeforeConquer);
  assert.equal(f.kernel.linked("treasure-hoard.create.goldToken"), undefined);
  assert.equal(f.kernel.objects.filter((object) => object.cardId === goldProgram.canonicalCardId).length, 0);
  // The triggering Move resolves normally; only the declined trigger is removed
  // without a Resolve. Do not confuse those two chain items.
  assert.equal(f.match.flow.chain.trace.some((entry) => entry.step === "removed" && entry.reason === "declined"), true);
});

test("sfd-220-221 Treasure Hoard production counterexample: insufficient Energy removes the trigger without a free Gold", () => {
  const f = productionMatch({ energy: 0 });
  const raider = addRaider(f.kernel, { id: "unpayable-raider" });
  f.match.flow.move("A", raider, f.hoard.ref.id);
  f.settle();

  assert.deepEqual(f.requests.map(({ id, type }) => ({ id, type })),
    [{ id: "finalize:trigger:1:optional", type: "optional" }]);
  assert.deepEqual(f.energyAtOptional, [0]);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(f.kernel.events.filter((event) => event.action === "pay").length, 0);
  assert.equal(f.kernel.linked("treasure-hoard.create.goldToken"), undefined);
  assert.equal(f.kernel.objects.filter((object) => object.cardId === goldProgram.canonicalCardId).length, 0);
  assert.ok(f.match.flow.chain.trace.some((entry) => entry.step === "removed" && entry.reason === "unperformable-trigger"));
});

test("sfd-220-221 Treasure Hoard production counterexample: conquering another battlefield does not fire here", () => {
  const f = productionMatch();
  const other = f.match.flow.battlefields.find((field) => field.id !== f.hoard.ref.id);
  assert.ok(other);
  const raider = addRaider(f.kernel, { id: "elsewhere-raider" });
  const energyBeforeConquer = f.kernel.player("A").energy;
  f.match.flow.move("A", raider, other.id);
  f.settle();

  assert.deepEqual(f.lifecycleErrors, []);
  assert.deepEqual(f.requests, []);
  assert.equal(f.kernel.player("A").energy, energyBeforeConquer);
  assert.equal(f.kernel.linked("treasure-hoard.create.goldToken"), undefined);
  assert.equal(f.kernel.objects.filter((object) => object.cardId === goldProgram.canonicalCardId).length, 0);
});

test("sfd-220-221 Treasure Hoard production boundary: default setup and MatchCommandAdapter bind the Board Battlefield exactly once", () => {
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
  const binding = createProgramBinding({ cardPrograms: [program] });
  const match = createMatch({
    decks: [deck({ treasure: true }), deck()],
    seed: "treasure-hoard-setup",
    host,
    programs: binding,
    battlefieldChoice: [0, 0]
  });
  const battlefield = match.setup.battlefields.find((entry) => entry.cardId === "sfd-220-221");
  assert.ok(battlefield);
  const source = kernel.getObject(battlefield.id);
  assert.equal(source.cardId, CANONICAL);
  assert.equal(source.zone, "board");
  assert.deepEqual(source.location, { type: "battlefield", id: battlefield.id });
  assert.equal(source.ref.id, battlefield.id);
  assert.equal(source.isToken, true);
  assert.deepEqual(source.types, ["battlefield"]);

  const registrations = () => [...match.flow.chain.pipeline.checkpoint().triggers.values()]
    .filter((registration) => registration.source.cardId === CANONICAL);
  assert.deepEqual(registrations(), []);
  assert.equal(source.location.id, source.ref.id, "the default setup Battlefield is its own Location");

  // The public MatchCommandAdapter is the default player-command lifecycle
  // owner. Its attach must discover the already established setup Battlefield
  // without a test-side Chain-to-Board migration or a manual registration.
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  try {
    const errors = [];
    assert.deepEqual(
      registrations().map((registration) => [registration.id, registration.source.ref, registration.source.zone]),
      [[`program:${source.ref.id}:${source.ref.zoneEntryId}:0`, source.ref, "board"]]
    );
    assert.deepEqual(registrations()[0].spec, {
      at: "conquer",
      filter: {
        event: "conquer",
        here: true,
        player: "self"
      }
    });
    const repeated = binding.attachLifecycle(match.flow.chain, (error) => errors.push(error));
    assert.equal(registrations().length, 1);
    repeated.detach();
    assert.equal(registrations().length, 1);
    assert.deepEqual(errors, []);
  } finally {
    adapter.detach();
  }
  assert.deepEqual(registrations(), []);
});
