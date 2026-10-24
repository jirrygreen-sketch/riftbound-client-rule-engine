import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import {
  bindResolveContext,
  createActionPipelineHost
} from "../../../../engine-core/dist/events/action-adapter.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

// Official interaction evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c.
// The continuous Might grant applies through 475/478/479 and is active only
// while this exact Board incarnation remains the source. A Hold is emitted once
// when this participating Unit is present under 383.4.d.2.a/473.2.b; its
// self-anchored trigger is collected for that event, becomes Pending and waits
// for Priority under 337.1.a/338, then Resolve under 359.3.d plays the 187.4
// Mech through 440.2.c/185.2.a. Unit entry is exhausted by 143.4/185.2.d.
// Finalize makes no choice and pays no cost; the response window precedes
// Resolve. No Focus is created by this Hold ability, and no LKI is needed while
// this exact source remains on its Battlefield.

const cardId = "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c";
const program = cardProgramsById.get(cardId);
const battlefield = { type: "battlefield", id: "bf1" };
const baseA = { type: "base", player: "A" };

function productionHold({
  battlefieldController = "A",
  scrapperLocation = battlefield,
  buddyLocation = baseA,
  rowdy = false
} = {}) {
  const builder = world()
    .player("A")
    .player("B")
    .unit("scrapper", {
      cardId,
      owner: "A",
      controller: "A",
      types: ["unit"],
      might: 4,
      energy: 5,
      power: ["Mind"],
      tags: ["Mech", "Yordle", "Rumble", "Bandle City", "Champion"],
      location: scrapperLocation
    })
    .unit("buddy", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      might: 2,
      tags: ["Mech"],
      location: buddyLocation
    })
    .unit("enemy-mech", {
      owner: "B",
      controller: "B",
      types: ["unit"],
      might: 4,
      tags: ["Mech"],
      location: { type: "base", player: "B" }
    });
  if (rowdy) {
    builder.unit("rowdy", {
      owner: "A",
      controller: "A",
      types: ["unit"],
      might: 2,
      tags: [],
      location: battlefield
    });
  }
  for (const player of ["A", "B"]) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "mode") return request.options[0];
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    if (request.type === "select-objects" && request.min === 0) return [];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
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
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: battlefieldController }, { id: "bf2", controller: null }]
  });
  const binding = createProgramBinding({
    cardPrograms: [program],
    staticBinder: createEngineStaticBinder(flow.chain)
  });
  const lifecycle = binding.attachLifecycle(flow.chain, error => { throw error; });

  // Bind both abilities through the production ProgramBinding surface. The
  // static binder is the same adapter lifecycle installs in a real match.
  const source = kernel.getObject("scrapper");
  const staticHandle = binding.bindStatic(program.abilities[0], source);
  const triggerIds = binding.registerProgramTriggers(flow.chain, source);
  assert.equal(triggerIds.length, 1);
  assert.equal(
    flow.chain.pipeline.checkpoint().triggers.has(`program:scrapper:${kernel.ref("scrapper").zoneEntryId}:1`),
    true
  );
  assert.equal(flow.chain.layers.registry.list().length, 1);

  const settle = () => {
    let guard = 0;
    while (flow.chain.items.length || flow.chain.focus !== null) {
      assert.ok(++guard < 60, "the production Chain must settle");
      if (flow.chain.items.length) flow.pass(flow.chain.priority);
      else flow.pass(flow.chain.focus);
    }
  };
  const may = id => {
    flow.chain.layers.setObjects(kernel.objects);
    return flow.chain.layers.evaluate(kernel.ref(id)).might;
  };
  return { kernel, flow, binding, lifecycle, staticHandle, triggerIds, requests, settle, may };
}

test("rumble-scrapper program is registered and validates", () => {
  assert.ok(program, "rumble-scrapper must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("rumble-scrapper identity, ruleset, executable status and verbatim text", () => {
  assert.equal(program.canonicalCardId, cardId);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(Object.hasOwn(program, "judgeReason"), false);
  assert.equal(
    program.sourceText,
    "Your Mechs have +1 :rb_might: (including me).\n" +
      "When I hold, play a 3 :rb_might: Mech unit token to your base."
  );
});

test("rumble-scrapper structure: static might aura + hold trigger token body", () => {
  assert.equal(program.status, "executable");
  assert.equal(program.abilities.length, 2);

  const [aura, hold] = program.abilities;
  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  // "Your Mechs" is a tag reference. The static layer consumes the canonical
  // plural tag spelling; the singular spelling would survive registration but
  // never match at layer evaluation.
  assert.deepEqual(aura.effect.filter, { tags: ["Mech"], controller: "controller", zone: "board" });
  assert.equal(aura.effect.filter.controller, "controller");
  assert.equal(aura.effect.value.value, 1);

  assert.equal(hold.kind, "triggered");
  assert.equal(hold.trigger.at, "hold");
  // The closed event vocabulary (EVENT_PATTERN_TYPES) names this discriminant
  // "held"; the pipeline maps it onto the hold timing point.
  assert.equal(hold.trigger.filter.event, "held");
  assert.equal(hold.trigger.filter.filter.source, "self");
  assert.equal(hold.optional, false);
  assert.equal(hold.body.length, 2);
  const [base, instruction] = hold.body;
  assert.equal(base.id, "rumble-scrapper.base");
  assert.equal(base.op, "condition.value");
  assert.deepEqual(base.args.value, { kind: "location", value: "ability-controller-base" });
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.args.token.value, "mech");
  assert.equal(instruction.args.amount.value, 1);
  // 440.2.c / 185.2.a: a *played* token is created on the Chain and the play
  // action takes it over. The preceding expression binds "your base" to the
  // ability controller before the primitive receives its concrete LocationRef.
  assert.equal(instruction.args.mode.value, "play");
  assert.deepEqual(instruction.args.location, { kind: "linked-value", instructionId: "rumble-scrapper.base", key: "value" });
});

test("rumble-scrapper: the original Hold filter binds this exact Unit incarnation", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const f = fixture({
    cards: [{ id: "scrapper", cardId, types: ["unit"], energy: 4, power: [], might: 4, tags: ["Mech"] }]
  });
  const source = f.kernel.getObject("scrapper");
  const ids = binding.registerProgramTriggers(f.engine, source);
  assert.equal(ids.length, 1);
  const [registration] = [...f.engine.pipeline.checkpoint().triggers.values()];
  assert.equal(registration.spec.at, "hold");
  assert.deepEqual(registration.spec.filter, { event: "held", object: { objectId: "scrapper" } });

  const emitted = {
    timingPoint: "hold", kind: "hold", player: "A",
    object: source, source, it: source,
    details: { battlefieldId: "bf1", objectId: "scrapper", playerId: "A" }
  };
  assert.equal(matchesTriggerEvent(registration.spec.filter, emitted, "A", source), true);
  assert.equal(matchesTriggerEvent(registration.spec.filter, {
    ...emitted, object: f.kernel.getObject("source")
  }, "A", source), false);
  assert.equal(matchesTriggerEvent(registration.spec.filter, {
    ...emitted, object: { ...source, ref: { ...source.ref, zoneEntryId: source.ref.zoneEntryId + 1 } }
  }, "A", source), false);
  // The details payload is evidence for 473.2.b, while the trigger's own
  // identity requirement is the exact event object/source/it incarnation.
  assert.equal(matchesTriggerEvent(registration.spec.filter, {
    ...emitted, details: { battlefieldId: "bf1" }
  }, "A", source), true);
});

test("rumble-scrapper golden: the merged continuous.might primitive registers the +1 aura layer entry", () => {
  // Isolated primitive evidence: this deliberately broad filter selects both
  // players. The source-relative card aura is tested through the binder below.
  const kernel = world()
    .unit("scrapper", { owner: "A", controller: "A", tags: ["Mech"], might: 4 })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], might: 4 })
    .build();
  const [aura] = program.abilities;
  const run = runInstruction(
    might,
    { filter: { tags: ["Mech"], zone: "board" }, amount: aura.effect.value.value },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 2);
  for (const entry of kernel.continuousEffects) {
    assert.equal(entry.effect.layer, "arithmetic");
    assert.equal(entry.effect.effect.kind, "continuous.might");
    assert.equal(entry.effect.effect.amount, 1);
    assert.deepEqual(entry.duration, { type: "permanent" });
  }

  // Both objects were explicitly selected above; this does not model the
  // printed friendly-only aura.
  const engine = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("scrapper")).might, 5);
  assert.equal(engine.evaluate(kernel.ref("enemy-mech")).might, 5);
});


test("rumble-scrapper golden: production static binding applies the original aura only to friendly Mechs", () => {
  const { engine, kernel } = fixture({ cards: [
    { id: "scrapper", cardId, tags: ["Mech"], might: 4 },
    { id: "ally-mech", tags: ["Mech"], might: 2 },
    { id: "ally-other", tags: [], might: 2 },
    { id: "enemy-mech", owner: "B", controller: "B", tags: ["Mech"], might: 4 },
    { id: "later-mech", tags: ["Mech"], might: 3 }
  ] });
  for (const id of ["scrapper", "ally-mech", "ally-other", "enemy-mech"]) {
    engine.commit({ type: "move-zone", object: kernel.ref(id), to: "base", location: { type: "base", player: kernel.getObject(id).controller } });
  }
  const handle = createEngineStaticBinder(engine).bindStatic(program.abilities[0], kernel.getObject("scrapper"));
  const [entry] = engine.layers.registry.list();
  assert.equal(engine.layers.registry.list().length, 1);
  // The bound layer filter keeps the source-relative selector symbolic and
  // resolves "controller" against the live source on every evaluation.
  assert.deepEqual(entry.effect.filter, { tags: ["Mech"], controller: "controller", zone: "board" });
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("scrapper")).might, 5);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-mech")).might, 3);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-other")).might, 2);
  assert.equal(engine.layers.evaluate(kernel.ref("enemy-mech")).might, 4);
  assert.equal(engine.layers.evaluate(kernel.ref("later-mech")).might, 3);

  engine.commit({ type: "move-zone", object: kernel.ref("later-mech"), to: "base", location: { type: "base", player: "A" } });
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("later-mech")).might, 4);
  handle.unbind();
  assert.equal(engine.layers.registry.list().length, 0);
  assert.equal(engine.layers.evaluate(kernel.ref("scrapper")).might, 4);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-mech")).might, 2);
});

test("rumble-scrapper golden: the original Hold body creates and plays the printed Mech token to your base", () => {
  const kernel = world().player("A").player("B").build();
  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [["rumble-scrapper.base", "executed"], ["play-mech-token", "executed"]]);
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
  const tokens = kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 1);
  const [token] = tokens;
  assert.equal(token.name, "Mech");
  assert.deepEqual(token.types, ["unit"]);
  assert.deepEqual(token.tags, ["Mech"]);
  assert.equal(token.might, 3);
  assert.equal(token.energy, null);
  assert.equal(token.power, null);
  assert.equal(token.controller, "A");
  assert.equal(token.zone, "board");
  assert.deepEqual(token.location, { type: "base", player: "A" });
  assert.deepEqual(kernel.pendingItems, []);
  assert.deepEqual(outcome.results[1].result.linkedValues["token.objects"], [token.ref]);
});

test("rumble-scrapper production golden: this Unit's begun Hold plays one Mech token to its controller's Base", () => {
  const f = productionHold();
  f.flow.start();

  const hold = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "hold");
  assert.equal(hold.length, 1);
  assert.equal(hold[0].object.ref.id, "scrapper");
  assert.deepEqual(hold[0].details, {
    battlefieldId: "bf1",
    objectId: "scrapper",
    playerId: "A"
  });
  // The final score payload preserves the exact participating incarnation.
  const score = f.flow.chain.pipeline.events.find(event => event.timingPoint === "score");
  assert.deepEqual(score.details.participatingUnits, [f.kernel.ref("scrapper")]);
  // The trigger is Pending until Priority/Focus are passed through the real
  // Chain; no token has been fabricated alongside the Hold event.
  assert.deepEqual(f.flow.chain.items.map(item => item.trigger?.registration.id),
    [`program:scrapper:${f.kernel.ref("scrapper").zoneEntryId}:1`]);
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0);

  f.settle();
  assert.deepEqual(f.requests, [], "the mandatory Hold body needs no invented choice");
  const tokens = f.kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 1, "the original body creates and plays exactly one token");
  const [token] = tokens;
  // CR 187.4: the printed Mech is domainless, 3 Might, tagged Mech. A Unit
  // enters the Board exhausted unless an entry replacement changes it
  // (359.2.c / 805.6); its cost remains absent, not zero.
  assert.equal(token.name, "Mech");
  assert.deepEqual(token.types, ["unit"]);
  assert.deepEqual(token.tags, ["Mech"]);
  assert.equal(token.might, 3);
  assert.equal(token.energy, null);
  assert.equal(token.power, null);
  assert.equal(token.controller, "A");
  assert.deepEqual(token.location, baseA);
  assert.equal(token.exhausted, true);
  assert.equal(
    f.flow.chain.pipeline.events.some(event => event.timingPoint === "object-readied"),
    false,
    "entry exhausted is not a separate Ready action"
  );

  // "Your Mechs have +1 (including me)" is live for Rumble, the existing
  // friendly Mech, and the newly played friendly Mech token; the enemy Mech is
  // excluded.
  assert.equal(f.may("scrapper"), 5);
  assert.equal(f.may("buddy"), 3);
  assert.equal(f.may(token.ref.id), 4);
  assert.equal(f.may("enemy-mech"), 4);
  assert.deepEqual(f.flow.chain.items, []);
});

test("rumble-scrapper production boundary: another friendly Unit holding without Rumble does not trigger it", () => {
  const f = productionHold({
    scrapperLocation: baseA,
    buddyLocation: battlefield
  });
  f.flow.start();

  const hold = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "hold");
  assert.equal(hold.length, 1);
  assert.equal(hold[0].object.ref.id, "buddy");
  assert.equal(f.kernel.player("A").score, 1, "the Battlefield was held by the other Unit");
  assert.deepEqual(f.flow.chain.items, []);
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 0);
});

test("rumble-scrapper production boundary: a Hold containing Rumble and another Unit triggers only Rumble", () => {
  const f = productionHold({ buddyLocation: battlefield, rowdy: true });
  f.flow.start();

  const hold = f.flow.chain.pipeline.events.filter(event => event.timingPoint === "hold");
  assert.deepEqual(hold.map(event => event.object.ref.id).sort(), ["buddy", "rowdy", "scrapper"]);
  assert.deepEqual(f.flow.chain.items.map(item => item.trigger?.registration.id),
    [`program:scrapper:${f.kernel.ref("scrapper").zoneEntryId}:1`]);
  f.settle();
  assert.equal(f.kernel.objects.filter(object => object.isToken).length, 1,
    "the other friendly Units and the non-Mech Unit do not duplicate Rumble's trigger");
});


test("rumble-scrapper golden: the same original body plays a token to player B's base", () => {
  const initial = world().player("A").player("B").unit("scrapper", { owner: "B", controller: "B", cardId }).build();
  const kernel = initial.clone({ controller: "B", sourceSnapshot: initial.getObject("scrapper") });
  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "executed");
  const [token] = kernel.objects.filter(object => object.isToken);
  assert.equal(token.controller, "B");
  assert.deepEqual(token.location, { type: "base", player: "B" });
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
  assert.equal(token.energy, null);
  assert.equal(token.power, null);
});
