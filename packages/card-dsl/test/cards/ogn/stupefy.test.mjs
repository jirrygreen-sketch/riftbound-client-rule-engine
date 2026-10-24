import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { executeGameCommand } from "../../../../engine-core/dist/game/commands/index.js";
import { createMatch } from "../../../../engine-core/dist/game/lifecycle.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

import stupefy from "../../../dist/cards/ogn/stupefy.js";

const [speed, play] = stupefy.abilities;
const [debuff, drawInstruction] = play.body;
const CANONICAL_CARD_ID = "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf";

// Official interaction evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf.
// Reaction is 159.2.b/813.1.c, allowing a Closed-State response. The one Unit
// target is locked at Finalize under 355.7/355.9, both players receive the
// Priority window, and 359.3.d resolves top-to-bottom. The reduction is an
// arithmetic-layer effect under 478/479 and honors the card's printed minimum
// snapshotted by that effect; 359.3.e.5 drops only the illegal debuff while the
// unlinked Draw 1 still executes under 359.3.e.11, expiring at 317.2.c.
// It becomes Pending after the Play move, creates no Focus in the neutral Main
// Phase, and uses no departed-object LKI when the locked target leaves Board.

const registrations = (kernel) => kernel.continuousEffects.map((entry, index) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: index + 1
}));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

function debuffWorld(might) {
  const kernel = world()
    .unit("target-unit", { owner: "B", controller: "B", might, zone: "board" })
    .deck(["top-card", "bottom-card"], { owner: "A" })
    .build();
  kernel.setTargets("unit", [kernel.ref("target-unit")]);
  return kernel;
}

test("Stupefy program is structurally valid and executable", () => {
  const result = validateCardProgram(stupefy);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(stupefy.status, "executable");
  assert.equal(stupefy.judgeReason, undefined);
  assert.equal(
    stupefy.canonicalCardId,
    "card.hash-5b08b5b8648e8c5c057d15279d1b4e677457eb0b43fcf2810e2ec4f4c4d1b7cf"
  );
  assert.equal(stupefy.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.match(stupefy.sourceText, /minimum of 1/);
  assert.equal(cardRegistryById.get(stupefy.canonicalCardId), stupefy);
});

test("Stupefy ability structure: [Reaction] keyword + debuff target + unlinked draw", () => {
  assert.equal(stupefy.abilities.length, 2);

  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });

  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["debuff", "draw"]
  );

  // "Give a unit -1 Might this turn": exactly one target (any one unit).
  assert.equal(debuff.targets.length, 1);
  assert.equal(debuff.targets[0].id, "unit");
  assert.equal(debuff.targets[0].selection, "one");
  assert.equal(debuff.targets[0].filter.type, "unit");
  assert.equal(debuff.targets[0].filter.zone, "board");
  assert.equal(debuff.targets[0].min, 1);
  assert.equal(debuff.targets[0].max, 1);
  assert.equal(debuff.picks, undefined, "Stupefy chooses a unit as a target, not a non-target pick.");
  // The printed -1 with the "minimum of 1" clamp is carried into the merged
  // continuous.might primitive, which snapshots it per 479.4.b.
  assert.equal(debuff.op, "continuous.might");
  assert.deepEqual(debuff.args.amount, { kind: "literal", value: -1 });
  assert.deepEqual(debuff.args.duration, { kind: "literal", value: "this-turn" });
  assert.deepEqual(debuff.args.minimum, { kind: "literal", value: 1 });
  assert.deepEqual(debuff.args.objects, {
    kind: "literal",
    value: { kind: "target", id: "unit" }
  });

  // "Draw 1." is NOT linked to the debuff: under 359.3.e.11 ("as much as
  // possible") the draw still happens when the debuff cannot (e.g. the only
  // unit already has 1 Might).
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.deepEqual(drawInstruction.args.amount, { kind: "literal", value: 1 });
});

test("Stupefy golden: the debuff registers -1 Might this turn on the locked unit and Draw 1 resolves", () => {
  const kernel = debuffWorld(4);
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [["debuff", "executed"], ["draw", "executed"]]
  );
  // 478 / 478.1.a: Might modifications live in the arithmetic layer, applied by
  // ctx.addContinuous with the printed minimum snapshotted (479.4.b).
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -1);
  assert.equal(registration.effect.effect.minimum, 1);
  assert.deepEqual(registration.effect.filter.objectId, "target-unit");
  // 317.1.a / 468.7.c: "this turn" is an end-of-turn duration.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  assert.equal(effectiveMight(kernel, "target-unit"), 3);
  // The independent "Draw 1." really drew from the top of the deck (414.1.a).
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
});

test("Stupefy golden: the printed minimum of 1 is snapshotted, not the layer engine's 0 floor", () => {
  // 479.4.b: a 1-Might unit given "-1 to a minimum of 1" receives a 0-Might
  // modification and stays at 1; the generic arithmetic pass would floor at 0.
  const kernel = debuffWorld(1);
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 0);
  assert.equal(kernel.continuousEffects[0].effect.effect.minimum, 1);
  assert.equal(effectiveMight(kernel, "target-unit"), 1);
  // The debuff did not negate the independent draw (359.3.e.11).
  assert.equal(kernel.player("A").handSize, 1);
});

test("Stupefy golden: the modification expires at end of turn (317.1.a / 468.7.c)", () => {
  const kernel = debuffWorld(4);
  resolveChainBody(play.body, kernel);
  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("target-unit")).might, 3);

  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("target-unit")).might, 4);
});

test("Stupefy golden: a target that left the Board is ignored and Draw 1 still resolves (359.3.e.6 / 359.3.e.11)", () => {
  const kernel = debuffWorld(4);
  const stale = kernel.ref("target-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("unit", [stale]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status, result.result.reason ?? null]),
    [["debuff", "ignored", "mistargeted"], ["draw", "executed", null]]
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.player("A").handSize, 1);
});

// Independent production golden for this card only. The unchanged shipped
// program runs through createProgramBinding -> the default ChainEngine -> a
// real ActionPipelineHost. All values below belong to Stupefy: printed Energy
// 1, no Power, target id "unit", -1 Might with minimum 1, independent Draw 1.
const productionScenario = ({
  energy = 1,
  deck = ["stupefy-top", "stupefy-next"],
  targetMight = 4,
  answers = { "target:unit": ["stupefy-target"] },
  objects,
  operations = [
    { type: "play", object: "stupefy", player: "A" },
    { type: "pass", player: "A" },
    { type: "pass", player: "B" }
  ]
} = {}) => ({
  players: {
    A: { energy, zones: { hand: ["stupefy"], deck } },
    B: { energy: 1 }
  },
  objects: objects ?? [
    {
      id: "stupefy",
      program: stupefy,
      cardId: CANONICAL_CARD_ID,
      owner: "A",
      types: ["spell"],
      zone: "hand",
      energy: 1,
      power: null,
      might: null
    },
    ...deck.map(id => ({ id, owner: "A", types: ["unit"], zone: "deck", might: 2 })),
    { id: "stupefy-target", owner: "B", types: ["unit"], zone: "board", might: targetMight },
    { id: "stupefy-bystander", owner: "B", types: ["unit"], zone: "board", might: 5 }
  ],
  answers,
  operations
});

const scenarioObject = (result, id) => result.state.objects.find(object => object.ref.id === id);

function productionHarness({ energy = 1, deck = ["stupefy-top", "stupefy-next"], choose } = {}) {
  const kernel = world()
    .player("A", { energy })
    .player("B", { energy: 1 })
    .hand("stupefy", {
      cardId: CANONICAL_CARD_ID,
      types: ["spell"],
      energy: 1,
      power: null,
      might: null
    })
    .unit("stupefy-target", { owner: "B", might: 4 })
    .unit("stupefy-bystander", { owner: "B", might: 5 })
    .deck(deck, { owner: "A" })
    .build();
  const requests = [];
  const decide = request => {
    requests.push(request);
    if (choose) return choose(request, kernel);
    if (request.id === "target:unit") return [kernel.ref("stupefy-target")];
    throw new Error(`Unexpected Stupefy choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose: decide
    })
  });
  const binding = createProgramBinding({ cardPrograms: [stupefy] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine);
  return { kernel, binding, engine, requests };
}

test(`Stupefy production golden: pay 1 Energy, resolve -1 Might and Draw 1 through the default program chain [${CANONICAL_CARD_ID}]`, () => {
  const result = runCardScenario(stupefy, productionScenario({
    expect: {
      objects: {
        stupefy: { zone: "trash", energy: 1, power: null, might: null },
        "stupefy-target": { zone: "board", might: 3, damage: 0 },
        "stupefy-bystander": { zone: "board", might: 5 }
      },
      players: { A: { energy: 0, power: [], handSize: 1, deckSize: 1 } },
      events: {
        sequence: [
          { timingPoint: "chain-item-pending", object: { ref: "stupefy" } },
          { timingPoint: "became-target", object: { ref: "stupefy-target" }, source: { ref: "stupefy" } },
          { timingPoint: "chain-item-finalize", object: { ref: "stupefy" } },
          { timingPoint: "card-drawn", object: { ref: "stupefy-top" }, source: { ref: "stupefy" } },
          { timingPoint: "card-played", object: { ref: "stupefy" } },
          { timingPoint: "chain-item-resolve", object: { ref: "stupefy" } }
        ]
      },
      links: {
        "debuff.affected.count": 1,
        "debuff.affected.objects": [{ id: "stupefy-target", zoneEntryId: 1 }],
        "draw.drawn": 1,
        "draw.drawnTo": "A"
      }
    }
  }));

  result.asserts();
  assert.equal(result.state.priority, "A");
  assert.deepEqual(result.state.chain, []);
  const playEvent = result.events.find(event => event.timingPoint === "card-played");
  assert.deepEqual(playEvent.details.printed, { energy: 1, power: null, might: null });
  const finalize = result.events.findIndex(event => event.timingPoint === "chain-item-finalize");
  const draw = result.events.findIndex(event => event.timingPoint === "card-drawn");
  const resolved = result.events.findIndex(event => event.timingPoint === "chain-item-resolve");
  assert.ok(finalize < draw && draw < resolved);
});

test(`Stupefy production golden: Finalize locks the target and pays before Priority passes; Resolve waits for the reaction window [${CANONICAL_CARD_ID}]`, () => {
  const { kernel, binding, engine } = productionHarness();
  const source = kernel.getObject("stupefy");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  assert.equal(draft.speed, "reaction");
  assert.deepEqual(draft.cost.cost, { kind: "printed" });
  assert.deepEqual(draft.cost.domains, []);

  engine.execute(draft);
  const [item] = engine.items;
  assert.equal(item.status, "finalized");
  assert.deepEqual(item.targetPlans[0].selected, [{ id: "stupefy-target", zoneEntryId: 1 }]);
  assert.deepEqual(item.costPlan.total, { energy: 1, power: [], xp: 0, actions: [] });
  assert.equal(item.payment.paid, true);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject("stupefy-target").might, 4);
  // The spell has moved from Hand to Chain, but Draw 1 has not resolved.
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(engine.turnState, "neutral-closed");
  assert.equal(engine.priority, "A");

  engine.pass("A");
  assert.equal(engine.priority, "B");
  assert.equal(engine.turnState, "neutral-closed");
  assert.equal(kernel.getObject("stupefy-target").might, 4, "The effect has not resolved in Response.");
  assert.equal(kernel.player("A").handSize, 0, "Draw 1 has not resolved in Response.");

  engine.pass("B");
  // CR 339.1: the two unbroken passes resolve the sole item and close the chain.
  assert.equal(engine.items.length, 0);
  assert.equal(engine.turnState, "neutral-open");
  assert.equal(engine.priority, "A");
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("stupefy-target")).might, 3);
  assert.equal(kernel.getObject("stupefy-bystander").might, 5);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.getObject("stupefy").zone, "trash");
  assert.deepEqual(
    engine.trace.filter(entry => entry.item === item.id && ["pending", "finalized", "resolved", "removed"].includes(entry.step))
      .map(entry => entry.step),
    ["pending", "finalized", "resolved", "removed"]
  );
});

test(`Stupefy production golden: a second copy may respond in the Closed State and resolves first [${CANONICAL_CARD_ID}]`, () => {
  const kernel = world()
    .player("A", { energy: 1 })
    .player("B", { energy: 1 })
    .hand("stupefy-a", {
      cardId: CANONICAL_CARD_ID,
      types: ["spell"],
      keywords: [{ id: "Reaction" }],
      energy: 1,
      power: null,
      might: null
    })
    .hand("stupefy-b", {
      cardId: CANONICAL_CARD_ID,
      types: ["spell"],
      keywords: [{ id: "Reaction" }],
      energy: 1,
      power: null,
      might: null
    })
    .unit("stupefy-a-target", { owner: "B", might: 4 })
    .unit("stupefy-b-target", { owner: "A", might: 5 })
    .deck(["stupefy-a-draw"], { owner: "A" })
    .deck(["stupefy-b-draw"], { owner: "B" })
    .build();
  const targetSequence = ["stupefy-b-target", "stupefy-a-target"];
  const choose = request => {
    if (request.id !== "target:unit") throw new Error(`Unexpected Stupefy choice ${request.id}`);
    return [kernel.ref(targetSequence.shift())];
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose
    })
  });
  const binding = createProgramBinding({ cardPrograms: [stupefy] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine);

  const first = kernel.getObject("stupefy-a");
  const firstDraft = binding.describePlay({ type: "play", object: first.ref, player: "A" }, first);
  engine.execute(firstDraft);
  assert.equal(engine.priority, "A");
  assert.equal(engine.canAct("B", "reaction", engine.items[0].source.ref, engine.items[0].source), false);
  engine.pass("A");
  assert.equal(engine.priority, "B");
  assert.equal(engine.canAct("B", "reaction", engine.items[0].source.ref, engine.items[0].source), true);

  const second = kernel.getObject("stupefy-b");
  const secondDraft = binding.describePlay({ type: "play", object: second.ref, player: "B" }, second);
  assert.equal(secondDraft.speed, "reaction");
  engine.execute(secondDraft);
  assert.deepEqual(engine.items.map(item => [item.controller, item.status]), [["A", "finalized"], ["B", "finalized"]]);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.player("B").energy, 0);
  assert.equal(kernel.getObject("stupefy-a-target").might, 4);
  assert.equal(kernel.getObject("stupefy-b-target").might, 5);

  engine.pass("B");
  assert.equal(engine.priority, "A");
  engine.pass("A");
  assert.equal(engine.items.length, 1);
  // B's response resolves first (CR 340.1); A's outer item now waits through
  // its post-Resolution pass window.
  assert.equal(kernel.getObject("stupefy-a-target").might, 4);
  assert.equal(kernel.getObject("stupefy-b-target").might, 5);
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.player("A").handSize, 0);

  engine.pass("A");
  assert.equal(engine.priority, "B");
  engine.pass("B");
  assert.equal(engine.items.length, 0);
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("stupefy-a-target")).might, 3);
  assert.equal(engine.layers.evaluate(kernel.ref("stupefy-b-target")).might, 4);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("B").handSize, 1);
  assert.deepEqual(
    engine.pipeline.events.filter(event => event.timingPoint === "card-drawn").map(event => event.object.ref.id),
    ["stupefy-b-draw", "stupefy-a-draw"]
  );
  assert.deepEqual(
    engine.pipeline.events.filter(event => event.timingPoint === "chain-item-resolve").map(event => event.object.ref.id),
    ["stupefy-b", "stupefy-a"]
  );
});

test(`Stupefy production boundaries: no legal target, illegal target and insufficient Energy fail before payment [${CANONICAL_CARD_ID}]`, () => {
  const targetless = [
    {
      id: "stupefy",
      program: stupefy,
      cardId: CANONICAL_CARD_ID,
      owner: "A",
      types: ["spell"],
      zone: "hand",
      energy: 1,
      power: null,
      might: null
    },
    { id: "stupefy-top", owner: "A", types: ["unit"], zone: "deck", might: 2 },
    { id: "stupefy-gear", owner: "B", types: ["gear"], zone: "board", might: null },
    { id: "stupefy-hand-unit", owner: "B", types: ["unit"], zone: "hand", might: 4 }
  ];
  assert.throws(
    () => runCardScenario(stupefy, productionScenario({
      deck: ["stupefy-top"],
      objects: targetless,
      answers: {},
      operations: [{ type: "play", object: "stupefy", player: "A" }]
    })),
    error => error.name === "TargetSelectionError" && error.code === "no-legal-targets"
  );

  const withLegalCandidate = [
    ...targetless,
    { id: "stupefy-legal", owner: "B", types: ["unit"], zone: "board", might: 4 }
  ];
  for (const invalid of ["stupefy-hand-unit", "stupefy-gear", "stupefy"]) {
    assert.throws(
      () => runCardScenario(stupefy, productionScenario({
        deck: ["stupefy-top"],
        objects: withLegalCandidate,
        answers: { "target:unit": [invalid] },
        operations: [{ type: "play", object: "stupefy", player: "A" }]
      })),
      error => error.name === "TargetSelectionError" && error.code === "invalid-target-choice",
      invalid
    );
  }

  assert.throws(
    () => runCardScenario(stupefy, productionScenario({
      energy: 0,
      operations: [{ type: "play", object: "stupefy", player: "A" }]
    })),
    error => error.name === "CostPlanError" && error.reason === "cannot-pay-cost" && /insufficient Energy/.test(error.message)
  );
});

test(`Stupefy production atomicity: a later payment failure restores host, events, chain, Priority and links [${CANONICAL_CARD_ID}]`, () => {
  const { kernel, binding, engine, requests } = productionHarness({ energy: 0 });
  const beforeState = kernel.snapshot();
  const beforeLinks = kernel.linkedSnapshot();
  const beforeTrace = engine.trace;
  const beforeEvents = structuredClone(engine.pipeline.events);
  const source = kernel.getObject("stupefy");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);

  assert.throws(
    () => engine.execute(draft),
    error => error.name === "CostPlanError" && error.reason === "cannot-pay-cost" && /insufficient Energy/.test(error.message)
  );
  assert.deepEqual(kernel.snapshot(), beforeState);
  assert.deepEqual(kernel.linkedSnapshot(), beforeLinks);
  assert.deepEqual(engine.trace, beforeTrace);
  assert.deepEqual(engine.pipeline.events, beforeEvents);
  assert.deepEqual(engine.items, []);
  assert.equal(engine.priority, "A");
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject("stupefy").zone, "hand");
  assert.equal(requests.filter(request => request.id === "target:unit").length, 1);
});

test(`Stupefy production boundary: replaying the same Chain draft is rejected atomically [${CANONICAL_CARD_ID}]`, () => {
  const { kernel, binding, engine } = productionHarness();
  const source = kernel.getObject("stupefy");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  engine.execute(draft);
  const beforeState = kernel.snapshot();
  const beforeLinks = kernel.linkedSnapshot();
  const beforeItems = engine.items;
  const beforeTrace = engine.trace;
  const beforePriority = engine.priority;

  assert.throws(
    () => engine.execute(draft),
    error => error.name === "Error" && error.message === "Invalid or reused chain identity"
  );
  assert.deepEqual(kernel.snapshot(), beforeState);
  assert.deepEqual(kernel.linkedSnapshot(), beforeLinks);
  assert.deepEqual(engine.items, beforeItems);
  assert.deepEqual(engine.trace, beforeTrace);
  assert.equal(engine.priority, beforePriority);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(engine.items.length, 1);
  assert.equal(engine.items[0].status, "finalized");
});

test(`Stupefy production boundary: a Reaction removes the locked incarnation; debuff is ignored but Draw 1 resolves [${CANONICAL_CARD_ID}]`, () => {
  const retreat = {
    canonicalCardId: "test.rift-869.retreat-driver",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "Test control: return a friendly unit to hand. Not an official card program.",
    abilities: [{
      kind: "play",
      cost: { kind: "cost.printed", energy: { kind: "constant", value: 1 } },
      body: [{
        id: "return-unit",
        op: "effect.zone",
        args: {
          target: { kind: "literal", value: "friendly-unit" },
          to: { kind: "literal", value: "hand" }
        },
        targets: [{
          id: "friendly-unit",
          filter: { type: "unit", controller: "self", zone: "board" },
          min: 1,
          max: 1,
          selection: "one"
        }]
      }]
    }, { kind: "keyword", keyword: "reaction" }]
  };
  const result = runCardScenario(stupefy, {
    players: {
      A: { energy: 1, zones: { hand: ["stupefy"], deck: ["stupefy-top"] } },
      B: { energy: 1, zones: { hand: ["retreat"], deck: ["retreat-top"] } }
    },
    objects: [
      {
        id: "stupefy",
        program: stupefy,
        cardId: CANONICAL_CARD_ID,
        owner: "A",
        types: ["spell"],
        zone: "hand",
        energy: 1,
        power: null,
        might: null
      },
      {
        id: "retreat",
        program: retreat,
        cardId: retreat.canonicalCardId,
        owner: "B",
        types: ["spell"],
        keywords: [{ id: "Reaction" }],
        zone: "hand",
        energy: 1,
        power: null,
        might: null
      },
      { id: "stupefy-target", owner: "B", types: ["unit"], zone: "board", might: 4 },
      { id: "stupefy-bystander", owner: "B", types: ["unit"], zone: "board", might: 5 },
      { id: "stupefy-top", owner: "A", types: ["unit"], zone: "deck", might: 2 },
      { id: "retreat-top", owner: "B", types: ["unit"], zone: "deck", might: 2 }
    ],
    answers: { "target:unit": ["stupefy-target"], "target:friendly-unit": ["stupefy-target"] },
    operations: [
      { type: "play", object: "stupefy", player: "A" },
      { type: "pass", player: "A" },
      { type: "play", object: "retreat", player: "B" },
      { type: "pass", player: "B" },
      { type: "pass", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  });

  assert.equal(scenarioObject(result, "stupefy-target").zone, "hand");
  assert.equal(scenarioObject(result, "stupefy-target").might, 4);
  assert.equal(scenarioObject(result, "stupefy-bystander").might, 5);
  assert.equal(result.links["debuff.affected"], undefined);
  assert.equal(result.links["draw.drawn"], 1);
  assert.equal(result.state.players.A.handSize, 1);
  assert.deepEqual(result.state.chain, []);
});

test(`Stupefy production boundary: wrong actor to the public game command is rejected without state change [${CANONICAL_CARD_ID}]`, () => {
  const kernel = world().player("A").player("B").build();
  const decide = request => { throw new Error(`Unexpected match choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose: decide
    })
  });
  const card = (id, types, extra = {}) => ({ id, cardId: id, types, ...extra });
  const stupefyCard = id => ({
    id,
    cardId: CANONICAL_CARD_ID,
    name: "Stupefy",
    types: ["spell"],
    domains: ["Mind"],
    energy: 1,
    power: null,
    might: null
  });
  const deck = player => ({
    mainDeck: Array.from({ length: 40 }, (_, index) => stupefyCard(`${player}-stupefy-${index}`)),
    runeDeck: Array.from({ length: 12 }, (_, index) => card(`${player}-rune-${index}`, ["rune"])),
    championLegend: card(`${player}-legend`, ["legend"]),
    chosenChampion: card(`${player}-champion`, ["champion"]),
    battlefields: [
      card(`${player}-battlefield-0`, ["battlefield"]),
      card(`${player}-battlefield-1`, ["battlefield"]),
      card(`${player}-battlefield-2`, ["battlefield"])
    ]
  });
  const match = createMatch({
    host: { ...host, player: player => kernel.player(player) },
    decks: [deck("A"), deck("B")],
    seed: "RIFT-869-stupefy",
    battlefieldChoice: [0, 1],
    mulligans: [[], []],
    firstPlayer: 0
  });
  const owned = kernel.objects.find(object =>
    object.owner === "A" && object.zone === "hand" && object.cardId === CANONICAL_CARD_ID
  );
  assert.ok(owned, "the focused match setup has an A-owned Stupefy in hand");
  const binding = createProgramBinding({ cardPrograms: [stupefy] });
  binding.attachLifecycle(match.flow.chain);
  const before = kernel.snapshot();
  assert.throws(
    () => executeGameCommand({ match, binding, stateVersion: 0 }, "B", {
      type: "play",
      commandId: "stupefy-wrong-actor",
      stateVersion: 0,
      cardObjectId: owned.ref.id
    }),
    error => error.name === "GameCommandError" && error.code === "unavailable-object"
  );
  assert.deepEqual(kernel.snapshot(), before);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.getObject(owned.ref.id).zone, "hand");
});
