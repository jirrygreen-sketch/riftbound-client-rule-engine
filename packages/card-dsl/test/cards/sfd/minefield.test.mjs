import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minefield.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { createMatchCommandAdapter } from "../../../../engine-core/dist/game/command-adapter.js";
import { moveUnits } from "../../../../engine-core/dist/game/commands/index.js";
import { createMatch } from "../../../../engine-core/dist/game/lifecycle.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindBurnOutInstructionCapability } from "../../../../engine-core/dist/turn/burn-out.js";

const CANONICAL_ID = "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4";
const PRINTING_ID = "sfd-212-221";
const SOURCE_TEXT = "When you conquer here, put the top 2 cards of your Main Deck into your trash.";
const CORE_RULES_URL = "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL = "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL = "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const SFD_PATCH_URL = "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-core-rules-spiritforged-patch-notes/";
const field = id => ({ type: "battlefield", id });
// Official interaction evidence (also pinned by OFFICIAL_EVIDENCE below):
// Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Radiance patch notes, effective 2026-10-16:
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4.
// At a real 383.4.c.2.b/471.1 Conquer, "here" identifies this exact Battlefield
// (053.3/383.4.c); the mandatory ability is Pending, Finalize selects no target,
// then players receive Priority under 337.1.a/338 and Resolve under 359.3.d.
// "Put the top 2 cards into Trash" follows 441.4; short decks resolve as much
// as possible under 055/359.3.e.11 and 432.3/432.4 handles Burn Out. A
// replacement of the point gain under 383.4.c.2.c cannot suppress this trigger.
// The trigger reads the current Battlefield incarnation; no departed-object LKI
// is needed for the mill. The normal Priority window creates no extra Focus.
const PRODUCTION_TEST_NAMES = Object.freeze({
  setup: "minefield: default setup and two Units produce one mill through Priority, Finalize and Resolve",
  currentController: "minefield: current controller B conquers through real combat and burns B, not creator A",
  shortDeck: "minefield: one-card Main Deck completes Burn Out under the setup production path",
  emptyDeck: "minefield: empty Main Deck recycles two Trash cards and completes the full instructed Burn"
});

const OFFICIAL_EVIDENCE = Object.freeze({
  policyId: "official-effect-order-20261019",
  canonicalCardId: CANONICAL_ID,
  rulesetVersion: "core-1.5",
  coreRules: Object.freeze({
    version: "1.5",
    url: CORE_RULES_URL,
    updated: "2026-10-09",
    effective: "2026-10-16",
    sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec",
    rules: Object.freeze([
      "002", "051", "053.3", "170.2.a-b", "170.8-10", "190.6.a/d",
      "303.2.a", "383.4.c", "432.1.b", "432.2.a-d", "441.4",
      "471.1", "472", "473.2.a/c"
    ])
  }),
  radianceRuling: Object.freeze({
    url: RADIANCE_URL,
    published: "2026-10-09",
    effective: "2026-10-16",
    involvesMinefield: false
  }),
  spiritforgedErrata: Object.freeze({
    url: SFD_ERRATA_URL,
    published: "2026-01-14",
    effective: null,
    involvesMinefield: false
  }),
  spiritforgedRulings: Object.freeze({
    url: SFD_PATCH_URL,
    published: "2025-12-05",
    effective: null,
    involvesMinefield: false
  }),
  interactions: Object.freeze([
    Object.freeze({
      id: "setup-conquer",
      canonicalCardId: CANONICAL_ID,
      productionTests: Object.freeze([PRODUCTION_TEST_NAMES.setup]),
      rules: Object.freeze([
        "002", "051", "053.3", "133.6.a.1", "170.2.a-b", "170.9", "190.6.a/d",
        "303.2.a", "312.2", "313", "337.1", "338.1.a.2", "383.3.d",
        "383.4.c", "383.4.c.2.b", "407.4", "407.5", "471.1", "472", "473.2.a/c"
      ]),
      priorityFocus: "The Score and its Conquer trigger enter the ordinary Chain; shown Standard Move closes its Showdown by Focus passes, the trigger becomes Pending, and the controller receives ordinary Priority.",
      responseWindow: "After the mandatory trigger is Finalized, the ordinary Closed State permits legally timed Reactions before Resolve.",
      replacement: "Minefield supplies no replacement or prevention. CR 383.4.c.2.c keeps the Conquer trigger even if the point gain is replaced.",
      layers: "This trigger does not depend on continuous-effect layer ordering; there is no layer dependency to resolve.",
      lki: "The Board Battlefield source remains present while its Resolve burns cards; no left-zone value is read.",
      simultaneousTriggers: "A multi-Unit Score wave is one batch and registers this Battlefield ability once. There is no card-specific numeric priority; simultaneous ordering remains engine-owned by the applicable CR process.",
      timeline: Object.freeze([
        "createMatch moves the selected Battlefield to the Board at its own Location",
        "MatchCommandAdapter initial scan binds the exact Board object",
        "Standard Move contests the Battlefield and Showdown Focus closes",
        "control-established, Conquer and Score emissions share one batchId",
        "one Pending trigger receives Priority",
        "Finalize chooses no target and pays no cost or optional extra cost",
        "Resolve burns the top two cards"
      ])
    }),
    Object.freeze({
      id: "current-controller",
      canonicalCardId: CANONICAL_ID,
      productionTests: Object.freeze([PRODUCTION_TEST_NAMES.currentController]),
      rules: Object.freeze(["002", "051", "190.6.a/d", "303.2.a", "383.4.c"]),
      priorityFocus: "B receives ordinary Priority and Focus after A ends the prior Main Phase; the battlefield ability is controlled by its current controller B.",
      responseWindow: "The trigger follows the same ordinary Pending, Finalize, Reaction, Resolve sequence as the positive case.",
      replacement: "No replacement or prevention is involved in identifying the controller of the ability.",
      layers: "Control here is a current state rather than a layered characteristic; the test checks the synchronized Battlefield controller.",
      lki: "The source remains on the Board; current controller data is read while the trigger is collected and resolved.",
      simultaneousTriggers: "The counterexample has one participant and therefore one trigger instance.",
      timeline: Object.freeze([
        "A passes an idle Main Phase and B receives Priority",
        "B Standard Moves a Unit into Minefield",
        "B establishes control and the Board object controller synchronizes to B",
        "the Battlefield ability resolves for B and does not burn A"
      ])
    }),
    Object.freeze({
      id: "short-deck-burn-out",
      canonicalCardId: CANONICAL_ID,
      productionTests: Object.freeze([PRODUCTION_TEST_NAMES.shortDeck]),
      rules: Object.freeze(["002", "051", "411.2", "432.1.b", "432.2.a-d", "432.5", "441.1", "441.4"]),
      priorityFocus: "The score and Minefield ability still use the ordinary Priority/Focus and Finalize path. Burn Out occurs only after the ability begins Resolve; it creates no new discretionary priority by itself.",
      responseWindow: "The post-Finalize Reaction opportunity closes before Resolve; the sequence of Burn action, replacement Burn Out, and remaining Burn then executes as the instructed effect.",
      replacement: "Burn Out is a replacement effect by CR 432.5. The test observes the real mill, recycle, shuffle, score, and remaining mill sequence.",
      layers: "No continuous-effect layer or dependency affects the burn amount or Burn Out procedure.",
      lki: "The post-Burn-Out remainder is drawn from the newly recycled Main Deck; the test does not replace that move with a stale pre-resolution reference.",
      simultaneousTriggers: "Only the one per-batch Minefield trigger is resolving in this interaction.",
      timeline: Object.freeze([
        "Score action",
        "Pending then Finalize",
        "Resolve burns the remaining card, recycles and randomizes Trash, awards the opponent one point",
        "Resolve then burns the recycled shortfall card through the same mill action"
      ])
    }),
    Object.freeze({
      id: "empty-deck-burn-out",
      canonicalCardId: CANONICAL_ID,
      productionTests: Object.freeze([PRODUCTION_TEST_NAMES.emptyDeck]),
      rules: Object.freeze(["002", "051", "411.2", "432.1.b", "432.2.a-d", "432.5", "441.1", "441.4"]),
      priorityFocus: "The empty deck changes only the Resolve continuation, not the ordinary Priority/Focus path that produced the Pending trigger.",
      responseWindow: "The ordinary pre-Resolve Reaction window has closed before Burn Out begins; Burn Out itself adds no discretionary choice beyond its instructed sequence.",
      replacement: "CR 432.5 makes Burn Out the replacement for the impossible full two-card burn; both recycled cards are burned after the opponent-point step.",
      layers: "No layer or dependency controls the empty-deck Burn Out continuation.",
      lki: "The two cards are identified in Trash at Burn Out and then burned again after being recycled; the test asserts their final Trash identities.",
      simultaneousTriggers: "Only one per-batch trigger resolves; this boundary concerns the Burn amount, not simultaneous trigger ordering.",
      timeline: Object.freeze([
        "Score action",
        "Pending then Finalize",
        "Resolve attempts the instructed two-card burn with an empty Main Deck",
        "Burn Out recycles and randomizes Trash, awards the opponent one point",
        "Resolve burns the full two-card shortfall"
      ])
    })
  ])
});

function card(id, types, extra = {}) {
  return {
    id,
    cardId: extra.cardId ?? id,
    canonicalCardId: extra.canonicalCardId ?? id,
    types,
    energy: null,
    power: null,
    might: null,
    ...extra
  };
}

function deck({ prefix, mine = false, mainDeckSize = 7 } = {}) {
  return {
    mainDeck: Array.from({ length: mainDeckSize }, (_, index) => card(`${prefix}:main:${index}`, ["unit"], {
      cardType: "Unit",
      energy: 1,
      power: [],
      might: 2
    })),
    runeDeck: Array.from({ length: 4 }, (_, index) => card(`${prefix}:rune:${index}`, ["rune"], {
      cardType: "Rune"
    })),
    championLegend: card(`${prefix}:legend`, ["legend"], { cardType: "Legend" }),
    chosenChampion: card(`${prefix}:champion`, ["champion"], { cardType: "Champion" }),
    battlefields: Array.from({ length: 3 }, (_, index) => card(`${prefix}:battlefield:${index}`, ["battlefield"], {
      cardId: mine && index === 0 ? PRINTING_ID : `${prefix}:battlefield-printing:${index}`,
      canonicalCardId: mine && index === 0 ? CANONICAL_ID : `${prefix}:battlefield-program:${index}`,
      cardType: "Battlefield",
      name: mine && index === 0 ? "Minefield" : `${prefix} field ${index}`
    }))
  };
}

function fixture({ mineDeck = true, mainDeckSize = 7 } = {}) {
  const kernel = world().player("A").player("B").build();
  let pipeline;
  let adapterDefaultChoose;
  const requests = [];
  const choose = request => {
    requests.push(structuredClone(request));
    if (pipeline !== undefined && pipeline.choose !== adapterDefaultChoose) return pipeline.choose(request);
    if (request.type === "optional") return true;
    if (request.type === "mode") return request.options[0];
    if (request.type === "order") return [...request.options];
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  pipeline = createActionPipelineHost({
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
      source: bindBurnOutInstructionCapability(source, kernel.burnOutInstructionCapability()),
      controller,
      timingPoint,
      choose
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  adapterDefaultChoose = pipeline.choose;
  pipeline.player = id => kernel.player(id);
  const binding = createProgramBinding({ cardPrograms: [program] });
  const match = createMatch({
    host: pipeline,
    decks: [deck({ prefix: "A", mine: mineDeck, mainDeckSize }), deck({ prefix: "B" })],
    programs: binding,
    seed: "RIFT-980",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
    victoryScore: 20
  });
  const mine = kernel.objects.find(object => object.cardId === CANONICAL_ID && object.zone === "board");
  assert.ok(mine, "default setup must create Minefield on the Board");
  assert.equal(kernel.getObject(mine.ref.id).zone, "board");
  assert.deepEqual(mine.location, field(mine.ref.id));
  const mineId = mine.location.id;
  const otherField = match.setup.battlefields.find(entry => entry.id !== mineId);
  assert.ok(otherField);
  const adapter = createMatchCommandAdapter({ match, stateVersion: 0 });
  const registrations = () => match.flow.chain.pipeline.registeredTriggers()
    .filter(registration => registration.source.ref.id === mineId);
  assert.deepEqual(registrations().map(registration => registration.id), [
    `program:${mineId}:${mine.ref.zoneEntryId}:0`
  ]);
  assert.equal(registrations()[0].source.zone, "board");
  return { kernel, match, adapter, binding, mine, mineId, otherFieldId: otherField.id, requests, registrations };
}

function addUnit(kernel, id, player, { might = 5, location = { type: "base", player } } = {}) {
  kernel.addObject({
    ref: { id, zoneEntryId: 1 },
    cardId: id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: player,
    controller: player,
    zone: "board",
    location,
    might,
    energy: 0,
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

function settleChain(adapter, label, budget = 160) {
  for (let index = 0; index < budget; index++) {
    if (!adapter.match.flow.chain.items.length) return;
    const player = adapter.match.flow.chain.priority;
    assert.ok(player, "a pending Chain item must grant Priority");
    adapter.execute(player, {
      type: "pass",
      commandId: `RIFT-980:${label}:settle:${index}`,
      stateVersion: adapter.stateVersion
    });
  }
  throw new Error(`Minefield ${label} chain did not settle`);
}

function passUnitIfNeeded(adapter, label) {
  settleChain(adapter, label);
  const flow = adapter.match.flow;
  if (flow.chain.items.length || flow.combat.active) {
    assert.ok(flow.chain.priority);
    adapter.execute(flow.chain.priority, {
      type: "pass",
      commandId: `RIFT-980:${label}:unit:${adapter.stateVersion}`,
      stateVersion: adapter.stateVersion
    });
  }
  settleChain(adapter, label);
}

function finishShowdown(adapter, label) {
  const flow = adapter.match.flow;
  let passes = 0;
  while (flow.combat.current?.step === "showdown") {
    assert.ok(++passes <= 4, "Showdown must close after its Focus passes");
    const focus = flow.chain.focus;
    assert.ok(focus);
    flow.pass(focus);
    settleChain(adapter, label);
  }
}

function moveUnit(adapter, objectId, destination, label) {
  adapter.execute(adapter.match.flow.turnPlayer, {
    type: "move",
    commandId: `RIFT-980:${label}:move`,
    stateVersion: adapter.stateVersion,
    objectId,
    to: { zone: "battlefield", locationId: destination }
  });
  passUnitIfNeeded(adapter, label);
  finishShowdown(adapter, label);
  if (adapter.match.flow.combat.active) {
    adapter.match.flow.advance();
    passUnitIfNeeded(adapter, label);
  }
  settleChain(adapter, label);
}

function moveFormation(adapter, objectIds, destination, label) {
  const flow = adapter.match.flow;
  moveUnits({ match: adapter.match, stateVersion: adapter.stateVersion }, flow.turnPlayer, [...objectIds], {
    zone: "battlefield",
    locationId: destination
  });
  passUnitIfNeeded(adapter, label);
  finishShowdown(adapter, label);
  if (flow.combat.active) {
    flow.advance();
    passUnitIfNeeded(adapter, label);
  }
  settleChain(adapter, label);
}

function endCurrentTurn(adapter, label) {
  settleChain(adapter, label);
  if (adapter.match.flow.chain.focus !== null) {
    adapter.match.flow.pass(adapter.match.flow.chain.focus);
    settleChain(adapter, label);
  }
  adapter.execute(adapter.match.flow.turnPlayer, {
    type: "pass",
    commandId: `RIFT-980:${label}:end-turn`,
    stateVersion: adapter.stateVersion
  });
  settleChain(adapter, label);
}

function triggerEvents(match) {
  return match.events().filter(event => event.timingPoint === "chain-item-pending" &&
    String(event.details?.item ?? "").startsWith("trigger:"));
}

function idsIn(kernel, player, zone) {
  return kernel.objectsInZone(player, zone).map(ref => kernel.getObject(ref.id).cardId);
}

test("minefield: executable identity, text, IR and optional status boundary are exact", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "executable");
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.deepEqual(program.abilities, [{
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquered", here: true, player: "self" },
      once: "per-batch"
    },
    optional: false,
    body: [{
      id: "minefield.mill",
      op: "effect.mill",
      args: { amount: { kind: "constant", value: 2 } }
    }]
  }]);
});

test("minefield: official evidence maps each interaction to real production assertions", () => {
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, CANONICAL_ID);
  assert.equal(OFFICIAL_EVIDENCE.rulesetVersion, "core-1.5");
  assert.equal(OFFICIAL_EVIDENCE.coreRules.updated, "2026-10-09");
  assert.equal(OFFICIAL_EVIDENCE.coreRules.version, "1.5");
  assert.equal(OFFICIAL_EVIDENCE.coreRules.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.coreRules.sha256, "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec");
  assert.equal(OFFICIAL_EVIDENCE.coreRules.url, CORE_RULES_URL);
  assert.equal(OFFICIAL_EVIDENCE.radianceRuling.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.radianceRuling.published, "2026-10-09");
  assert.equal(OFFICIAL_EVIDENCE.radianceRuling.involvesMinefield, false);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedErrata.published, "2026-01-14");
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedErrata.effective, null);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedErrata.involvesMinefield, false);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedRulings.published, "2025-12-05");
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedRulings.effective, null);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedRulings.involvesMinefield, false);
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.map(interaction => interaction.id), [
    "setup-conquer",
    "current-controller",
    "short-deck-burn-out",
    "empty-deck-burn-out"
  ]);
  for (const interaction of OFFICIAL_EVIDENCE.interactions) {
    assert.equal(interaction.canonicalCardId, CANONICAL_ID);
    assert.ok(interaction.rules.length > 0);
    assert.ok(interaction.timeline.length > 0);
    assert.ok(interaction.productionTests.length > 0);
    for (const testName of interaction.productionTests) {
      assert.ok(Object.values(PRODUCTION_TEST_NAMES).includes(testName), `${testName} is a named production test`);
    }
    assert.match(interaction.priorityFocus, /Priority/);
    assert.match(interaction.responseWindow, /Reaction|Resolve|response/i);
    assert.ok(interaction.replacement.length > 0);
    assert.ok(interaction.layers.length > 0);
    assert.ok(interaction.lki.length > 0);
    assert.ok(interaction.simultaneousTriggers.length > 0);
  }
});

test("minefield: trigger contract accepts self conquer at here with per-batch frequency", () => {
  const result = validateTriggerSpec(program.abilities[0].trigger);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(
    translateTriggerFilter(program.abilities[0].trigger.filter, "mine", "conquer"),
    { event: "conquered", here: true, player: "self" }
  );
});

test(PRODUCTION_TEST_NAMES.setup, () => {
  const f = fixture();
  try {
    addUnit(f.kernel, "unit-a1", "A");
    addUnit(f.kernel, "unit-a2", "A");
    const deckBefore = idsIn(f.kernel, "A", "deck");
    const trashBefore = idsIn(f.kernel, "A", "trash");
    moveFormation(f.adapter, ["unit-a1", "unit-a2"], f.mineId, "normal");

    const events = f.match.events();
    const control = events.filter(event => event.timingPoint === "control-established");
    const conquer = events.filter(event => event.timingPoint === "conquer");
    const score = events.filter(event => event.timingPoint === "score");
    assert.equal(control.length, 1);
    assert.equal(conquer.length, 2, "the real Score wave emits one Conquer event per participant");
    assert.equal(score.length, 1);
    assert.equal(new Set(conquer.map(event => event.batchId)).size, 1);
    assert.equal(conquer[0].batchId, score[0].batchId);
    assert.deepEqual(score[0].details.participatingUnits.map(unit => unit.id), ["unit-a1", "unit-a2"]);
    assert.equal(triggerEvents(f.match).length, 1, "per-batch collection creates one Pending trigger");
    assert.equal(f.match.flow.battlefields.find(battlefield => battlefield.id === f.mineId).controller, "A");
    assert.equal(f.kernel.getObject(f.mineId).controller, "A");
    assert.equal(f.kernel.player("A").score, 1);
    assert.equal(f.kernel.player("B").score, 0);
    assert.deepEqual(idsIn(f.kernel, "A", "trash"), trashBefore.concat(deckBefore.slice(0, 2)));
    assert.deepEqual(idsIn(f.kernel, "A", "deck"), deckBefore.slice(2));
    assert.deepEqual(idsIn(f.kernel, "B", "trash"), []);

    const pendingAt = events.findIndex(event => event.timingPoint === "chain-item-pending" &&
      String(event.details?.item ?? "").startsWith("trigger:"));
    const finalizeAt = events.findIndex(event => event.timingPoint === "chain-item-finalize" &&
      String(event.details?.item ?? "").startsWith("trigger:"));
    const burned = events.filter(event => event.timingPoint === "card-burned");
    const resolveAt = events.findIndex(event => event.timingPoint === "chain-item-resolve" &&
      String(event.details?.item ?? "").startsWith("trigger:"));
    assert.ok(pendingAt >= 0 && pendingAt < finalizeAt && finalizeAt < resolveAt);
    assert.equal(burned.length, 2);
    assert.equal(f.requests.some(request => request.id.startsWith("finalize:trigger:")), false,
      "the mandatory trigger has no target, cost, or optional extra cost");
  } finally {
    f.adapter.detach();
  }
});

test(PRODUCTION_TEST_NAMES.currentController, () => {
  const f = fixture();
  try {
    addUnit(f.kernel, "unit-b", "B");
    endCurrentTurn(f.adapter, "controller-end-a");
    assert.equal(f.match.flow.turnPlayer, "B");
    const bDeckBefore = idsIn(f.kernel, "B", "deck");
    const aTrashBefore = idsIn(f.kernel, "A", "trash");
    moveUnit(f.adapter, "unit-b", f.mineId, "controller-b");

    assert.equal(f.match.flow.battlefields.find(battlefield => battlefield.id === f.mineId).controller, "B");
    assert.equal(f.kernel.getObject(f.mineId).controller, "B");
    const conquer = f.match.events().filter(event => event.timingPoint === "conquer");
    assert.equal(conquer.length, 1);
    assert.equal(conquer[0].player, "B");
    assert.equal(triggerEvents(f.match).length, 1);
    assert.deepEqual(idsIn(f.kernel, "B", "trash"), bDeckBefore.slice(0, 2));
    assert.deepEqual(idsIn(f.kernel, "A", "trash"), aTrashBefore);
    assert.equal(f.kernel.player("B").score, 1, "B gains only the real Conquer point");
  } finally {
    f.adapter.detach();
  }
});

test("minefield: conquering the other Battlefield does not satisfy here", () => {
  const f = fixture();
  try {
    addUnit(f.kernel, "unit-other", "A");
    const deckBefore = idsIn(f.kernel, "A", "deck");
    const trashBefore = idsIn(f.kernel, "A", "trash");
    moveUnit(f.adapter, "unit-other", f.otherFieldId, "other-field");

    const conquer = f.match.events().filter(event => event.timingPoint === "conquer");
    assert.equal(conquer.length, 1);
    assert.equal(conquer[0].details.battlefieldId, f.otherFieldId);
    assert.equal(triggerEvents(f.match).length, 0);
    assert.deepEqual(idsIn(f.kernel, "A", "deck"), deckBefore);
    assert.deepEqual(idsIn(f.kernel, "A", "trash"), trashBefore);
  } finally {
    f.adapter.detach();
  }
});

test(PRODUCTION_TEST_NAMES.shortDeck, () => {
  const f = fixture({ mainDeckSize: 6 });
  try {
    addUnit(f.kernel, "unit-short", "A");
    const deckBefore = idsIn(f.kernel, "A", "deck");
    assert.equal(deckBefore.length, 1, "setup and Draw Phase leave fewer than two cards to burn");
    moveUnit(f.adapter, "unit-short", f.mineId, "short-deck");

    assert.equal(triggerEvents(f.match).length, 1);
    assert.deepEqual(idsIn(f.kernel, "A", "deck"), []);
    assert.deepEqual(idsIn(f.kernel, "A", "trash").toSorted(), deckBefore.toSorted());
    assert.equal(f.kernel.player("B").score, 1, "the opponent gains the one Burn Out point");
    assert.equal(f.match.events().filter(event => event.timingPoint === "card-burned").length, 2,
      "the remaining card and the post-Burn-Out shortfall are both burned");
    assert.equal(f.kernel.events.filter(event => event.action === "recycle").length, 1,
      "the one-card Trash is recycled through the real primitive");
    assert.equal(f.kernel.events.filter(event => event.action === "shuffle").length, 1,
      "the recycled Main Deck is randomized through the real primitive");
    const continuation = f.kernel.actionHistory.filter(entry => ["mill", "recycle", "shuffle", "score"].includes(entry.action.type))
      .map(entry => entry.action.type);
    const initialMill = continuation.lastIndexOf("mill", continuation.indexOf("recycle") - 1);
    assert.ok(initialMill >= 0);
    assert.equal(continuation[initialMill - 1], "score", "the Conquer point precedes this resolver's burn");
    assert.deepEqual(continuation.slice(initialMill), ["mill", "recycle", "shuffle", "score", "mill"]);
  } finally {
    f.adapter.detach();
  }
});

test(PRODUCTION_TEST_NAMES.emptyDeck, () => {
  const f = fixture({ mainDeckSize: 5 });
  try {
    addUnit(f.kernel, "unit-empty", "A");
    const deckBefore = idsIn(f.kernel, "A", "deck");
    assert.equal(deckBefore.length, 0, "an empty Main Deck still requires the full two-card instruction");
    const fromHand = f.kernel.objectsInZone("A", "hand").slice(0, 2);
    assert.equal(fromHand.length, 2, "setup provides at least two hand cards to place in Trash");
    const trashBefore = fromHand.map(ref => f.kernel.getObject(ref.id).cardId);
    for (const object of fromHand) {
      assert.equal(f.kernel.perform({ type: "move-zone", object, to: "trash" }).status, "done");
    }
    assert.deepEqual(idsIn(f.kernel, "A", "trash").toSorted(), trashBefore.toSorted());

    moveUnit(f.adapter, "unit-empty", f.mineId, "empty-deck");

    assert.equal(triggerEvents(f.match).length, 1);
    assert.equal(f.kernel.player("B").score, 1, "the opponent gains one point from Burn Out");
    assert.equal(f.kernel.events.filter(event => event.action === "recycle").length, 2,
      "both Trash cards are individually recycled");
    assert.equal(f.kernel.events.filter(event => event.action === "shuffle").length, 1);
    assert.equal(f.match.events().filter(event => event.timingPoint === "card-burned").length, 2,
      "the two-card shortfall is burned after Burn Out");
    assert.deepEqual(idsIn(f.kernel, "A", "deck"), []);
    assert.deepEqual(idsIn(f.kernel, "A", "trash").toSorted(), trashBefore.toSorted());
    const continuation = f.kernel.actionHistory.filter(entry => ["mill", "recycle", "shuffle", "score"].includes(entry.action.type))
      .map(entry => entry.action.type);
    const initialMill = continuation.lastIndexOf("mill", continuation.indexOf("recycle") - 1);
    assert.ok(initialMill >= 0);
    assert.deepEqual(continuation.slice(initialMill), ["mill", "recycle", "recycle", "shuffle", "score", "mill"]);
  } finally {
    f.adapter.detach();
  }
});
