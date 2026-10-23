// Scenario execution evidence: ../templates/static-644.test.mjs (one parameterized row per card).
// This card stays judge-required; the template row pins the object-count gate over-applying +4
// at 0 XP through the production static binder.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/targonian-visionary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-7a28733b1d7d68a60f53e6b2afcce546b7e3c138e103f63079734f2d3809e08f";
const SOURCE_TEXT =
  "[Level 11][>] I have +4 :rb_might:. (While you have 11+ XP, get the effect.)";

const [levelEleven] = program.abilities;

/** Move a real board object onto a battlefield through the merged pipeline. */
function board(f, id) {
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref(id),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
}

/**
 * The merged interpreter evaluates count expressions as an object set query:
 * interpreter/expr.ts `case "count"` calls queryObjects(expr.filter) and never
 * reads `subject`. This environment records every player() read so the golden
 * can prove the gate is not an XP read.
 */
function countEnvironment(objects) {
  const reads = { player: 0, filters: [] };
  const environment = {
    context: {
      source: { ref: { id: "visionary", zoneEntryId: 1 }, controller: "A" },
      controller: "A",
      timingPoint: "main-start",
      query: filter => { reads.filters.push(filter); return objects; },
      player: id => { reads.player += 1; return { id, xp: 11 }; },
      evaluate: () => 0,
      test: () => false,
      linked: () => undefined,
      object: () => null,
      lastKnown: () => ({}),
      targets: () => [],
      picks: () => [],
      zoneSlice: () => [],
      history: () => 0,
      choose: () => { throw new Error("no choice expected"); },
      perform: () => ({ status: "done", events: [] }),
      link: () => {},
      addContinuous: () => {},
      registerDelayedTrigger: () => {}
    },
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  return { environment, reads };
}

function boardObjects(count) {
  return Array.from({ length: count }, (unused, index) => ({
    ref: { id: `object-${index}`, zoneEntryId: 1 },
    types: ["unit"],
    tags: [],
    keywords: [],
    zone: "board"
  }));
}

test("unl-098-219 Targonian Visionary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-098-219 Targonian Visionary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /824\.1/);
  // Assertions carried over from the previous sweep (the reason still names the
  // Level keyword, the XP gate and the arithmetic-layer continuous.might change),
  // now next to the specific current gaps.
  assert.match(program.judgeReason, /Level/);
  assert.match(program.judgeReason, /XP/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /controller-xp/);
  assert.match(program.judgeReason, /count/);
  assert.match(program.judgeReason, /condition\.predicate/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /RIFT-268/);
  // The earlier reasons cited a missing registration path; that claim is stale
  // (RIFT-349 merged createEngineStaticBinder + attachProgramLifecycle). The
  // reason now names the current dependency instead of the merged path.
  assert.match(program.judgeReason, /RIFT-349/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91\b|RIFT-257\b/);
});

test("unl-098-219 Targonian Visionary: [Level 11][>] is one static +4 Might ability for the host", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(levelEleven.kind, "static");
  // 824.1.b.2: the Dependent Ability here is "I have +4 :rb_might:" — an
  // arithmetic-layer Might change (143.2.a), not a Buff counter (702).
  assert.equal(levelEleven.effect.kind, "continuous.might");
  assert.equal(levelEleven.effect.mode, "add");
  assert.equal(levelEleven.effect.layer, "arithmetic");
  assert.deepEqual(levelEleven.effect.amount, { kind: "constant", value: 4 });
  // 053.1: "I" is the ability host.
  assert.deepEqual(levelEleven.effect.filter, { object: "self" });
});

test("unl-098-219 Targonian Visionary: the 11-XP gate keeps the 824.1.b.1 shape", () => {
  const condition = levelEleven.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 11 });
  // 824.1.c: the gate must be the controller XP (824.1.c.1 / 824.1.d re-evaluate
  // on a controller change or a drop below 11); the retained shape records the
  // printed threshold, but the merged count primitive never reads `subject`.
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "controller-xp");
  assert.deepEqual(condition.left.filter, { player: "controller" });
});

test("unl-098-219 Targonian Visionary: the merged [Level 11] KeywordDef expands the 11-XP predicate", () => {
  // RIFT-268 landed effects/keywords/Level.ts; 824.1.a-b turn the printed
  // "[Level 11][>]" into the predicate that makes the dependent ability active.
  const definition = keywordDefinitionsById.get("Level");
  assert.ok(definition, "the merged Level KeywordDef must be registered");
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "separate");
  const [predicate] = definition.expand({ value: 11, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(predicate.kind, "static");
  assert.equal(predicate.effect.kind, "condition.predicate");
  assert.equal(predicate.effect.predicate, "level-active");
  assert.equal(predicate.effect.query, "controller-xp");
  assert.equal(predicate.effect.characteristic, "xp");
  assert.equal(predicate.effect.operator, "gte");
  assert.deepEqual(predicate.effect.threshold, { kind: "constant", value: 11 });
  assert.equal(predicate.effect.id, "level:" + CANONICAL_ID + ":11:predicate");
});

test("unl-098-219 Targonian Visionary: the program declaration matches the merged keyword expansion", async () => {
  // The declaration half of 824.1.a is expressible today; the predicate
  // consumers (XP evaluation plus the predicate layer mapping) are not.
  const binding = createProgramBinding({ cardPrograms: cardRegistryById });
  const source = {
    ref: { id: "visionary", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Targonian Visionary",
    types: ["unit"],
    tags: ["Mount Targon"],
    keywords: [{ id: "Level", value: 11 }],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    combatRole: null,
    might: 6,
    energy: 6,
    power: ["Body"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expanded = binding.inspect(source).abilities;
  assert.equal(keywordDefinitionsById.has("Level"), true);
  assert.deepEqual(expanded.map(ability => [ability.kind, ability.effect.kind]), [
    ["static", "continuous.might"],
    ["static", "condition.predicate"]
  ]);
});

test("unl-098-219 Targonian Visionary: the declared gate counts objects, never the controller XP", () => {
  const gate = levelEleven.condition;
  const ten = countEnvironment(boardObjects(10));
  // 824.1.c wants "you have 11 or more XP"; the merged algebra returns false
  // for ten board objects even though the recorded player XP is 11.
  assert.equal(evaluateCondition(gate, ten.environment), false);
  assert.equal(ten.reads.player, 0, "count must not read the player snapshot");
  // The only thing the set query receives is the leftover filter; `subject`
  // ("controller-xp") never reaches the interpreter at all.
  assert.deepEqual(ten.reads.filters, [{ player: "controller" }]);
  const eleven = countEnvironment(boardObjects(11));
  assert.equal(evaluateCondition(gate, eleven.environment), true);
  assert.equal(eleven.reads.player, 0);
  assert.deepEqual(eleven.reads.filters, [{ player: "controller" }]);
});

test("unl-098-219 Targonian Visionary: the program-level binding refuses the card, and the declared static ability still over-applies at 0 XP", () => {
  // Concrete evidence for the judgeReason. RIFT-349 landed the CardProgram ->
  // layers binder, so the declared static ability really is registered and its
  // IR condition really is evaluated by the interpreter - but that condition is
  // an object count, so the printed 11-XP gate does not hold and the +4 fires at
  // 0 XP. The production registry additionally refuses the whole program while
  // the card is judge-required, so this golden binds the declared ability the
  // same way the production binder does and pins the arithmetic outcome.
  const binding = createProgramBinding({ cardPrograms: cardRegistryById });
  const f = fixture({
    cards: [{ id: "visionary", cardId: CANONICAL_ID, types: ["unit"], tags: ["Mount Targon"], might: 6 }],
    describePlay: binding.describePlay
  });
  const errors = [];
  binding.attachLifecycle(f.engine, error => errors.push(error));
  board(f, "visionary");
  f.engine.layers.setObjects(f.kernel.objects);
  // The registry gate re-throws judgeReason for non-executable programs, so
  // the lifecycle binder never registers anything for this card today.
  assert.equal(errors.length > 0, true);
  assert.ok(errors.every(error => error.name === "ProgramBindingError"));
  assert.equal(f.engine.layers.registry.list().length, 0);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("visionary")).might, 6);

  // Bind the declared static ability directly with the same production binder
  // the lifecycle uses; this is the state the card would be in once the
  // registry admits it, and it shows the gate is an object count.
  const source = f.kernel.getObject("visionary");
  const handle = createEngineStaticBinder(f.engine).bindStatic(levelEleven, source);
  f.engine.layers.setObjects(f.kernel.objects);
  const registrations = f.engine.layers.registry.list();
  assert.equal(registrations.length, 1);
  const [registration] = registrations;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 4);
  assert.equal(typeof registration.effect.effect.condition, "function");
  assert.equal(f.kernel.player("A").xp, 0);
  // 824.1.c: no XP at all must mean no +4. The merged evaluation adds it anyway
  // (the set query matches every board object, including this unit).
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("visionary")).might, 10);
  handle.unbind();
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test("unl-098-219 Targonian Visionary: the Level predicate binds as a production capability", () => {
  const f = fixture({
    cards: [{ id: "visionary", cardId: CANONICAL_ID, types: ["unit"], might: 6 }],
    describePlay: createProgramBinding({ cardPrograms: cardRegistryById }).describePlay
  });
  board(f, "visionary");
  const source = f.kernel.getObject("visionary");
  const [predicate] = keywordDefinitionsById.get("Level").expand({ value: 11, host: { canonicalCardId: CANONICAL_ID } });
  // 824.1.c.1/.d: the predicate enters the production capability registry;
  // its live XP evaluation remains a separate consumer concern.
  const handle = createEngineStaticBinder(f.engine).bindStatic(predicate, source);
  const [registration] = f.engine.layers.registry.list();
  assert.equal(registration.effect.effect.capabilityKind, "predicate");
  assert.equal(registration.effect.effect.ability.effect.query, "controller-xp");
  handle.unbind();
});

test.todo(
  "unl-098-219 Targonian Visionary: evaluate the level-active predicate against the controller's live XP " +
    "(CR 824.1.c, 824.1.c.1, 824.1.d) - the merged count primitive reads objects, not PlayerSnapshot.xp (RIFT-359)"
);
test.todo(
  "unl-098-219 Targonian Visionary: map condition.predicate into a layer and attach the dependent +4 Might " +
    "text to it (CR 824.1.b.1/824.1.c.1) - programs/statics.ts layerFor rejects the merged Level predicate " +
    "(RIFT-268 follow-up / RIFT-359)"
);

