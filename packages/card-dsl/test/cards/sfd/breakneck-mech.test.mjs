// Breakneck Mech execution evidence. The production tests at the end use the
// original registry program, createProgramBinding, ChainEngine and lifecycle.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/breakneck-mech.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { createContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";
import defiantDance from "../../../dist/cards/sfd/defiant-dance.js";
import { createDuelBoard, placeDuelUnit, selectDuelBattlefields } from "../../../../engine-core/dist/duel/battlefields.js";
import { moveDuelUnitsStandard } from "../../../../engine-core/dist/zones/movement.js";
import { mainTiming, readinessFor } from "../../../../engine-core/test/rules/movement/support.mjs";

const CARD_ID = "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab";
const SOURCE_TEXT =
  "Your Mechs have [Deflect] and [Ganking]. (Opponents must pay :rb_rune_rainbow: to choose us with a spell or ability. We can move from battlefield to battlefield.)\n" +
  "I enter ready if you control another Mech.";

const [grant, enterReady] = program.abilities;

/** Pipeline host over the reference kernel, as engine-core's chain tests build it. */
function pipelineFor(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: (request) => { throw new Error(`unexpected choice request ${request.id}`); },
    // The chain's ResolveContext normalizes the static "self" controller
    // spelling to the ability controller and evaluates through the layer
    // filter; the reference kernel alone compares raw filter values.
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
        Object.fromEntries(Object.entries(filter).map(([key, value]) => [
          key,
          key === "controller" && value === "self" ? controller : value
        ])),
        object
      ))
    }),
    testTrigger: () => true
  });
  return new EventPipeline(host, ["A", "B"], "A");
}

const bindDeps = (kernel, pipeline) => ({
  host: { object: (ref) => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
  pipeline
});

/**
 * The condition evaluator's environment over the reference kernel, with the
 * chain's own "self" controller normalization (chain/engine.ts) so the declared
 * count filter is evaluated exactly as it is at Finalize/Resolve time.
 */
function conditionEnvironment(kernel, hostId) {
  const context = bindResolveContext(kernel, {
    source: kernel.getObject(hostId),
    controller: "A",
    timingPoint: "chain-item-finalize",
    query: (filter) => {
      const normalized = { ...filter };
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "self") normalized[key] = "A";
      }
      return kernel.objects.filter((object) => matchesObjectFilter({
        ...normalized,
        ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
        ...(normalized.owner === "opponent" ? { owner: "any" } : {})
      }, object) && !(normalized.controller === "opponent" && object.controller === "A"));
    }
  });
  return {
    context,
    host: kernel.ref(hostId),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
}

test("breakneck-mech program is registered and validates", () => {
  assert.ok(program, "breakneck-mech must be exported");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("breakneck-mech no longer carries an obsolete judge-required reason", () => {
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
});

test("breakneck-mech structure: static grant + enter-ready replacement", () => {
  assert.equal(program.abilities.length, 2);

  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "grant-keyword");
  assert.deepEqual(grant.effect.keywords, ["Deflect", "Ganking"]);
  assert.deepEqual(grant.effect.filter, {
    tag: "Mech",
    controller: "controller",
    zone: "board"
  });
  assert.equal(grant.condition, undefined);

  // 359.2.c / 369.3 / 805.6: the entry orientation is replaced, so the body is
  // the entry action itself and names the entering source rather than a later
  // ready of an already-entered permanent.
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.deepEqual(enterReady.with.map((instruction) => [instruction.id, instruction.op]), [
    ["breakneck-mech.enter-ready", "effect.ready"]
  ]);
  assert.deepEqual(enterReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(enterReady.with[0].targets, undefined);
  assert.equal(enterReady.condition.kind, "compare");
  assert.equal(enterReady.condition.left.kind, "count");
  // Engine vocabulary: a tag list plus the contract 3.6 "self" exclusion
  // anchor; the singular tag/other keys were never read by layers/filter.ts.
  assert.deepEqual(enterReady.condition.left.filter, {
    tags: ["Mech"],
    controller: "self",
    zone: "board",
    exclude: "self"
  });
  assert.equal(enterReady.condition.operator, "gte");
  assert.deepEqual(enterReady.condition.right, { kind: "constant", value: 1 });
});

test("breakneck-mech: both declared keywords expand through the merged registry", () => {
  const deflect = keywordDefinitionsById.get("Deflect");
  const ganking = keywordDefinitionsById.get("Ganking");
  assert.ok(deflect, "effects/keywords/Deflect.ts must be registered");
  assert.ok(ganking, "effects/keywords/Ganking.ts must be registered");

  // 809: Deflect expands to the static target tax consumed by the target plan.
  const [deflectAbility] = deflect.expand({ value: 1, host: { canonicalCardId: CARD_ID } });
  assert.equal(deflectAbility.kind, "static");
  assert.equal(deflectAbility.effect.kind, "target.tax");
  assert.deepEqual(deflectAbility.effect.value, { kind: "constant", value: 1 });

  // 810: Ganking expands to the battlefield-to-battlefield movement permission.
  const [gankingAbility] = ganking.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(gankingAbility.kind, "static");
  assert.equal(gankingAbility.effect.kind, "continuous.movement");
  assert.equal(gankingAbility.effect.permission, "battlefield-to-battlefield");
});

test("breakneck-mech golden: the battlefield-to-battlefield permission is readable through the merged movement query", () => {
  // What the granted Ganking means (810.1.c: the unit may use a standard move
  // between battlefields) is consumed by the merged rules query as an
  // ability-layer continuous.movement registration whose permission lists the
  // routes. The query reports that route for the granted permanent and leaves
  // an ungranted unit without it.
  const kernel = world().player("A")
    .unit("mech", { tags: ["Mech"], might: 2 })
    .unit("other-unit", { might: 2 })
    .build();
  const registration = (id) => ({
    effect: {
      id: `breakneck-mech.movement:${id}`,
      layer: "ability",
      source: kernel.ref("mech"),
      filter: { objectId: id, zone: "board", zoneEntryId: kernel.ref(id).zoneEntryId },
      effect: {
        kind: "continuous.movement",
        permission: { routes: ["battlefield-to-battlefield"], move: "standard" }
      }
    },
    duration: { type: "permanent" },
    timestamp: 1
  });
  const registry = createContinuousEffectRegistry([registration("mech")]);

  const granted = movement(registry, kernel.ref("mech"), kernel.getObject("mech"), "A");
  assert.equal(granted.canGank, true);
  assert.equal(granted.battlefieldToBattlefield, true);
  assert.deepEqual(granted.permissions.map((permission) => permission.routes), [["battlefield-to-battlefield"]]);

  const ungranted = movement(registry, kernel.ref("other-unit"), kernel.getObject("other-unit"), "A");
  assert.equal(ungranted.canGank, false);
  assert.deepEqual(ungranted.permissions, []);
});

test("breakneck-mech golden: the granted keywords re-expand through the merged keyword layer", () => {
  // The declared grant is a single ability-layer grant-keyword effect over the
  // controller's Mechs (802.2 style). The layer engine applies the grants to
  // exactly that set.
  const kernel = world().player("A")
    .unit("mech", { tags: ["Mech"], might: 2, controller: "A" })
    .unit("ally-non-mech", { tags: [], might: 2, controller: "A" })
    .unit("enemy-mech", { tags: ["Mech"], might: 2, owner: "B", controller: "B" })
    .build();
  const registration = {
    effect: {
      id: "breakneck-mech.grant",
      layer: "ability",
      source: kernel.ref("mech"),
      // 478 的 ability 图层按注册的 per-object 过滤器匹配；引擎的过滤器读
      // characteristics.tags 而不是顶层 tag 键（layers/filter.ts）。
      filter: { type: "unit", tags: ["Mech"], controller: "A", zone: "board" },
      effect: { kind: "continuous.grant-keyword", keywords: [{ id: "Deflect", value: 1 }, { id: "Ganking" }] }
    },
    duration: { type: "permanent" },
    timestamp: 1
  };
  const engine = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => bindResolveContext(kernel, { source, controller: source.controller })
  });
  engine.addContinuous(registration.effect, registration.duration, registration.timestamp);

  assert.deepEqual(engine.evaluate(kernel.ref("mech")).keywords.map((keyword) => keyword.id).sort(), ["Deflect", "Ganking"]);
  assert.deepEqual(engine.evaluate(kernel.ref("ally-non-mech")).keywords, []);
  assert.deepEqual(engine.evaluate(kernel.ref("enemy-mech")).keywords, []);
});

/**
 * Drive the real play/entry path: the card moves hand -> chain, the resolver
 * lands the default exhausted orientation on the chain permanent (CR 805.6),
 * and the entry move carries it to a Board location.
 */
function enterBoard({ bind = true, otherMech = true } = {}) {
  const builder = world().player("A").hand("mech", { types: ["unit"], tags: ["Mech"], might: 2 });
  if (otherMech) builder.unit("other-mech", { tags: ["Mech"], might: 3, controller: "A" });
  const kernel = builder.build();
  const hostRef = kernel.ref("mech");
  const pipeline = pipelineFor(kernel);
  const bound = bind
    ? bindReplacement({ replaces: enterReady.replaces, with: enterReady.with, condition: enterReady.condition },
        hostRef, bindDeps(kernel, pipeline))
    : null;

  pipeline.commit({ type: "move-zone", object: hostRef, to: "chain" });
  pipeline.commit({ type: "exhaust", object: kernel.ref("mech") });
  const chainOrientation = kernel.getObject("mech").exhausted;
  pipeline.commit({
    type: "move-zone",
    object: kernel.ref("mech"),
    to: "base",
    location: { type: "base", player: "A" }
  });
  const object = kernel.getObject("mech");
  const result = {
    chainOrientation,
    zone: object.zone,
    location: object.location,
    exhausted: object.exhausted,
    readyTiming: pipeline.events.some((event) => event.timingPoint === "object-readied")
  };
  if (bound) bound.cancel();
  return result;
}

test("breakneck-mech golden: 'I enter ready' binds as a board-entry replacement, not a later ready", () => {
  const kernel = world().player("A")
    .unit("mech", { tags: ["Mech"], might: 2, zone: "chain", exhausted: true })
    .unit("other-mech", { tags: ["Mech"], might: 3, controller: "A" })
    .build();
  const pipeline = pipelineFor(kernel);

  const bound = bindReplacement({
    replaces: enterReady.replaces,
    with: enterReady.with,
    condition: enterReady.condition
  }, kernel.ref("mech"), bindDeps(kernel, pipeline));

  assert.equal(bound.registration.id, `replacement:mech:${kernel.ref("mech").zoneEntryId}`);
  // 370.3/370.4: a replacement is evaluated from its active zone, so the
  // binding stays active across zones (hand -> chain -> board).
  assert.deepEqual(bound.registration.activeZones, ["hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain"]);
  // The declared body is accepted by the merged entry planner, which requires
  // the entering source selector for effect.ready.
  bound.cancel();
});

test("breakneck-mech golden: the entry replacement turns the default exhausted entry into a ready entry", () => {
  // 359.2.c: units enter exhausted by default; 369.3 / 805.6 let an entry
  // replacement choose the orientation. The comparison against the unbound run
  // is the evidence that the orientation comes from the declared replacement.
  const withoutCard = enterBoard({ bind: false });
  const withCard = enterBoard({ bind: true });

  assert.equal(withoutCard.chainOrientation, true);
  // 199.1: the permanent reaches the Board at the chosen Base location.
  assert.equal(withoutCard.zone, "board");
  assert.deepEqual(withoutCard.location, { type: "base", player: "A" });
  assert.equal(withoutCard.exhausted, true, "the default entry stays exhausted without the card");

  assert.equal(withCard.chainOrientation, true);
  assert.equal(withCard.zone, "board");
  assert.deepEqual(withCard.location, { type: "base", player: "A" });
  assert.equal(withCard.exhausted, false, "the declared entry replacement carries a ready orientation");
  // The orientation rides the entry move, so no separate "becomes ready"
  // timing point is emitted for the entering permanent.
  assert.equal(withCard.readyTiming, false);
});

test("breakneck-mech golden: 'if you control another Mech' really counts the other Mechs", () => {
  // "if you control another Mech" is a programmatic object count, never a
  // choice (355.10.d). The declaration uses the engine's own vocabulary — a
  // `tags` list plus the contract 3.6 `exclude: "self"` anchor — because
  // layers/filter.ts has no singular tag/other keys. The merged condition
  // evaluator is driven here over the production query normalization, so the
  // count really discriminates "another Mech" from "no other Mech".
  const condition = enterReady.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "objects");
  assert.deepEqual(condition.left.filter, {
    tags: ["Mech"],
    controller: "self",
    zone: "board",
    exclude: "self"
  });

  const withOther = world().player("A").player("B")
    .unit("mech", { tags: ["Mech"], might: 2, controller: "A" })
    .unit("other-mech", { tags: ["Mech"], might: 3, controller: "A" })
    .unit("enemy-mech", { tags: ["Mech"], might: 3, owner: "B", controller: "B" })
    .build();
  const withoutOther = world().player("A").player("B")
    .unit("mech", { tags: ["Mech"], might: 2, controller: "A" })
    .unit("enemy-mech", { tags: ["Mech"], might: 3, owner: "B", controller: "B" })
    .build();

  assert.equal(evaluateCondition(condition, conditionEnvironment(withOther, "mech")), true);
  assert.equal(evaluateCondition(condition, conditionEnvironment(withoutOther, "mech")), false);
});

const BF1 = { type: "battlefield", id: "bf1" };

function breakneckBuild({ controlsOther = true, controlsTaggedGear = false } = {}) {
  return w => {
    let builder = w.player("A", { energy: 20, power: ["Mind", "Body"] })
      .player("B", { energy: 20, power: ["Calm", "Calm"] })
      .object("breakneck", {
        owner: "A", controller: "A", cardId: CARD_ID, types: ["unit"], tags: ["Mech"],
        zone: "hand", energy: 8, power: ["Mind"], might: 7
      });
    if (controlsOther) {
      builder = builder.unit("other-mech", {
        owner: "A", controller: "A", types: ["unit"], tags: ["Mech"], might: 3,
        location: { type: "base", player: "A" }
      });
    }
    if (controlsTaggedGear) {
      // 133.8: Mech is a tag and may appear on types other than Unit.
      builder = builder.object("mech-gear", { owner: "A", controller: "A", types: ["gear"], tags: ["Mech"], zone: "board", location: { type: "base", player: "A" } });
    }
    return builder
      .unit("ally-non-mech", { owner: "A", controller: "A", types: ["unit"], tags: [], might: 3, location: { type: "base", player: "A" } })
      .unit("enemy-mech", { owner: "B", controller: "B", types: ["unit"], tags: ["Mech"], might: 3, location: { type: "base", player: "B" } })
      .deck(["a1", "a2", "a3"], { owner: "A" })
      .deck(["b1", "b2", "b3"], { owner: "B" });
  };
}

function playBreakneck(options) {
  const f = productionPlay({ programs: [program], build: breakneckBuild(options) });
  const draft = f.play("breakneck");
  return { f, draft };
}

test("breakneck-mech production: another Mech makes it enter ready and activates Deflect/Ganking only for friendly Mechs", () => {
  const { f, draft } = playBreakneck({ controlsTaggedGear: true });
  const entered = f.kernel.getObject("breakneck");
  assert.equal(draft.speed, "normal");
  assert.equal(entered.zone, "board");
  assert.deepEqual(entered.location, { type: "base", player: "A" });
  assert.equal(entered.exhausted, false, "the replacement condition is true and the entry is ready");

  f.engine.layers.setObjects(f.kernel.objects);
  const granted = f.engine.layers.snapshot(f.kernel.ref("other-mech"));
  const taggedGear = f.engine.layers.snapshot(f.kernel.ref("mech-gear"));
  const nonMech = f.engine.layers.snapshot(f.kernel.ref("ally-non-mech"));
  const enemy = f.engine.layers.snapshot(f.kernel.ref("enemy-mech"));
  assert.deepEqual(granted.keywords.map(keyword => keyword.id).sort(), ["Deflect", "Ganking"]);
  assert.deepEqual(taggedGear.keywords.map(keyword => keyword.id).sort(), ["Deflect", "Ganking"]);
  assert.equal(granted.movement.canGank, true);
  assert.equal(nonMech.movement.canGank, false);
  assert.deepEqual(nonMech.keywords, []);
  assert.deepEqual(enemy.keywords, []);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-enters-board" && event.object?.ref.id === "breakneck"), true);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied" && event.object?.ref.id === "breakneck"), false);
  assert.deepEqual(f.requests, [], "the replacement and static grant add no player choices");
});

test("breakneck-mech production: without another friendly Mech it enters exhausted", () => {
  const { f } = playBreakneck({ controlsOther: false });
  const entered = f.kernel.getObject("breakneck");
  assert.equal(entered.zone, "board");
  assert.equal(entered.exhausted, true, "the enemy Mech does not satisfy 'another Mech'");
  assert.deepEqual(f.requests, []);
});

test("breakneck-mech production: opponent-targeting a friendly Mech pays the granted Deflect as any-domain Power", () => {
  const inspect = productionPlay({
    programs: [program, defiantDance],
    answers: {
      "target:defiant-dance.unit": ["other-mech"],
      "target:defiant-dance.another-unit": ["ally-non-mech"]
    },
    build: w => w.player("A", { energy: 20, power: ["Mind", "Body"] })
      .player("B", { energy: 20, power: ["Calm", "Calm"] })
      .object("breakneck", {
        owner: "A", controller: "A", cardId: CARD_ID, types: ["unit"], tags: ["Mech"],
        zone: "hand", energy: 8, power: ["Mind"], might: 7
      })
      .unit("other-mech", { owner: "A", controller: "A", types: ["unit"], tags: ["Mech"], might: 3, location: BF1 })
      .unit("ally-non-mech", { owner: "A", controller: "A", types: ["unit"], tags: [], might: 3, location: BF1 })
      .object("dance", {
        owner: "B", controller: "B", cardId: defiantDance.canonicalCardId, types: ["spell"],
        zone: "hand", energy: 1, power: ["Calm"], might: null
      })
      .deck(["a1", "a2", "a3"], { owner: "A" })
      .deck(["b1", "b2", "b3"], { owner: "B" })
  });
  inspect.play("breakneck");
  inspect.engine.layers.setObjects(inspect.kernel.objects);
  const source = inspect.kernel.getObject("dance");
  const draft = inspect.binding.describePlay({ type: "play", object: source.ref, player: "B" }, source);
  inspect.engine.openShowdown("A");
  inspect.engine.pass("A");
  inspect.engine.execute(draft);
  const finalized = inspect.engine.items[0];
  assert.equal(finalized.status, "finalized");
  assert.deepEqual(finalized.targetPlans.map(plan => plan.selected.map(ref => ref.id)), [
    ["other-mech"],
    ["ally-non-mech"]
  ]);
  assert.deepEqual(finalized.costPlan.total.power, [
    // Defiant Dance's printed Calm cost.
    { amount: 1, allowedDomains: ["Calm"] },
    // The extra cost comes only from the Deflect granted to the selected Mech.
    { amount: 1, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
  assert.deepEqual(finalized.payment.power.power, [
    { requirementIndex: 0, from: "Calm", amount: 1 },
    { requirementIndex: 1, from: "Calm", amount: 1 }
  ]);
  assert.equal(inspect.kernel.player("B").energy, 19);
  assert.deepEqual(inspect.kernel.player("B").power, [], "one Calm paid the printed cost and one paid Deflect");

  inspect.settle();
  assert.equal(inspect.might("other-mech"), 5, "+2 applied to the targeted Mech");
  assert.equal(inspect.might("ally-non-mech"), 1, "-2 applied to the other targeted non-Mech");
});

test("breakneck-mech production: granted Ganking permits a real Battlefield-to-Battlefield Standard Move", () => {
  const { f } = playBreakneck();
  const mover = f.kernel.getObject("other-mech");
  assert.equal(mover.zone, "board");
  assert.equal(f.engine.layers.snapshot(mover.ref).movement.canGank, true);

  const given = createDuelBoard(selectDuelBattlefields([
    { playerId: "A", battlefields: [
      { instanceId: "a1", cardId: "print-a1" },
      { instanceId: "a2", cardId: "print-a2" },
      { instanceId: "a3", cardId: "print-a3" }
    ] },
    { playerId: "B", battlefields: [
      { instanceId: "b1", cardId: "print-b1" },
      { instanceId: "b2", cardId: "print-b2" },
      { instanceId: "b3", cardId: "print-b3" }
    ] }
  ], () => 0));
  const board = placeDuelUnit(given, {
    objectId: mover.ref.id,
    controllerPlayerId: "A",
    locationId: given.battlefields[0].locationId
  });
  const request = {
    actor: "A",
    unitUIDs: [mover.ref.id],
    destinationLocationId: given.battlefields[1].locationId,
    timing: mainTiming("A")
  };
  assert.throws(
    () => moveDuelUnitsStandard(board, readinessFor(board, { ganking: [] }), request),
    /needs Ganking/,
    "the caller boolean is intentionally false; the layer query must grant the route"
  );
  const moved = moveDuelUnitsStandard(board, readinessFor(board, { ganking: [] }), request, {
    registry: f.engine.layers.registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.engine.layers.snapshot(f.kernel.ref(unit.objectId))
  });
  assert.equal(moved.board.units[0].locationId, given.battlefields[1].locationId);
  assert.equal(moved.group.exhaustedCount, 1);
  assert.equal(moved.readiness[0].readied, false);
});
