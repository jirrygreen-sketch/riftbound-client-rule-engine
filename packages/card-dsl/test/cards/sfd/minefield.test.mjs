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

const CANONICAL_ID = "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4";
const PRINTING_ID = "sfd-212-221";
const SOURCE_TEXT = "When you conquer here, put the top 2 cards of your Main Deck into your trash.";
const CORE_RULES_URL = "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL = "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL = "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const SFD_PATCH_URL = "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-core-rules-spiritforged-patch-notes/";
const field = id => ({ type: "battlefield", id });

// The committed program remains fail-closed. Lift only this in-memory copy to
// verify the authored IR through the same default setup and command adapter a
// production match uses; the promotion decision stays with the committed status.
const admitted = Object.freeze({ ...program, status: "executable", judgeReason: undefined });

const OFFICIAL_EVIDENCE = Object.freeze({
  policyId: "official-effect-order-20261019",
  canonicalCardId: CANONICAL_ID,
  rulesetVersion: "core-1.5",
  coreRules: Object.freeze({
    url: CORE_RULES_URL,
    updated: "2026-10-09",
    rules: Object.freeze([
      "002", "051", "053.3", "170.2.a-b", "170.8-10", "190.6.a/d",
      "303.2.a", "383.4.c", "432.1.b", "432.2.a-d", "441.4",
      "471.1", "472", "473.2.a/c"
    ])
  }),
  radianceRuling: Object.freeze({
    url: RADIANCE_URL,
    effective: "2026-10-16",
    involvesMinefield: false
  }),
  spiritforgedErrata: Object.freeze({ url: SFD_ERRATA_URL, involvesMinefield: false }),
  spiritforgedRulings: Object.freeze({ url: SFD_PATCH_URL, involvesMinefield: false }),
  interactions: Object.freeze([
    Object.freeze({
      id: "setup-conquer",
      productionTest: "default setup production golden",
      rules: Object.freeze(["002", "051", "053.3", "170.2.a-b", "170.8-10", "303.2.a", "383.4.c", "471.1", "472", "473.2.a/c"]),
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
      productionTest: "current controller production counterexample",
      rules: Object.freeze(["002", "051", "190.6.a/d", "303.2.a", "383.4.c"]),
      timeline: Object.freeze([
        "A passes an idle Main Phase and B receives Priority",
        "B Standard Moves a Unit into Minefield",
        "B establishes control and the Board object controller synchronizes to B",
        "the Battlefield ability resolves for B and does not burn A"
      ])
    }),
    Object.freeze({
      id: "short-deck-burn-out",
      productionTest: "short Main Deck production gap",
      rules: Object.freeze(["002", "051", "432.1.b", "432.2.a-d", "441.4"]),
      timeline: Object.freeze([
        "Score action",
        "Pending then Finalize",
        "Resolve burns the cards remaining in the Main Deck",
        "required Burn Out recycle, randomize, point and shortfall continuation is absent"
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
      source,
      controller,
      timingPoint,
      choose
    }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  adapterDefaultChoose = pipeline.choose;
  pipeline.player = id => kernel.player(id);
  const binding = createProgramBinding({ cardPrograms: [admitted] });
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

test("minefield: identity, text, IR and the narrowed judge-required boundary are exact", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /apps\/game-server\/src\/engine-runtime\/host\.ts:745-749/);
  assert.match(program.judgeReason, /effects\/instructions\/effect\.mill\.ts:358-371/);
  assert.match(program.judgeReason, /turn\/burn-out\.ts:38-74/);
  assert.match(program.judgeReason, /CR 441\.4、432\.1\.b、432\.2\.a-d/);
  assert.doesNotMatch(program.judgeReason, /room\.ts|ProgramBinding/);
  assert.match(program.judgeReason, /不足 2 张|至多 2 张/);
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
  assert.equal(OFFICIAL_EVIDENCE.coreRules.url, CORE_RULES_URL);
  assert.equal(OFFICIAL_EVIDENCE.radianceRuling.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.radianceRuling.involvesMinefield, false);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedErrata.involvesMinefield, false);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedRulings.involvesMinefield, false);
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.map(interaction => interaction.id), [
    "setup-conquer",
    "current-controller",
    "short-deck-burn-out"
  ]);
  for (const interaction of OFFICIAL_EVIDENCE.interactions) {
    assert.ok(interaction.rules.length > 0);
    assert.ok(interaction.timeline.length > 0);
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

test("minefield: default setup and two Units produce one mill through Priority, Finalize and Resolve", () => {
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

test("minefield: current controller B conquers through real combat and burns B, not creator A", () => {
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

test("minefield: short Main Deck exposes the missing Burn Out continuation under the setup production path", () => {
  const f = fixture({ mainDeckSize: 6 });
  try {
    addUnit(f.kernel, "unit-short", "A");
    const deckBefore = idsIn(f.kernel, "A", "deck");
    assert.equal(deckBefore.length, 1, "setup and Draw Phase leave fewer than two cards to burn");
    moveUnit(f.adapter, "unit-short", f.mineId, "short-deck");

    assert.equal(triggerEvents(f.match).length, 1);
    assert.deepEqual(idsIn(f.kernel, "A", "deck"), []);
    assert.deepEqual(idsIn(f.kernel, "A", "trash"), deckBefore);
    assert.equal(f.kernel.player("B").score, 0);
    assert.equal(f.match.events().filter(event => event.timingPoint === "card-burned").length, 1);
    assert.equal(f.kernel.events.filter(event => event.action === "recycle").length, 0);
  } finally {
    f.adapter.detach();
  }
});
