// Golden tests for Gem Jammer (sfd-007-221).
//
// Production cases use a test view that changes only the admission metadata on
// the published CardProgram. Its identity, source text, trigger and body stay
// unchanged. The published card remains judge-required because the lifecycle
// keeps the derived movement permission after the end-of-turn grant expires.
import test from "node:test";
import assert from "node:assert/strict";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/gem-jammer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { TargetSelectionError } from "../../../../engine-core/dist/target/target-plan.js";
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

// Admission-only view for the supported production fragment. Its identity,
// source text, trigger and body are the published program unchanged; the card
// itself remains judge-required because the derived permission survives
// turn-end, so this is not whole-card execution evidence.
const executableView = {
  ...program,
  status: "executable",
  judgeReason: undefined
};

test("sfd-007-221 Gem Jammer: program validates and is judge-required for stale keyword permission cleanup", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /programs\/statics\.ts:184/);
  assert.match(program.judgeReason, /turn-end/);
  assert.match(program.judgeReason, /permission/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-007-221 Gem Jammer: judgeReason names the current gap and Ganking remains a single-stack keyword", () => {
  assert.match(program.judgeReason, /programs\/statics\.ts:184/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /turn-end/);
  assert.match(program.judgeReason, /canGank/);
  assert.doesNotMatch(program.judgeReason, /RIFT-83|RIFT-91|RIFT-257|RIFT-258/);
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

test("sfd-007-221 Gem Jammer golden: the grant registers once on the locked unit and expires at turn end", () => {
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

test("sfd-007-221 Gem Jammer production blockers: the published program is admitted only through an executable test view", () => {
  const publishedBinding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .player("A", { energy: 2 })
    .player("B")
    .object("gem", gemInHand)
    .build();
  assert.throws(
    () => publishedBinding.describePlay({
      type: "play",
      object: kernel.ref("gem"),
      player: "A"
    }, kernel.getObject("gem")),
    error => error?.code === "judge-required" && /programs\/statics\.ts:184/.test(error.message)
  );
});

test("sfd-007-221 Gem Jammer production: a target that leaves after Finalize causes no grant", () => {
  let locked;
  const f = productionPlay({
    programs: [executableView],
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
  const f = productionPlay({
    programs: [executableView],
    answers: { "target:gem-jammer.unit": ["target"] },
    build: w => w.player("A", { energy: 2, power: [] }).player("B", { energy: 0, power: [] })
      .object("gem", gemInHand)
      .unit("target", {
        owner: "B",
        controller: "B",
        types: ["unit"],
        might: 2,
        energy: null,
        power: null,
        location: { type: "battlefield", id: scene.bf1 }
      })
  });

  const draft = f.play("gem");
  assert.equal(draft.kind, "unit");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(f.kernel.getObject("gem").zone, "board");
  assert.deepEqual(f.targetRequests().map(request => [
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

  f.engine.emit({ timingPoint: "turn-end", player: "A" });
  const expiredTarget = f.engine.layers.evaluate(target);
  assert.deepEqual(expiredTarget.keywords, []);
  assert.deepEqual(
    f.engine.layers.registry.list().filter(entry =>
      entry.effect.effect.kind === "continuous.grant-keyword" && entry.effect.filter.objectId === "target"),
    []
  );
});

test.todo(
  "sfd-007-221 Gem Jammer production: turn-end must revoke the derived battlefield-to-battlefield permission " +
  "(programs/statics.ts:184/194 currently leaves the generated permanent movement effect queryable)"
);

test("sfd-007-221 Gem Jammer production: with no other Board Unit, the played Unit may choose itself", () => {
  const f = productionPlay({
    programs: [executableView],
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
    programs: [executableView],
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
