import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minefield.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const CANONICAL_ID = "card.hash-0c36f22df8ffa7bed49f59fd138d24b9b0a52a7b8ad4c720afcaa12ec816eee4";
const SOURCE_TEXT = "When you conquer here, put the top 2 cards of your Main Deck into your trash.";
const c = value => ({ kind: "constant", value });
const field = id => ({ type: "battlefield", id });

// Keep the registry's status gate explicit. These tests exercise the authored
// IR through the default production lifecycle without changing the committed
// judge-required classification.
const admitted = { ...program, status: "executable", judgeReason: undefined };

// Structured effect-order evidence. The cached official snapshots were checked
// for this card; none of the three supplement/rulings pages names Minefield.
const OFFICIAL_EVIDENCE = Object.freeze({
  policyId: "official-effect-order-20261019",
  canonicalCardId: CANONICAL_ID,
  coreRules: {
    url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
    version: "1.5",
    updated: "2026-10-09",
    rules: ["002", "051", "053.3", "170.2.a-b", "170.8-10", "190.6.a/d", "303.2.a", "383.4.c", "432.1.b", "432.2.a-d", "441.4", "471.1", "472", "473.2.a/c"]
  },
  radianceRuling: {
    url: "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/",
    effective: "2026-10-16",
    involvesMinefield: false
  },
  spiritforgedErrata: {
    url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/",
    involvesMinefield: false
  },
  spiritforgedRulings: {
    url: "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-core-rules-spiritforged-patch-notes/",
    involvesMinefield: false
  },
  interactions: Object.freeze([
    Object.freeze({
      id: "full-deck-conquer",
      productionTest: "default lifecycle production golden",
      priorityFocus: "competing Units close the Showdown through Focus passes; the trigger follows control-established, conquer, and score and receives ordinary Priority before Finalize/Resolve",
      replacement: "none in this interaction",
      layers: "not consulted; the trigger is positional/player based",
      lki: "not required for the burn move",
      timeline: ["Score action", "control-established", "two conquer emissions sharing one score-wave batchId", "one Pending trigger", "Finalize with no target, cost, or optional choice", "Resolve moves two live top cards to trash"]
    }),
    Object.freeze({
      id: "short-deck-burn-out",
      productionTest: "short Main Deck production gap",
      priorityFocus: "same post-Score trigger window as full-deck conquest",
      replacement: "Burn Out is the required replacement at CR 432.5; current mill host omits it",
      layers: "not consulted",
      lki: "not required",
      timeline: ["Score action", "Pending", "Finalize", "Resolve burns available cards", "required Burn Out continuation is absent"]
    })
  ])
});

function choose(request) {
  if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
    return [...request.options];
  }
  if (request.type === "select-objects" && request.min === 0) return [];
  if (request.type === "mode") return request.options[0];
  throw new Error(`Unexpected production choice ${request.type}/${request.id}`);
}

function fixture({ mineAt = "bf1", cards = ["top", "second", "third", "fourth"], fieldController = null, units = [] } = {}) {
  const builder = world()
    .player("A")
    .player("B")
    .deck(cards, { owner: "A" })
    .deck(["b:top", "b:second", "b:third", "b:fourth"], { owner: "B" })
    .rune(["a:rune:0", "a:rune:1"], { owner: "A" })
    .rune(["b:rune:0", "b:rune:1"], { owner: "B" })
    .battlefield("mine", {
      cardId: CANONICAL_ID,
      types: ["battlefield"],
      isToken: true,
      owner: "A",
      controller: "A",
      location: field(mineAt),
      might: null,
      energy: null,
      power: null
    });
  for (const unit of units) {
    builder.unit(unit.id, {
      owner: unit.owner,
      controller: unit.owner,
      might: unit.might,
      location: unit.location
    });
  }
  const kernel = builder.build();
  const host = createActionPipelineHost({
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
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: fieldController }, { id: "bf2", controller: null }],
    victoryScore: 20
  });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  const lifecycleErrors = [];
  binding.attachLifecycle(flow.chain, error => lifecycleErrors.push(error));
  const registrations = () => flow.chain.pipeline.registeredTriggers()
    .filter(registration => registration.source.ref.id === "mine");
  const settle = (budget = 160) => {
    for (let index = 0; index < budget; index++) {
      if (flow.chain.items.length) {
        assert.ok(flow.chain.priority, "a pending Chain item must grant Priority");
        flow.pass(flow.chain.priority);
        continue;
      }
      if (flow.chain.focus !== null) {
        flow.pass(flow.chain.focus);
        continue;
      }
      if (flow.combat.active) {
        flow.advance();
        continue;
      }
      return;
    }
    throw new Error("Minefield production path did not settle");
  };
  const moveTo = (owner, ids, id = `move:${owner}:${ids.join("+")}:${mineAt}`, destination = mineAt) => flow.execute({
    id,
    controller: owner,
    source: kernel.getObject(ids[0]),
    kind: "activated",
    speed: "normal",
    body: [{
      id: `${id}:effect`,
      op: "effect.move",
      args: {
        objects: c({ kind: "choose", id: `${id}:objects`, filter: { type: "unit", zone: "board", controller: owner } }),
        amount: c(ids.length),
        to: c(field(destination))
      }
    }]
  });
  return { kernel, flow, binding, lifecycleErrors, registrations, settle, moveTo };
}

function triggerPending(flow) {
  return flow.chain.trace.filter(entry =>
    entry.step === "pending" && String(entry.item ?? "").startsWith("trigger:"));
}

test("minefield: validates the current identity, text, and honest judge-required structure", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /apps\/game-server\/src\/room\.ts:236-243/);
  assert.match(program.judgeReason, /apps\/game-server\/src\/engine-runtime\/host\.ts:745-748/);
  assert.match(program.judgeReason, /turn\/burn-out\.ts:38-74/);
  assert.match(program.judgeReason, /CR 441\.4、432\.1\.b、432\.2\.a-d/);
  assert.doesNotMatch(program.judgeReason, /programs\/lifecycle\.ts:439-441/);
  assert.doesNotMatch(program.judgeReason, /combat\/flow\.ts:393/);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.deepEqual(ability.trigger, {
    at: "conquer",
    filter: { event: "conquered", here: true, player: "self" },
    once: "per-batch"
  });
  assert.equal(ability.optional, false);
  assert.deepEqual(ability.body, [{
    id: "minefield.mill",
    op: "effect.mill",
    args: { amount: { kind: "constant", value: 2 } }
  }]);
});

test("minefield: official order evidence is tied to the real production tests", () => {
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, CANONICAL_ID);
  assert.equal(OFFICIAL_EVIDENCE.coreRules.version, "1.5");
  assert.equal(OFFICIAL_EVIDENCE.coreRules.updated, "2026-10-09");
  assert.equal(OFFICIAL_EVIDENCE.radianceRuling.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.radianceRuling.involvesMinefield, false);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedErrata.involvesMinefield, false);
  assert.equal(OFFICIAL_EVIDENCE.spiritforgedRulings.involvesMinefield, false);
  assert.match(OFFICIAL_EVIDENCE.coreRules.url, /5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94\.pdf$/);
  assert.deepEqual(OFFICIAL_EVIDENCE.interactions.map(interaction => interaction.id), [
    "full-deck-conquer",
    "short-deck-burn-out"
  ]);
});

test("minefield: the closed trigger contract accepts self conquer at here with per-batch frequency", () => {
  const result = validateTriggerSpec(program.abilities[0].trigger);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(
    translateTriggerFilter(program.abilities[0].trigger.filter, "mine", "conquer"),
    { event: "conquered", here: true, player: "self" }
  );
});

test("minefield: default lifecycle binds setup Battlefield and two Units produce one mill through Priority/Focus/Finalize/Resolve", () => {
  const f = fixture({
    cards: ["drawn", "top", "second", "third"],
    units: [
      { id: "u1", owner: "A", might: 2, location: { type: "base", player: "A" } },
      { id: "u2", owner: "A", might: 3, location: { type: "base", player: "A" } }
    ]
  });
  assert.deepEqual(f.lifecycleErrors, []);
  assert.deepEqual(f.registrations().map(registration => registration.id), ["program:mine:1:0"]);
  f.flow.start();
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["top", "second", "third"]);

  f.moveTo("A", ["u1", "u2"], "two-unit-conquer");
  f.settle();

  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
  const score = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "score");
  assert.equal(conquer.length, 2, "the real TurnFlow emits one conquer event per participant");
  assert.equal(new Set(conquer.map(event => event.batchId)).size, 1);
  assert.equal(score.length, 1);
  assert.equal(conquer[0].batchId, score[0].batchId);
  assert.deepEqual(score[0].details.participatingUnits, [f.kernel.ref("u1"), f.kernel.ref("u2")]);
  assert.equal(triggerPending(f.flow).length, 1, "per-batch collection must expose one Pending trigger");
  assert.deepEqual(f.kernel.zone("A", "trash").map(ref => ref.id), ["top", "second"]);
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["third"]);
  assert.deepEqual(f.kernel.zone("B", "trash"), []);
  assert.equal(f.flow.battlefields.find(battlefield => battlefield.id === "bf1").controller, "A");
  assert.equal(f.kernel.player("A").score, 1);

  const pendingAt = f.flow.chain.pipeline.events.findIndex(event =>
    event.timingPoint === "chain-item-pending" && String(event.details?.item).startsWith("trigger:"));
  const finalizeAt = f.flow.chain.pipeline.events.findIndex(event =>
    event.timingPoint === "chain-item-finalize" && String(event.details?.item).startsWith("trigger:"));
  const burned = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "card-burned");
  const resolveAt = f.flow.chain.pipeline.events.findIndex(event =>
    event.timingPoint === "chain-item-resolve" && String(event.details?.item).startsWith("trigger:"));
  assert.ok(conquer.every(event => f.flow.chain.pipeline.events.indexOf(event) < pendingAt));
  assert.ok(pendingAt >= 0 && pendingAt < finalizeAt && finalizeAt < resolveAt);
  assert.equal(burned.length, 2);
});

test("minefield: current controller B conquers through real combat and mills B, not creator A", () => {
  const f = fixture({
    fieldController: "A",
    cards: ["drawn", "a:top", "a:second"],
    units: [
      { id: "attacker", owner: "B", might: 4, location: field("bf1") },
      { id: "defender", owner: "A", might: 2, location: field("bf1") }
    ]
  });
  assert.deepEqual(f.lifecycleErrors, []);
  assert.equal(f.registrations().length, 1);
  f.flow.start();
  assert.equal(f.flow.chain.focus, "B");
  f.flow.pass("B");
  f.flow.pass("A");
  f.flow.combat.prepareDamage();
  f.flow.combat.submitAttackerDamage("B", [{ uid: "defender", amount: 4 }]);
  f.flow.combat.submitDefenderDamage("A", [{ uid: "attacker", amount: 2 }]);
  f.settle();

  assert.equal(f.flow.battlefields.find(battlefield => battlefield.id === "bf1").controller, "B");
  assert.equal(f.kernel.getObject("mine").controller, "B", "CR 190.6 reads the synchronized Battlefield controller");
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "control-established").length, 1);
  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.equal(conquer[0].player, "B");
  assert.equal(triggerPending(f.flow).length, 1);
  assert.deepEqual(f.kernel.zone("B", "trash").map(ref => ref.id), ["b:top", "b:second"]);
  assert.equal(f.kernel.zone("A", "trash").some(ref => ["a:top", "a:second"].includes(ref.id)), false);
  assert.deepEqual(f.kernel.zone("A", "trash").map(ref => ref.id), ["defender"], "combat damage moves only the defeated defender to A's trash");
  assert.equal(f.kernel.player("B").score, 1);
});

test("minefield: conquer at another Battlefield does not trigger here", () => {
  const f = fixture({
    mineAt: "bf2",
    cards: ["drawn", "top", "second", "third"],
    units: [{ id: "mover", owner: "A", might: 3, location: { type: "base", player: "A" } }]
  });
  f.flow.start();
  f.moveTo("A", ["mover"], undefined, "bf1");
  f.settle();

  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.equal(conquer[0].details.battlefieldId, "bf1");
  assert.equal(triggerPending(f.flow).length, 0);
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["top", "second", "third"]);
  assert.deepEqual(f.kernel.zone("A", "trash"), []);
});

test("minefield: short Main Deck exposes the missing Burn Out continuation instead of treating two as up-to-two", () => {
  const f = fixture({
    cards: ["drawn", "last"],
    units: [
      { id: "u1", owner: "A", might: 2, location: { type: "base", player: "A" } },
      { id: "u2", owner: "A", might: 2, location: { type: "base", player: "A" } }
    ]
  });
  f.flow.start();
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["last"]);
  f.moveTo("A", ["u1", "u2"], "short-deck-conquer");
  f.settle();

  assert.equal(triggerPending(f.flow).length, 1);
  assert.deepEqual(f.kernel.zone("A", "trash").map(ref => ref.id), ["last"]);
  assert.deepEqual(f.kernel.zone("A", "deck"), []);
  assert.equal(f.kernel.player("B").score, 0, "no opponent Burn Out point is awarded");
  assert.equal(f.flow.chain.pipeline.events.filter(event => event.timingPoint === "card-burned").length, 1);
  assert.equal(f.kernel.events.filter(event => event.action === "shuffle").length, 0);
  assert.equal(f.kernel.events.filter(event => event.action === "recycle").length, 0);
});
