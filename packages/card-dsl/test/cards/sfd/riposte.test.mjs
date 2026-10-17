import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/riposte.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine, matchesObjectFilter } from "../../../../engine-core/dist/layers/index.js";

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
