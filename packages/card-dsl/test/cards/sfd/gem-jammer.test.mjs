// Golden tests for Gem Jammer (sfd-007-221).
//
// The published CardProgram runs through ProgramBinding, ChainEngine and the
// production lifecycle. TurnPhaseLayers distinguishes the turn-end Ending
// Step from the later Expiration Step so the test can verify both CR 317.1.a
// and the removal of the derived Ganking movement permission.
import test from "node:test";
import assert from "node:assert/strict";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/gem-jammer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { TargetSelectionError } from "../../../../engine-core/dist/target/target-plan.js";
import { TurnPhaseLayers } from "../../../../engine-core/dist/turn/phase-layers.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll, stages } from "../../../../engine-core/test/chain/helpers.mjs";
import { duelWorld, mainTiming, readinessFor, moveDuelUnitsStandard } from "../../../../engine-core/test/rules/movement/support.mjs";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CANONICAL = "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9";
const SOURCE_TEXT =
  "When you play me, give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)";

const [ability] = program.abilities;
const [grant] = ability.body;

const registrations = (kernel) =>
  kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));

const effectiveKeywords = (kernel, id) =>
  (() => {
    const layers = new KeywordGrantLayerEngine(kernel.objects, {
      context: source => bindResolveContext(kernel, { source, controller: source.controller })
    });
    for (const entry of registrations(kernel)) layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
    return layers.evaluate(kernel.ref(id));
  })()
    .keywords.map((keyword) => keyword.id);

const gemInHand = {
  id: "gem",
  cardId: CANONICAL,
  owner: "A",
  controller: "A",
  types: ["unit"],
  zone: "hand",
  energy: 2,
  power: null,
  might: 2
};

function productionTurnPlay({ build, answers = {} }) {
  const kernel = build(world()).build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    const answer = answers[request.id];
    if (typeof answer === "function") return answer(kernel, request);
    if (Array.isArray(answer)) return answer.map(id => kernel.ref(id));
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
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose
    })
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    layers: new TurnPhaseLayers(kernel.objects),
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const settle = () => {
    engine.advance();
    for (let guard = 0; engine.items.length; guard++) {
      assert.ok(guard < 20, "Chain did not settle");
      if (engine.priority === null) break;
      engine.pass(engine.priority);
    }
  };
  return { kernel, engine, binding, requests, settle };
}

test("sfd-007-221 Gem Jammer: program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-007-221 Gem Jammer: Ganking remains a single-stack keyword", () => {
  assert.equal(keywordDefinitionsById.has("Ganking"), true);
  assert.equal(keywordDefinitionsById.get("Ganking").stacking, "single");
});

test("sfd-007-221 Gem Jammer: trigger fires when the card itself is played", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.equal(ability.trigger.condition, undefined);
});

test("sfd-007-221 Gem Jammer: body grants Ganking to exactly one unit until end of turn", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grant.id, "gem-jammer.grant-ganking");
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // Contract 3.6: the affected unit is the Finalize-locked TargetSpec, not the
  // source (the primitive's default selection).
  assert.deepEqual(grant.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "gem-jammer.unit" }
  });
  assert.equal(grant.targets.length, 1);
  // "a unit" (CR 355.9.a.1): any Board unit, friend or foe — no controller filter.
  assert.deepEqual(grant.targets[0], {
    id: "gem-jammer.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-007-221 Gem Jammer golden: the grant registers once on the locked unit and expires for the end-of-turn duration", () => {
  const kernel = world()
    .unit("unit-1")
    .unit("unit-2", { owner: "B", controller: "B" })
    .build();
  kernel.setTargets("gem-jammer.unit", [kernel.ref("unit-2")]);

  const outcome = resolveChainBody([grant], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Ganking");
  assert.equal(registration.effect.effect.keywordValue, undefined);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  assert.deepEqual(effectiveKeywords(kernel, "unit-2"), ["Ganking"]);
  assert.deepEqual(effectiveKeywords(kernel, "unit-1"), []);
  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => bindResolveContext(kernel, { source, controller: source.controller })
  });
  for (const entry of registrations(kernel)) layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
  assert.equal(layers.evaluate(kernel.ref("unit-2")).movement.canGank, true);
  assert.equal(movement(layers.registry, kernel.ref("unit-2"), layers.evaluate(kernel.ref("unit-2")), "A").canGank, true);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.deepEqual(layers.evaluate(kernel.ref("unit-2")).keywords, []);
});

test("sfd-007-221 Gem Jammer: the reference pipeline preserves the complete play and trigger stages", () => {
  const playable = {
    canonicalCardId: "card:gem-jammer",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: SOURCE_TEXT,
    abilities: program.abilities
  };
  const binding = createProgramBinding({ cardPrograms: [playable] });
  const choices = [];
  const f = fixture({
    cards: [
      { id: "gem", cardId: "card:gem-jammer", types: ["unit"], energy: 2, power: [], might: 2 },
      { id: "ally", cardId: "card:ally", types: ["unit"], energy: 1, power: [], might: 2 },
      { id: "enemy", owner: "B", controller: "B", types: ["unit"], might: 2 }
    ],
    describePlay: binding.describePlay,
    choose: request => {
      if (request.type !== "select-objects") return undefined;
      choices.push([request.id, request.options.map(option => option.id)]);
      const pick = request.options.find(option => option.id === "ally");
      return pick ? [pick] : undefined;
    }
  });
  binding.attachLifecycle(f.engine);
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("ally"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("enemy"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.engine.advance();
  f.engine.commit({
    type: "play",
    object: f.kernel.ref("gem"),
    player: "A",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.engine.advance();
  resolveAll(f.engine);

  assert.deepEqual(stages(f.engine), [
    "pending:play:gem:1:A:1",
    "finalized:play:gem:1:A:1",
    "pending:trigger:1",
    "resolved:play:gem:1:A:1",
    "removed:play:gem:1:A:1",
    "finalized:trigger:1",
    "resolved:trigger:1",
    "removed:trigger:1"
  ]);
  assert.deepEqual(choices, [["target:gem-jammer.unit", ["source", "enemy", "gem", "ally"]]]);
  assert.equal(f.kernel.getObject("gem").zone, "board");
  assert.deepEqual(
    f.engine.layers.evaluate(f.kernel.ref("ally")).keywords.map(keyword => keyword.id),
    ["Ganking"]
  );
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("gem")).keywords, []);
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("enemy")).keywords, []);
});

test("sfd-007-221 Gem Jammer golden: a stale locked target makes the grant ignored", () => {
  const kernel = world().unit("unit-1").build();
  const stale = kernel.ref("unit-1");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("gem-jammer.unit", [stale]);

  const outcome = resolveChainBody([grant], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

test("sfd-007-221 Gem Jammer: the published program is admitted by the production registry", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .player("A", { energy: 2 })
    .player("B")
    .object("gem", gemInHand)
    .build();
  const source = kernel.getObject("gem");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  assert.equal(draft.source.cardId, CANONICAL);
  assert.equal(draft.kind, "unit");
});

test("sfd-007-221 Gem Jammer production: a target that leaves after Finalize causes no grant", () => {
  let locked;
  const f = productionPlay({
    programs: [program],
    answers: {
      "target:gem-jammer.unit": (kernel, request) => {
        locked = request.options.find(option => option.id === "target");
        return locked ? [locked] : [];
      }
    },
    build: w => w.player("A", { energy: 2, power: [] }).player("B", { energy: 0, power: [] })
      .object("gem", gemInHand)
      .unit("target", {
        owner: "B",
        controller: "B",
        types: ["unit"],
        might: 2,
        energy: null,
        power: null,
        location: { type: "battlefield", id: "battlefield-1" }
      })
  });

  const draft = f.describe("gem");
  f.engine.execute(draft);
  assert.ok(locked);
  assert.equal(f.engine.items[0].status, "finalized");
  assert.equal(f.engine.priority, "A");
  f.engine.pass("A");
  f.engine.advance();
  const trigger = f.engine.items[0];
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.status, "finalized");
  assert.deepEqual(trigger.targetPlans[0].selected, [locked]);

  assert.equal(f.engine.commit({ type: "return-to-hand", object: locked }).status, "done");
  assert.equal(f.kernel.getObject("target").zone, "hand");
  f.engine.advance();
  resolveAll(f.engine);

  assert.deepEqual(f.engine.items, []);
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("target")).keywords, []);
  assert.equal(f.engine.layers.registry.list().filter(entry =>
    entry.effect.effect.kind === "continuous.grant-keyword").length, 0);
  assert.equal(movement(
    f.engine.layers.registry,
    f.kernel.ref("target"),
    f.engine.layers.evaluate(f.kernel.ref("target")),
    "B"
  ).canGank, false);
  assert.ok(f.engine.trace.some(entry =>
    entry.step === "removed" && entry.item === "trigger:1" && entry.reason === "resolved"
  ));
  assert.equal(f.engine.pipeline.events.some(event =>
    event.timingPoint === "object-leaves-board" && event.object?.ref.id === "target"
  ), true);
});

test("sfd-007-221 Gem Jammer production: an enemy Unit gains actionable Ganking and moves between battlefields", () => {
  const scene = duelWorld();
  const board = scene.place(scene.board, "target", "B", scene.bf1);
  const f = productionTurnPlay({
    answers: { "target:gem-jammer.unit": ["target"] },
    build: w => w.player("A", { energy: 2, power: [] }).player("B", { energy: 0, power: [] })
      .deck(["a-top", "a-second"], { owner: "A" })
      .deck(["b-top", "b-second"], { owner: "B" })
      .object("gem", gemInHand)
      .unit("target", {
        cardId: "card:target",
        owner: "B",
        controller: "B",
        types: ["unit"],
        might: 2,
        energy: null,
        power: null,
        location: { type: "battlefield", id: scene.bf1 }
      })
  });

  const source = f.kernel.getObject("gem");
  const draft = f.binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  f.kernel.setTargets("gem-jammer.unit", [f.kernel.ref("target")]);
  const play = f.engine.commit({
    type: "play",
    object: source.ref,
    player: "A",
    location: { type: "battlefield", id: scene.bf1 }
  });
  assert.equal(play.status, "done");
  f.settle();
  assert.equal(draft.kind, "unit");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(f.kernel.getObject("gem").zone, "board");
  assert.deepEqual(f.requests.filter(request => request.type === "select-objects").map(request => [
    request.id,
    request.options.map(option => option.id)
  ]), [["target:gem-jammer.unit", ["gem", "target"]]]);

  const target = f.kernel.ref("target");
  const targetSnapshot = f.engine.layers.evaluate(target);
  assert.deepEqual(targetSnapshot.keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("gem")).keywords, []);
  const registration = f.engine.layers.registry.list().find(entry =>
    entry.effect.effect.kind === "continuous.grant-keyword" && entry.effect.filter.objectId === "target");
  assert.ok(registration);
  assert.equal(f.engine.layers.registry.list().filter(entry =>
    entry.effect.effect.kind === "continuous.grant-keyword" && entry.effect.filter.objectId === "target").length, 1);
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Ganking");
  assert.equal(registration.effect.effect.keywordValue, undefined);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(targetSnapshot.movement.canGank, true);
  assert.equal(movement(f.engine.layers.registry, target, targetSnapshot, "B").canGank, true);

  const moved = moveDuelUnitsStandard(board, readinessFor(board), {
    actor: "B",
    unitUIDs: ["target"],
    destinationLocationId: scene.bf2,
    timing: mainTiming("B")
  }, {
    registry: f.engine.layers.registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.engine.layers.evaluate(f.kernel.ref(unit.objectId))
  });
  assert.equal(moved.board.units.find(unit => unit.objectId === "target").locationId, scene.bf2);
  assert.equal(moved.group.exhaustedCount, 1);
  assert.equal(f.engine.commit({
    type: "move-location",
    object: f.kernel.ref("target"),
    to: { type: "battlefield", id: scene.bf2 }
  }).status, "done");
  assert.equal(f.engine.commit({ type: "exhaust", object: f.kernel.ref("target") }).status, "done");

  f.engine.pipeline.emit({ timingPoint: "turn-end", player: "A" });
  const endingTarget = f.engine.layers.evaluate(target);
  assert.deepEqual(endingTarget.keywords.map(keyword => keyword.id), ["Ganking"],
    "CR 317.1.a keeps the this-turn grant through the Ending Step");
  assert.equal(movement(f.engine.layers.registry, target, endingTarget, "B").canGank, true);

  assert.ok(f.engine.layers.expireTurn("A").length > 0,
    "CR 317.2.c expires this-turn effects in the Expiration Step");
  const expiredTarget = f.engine.layers.evaluate(target);
  assert.deepEqual(expiredTarget.keywords, []);
  assert.deepEqual(
    f.engine.layers.registry.list().filter(entry =>
      entry.effect.effect.kind === "continuous.grant-keyword" && entry.effect.filter.objectId === "target"),
    []
  );
  assert.equal(movement(f.engine.layers.registry, target, expiredTarget, "B").canGank, false);
  assert.equal(f.engine.layers.registry.lifecycleRuleEffects().filter(entry =>
    entry.effect.effect.kind === "continuous.movement" && entry.effect.filter.objectId === "target").length, 0);

  const beforeBoard = structuredClone(moved.board);
  const beforeReadiness = readinessFor(moved.board);
  const beforeKernelLocation = structuredClone(f.kernel.getObject("target").location);
  const beforeKernelExhausted = f.kernel.getObject("target").exhausted;
  assert.equal(beforeKernelLocation.id, scene.bf2);
  assert.equal(beforeKernelExhausted, true, "the successful Standard Move paid Exhaust");
  assert.throws(() => moveDuelUnitsStandard(moved.board, beforeReadiness, {
    actor: "B",
    unitUIDs: ["target"],
    destinationLocationId: scene.bf1,
    timing: mainTiming("B")
  }, {
    registry: f.engine.layers.registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.engine.layers.evaluate(f.kernel.ref(unit.objectId))
  }), /needs Ganking/);
  assert.deepEqual(moved.board, beforeBoard, "the rejected Standard Move changes no location");
  assert.deepEqual(readinessFor(moved.board), beforeReadiness, "the rejected Move pays no Exhaust cost");
  assert.deepEqual(f.kernel.getObject("target").location, beforeKernelLocation);
  assert.equal(f.kernel.getObject("target").exhausted, beforeKernelExhausted);
});

test("sfd-007-221 Gem Jammer production: with no other Board Unit, the played Unit may choose itself", () => {
  const f = productionPlay({
    programs: [program],
    build: w => w.player("A", { energy: 2, power: [] }).player("B", { energy: 0, power: [] })
      .object("gem", gemInHand)
  });

  f.play("gem");
  const gem = f.kernel.ref("gem");
  assert.deepEqual(f.engine.layers.evaluate(gem).keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.deepEqual(f.engine.items, []);
});

test("sfd-007-221 Gem Jammer production: a non-Unit answer is rejected atomically at Finalize", () => {
  const f = productionPlay({
    programs: [program],
    answers: { "target:gem-jammer.unit": ["gear"] },
    build: w => w.player("A", { energy: 2, power: [] }).player("B", { energy: 0, power: [] })
      .object("gem", gemInHand)
      .object("gear", {
        owner: "B",
        controller: "B",
        types: ["gear"],
        zone: "board",
        location: { type: "base", player: "B" },
        might: null,
        energy: null,
        power: null
      })
  });
  const before = f.kernel.snapshot();
  assert.throws(
    () => f.play("gem"),
    error => error instanceof TargetSelectionError && error.code === "invalid-target-choice"
  );
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.engine.items, []);
  assert.equal(f.kernel.getObject("gem").zone, "hand");
});
