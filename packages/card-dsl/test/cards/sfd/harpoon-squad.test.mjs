// Whole-card execution evidence for this program (the RIFT-687 template row and
// its supported-part tests) lives in
// test/cards/templates/triggered-object-moved-continuous-might-687.test.mjs;
// every assertion below is retained.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/harpoon-squad.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/timing-points.js";
import { createProgramBinding, translateTriggerFilter } from "../../../../engine-core/dist/programs/index.js";

const CARD_ID = "card.hash-f696312134479041b97777c95666ee948dd620df1b82a432d5d877753660bfd2";
const SOURCE_TEXT = "When I move from a battlefield, give me +2 :rb_might: this turn.";
const MIGHT_ID = "harpoon-squad.give-plus-2";

const [ability] = program.abilities;
const [might] = ability.body;

/** The production chain normalizes `self`/`opponent` player selectors in query. */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
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
const chainContext = (kernel, controller) => new Proxy(kernel, {
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

/** A complete Move emission as events/action-adapter.ts publishes it. */
const moveEvent = (id, fromZone) => ({
  timingPoint: "object-moved",
  kind: "object-moved",
  player: "A",
  fromZone,
  object: {
    ref: { id, zoneEntryId: 1 },
    cardId: id === "harpoon-1" ? CARD_ID : `card:${id}`,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-2" },
    might: 4,
    energy: 4,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    combatRole: null
  }
});

test("sfd-137-221 Harpoon Squad: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-137-221 Harpoon Squad: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.match(program.judgeReason, /449\.1\/449\.2/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257|RIFT-120/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-137-221 Harpoon Squad: one object-moved trigger filtered to this unit leaving a battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1 / 449.2: a Move is a permanent changing Location; 458/458.1
  // keeps Recalls out of Move triggers.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    fromZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-137-221 Harpoon Squad: the body declares a temporary +2 Might on the host, not a Buff counter", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(might.id, MIGHT_ID);
  assert.equal(might.op, "continuous.might");
  // 143.2.a / 317.2.c: a Might modification that expires at end of turn.
  assert.deepEqual(might.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(might.args.duration, { kind: "constant", value: "this-turn" });
  // "me" is the ability host: the merged appliesTo "self" shorthand, never a
  // fabricated TargetSpec (contract 3.6).
  assert.deepEqual(might.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(might.targets, undefined);
  assert.equal(might.picks, undefined);
  assert.equal(might.linkedTo, undefined);
});

test("sfd-137-221 Harpoon Squad golden: the merged continuous.might body lands +2 on the host through the production adapter", () => {
  const kernel = world()
    .player("A", { energy: 10 })
    .unit("harpoon", { owner: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("other", { owner: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const bound = kernel.clone({
    source: kernel.ref("harpoon"),
    sourceSnapshot: kernel.getObject("harpoon")
  });
  const outcome = resolveChainBody(ability.body, chainContext(bound, "A"));

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // One arithmetic-layer registration for the host only.
  assert.deepEqual(
    bound.continuousEffects.map(entry => entry.effect.filter.objectId),
    ["harpoon"]
  );
  assert.deepEqual(bound.continuousEffects[0].duration, { type: "end-of-turn" });
  const engine = createLayerEngine(bound.objects, registrations(bound));
  assert.equal(engine.evaluate(bound.ref("harpoon")).might, 6);
  assert.equal(engine.evaluate(bound.ref("other")).might, 4);
  // Never a Buff counter (702/703).
  assert.equal(engine.evaluate(bound.ref("harpoon")).buffs, 0);

  // 317.1.a / 468.7.c: the +2 expires at end of turn.
  engine.expireAt("turn-end");
  assert.equal(engine.evaluate(bound.ref("harpoon")).might, 4);
});

test("sfd-137-221 Harpoon Squad: the trigger filter translates to the host-anchored Move pattern it needs", () => {
  // The card-program binding translates the symbolic anchor and keeps the
  // Move's origin filter; registering this pattern is the remaining dependency
  // recorded in judgeReason.
  const translated = translateTriggerFilter(ability.trigger.filter, "harpoon-1", "object-moved");
  assert.deepEqual(translated, {
    event: "object-moved",
    object: { objectId: "harpoon-1" },
    fromZone: "battlefield"
  });
});

test("sfd-137-221 Harpoon Squad boundary: the closed event vocabulary admits the origin-filtered Move pattern", () => {
  // 449.1/449.2: the timing point and its fromZone predicate are both in the
  // closed vocabulary, preserving the Move origin restriction.
  assert.equal(getTimingPoint("object-moved").triggerable !== false, true);
  const translated = translateTriggerFilter(ability.trigger.filter, "harpoon-1", "object-moved");
  assert.doesNotThrow(() => assertTriggerSpec({ at: "object-moved", filter: translated }));
});

test("sfd-137-221 Harpoon Squad boundary: the translated pattern matches a real battlefield Move and no other unit", () => {
  const translated = translateTriggerFilter(ability.trigger.filter, "harpoon-1", "object-moved");
  assert.equal(matchesTriggerEvent(translated, moveEvent("harpoon-1", "battlefield"), "A"), true);
  // 458/458.1 plus the source anchor: another unit's Move never fires this card.
  assert.equal(matchesTriggerEvent(translated, moveEvent("other-unit", "battlefield"), "A"), false);
});

test("sfd-137-221 Harpoon Squad boundary: the production binding registers the Move trigger", () => {
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = world().player("A").player("B").unit("harpoon", { owner: "A", might: 4 }).build();
  const pipeline = new EventPipeline({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    execute: (action) => ({ outcome: kernel.perform(action), emissions: [] }),
    context: () => kernel,
    choose: () => { throw new Error("unexpected choice"); }
  }, ["A", "B"], "A");
  const source = { ...kernel.getObject("harpoon"), cardId: CARD_ID };

  assert.equal(binding.registerProgramTriggers({ pipeline }, source).length, 1);
  assert.equal(pipeline.triggers.size, 1);
});

test("sfd-137-221 Harpoon Squad boundary: the ObjectFilter fallback would widen the trigger to Base Moves", () => {
  // ObjectFilter has no fromZone/fromLocation field (events/trigger-spec.ts), so
  // the only shape that validates is `{ objectId }`, which also matches a
  // Base-to-Battlefield Move. The program must not take that route (449.1/449.2).
  const plain = translateTriggerFilter({ objectId: "harpoon-1" }, "harpoon-1", "object-moved");
  assert.deepEqual(plain, { objectId: "harpoon-1" });
  assertTriggerSpec({ at: "object-moved", filter: plain });
  assert.equal(matchesTriggerEvent(plain, moveEvent("harpoon-1", "base"), "A"), true);
  assert.equal(JSON.stringify(plain).includes("battlefield"), false);
});

test.todo(
  "sfd-137-221 Harpoon Squad: register the object-moved trigger so a real Move starting at a battlefield " +
    "gives the host +2 Might this turn (449.1/449.2, fromZone payload; 458/458.1 excludes Recalls) - needs " +
    "object-moved in the EventPattern vocabulary plus the CardProgram trigger registration"
);

