import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sunken-temple.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createMatch } from "../../../../engine-core/dist/game/lifecycle.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";

const CARD_ID = "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b";
const SOURCE_TEXT =
  "When you conquer here with one or more [Mighty] units, you may pay :rb_energy_1: to draw 1. (A unit is Mighty while it has 5+ :rb_might:.)";
const CORE_RULES_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";

const PRODUCTION_TEST_NAMES = Object.freeze({
  golden: "sfd-218-221 Sunken Temple production golden: default setup conquers, pays at Finalize, and draws at Resolve",
  onePerScore: "sfd-218-221 Sunken Temple production boundary: one Score wave creates one trigger opportunity",
  mightyBoundary: "sfd-218-221 Sunken Temple production counterexample: a frozen non-Mighty participant does not trigger",
  layeredMight: "sfd-218-221 Sunken Temple production boundary: current layered Might 5 satisfies Mighty",
  decline: "sfd-218-221 Sunken Temple production boundary: declining Finalize pays and draws nothing",
  unpayable: "sfd-218-221 Sunken Temple production counterexample: unavailable 1 Energy removes the trigger",
  opponent: "sfd-218-221 Sunken Temple production boundary: the new battlefield controller controls and pays for the ability",
  elsewhere: "sfd-218-221 Sunken Temple production counterexample: a conquer at another Battlefield never matches here",
  noSecondScore: "sfd-218-221 Sunken Temple production boundary: moving another Mighty Unit after the Score creates no second trigger",
  replacedPoint: "sfd-218-221 Sunken Temple production boundary: replacing point gain preserves the Conquer trigger"
});

// Official-source evidence is pinned to the repository's reviewed snapshots.
// Neither official Radiance rules page nor effective Spiritforged errata names
// this card; CR v1.5 supplies the procedure and the catalog supplies its text.
const OFFICIAL_EFFECT_ORDER_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CARD_ID,
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      published: "2026-10-09",
      effective: "2026-10-16",
      url: CORE_RULES_URL,
      sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_URL,
      appliesToThisCard: false,
      result: "reviewed: no Sunken Temple-specific ruling"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      appliesToThisCard: false,
      result: "reviewed: no Sunken Temple replacement text"
    })
  }),
  interactions: Object.freeze([
    Object.freeze({
      id: "battlefield-setup-and-here-conquer",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["When you conquer here"]),
      ruleRefs: Object.freeze([
        "053.3", "170.2.a", "170.2.b", "190.5", "190.6.a", "190.6.d",
        "383.4.c", "383.4.c.2", "383.4.c.2.b", "468.5", "468.5.d",
        "471.1", "473.2.a", "473.2.c"
      ]),
      timeline: Object.freeze([
        "Setup establishes each selected Battlefield on the Board at its own Location.",
        "The real control-establishment Score wave freezes the participating Unit refs and emits Conquer at this Battlefield.",
        "The current Battlefield controller is the ability controller; a conquer at another Location creates no Pending item."
      ]),
      priorityFocus: "The trigger becomes Pending after the Score action; Finalize does not itself pass Priority.",
      responseWindow: "After Finalize, the Closed State permits legally timed Reactions before Resolve.",
      lki: "The Battlefield remains on the Board; here is matched to the actual Conquer payload.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.replacedPoint,
        PRODUCTION_TEST_NAMES.opponent,
        PRODUCTION_TEST_NAMES.elsewhere
      ])
    }),
    Object.freeze({
      id: "one-or-more-frozen-mighty-participants",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["with one or more [Mighty] units", "A unit is Mighty while it has 5+ might."]),
      ruleRefs: Object.freeze([
        "383.2.a.1", "383.4.c.2", "472", "473.2.c", "478.1",
        "479.4.e.1.a", "706", "708", "710"
      ]),
      timeline: Object.freeze([
        "The Score action freezes its participating Unit identities.",
        "The condition filters exactly those refs, using current layered Might at trigger evaluation.",
        "Any count from one upward satisfies the trigger; several events in the same Score batch still make one trigger opportunity."
      ]),
      priorityFocus: "Priority follows the ordinary Pending/Finalize path; each controller orders simultaneous trigger instances and this card contributes one instance per Score wave.",
      responseWindow: "The condition is evaluated while collecting Pending items, before any later Reaction window.",
      lki: "A Unit that leaves after the Score does not retroactively change the frozen participant identity.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.onePerScore,
        PRODUCTION_TEST_NAMES.mightyBoundary,
        PRODUCTION_TEST_NAMES.layeredMight
      ])
    }),
    Object.freeze({
      id: "leading-finalize-may-and-energy-cost",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["you may pay 1 energy"]),
      ruleRefs: Object.freeze([
        "337.1", "337.1.a", "337.1.b", "338.1.b", "339.1", "403.1",
        "403.1.a", "404.1.b.1", "405.1", "405.2", "407.1", "407.4", "383.3.a", "383.3.b.1"
      ]),
      timeline: Object.freeze([
        "The leading may is chosen at Finalize by the trigger controller.",
        "Acceptance selects the one-Energy base cost; the same Finalize pays it before the item is Finalized.",
        "Decline or unavailable payment removes the Pending item and never reaches Resolve."
      ]),
      priorityFocus: "Finalize grants no new Priority; the controller makes the decision and pays the base cost there.",
      responseWindow: "After successful Finalize both seats pass in Turn Order before the real Resolve.",
      lki: "No look-back is required for the Energy payment or the still-active Battlefield source.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.decline,
        PRODUCTION_TEST_NAMES.unpayable,
        PRODUCTION_TEST_NAMES.opponent
      ])
    }),
    Object.freeze({
      id: "draw-on-resolve",
      canonicalCardId: CARD_ID,
      sourceIds: Object.freeze(["coreRules", "radianceRulings", "spiritforgedErrata"]),
      clauses: Object.freeze(["to draw 1"]),
      ruleRefs: Object.freeze(["407.5", "411.2.a", "411.2.b", "414.1", "414.2"]),
      timeline: Object.freeze([
        "After the Reaction window closes, Resolve executes the instructed Draw.",
        "The real top Main Deck card enters that controller's Hand; the former controller is unaffected.",
        "A replaced point gain does not remove this separate Conquer effect."
      ]),
      priorityFocus: "Draw is a Limited Action performed during Resolve and creates no discretionary Priority.",
      responseWindow: "No new response window occurs inside Resolve after the pre-Resolve window closed.",
      lki: "The drawn card is read from its current zone after the real move; no departed object is needed.",
      productionTestNames: Object.freeze([
        PRODUCTION_TEST_NAMES.golden,
        PRODUCTION_TEST_NAMES.opponent,
        PRODUCTION_TEST_NAMES.replacedPoint
      ])
    })
  ]),
  boundaries: Object.freeze({
    canonicalCardId: CARD_ID,
    simultaneousTriggerOrder: Object.freeze({
      applicable: false,
      ruleRefs: Object.freeze(["303.2.a", "383.3.d", "383.3.d.1"]),
      reason: "One Score wave collects this card as one trigger. Any ordering among other simultaneous abilities is engine-owned and no fixed numeric priority is assigned to this card."
    }),
    replacementOrPrevention: Object.freeze({
      applicable: false,
      ruleRefs: Object.freeze(["383.4.c.2.c"]),
      reason: "This card prints neither replacement nor prevention text. The external replaced-point test confirms that replacing the Score point does not remove its Conquer effect."
    })
  })
});

const field = id => ({ type: "battlefield", id });
const constant = value => ({ kind: "constant", value });
const deckCard = (id, type) => ({
  id,
  cardId: id,
  canonicalCardId: id,
  types: [type],
  cardType: type,
  energy: type === "unit" ? 1 : null,
  power: type === "unit" ? [] : null,
  might: type === "unit" ? 2 : null
});

function matchDeck(prefix, sunkenTemple = false) {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => deckCard(`${prefix}:main:${index}`, "unit")),
    runeDeck: Array.from({ length: 8 }, (_, index) => deckCard(`${prefix}:rune:${index}`, "rune")),
    championLegend: deckCard(`${prefix}:legend`, "legend"),
    chosenChampion: deckCard(`${prefix}:champion`, "champion"),
    battlefields: Array.from({ length: 3 }, (_, index) => {
      const card = deckCard(`${prefix}:battlefield:${index}`, "battlefield");
      return sunkenTemple && index === 0 ? { ...card, cardId: CARD_ID, canonicalCardId: CARD_ID } : card;
    })
  };
}

function addUnit(kernel, id, values = {}, zoneEntryId = 20) {
  const owner = values.owner ?? "A";
  return kernel.addObject({
    ref: { id, zoneEntryId },
    cardId: `synthetic:${id}`,
    canonicalCardId: `synthetic:${id}`,
    name: id,
    types: ["unit"],
    tags: values.tags ?? [],
    keywords: [],
    owner,
    controller: values.controller ?? owner,
    zone: "board",
    location: values.location ?? { type: "base", player: owner },
    combatRole: null,
    might: values.might ?? 2,
    energy: 1,
    power: [],
    exhausted: values.exhausted ?? false,
    damage: values.damage ?? 0,
    stunned: false,
    buffs: values.buffs ?? 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }, "board");
}

function settle(flow, budget = 120) {
  for (let guard = 0; guard < budget; guard++) {
    if (flow.chain.items.length) { flow.pass(flow.chain.priority); continue; }
    if (flow.chain.focus) { flow.pass(flow.chain.focus); continue; }
    return;
  }
  throw new Error("production chain did not settle");
}

function handRefs(kernel, player) {
  return kernel.zone(player, "hand");
}

function drawSnapshot(kernel, player, handCountBefore = kernel.player(player).handCount) {
  const deckBefore = kernel.zoneSlice(player, "deck", "top");
  const priorHand = structuredClone(handRefs(kernel, player));
  assert.equal(priorHand.length, handCountBefore);
  return {
    deckBefore,
    after: null,
    handCountBefore,
    handRefs: priorHand,
    assertDrawn(events) {
      const hand = handRefs(kernel, player);
      assert.equal(hand.length, handCountBefore + 1, `${player} draws exactly one additional card`);
      const added = hand.slice(handCountBefore);
      assert.equal(added.length, 1, `${player} appends exactly one hand incarnation`);
      this.after = added[0];
      const draws = events.filter(event => event.timingPoint === "card-drawn" && event.player === player &&
        event.object?.ref.id === this.after.id && event.amount === 1 && event.details?.fromZone === "deck");
      assert.equal(draws.length, 1, "one real card-drawn event names the card that entered Hand");
      return draws;
    }
  };
}

function assertHandUnchanged(kernel, player, before) {
  assert.equal(kernel.player(player).handCount, before.handCountBefore);
  assert.deepEqual(handRefs(kernel, player), before.handRefs);
}

function assertTempleDrawNotRecorded(events, player, before) {
  const matches = events.filter(event => event.timingPoint === "card-drawn" && event.player === player &&
    event.object?.ref.id === before.top?.id);
  assert.equal(matches.length, 0);
}

function productionMatch({ firstPlayer = 0, prepare, accept = true, replaceScore = false, energy = 2 } = {}) {
  const kernel = world().player("A").player("B").build();
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (request.type === "optional") return accept;
    if (request.type === "mode") return request.options[0];
    if (request.type === "order") return [...request.options];
    if (request.type === "select-objects" && request.options.length === request.min) return [...request.options];
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
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  host.player = id => kernel.player(id);
  const binding = createProgramBinding({ cardPrograms: [program] });
  const match = createMatch({
    host,
    decks: [matchDeck("A", true), matchDeck("B")],
    programs: binding,
    seed: "sunken-temple-production",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer,
    victoryScore: 20
  });
  const temple = kernel.objects.find(object => object.cardId === CARD_ID);
  assert.ok(temple, "selected Sunken Temple must be a real setup token");
  binding.attachLifecycle(match.flow.chain, error => { throw error; });
  settle(match.flow);
  const player = firstPlayer === 0 ? "A" : "B";
  prepare?.({ kernel, match, binding, temple, player });
  if (energy > 0) match.flow.chain.commit({ type: "gain-energy", player, amount: energy });
  settle(match.flow);
  if (replaceScore) {
    match.flow.chain.pipeline.registerReplacement({
      id: "sunken-temple:replace-point",
      matches: action => action.type === "score",
      apply: action => ({ status: "replace", actions: [{ type: "draw", player: action.player, amount: 1 }] })
    });
  }
  const initialHand = {
    A: handRefs(kernel, "A"),
    B: handRefs(kernel, "B")
  };
  return { kernel, match, binding, requests, temple, player, initialHand };
}

test("sfd-218-221 Sunken Temple: executable program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-218-221 Sunken Temple: official evidence records source dates, interactions and production assertions", () => {
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.canonicalCardId, CARD_ID);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.coreRules, {
    version: "1.5",
    published: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_RULES_URL,
    sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
  });
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.published, "2026-10-09");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.radianceRulings.appliesToThisCard, false);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.published, "2026-01-14");
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.effective, null);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.sources.spiritforgedErrata.appliesToThisCard, false);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.boundaries.canonicalCardId, CARD_ID);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.boundaries.simultaneousTriggerOrder.applicable, false);
  assert.equal(OFFICIAL_EFFECT_ORDER_EVIDENCE.boundaries.replacementOrPrevention.applicable, false);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions.map(interaction => interaction.id), [
    "battlefield-setup-and-here-conquer",
    "one-or-more-frozen-mighty-participants",
    "leading-finalize-may-and-energy-cost",
    "draw-on-resolve"
  ]);
  const [setup, mighty, finalize, draw] = OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions;
  assert.deepEqual(setup.ruleRefs, [
    "053.3", "170.2.a", "170.2.b", "190.5", "190.6.a", "190.6.d",
    "383.4.c", "383.4.c.2", "383.4.c.2.b", "468.5", "468.5.d",
    "471.1", "473.2.a", "473.2.c"
  ]);
  assert.deepEqual(setup.timeline, [
    "Setup establishes each selected Battlefield on the Board at its own Location.",
    "The real control-establishment Score wave freezes the participating Unit refs and emits Conquer at this Battlefield.",
    "The current Battlefield controller is the ability controller; a conquer at another Location creates no Pending item."
  ]);
  assert.deepEqual(mighty.ruleRefs, [
    "383.2.a.1", "383.4.c.2", "472", "473.2.c", "478.1",
    "479.4.e.1.a", "706", "708", "710"
  ]);
  assert.deepEqual(mighty.timeline, [
    "The Score action freezes its participating Unit identities.",
    "The condition filters exactly those refs, using current layered Might at trigger evaluation.",
    "Any count from one upward satisfies the trigger; several events in the same Score batch still make one trigger opportunity."
  ]);
  assert.deepEqual(finalize.ruleRefs, [
    "337.1", "337.1.a", "337.1.b", "338.1.b", "339.1", "403.1",
    "403.1.a", "404.1.b.1", "405.1", "405.2", "407.1", "407.4", "383.3.a", "383.3.b.1"
  ]);
  assert.deepEqual(finalize.timeline, [
    "The leading may is chosen at Finalize by the trigger controller.",
    "Acceptance selects the one-Energy base cost; the same Finalize pays it before the item is Finalized.",
    "Decline or unavailable payment removes the Pending item and never reaches Resolve."
  ]);
  assert.deepEqual(draw.ruleRefs, ["407.5", "411.2.a", "411.2.b", "414.1", "414.2"]);
  assert.deepEqual(draw.timeline, [
    "After the Reaction window closes, Resolve executes the instructed Draw.",
    "The real top Main Deck card enters that controller's Hand; the former controller is unaffected.",
    "A replaced point gain does not remove this separate Conquer effect."
  ]);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.boundaries.simultaneousTriggerOrder.ruleRefs,
    ["303.2.a", "383.3.d", "383.3.d.1"]);
  assert.deepEqual(OFFICIAL_EFFECT_ORDER_EVIDENCE.boundaries.replacementOrPrevention.ruleRefs,
    ["383.4.c.2.c"]);
  for (const interaction of OFFICIAL_EFFECT_ORDER_EVIDENCE.interactions) {
    assert.equal(interaction.canonicalCardId, CARD_ID);
    assert.deepEqual(interaction.sourceIds, ["coreRules", "radianceRulings", "spiritforgedErrata"]);
    assert.match(interaction.priorityFocus, /Priority/);
    assert.match(interaction.responseWindow, /Reaction|Resolve|response/i);
    for (const testName of interaction.productionTestNames) {
      assert.ok(Object.values(PRODUCTION_TEST_NAMES).includes(testName), `${testName} is a named production test`);
    }
  }
});

test("sfd-218-221 Sunken Temple: IR keeps the printed trigger, leading Finalize cost and draw", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
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

test("sfd-218-221 Sunken Temple production setup: the selected Battlefield is a Board object at its own Location", () => {
  const kernel = world().player("A").player("B").build();
  const choose = request => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) return [...request.options];
    if (request.type === "mode") return request.options[0];
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
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  host.player = id => kernel.player(id);
  const binding = createProgramBinding({ cardPrograms: [program] });
  const match = createMatch({
    host,
    decks: [matchDeck("A", true), matchDeck("B")],
    programs: binding,
    seed: "sunken-temple-setup",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
    victoryScore: 20
  });
  const selected = match.setup.battlefields.find(entry => entry.cardId === CARD_ID);
  assert.ok(selected);
  const object = kernel.getObject(selected.id);
  assert.equal(object.zone, "board");
  assert.deepEqual(object.location, field(selected.id));
  assert.equal(selected.cardId, CARD_ID);
  assert.equal(object.energy, null);
  assert.equal(object.power, null);
  const registrations = match.flow.chain.pipeline.registeredTriggers().filter(registration => registration.source.ref.id === selected.id);
  assert.deepEqual(registrations.map(registration => registration.id), []);
  binding.attachLifecycle(match.flow.chain, error => { throw error; });
  const attached = match.flow.chain.pipeline.registeredTriggers().filter(registration => registration.source.ref.id === selected.id);
  assert.deepEqual(attached.map(registration => registration.id), [`program:${selected.id}:${object.ref.zoneEntryId}:0`]);
  const [registration] = attached;
  assert.deepEqual(registration.spec.filter, { event: "conquered", here: true, player: "self" });
  assert.deepEqual(registration.cost, {
    id: `cost:${selected.id}:${object.ref.zoneEntryId}:sunken-temple.opt-in`,
    cost: { energy: constant(1) }
  });
  assert.equal(registration.mayAtFinalize, true);
  assert.equal(registration.optional, false);
  assert.deepEqual(registration.body.map(instruction => instruction.op), ["effect.draw"]);
  assert.deepEqual(registration.body[0].args.amount, constant(1));
  const direct = triggerRegistrations(binding.registry, object);
  assert.deepEqual(direct.map(candidate => ({
    id: candidate.id,
    source: candidate.source.ref,
    filter: candidate.spec.filter,
    cost: candidate.cost,
    mayAtFinalize: candidate.mayAtFinalize,
    body: candidate.body
  })), attached.map(candidate => ({
    id: candidate.id,
    source: candidate.source.ref,
    filter: candidate.spec.filter,
    cost: candidate.cost,
    mayAtFinalize: candidate.mayAtFinalize,
    body: candidate.body
  })));
});

test(PRODUCTION_TEST_NAMES.golden, () => {
  const f = productionMatch({
    prepare: ({ kernel }) => addUnit(kernel, "mighty", { might: 6 }, 30)
  });
  const draw = drawSnapshot(f.kernel, "A");
  f.match.flow.move("A", f.kernel.ref("mighty"), f.temple.ref.id);
  settle(f.match.flow);
  draw.assertDrawn(f.match.events());
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.equal(f.kernel.player("A").score, 1);
  assert.equal(f.kernel.getObject(f.temple.ref.id).controller, "A");
  assert.equal(f.match.flow.battlefields.find(battlefield => battlefield.id === f.temple.ref.id).controller, "A");
  assert.deepEqual(f.match.flow.chain.items, []);
  const events = f.match.events();
  const conquer = events.findIndex(event => event.timingPoint === "conquer");
  const score = events.findIndex(event => event.timingPoint === "score");
  const finalized = events.findIndex(event => event.timingPoint === "chain-item-finalize" && event.details?.item === "trigger:1");
  const triggerResolved = events.findIndex(event => event.timingPoint === "chain-item-resolve" && event.details?.item === "trigger:1");
  assert.ok(conquer >= 0 && score > conquer && finalized > score && triggerResolved > finalized);
  assert.equal(events.filter(event => event.timingPoint === "score").length, 1);
  assert.deepEqual(
    f.match.flow.chain.trace
      .filter(entry => entry.item === "trigger:1" || entry.step === "pass")
      .map(entry => [entry.step, entry.player ?? entry.item]),
    [
      ["pending", "trigger:1"],
      ["finalize-start", "trigger:1"],
      ["finalized", "trigger:1"],
      ["pass", "A"],
      ["pass", "B"],
      ["resolve-start", "trigger:1"],
      ["resolved", "trigger:1"],
      ["removed", "trigger:1"]
    ]
  );
  const payIndex = events.findIndex(event => event.timingPoint === "chain-item-finalize" && event.details?.item === "trigger:1");
  assert.ok(payIndex >= 0);
});

test(PRODUCTION_TEST_NAMES.onePerScore, () => {
  const f = productionMatch({ prepare: ({ kernel }) => {
    addUnit(kernel, "mighty", { might: 6, tags: ["sunken-temple-participant"] }, 31);
    addUnit(kernel, "weak-four", { might: 4, tags: ["sunken-temple-participant"] }, 32);
    addUnit(kernel, "weak-one", { might: 1, tags: ["sunken-temple-participant"] }, 33);
  } });
  const draw = drawSnapshot(f.kernel, "A");
  f.match.flow.execute({
    id: "sunken-temple:two-participant-score",
    controller: "A",
    source: f.kernel.getObject("mighty"),
    kind: "activated",
    speed: "normal",
    body: [{
      id: "sunken-temple:move-participants",
      op: "effect.move",
      args: {
        objects: constant({
          kind: "choose",
          id: "sunken-temple.participants",
          filter: { type: "unit", zone: "board", controller: "A", tags: ["sunken-temple-participant"] }
        }),
        amount: constant(3),
        to: constant(field(f.temple.ref.id))
      }
    }]
  });
  settle(f.match.flow);
  const conquer = f.match.events().filter(event => event.timingPoint === "conquer");
  const score = f.match.events().filter(event => event.timingPoint === "score");
  assert.equal(conquer.length, 3);
  assert.equal(score.length, 1);
  assert.equal(new Set(conquer.map(event => event.batchId)).size, 1);
  assert.deepEqual(score[0].details.participatingUnits, [
    f.kernel.ref("mighty"),
    f.kernel.ref("weak-four"),
    f.kernel.ref("weak-one")
  ]);
  assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
  assert.equal(f.match.flow.chain.trace.filter(entry => entry.step === "pending" && entry.item === "trigger:1").length, 1);
  draw.assertDrawn(f.match.events());
});

test(PRODUCTION_TEST_NAMES.mightyBoundary, () => {
  const f = productionMatch({
    prepare: ({ kernel }) => addUnit(kernel, "weak", { might: 4 }, 40)
  });
  const draw = drawSnapshot(f.kernel, "A");
  addUnit(f.kernel, "mighty-outsider", { might: 6 }, 41);
  f.match.flow.chain.pipeline.registerReplacement({
    id: "sunken-temple:frozen-boundary",
    matches: action => action.type === "score",
    apply: () => ({
      status: "replace",
      actions: [{
        type: "move-location",
        object: f.kernel.ref("mighty-outsider"),
        to: field(f.temple.ref.id)
      }]
    })
  });
  f.match.flow.move("A", f.kernel.ref("weak"), f.temple.ref.id);
  settle(f.match.flow);
  assert.equal(f.match.events().filter(event => event.timingPoint === "conquer").length, 1);
  assert.deepEqual(f.match.events().find(event => event.timingPoint === "score").details.participatingUnits,
    [f.kernel.ref("weak")]);
  assert.deepEqual(f.kernel.getObject("mighty-outsider").location, field(f.temple.ref.id));
  assert.deepEqual(f.requests, []);
  assert.equal(f.kernel.player("A").energy, 2);
  assertHandUnchanged(f.kernel, "A", draw);
  assertTempleDrawNotRecorded(f.match.events(), "A", draw);
});

test(PRODUCTION_TEST_NAMES.layeredMight, () => {
  const f = productionMatch({
    prepare: ({ kernel }) => addUnit(kernel, "layered", { might: 4, buffs: 1 }, 41)
  });
  const draw = drawSnapshot(f.kernel, "A");
  f.match.flow.move("A", f.kernel.ref("layered"), f.temple.ref.id);
  settle(f.match.flow);
  f.match.flow.layers.setObjects(f.kernel.objects);
  assert.equal(f.kernel.getObject("layered").might, 4);
  assert.equal(f.match.flow.layers.snapshot(f.kernel.ref("layered")).might, 5);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(f.kernel.player("A").energy, 1);
  draw.assertDrawn(f.match.events());
});

test(PRODUCTION_TEST_NAMES.decline, () => {
  const f = productionMatch({
    accept: false,
    prepare: ({ kernel }) => addUnit(kernel, "mighty-decline", { might: 6 }, 42)
  });
  const draw = drawSnapshot(f.kernel, "A");
  f.match.flow.move("A", f.kernel.ref("mighty-decline"), f.temple.ref.id);
  settle(f.match.flow);
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(f.kernel.player("A").energy, 2);
  assertHandUnchanged(f.kernel, "A", draw);
  assertTempleDrawNotRecorded(f.match.events(), "A", draw);
  assert.ok(f.match.flow.chain.trace.some(entry => entry.step === "removed" && entry.item === "trigger:1"));
  assert.equal(f.match.flow.chain.trace.some(entry => entry.step === "resolved" && entry.item === "trigger:1"), false);
});

test(PRODUCTION_TEST_NAMES.unpayable, () => {
  const f = productionMatch({
    energy: 0,
    prepare: ({ kernel }) => addUnit(kernel, "mighty-unpayable", { might: 6 }, 43)
  });
  const draw = drawSnapshot(f.kernel, "A");
  f.match.flow.move("A", f.kernel.ref("mighty-unpayable"), f.temple.ref.id);
  settle(f.match.flow);
  assert.equal(f.kernel.player("A").energy, 0);
  assertHandUnchanged(f.kernel, "A", draw);
  assertTempleDrawNotRecorded(f.match.events(), "A", draw);
  assert.ok(f.match.flow.chain.trace.some(entry => entry.step === "removed" && entry.reason === "unperformable-trigger"));
  assert.equal(f.match.flow.chain.trace.some(entry => entry.step === "resolved" && entry.item === "trigger:1"), false);
});

test(PRODUCTION_TEST_NAMES.opponent, () => {
  const f = productionMatch({
    firstPlayer: 1,
    prepare: ({ kernel }) => addUnit(kernel, "enemy", { owner: "B", might: 6 }, 44)
  });
  const drawA = drawSnapshot(f.kernel, "A");
  const drawB = drawSnapshot(f.kernel, "B");
  f.match.flow.move("B", f.kernel.ref("enemy"), f.temple.ref.id);
  settle(f.match.flow);
  assert.equal(f.kernel.getObject(f.temple.ref.id).controller, "B");
  assert.deepEqual(f.requests.map(request => request.id), ["finalize:trigger:1:optional"]);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(f.kernel.player("B").energy, 1);
  assertHandUnchanged(f.kernel, "A", drawA);
  assertTempleDrawNotRecorded(f.match.events(), "A", drawA);
  const exactDraw = f.match.events().filter(event => event.timingPoint === "card-drawn" && event.player === "B").at(-1);
  assert.ok(exactDraw);
  assert.equal(f.kernel.zone("B", "hand").some(ref => ref.id === exactDraw.object.ref.id),
    true, "B's hand owns the exact card named by the drawn event");
});

test(PRODUCTION_TEST_NAMES.elsewhere, () => {
  const f = productionMatch({ prepare: ({ kernel }) => addUnit(kernel, "mighty-elsewhere", { might: 6 }, 45) });
  const other = f.match.setup.battlefields.find(entry => entry.id !== f.temple.ref.id);
  assert.ok(other);
  const draw = drawSnapshot(f.kernel, "A");
  f.match.flow.move("A", f.kernel.ref("mighty-elsewhere"), other.id);
  settle(f.match.flow);
  assert.deepEqual(f.requests, []);
  assert.equal(f.kernel.player("A").energy, 2);
  assertHandUnchanged(f.kernel, "A", draw);
  assertTempleDrawNotRecorded(f.match.events(), "A", draw);
  assert.ok(f.match.events().some(event => event.timingPoint === "conquer" && event.details?.battlefieldId === other.id));
});

test(PRODUCTION_TEST_NAMES.noSecondScore, () => {
  const f = productionMatch({ prepare: ({ kernel }) => {
    addUnit(kernel, "mighty-once", { might: 6 }, 46);
    addUnit(kernel, "late-mighty", { might: 6 }, 47);
  } });
  const draw = drawSnapshot(f.kernel, "A");
  f.match.flow.move("A", f.kernel.ref("mighty-once"), f.temple.ref.id);
  settle(f.match.flow);
  draw.assertDrawn(f.match.events());
  f.match.flow.move("A", f.kernel.ref("late-mighty"), f.temple.ref.id);
  settle(f.match.flow);
  assert.deepEqual(f.match.flow.scored("A"), [f.temple.ref.id]);
  assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
});

test(PRODUCTION_TEST_NAMES.replacedPoint, () => {
  const f = productionMatch({
    replaceScore: true,
    prepare: ({ kernel }) => addUnit(kernel, "mighty-replaced", { might: 6 }, 48)
  });
  const draw = drawSnapshot(f.kernel, "A");
  const topTwo = draw.deckBefore.slice(0, 3);
  const drawEventStart = f.match.events().length;
  assert.ok(topTwo.length >= 2);
  f.match.flow.move("A", f.kernel.ref("mighty-replaced"), f.temple.ref.id);
  settle(f.match.flow);
  assert.equal(f.kernel.player("A").score, 0);
  assert.equal(f.match.events().filter(event => event.timingPoint === "conquer").length, 1);
  assert.equal(f.match.events().filter(event => event.timingPoint === "score").length, 1);
  assert.equal(f.requests.filter(request => request.type === "optional").length, 1);
  const hand = handRefs(f.kernel, "A");
  assert.equal(hand.length, draw.handCountBefore + 2);
  const allDraws = f.match.events().slice(drawEventStart).filter(event => event.timingPoint === "card-drawn" && event.player === "A");
  const draws = allDraws.slice(-2);
  assert.equal(draws.length, 2);
  const drawnIds = new Set(draws.map(event => event.object.ref.id));
  assert.ok(drawnIds.size === 1 || drawnIds.size === 2);
  assert.ok(draws.every(event => event.amount === 1 && event.details?.fromZone === "deck"));
  for (const event of draws) {
    assert.ok(hand.some(ref => ref.id === event.object.ref.id),
      "the runtime event names the card that entered Hand");
  }
  assert.ok(f.match.flow.scored("A").includes(f.temple.ref.id));
});
