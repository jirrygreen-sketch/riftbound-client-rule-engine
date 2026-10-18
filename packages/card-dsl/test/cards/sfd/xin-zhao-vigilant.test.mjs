// Template execution evidence: ../templates/keyword-replacement-effect-ready-700.test.mjs.
// False-condition and Tank regressions keep printed expectations under TODO.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/xin-zhao-vigilant.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-74a101bf90abcf30478ceacbdf6a254627d4b912349d7ed3b6a76591368936a8";
const SOURCE_TEXT =
  "[Tank] (I must be assigned combat damage first.)\n" +
  "I enter ready if you have two or more other units in your base.";

const [tank, enterReady] = program.abilities;
const [readyInstruction] = enterReady.with;

/**
 * The production chain normalizes the symbolic controller/owner anchors before
 * asking the layer matcher (chain/engine.ts), while interpreter set queries
 * consume the exclude anchor (interpreter/selectors.ts). This mirrors that path
 * so the condition is evaluated exactly as the merged consumers see it.
 */
function productionQuery(kernel, controller) {
  return filter => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    return kernel.query({}).filter(object => {
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
}

function conditionHolds(kernel, hostRef) {
  const context = new Proxy(kernel, {
    get(target, key) {
      if (key === "query") return productionQuery(target, "A");
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return evaluateCondition(enterReady.condition, {
    context,
    host: hostRef,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  });
}

test("sfd-176-221 Xin Zhao, Vigilant: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-176-221 Xin Zhao, Vigilant: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: name the current op/rule/dependency, never a stale missing file.
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /815\.1\.c/);
  assert.match(program.judgeReason, /815\.1\.c\.2/);
  assert.match(program.judgeReason, /base-combat-allocation/);
  assert.match(program.judgeReason, /matchesEnterAction/);
  assert.match(program.judgeReason, /364\.3/);
  assert.match(program.judgeReason, /incarnation/);
  assert.match(program.judgeReason, /zoneEntryId/);
  assert.match(program.judgeReason, /exclude/);
  // RIFT-359 landed the condition/result predicates and is no longer an
  // outstanding dependency for this card.
  assert.doesNotMatch(program.judgeReason, /RIFT-359/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-176-221 Xin Zhao, Vigilant: [Tank] expands to the merged continuous.combat declaration", () => {
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  // CR 815.1.b/.c: the merged KeywordDef (RIFT-264) carries the assignment
  // requirement the combat workflow still has to consume.
  const definition = keywordDefinitionsById.get("Tank");
  assert.ok(definition, "the merged Tank KeywordDef must be registered");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "single");
  const [expanded] = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expanded.kind, "static");
  assert.equal(expanded.effect.kind, "continuous.combat");
  assert.equal(expanded.effect.mode, "damage-assignment");
  assert.equal(expanded.effect.priority, "first");
  assert.equal(expanded.effect.damage, "lethal");
  assert.equal(expanded.effect.excludesKeyword, "Tank");
});

test("sfd-176-221 Xin Zhao, Vigilant: the replacement is an entry-state rewrite of self", () => {
  assert.equal(enterReady.kind, "replacement");
  // "I enter ready" (369.3) replaces the default exhausted entry (359.2.c) of
  // this card only, before the zone change.
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(enterReady.with.length, 1);
  assert.equal(readyInstruction.id, "xin-zhao-vigilant.enter-ready");
  assert.equal(readyInstruction.op, "effect.ready");
  // The replaced event's object is the entering unit itself (355.10.c/805.6).
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(readyInstruction.targets, undefined);
  assert.equal(readyInstruction.picks, undefined);
  assert.equal(readyInstruction.linkedTo, undefined);
});

test("sfd-176-221 Xin Zhao, Vigilant: the condition counts two or more other friendly units in your base", () => {
  const condition = enterReady.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 2 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "units");
  // "units in your base": controlled by you (107.1.c), on the Board at a Base
  // location (107.1.b/198.1); "other" excludes this card (740.1.a).
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    controller: "self",
    zone: "board",
    location: "base",
    exclude: "self"
  });
});

test("sfd-176-221 Xin Zhao, Vigilant: the condition evaluates against the real board (>=2 others in your base)", () => {
  const two = world()
    .base("xin-zhao", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .base("ally-1", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .base("ally-2", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .build();
  assert.equal(conditionHolds(two, two.ref("xin-zhao")), true);

  const one = world()
    .base("xin-zhao", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .base("ally-1", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .build();
  assert.equal(conditionHolds(one, one.ref("xin-zhao")), false);

  // A unit at a battlefield is not "in your base" (107.1.c/198.1).
  const battlefield = world()
    .base("xin-zhao", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .base("ally-1", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .unit("field-unit", { zone: "board", types: ["unit"], location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  assert.equal(conditionHolds(battlefield, battlefield.ref("xin-zhao")), false);

  // An opponent's base unit is not a friendly unit (740.1.a).
  const enemy = world()
    .base("xin-zhao", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .base("ally-1", { zone: "board", types: ["unit"], location: { type: "base", player: "A" } })
    .base("enemy-unit", { zone: "board", types: ["unit"], owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .build();
  assert.equal(conditionHolds(enemy, enemy.ref("xin-zhao")), false);
});

test("sfd-176-221 Xin Zhao, Vigilant: the replacement body executes through the production interpreter adapter", () => {
  // The with body is the card's real "ready me" rewrite; the synthetic entry
  // declaration (805.6/Accelerate) hands exactly this body to the entry path.
  const kernel = world().unit("xin-zhao", { exhausted: true, might: 4 }).build();
  const scoped = kernel.clone({
    source: kernel.ref("xin-zhao"),
    sourceSnapshot: kernel.getObject("xin-zhao")
  });
  const outcome = resolveChainBody(enterReady.with, scoped);
  assert.equal(outcome.status, "executed");
  const [result] = outcome.results;
  assert.equal(result.op, "effect.ready");
  assert.equal(result.result.status, "executed");
  assert.deepEqual(result.result.linkedValues, {
    readied: { count: 1, objects: [scoped.ref("xin-zhao")] }
  });
  assert.equal(scoped.getObject("xin-zhao").exhausted, false);
  assert.deepEqual(scoped.events.map(event => event.action), ["ready"]);

  // 416.1.b/416.1.c: an already-ready unit is not readied again.
  const ready = world().unit("xin-zhao", { exhausted: false, might: 4 }).build();
  const readyScoped = ready.clone({
    source: ready.ref("xin-zhao"),
    sourceSnapshot: ready.getObject("xin-zhao")
  });
  const readyOutcome = resolveChainBody(enterReady.with, readyScoped);
  assert.deepEqual(readyOutcome.results[0].result.linkedValues, {
    readied: { count: 0, objects: [] }
  });
  assert.deepEqual(readyScoped.events, []);
});

const productionDeps = (f) => ({
  host: {
    object: (ref) => f.kernel.object(ref),
    objects: () => f.kernel.objects,
    context: (snapshot, controller) => bindResolveContext(f.kernel, {
      source: snapshot, sourceSnapshot: snapshot, controller
    })
  },
  pipeline: f.engine.pipeline
});

test("sfd-176-221 Xin Zhao, Vigilant: a false ability condition must preserve exhausted entry", {
  todo: "RIFT-260 follow-up: matchesEnterAction skips ability.condition (CR 364.3/369.3)"
}, () => {
  // 364.3/369.3: the "if" clause gates the entry replacement itself. The
  // merged production binding (replacement/bind.ts matchesEnterAction) matches
  // on the replaces filter only and never evaluates ability.condition, so a
  // literal 1 == 2 condition still readies the entering unit.
  const f = fixture({ cards: [{ id: "xin", cardId: CARD_ID, types: ["unit"] }] });
  const alwaysFalse = { kind: "compare", operator: "eq", left: { kind: "constant", value: 1 }, right: { kind: "constant", value: 2 } };
  bindReplacement({ ...enterReady, condition: alwaysFalse }, f.kernel.ref("xin"), productionDeps(f));
  f.engine.execute(f.card("xin", { kind: "unit", body: [] }));
  resolveAll(f.engine);

  assert.equal(f.kernel.getObject("xin").zone, "board");
  assert.equal(f.kernel.getObject("xin").exhausted, true);
});

test("sfd-176-221 Xin Zhao, Vigilant: the entry condition must bind exclude:self to the entering incarnation", {
  todo: "RIFT-260 follow-up: one other base unit cannot satisfy the two-other-unit condition"
}, () => {
  // Exactly one other friendly Base unit: the printed condition (>=2 others)
  // is false, so the unit must enter exhausted. The binding also keeps the
  // registration-time hostRef (zoneEntryId 1) while entry lands a new
  // incarnation (zoneEntryId 3); evaluating the card's exclude:self anchor
  // against that stale ref counts the entering unit as "another" and flips the
  // condition to true.
  const f = fixture({ cards: [{ id: "xin", cardId: CARD_ID, types: ["unit"], exhausted: true, might: 4 }] });
  // The fixture's own "source" unit is a Base resident; move it to a
  // battlefield so exactly one other unit remains in player A's Base.
  f.kernel.perform({
    type: "move-zone",
    object: f.kernel.ref("source"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.kernel.addObject({
    ref: { id: "ally", zoneEntryId: 1 },
    cardId: "card:ally",
    name: "ally",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    combatRole: null,
    might: 2,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }, "board");
  const registered = f.kernel.getObject("xin").ref;
  bindReplacement(enterReady, registered, productionDeps(f));
  f.engine.execute(f.card("xin", { kind: "unit", body: [] }));
  resolveAll(f.engine);

  const entered = f.kernel.getObject("xin");
  assert.equal(entered.zone, "board");
  assert.notEqual(entered.ref.zoneEntryId, registered.zoneEntryId);
  // The condition must be false with only one other Base unit...
  assert.equal(conditionHolds(f.kernel, entered.ref), false);
  // ...but the registration-time incarnation fails to exclude the entering
  // unit and reports the wrong answer, and the merged entry path never asks.
  assert.equal(conditionHolds(f.kernel, registered), true);
  assert.equal(entered.exhausted, true);
});

// The old allocator probe supplied keywordPriority:"proven-none" itself and
// never bound this card's Tank ability. That absent-consumer assertion is not
// executable Tank evidence; preserve the required behavior as an explicit gap.
test.todo(
  "sfd-176-221 Xin Zhao, Vigilant: reject non-Tank damage first using real Tank-aware combat facts " +
    "(CR 815.1.c.2; RIFT-264 follow-up: continuous.combat priority consumer is absent)"
);

test.todo(
  "Xin Zhao: consume Tank's continuous.combat priority during lethal-first combat damage assignment " +
    "(815.1.b/815.1.c.2); the merged assignment kernel only accepts keywordPriority: \"proven-none\""
);
test.todo(
  "Xin Zhao: evaluate ability.condition before the entry-state replacement and bind exclude:self to the " +
    "entering incarnation (364.3/369.3); replacement/bind.ts matchesEnterAction returns true without " +
    "testCondition and keeps the registration-time hostRef"
);
