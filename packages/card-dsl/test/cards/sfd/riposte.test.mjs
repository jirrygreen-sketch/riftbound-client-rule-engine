import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/riposte.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine, matchesObjectFilter } from "../../../../engine-core/dist/layers/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import premonition from "../../../dist/cards/sfd/premonition.js";

const CARD_ID = "card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit and a spell. Counter that spell and give that unit " +
  "+:rb_might: equal to that spell's Energy cost this turn.";

const [reactionKeyword, play] = program.abilities;
const [counterSpell, readSpellEnergy, grantMight] = play.body;

/**
 * Card-program filters reach the chain already normalized: the merged
 * programs layer (programs/filters.ts normalizePlayer) rewrites the static
 * 'controller' / 'you' spellings to 'self' before the chain's own
 * controller/owner substitution runs. The reference kernel's query compares
 * filter values literally, so this helper applies both steps, exactly as the
 * merged smoke-screen / siphon-power goldens do for the 'self' spelling.
 */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self" || normalized[key] === "you" || normalized[key] === "controller") {
      normalized[key] = controller;
    }
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const chainContext = (kernel, controller = "A") => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

const registrations = (kernel) => kernel.continuousEffects.map((entry) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

/** The countered spell on the Chain plus the friendly unit the spell buffs. */
function riposteWorld(energy, { spellZone = "chain", unitMight = 2 } = {}) {
  const kernel = world()
    .object("enemy-spell", {
      zone: spellZone,
      types: ["spell"],
      cardId: "card:enemy-spell",
      energy,
      owner: "B",
      controller: "B"
    })
    .unit("ally", { owner: "A", controller: "A", might: unitMight })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 3 })
    .build();
  kernel.setTargets("target-spell", [kernel.ref("enemy-spell")]);
  kernel.setTargets("target-unit", [kernel.ref("ally")]);
  return kernel;
}

test("sfd-206-221 Riposte: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-206-221 Riposte structure: [Reaction] plus counter-then-grant play body", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 2 }
  });
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["counter-spell", "effect.counter"],
    ["read-spell-energy", "condition.value"],
    ["grant-might", "continuous.might"]
  ]);
});

test("sfd-206-221 Riposte structure: the countered spell is the Chain target (355.7 / 355.9.a.2)", () => {
  assert.deepEqual(counterSpell.args, { target: { kind: "constant", value: "target-spell" } });
  assert.deepEqual(counterSpell.targets, [
    {
      id: "target-spell",
      filter: { type: "spell", zone: "chain" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(counterSpell.linkedTo, undefined);
});

test("sfd-206-221 Riposte structure: the Might amount is the countered spell's printed Energy cost", () => {
  // CR 206: the cost of a card is its printed cost, so the amount reads the
  // countered spell's `energy` characteristic. The merged continuous.might
  // primitive evaluates numeric amounts itself, so the value travels through
  // the interpreter's condition.value binding (the merged
  // ogn/faithful-manufactor precedent for a value a primitive schema cannot
  // take as a raw symbolic expression).
  assert.equal(readSpellEnergy.op, "condition.value");
  assert.equal(readSpellEnergy.linkedTo, "counter-spell");
  assert.deepEqual(readSpellEnergy.args.value, {
    kind: "object-property",
    object: { linked: "counter-spell" },
    property: "energy"
  });
  assert.deepEqual(readSpellEnergy.args.key, { kind: "constant", value: "energyCost" });
  assert.equal(readSpellEnergy.targets, undefined);

  assert.equal(grantMight.op, "continuous.might");
  assert.equal(grantMight.linkedTo, "read-spell-energy");
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "target-unit" }
  });
  assert.deepEqual(grantMight.args.amount, {
    kind: "linked-value",
    instructionId: "read-spell-energy",
    key: "energyCost"
  });
  // "this turn" is the end-of-turn duration of the arithmetic layer effect
  // (317.1.a / 468.7.c).
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(grantMight.args.minimum, undefined);
  assert.deepEqual(grantMight.targets, [
    {
      id: "target-unit",
      filter: { type: "unit", controller: "you" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sfd-206-221 Riposte golden: real counter plus an end-of-turn Might grant worth the printed Energy cost", () => {
  const kernel = riposteWorld(3);
  const outcome = resolveChainBody(play.body, chainContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["counter-spell", "executed"], ["read-spell-energy", "executed"], ["grant-might", "executed"]]
  );

  // 426.1.a / 426.1.a.1: a countered card does nothing and is cleared from the
  // Chain into the trash (426.1.c adds that no costs are refunded).
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.deepEqual(outcome.results[0].result.linkedValues.counteredObjects, [
    { id: "enemy-spell", zoneEntryId: 1 }
  ]);

  // 478 / 478.1.a: the Might change is registered in the arithmetic layer
  // through ResolveContext.addContinuous with the printed amount.
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.equal(registration.effect.filter.objectId, "ally");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(kernel, "ally"), 5);

  // The value is locked while the countered spell was still readable: the
  // spell already left the Chain before the amount was bound.
  assert.equal(outcome.results[1].result.linkedValues.energyCost, 3);
});

test("sfd-206-221 Riposte golden: the amount follows the countered spell's own printed cost", () => {
  const kernel = riposteWorld(5);
  const outcome = resolveChainBody(play.body, chainContext(kernel));
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 5);
  assert.equal(effectiveMight(kernel, "ally"), 7);
});

test("sfd-206-221 Riposte golden: a zero-cost spell grants nothing (355.13)", () => {
  // sfd-122-221 is a real 0-Energy spell, so a +0 modification is reachable;
  // continuous.might treats a 0 add as negated/skipped and registers no layer
  // effect, which is the merged no-op semantics for "nothing additional
  // happens". The counter itself still happens (055 / 359.3.e.11).
  const kernel = riposteWorld(0);
  const outcome = resolveChainBody(play.body, chainContext(kernel));
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [["counter-spell", "executed", null], ["read-spell-energy", "executed", null], ["grant-might", "negated", "skipped"]]
  );
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(effectiveMight(kernel, "ally"), 2);
});

test("sfd-206-221 Riposte golden: a spell that already left the Chain ignores the whole body (359.3.e.6)", () => {
  const kernel = riposteWorld(3, { spellZone: "trash" });
  const outcome = resolveChainBody(play.body, chainContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["counter-spell", "ignored", "mistargeted"],
      ["read-spell-energy", "ignored", "linked-ignored"],
      ["grant-might", "ignored", "linked-ignored"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(effectiveMight(kernel, "ally"), 2);
});

test("sfd-206-221 Riposte golden: the end-of-turn duration expires the granted Might (317.1.a / 468.7.c)", () => {
  const kernel = riposteWorld(4);
  resolveChainBody(play.body, chainContext(kernel));
  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 6);

  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("ally")).might, 2);
});

test("sfd-206-221 Riposte golden: the grant follows the ability controller, not a fixed seat (190.6.d)", () => {
  const kernel = world()
    .object("enemy-spell", {
      zone: "chain",
      types: ["spell"],
      cardId: "card:enemy-spell",
      energy: 3,
      owner: "A",
      controller: "A"
    })
    .unit("ally", { owner: "B", controller: "B", might: 2 })
    .build();
  kernel.setTargets("target-spell", [kernel.ref("enemy-spell")]);
  kernel.setTargets("target-unit", [kernel.ref("ally")]);

  const outcome = resolveChainBody(play.body, chainContext(kernel, "B"));
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 3);
  assert.equal(effectiveMight(kernel, "ally"), 5);
});

// Official sources: Core Rules v1.5 (2026-10-09),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// and Radiance patch notes (effective 2026-10-16),
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/.
// canonicalCardId card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d.
// Timeline: B plays a spell and passes at Priority; the Chain is Closed; A plays
// Reaction Riposte from ordinary Priority; Finalize locks the friendly Unit and
// the B spell and pays 2 Energy + 2 Body; A escalates Priority to B; after B
// passes, the newest Riposte Resolves first at 340.1.  effect.counter moves the
// older spell to Trash under 426.1; the linked Energy read is frozen before the
// grant; 478.1.a registers the Might and 468.7.c expires it at this turn's end.
function riposteProductionFixture(energyCost) {
  const kernel = world()
    .player("A", { energy: 2, power: ["Body", "Body"] })
    .player("B", { energy: 20, power: ["Mind", "Mind", "Mind"] })
    .hand("riposte", {
      cardId: CARD_ID,
      types: ["spell"],
      energy: 2,
      power: ["Body"],
      might: null
    })
    .hand("opener", {
      cardId: premonition.canonicalCardId,
      types: ["spell"],
      energy: energyCost,
      power: energyCost === 0 ? [] : ["Mind"],
      might: null
    })
    .deck(["draw-one", "draw-two", "draw-three"], { owner: "B" })
    .unit("ally", {
      owner: "A",
      controller: "A",
      might: 2,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "select-objects" && request.id === "target:target-spell") {
      return [kernel.ref("opener")];
    }
    if (request.type === "select-objects" && request.id === "target:target-unit") {
      return [kernel.ref("ally")];
    }
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
      bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program, premonition] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "B",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  return { kernel, engine, binding, errors, requests };
}

function resolveRiposte(f) {
  const opener = f.kernel.getObject("opener");
  f.engine.execute(f.binding.describePlay({ type: "play", player: "B", object: opener.ref }, opener));
  f.engine.pass("B");
  assert.equal(f.engine.turnState, "neutral-closed");
  const source = f.kernel.getObject("riposte");
  const draft = f.binding.describePlay({ type: "play", player: "A", object: source.ref }, source);
  assert.equal(draft.speed, "reaction");
  f.engine.execute(draft);
  assert.deepEqual(f.engine.items.map(item => [item.object.id, item.status]), [
    ["opener", "finalized"],
    ["riposte", "finalized"]
  ]);
  assert.equal(f.kernel.getObject("opener").zone, "chain");
  assert.equal(f.kernel.getObject("ally").damage, 0);
  f.engine.pass("A");
  assert.equal(f.engine.priority, "B");
  assert.equal(f.kernel.getObject("opener").zone, "chain");
  f.engine.pass("B");
  assert.equal(f.kernel.getObject("opener").zone, "trash");
  assert.equal(f.kernel.getObject("riposte").zone, "trash");
  return draft;
}

test("sfd-206-221 Riposte production golden: a real Reaction counters the older spell and grants its printed Energy as temporary Might", () => {
  // Premonition has printed Energy 2, so Riposte's amount is 2 here.
  const f = riposteProductionFixture(2);
  assert.deepEqual(f.errors, []);
  resolveRiposte(f);
  assert.deepEqual(f.requests.map(request => [request.id, request.options.map(option => option.id)]), [
    ["target:target-spell", ["opener"]],
    ["target:target-unit", ["ally"]]
  ]);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("ally")).might, 4);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-drawn").length, 0,
    "the countered spell never executes its own effect");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "chain-item-resolve").length, 1,
    "Riposte resolves once; the countered spell is removed without Resolve under CR 426.1");
  assert.deepEqual(f.engine.items, []);
});

test("sfd-206-221 Riposte production golden: end-of-turn expiry removes the Might grant", () => {
  const f = riposteProductionFixture(2);
  resolveRiposte(f);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("ally")).might, 4);
  const expired = f.engine.layers.advance({ id: "turn-end" });
  assert.equal(expired.length, 1);
  assert.match(expired[0], /continuous\.might:settlement-1:riposte:1:ally:1:1/);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref("ally")).might, 2);
});
