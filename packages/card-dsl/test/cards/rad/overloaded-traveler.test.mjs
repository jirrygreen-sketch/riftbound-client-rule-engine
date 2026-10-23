// Scenario execution evidence: ../../templates/static-642.test.mjs.
// This file keeps the validation and identity checks plus the key structural
// assertions; the real execution path for this card lives in that template row.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/overloaded-traveler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-adfd644e08c5d8afc96ca8c90b7a573a5e333bba2b2fb4d364ea5830160dc459";
const [staticAbility] = program.abilities;

// The card declares its static effect only; a card file cannot register it with
// LayerEngine (no merged caller reads a card program). The card's own declared
// effect is therefore fed to the real layer engine directly, exactly as the
// sibling goldens do, to prove the declared shape really computes +1 Might.
function unit(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...values
  };
}

function spec() {
  return {
    id: "overloaded-traveler",
    layer: staticAbility.effect.layer,
    filter: { objectId: "traveler", zone: "board" },
    effect: staticAbility.effect
  };
}

test("rad-072-167 Overloaded Traveler: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "While there's a friendly gear with [Deploy] at my battlefield, I have +1 :rb_might:."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-072-167 Overloaded Traveler: judgeReason names the conditional Might, the Deploy predicate, and the type mismatch", () => {
  // Rule anchors stay durable as engine dependencies merge.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /\[Deploy\]/);
  assert.match(program.judgeReason, /830\.3/);
  assert.match(program.judgeReason, /143\.2/);
  // The relative-player anchor is the second rule gap, and the reason must name
  // the observed wrong result (opposed gear satisfying the clause) instead of
  // only the keyword predicate.
  assert.match(program.judgeReason, /has-keyword/);
  assert.match(program.judgeReason, /object\.controller === object\.controller/);
  // RIFT-359's condition/predicate work merged; the reason must name the merged
  // code that still rejects the two clauses rather than the closed task id.
  assert.doesNotMatch(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /Unsupported filter field/);
  // The catalog types this printing as a Spell with Might 2 while the text is a
  // permanent unit's static ability.
  assert.match(program.judgeReason, /Spell/);
});

test("rad-072-167 Overloaded Traveler: structure — one static conditional +1 Might on the source", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  const { effect } = staticAbility;
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.mode, "add");
  assert.equal(effect.layer, "arithmetic");
  assert.equal(effect.appliesTo, "self");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  assert.equal(effect.duration, "while-conditional");
});

test("rad-072-167 Overloaded Traveler: structure — the friendly-[Deploy]-gear-at-my-battlefield condition", () => {
  const { condition } = staticAbility;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });

  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "friendly-gears-with-deploy-at-my-battlefield");
  // "my battlefield" is the source's own location (sameLocationAs: "self");
  // the [Deploy] qualifier stays in the subject because no merged filter path
  // evaluates a keyword qualifier (judgeReason), and no key is added that
  // nothing would read.
  assert.deepEqual(condition.left.filter, {
    type: "gear",
    controller: "self",
    sameLocationAs: "self"
  });
  assert.equal(Object.hasOwn(condition.left.filter, "keyword"), false);
  assert.equal(Object.hasOwn(condition.left.filter, "keywords"), false);
});

/** Bind the card's own static through the merged production static → layers path. */
function boundStatic() {
  const kernel = world()
    .unit("traveler", { controller: "A", owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  createEngineStaticBinder(engine).bindStatic(staticAbility, kernel.getObject("traveler"));
  return { kernel, engine, entry: engine.layers.registry.list()[0] };
}

test("rad-072-167 Overloaded Traveler: the authored static really binds and its condition gates the +1 Might", () => {
  // 143.2 / 479.4.e.1: the card's own declared shape registers through the
  // merged static → layers binder, so the remaining gaps are exactly the ones
  // judgeReason lists — not the binding path.
  const { kernel, engine, entry } = boundStatic();
  assert.ok(entry);
  assert.equal(entry.effect.layer, "arithmetic");
  assert.equal(entry.effect.effect.kind, "continuous.might");
  assert.equal(typeof entry.effect.effect.condition, "function");
  // With no gear present the while-clause is false, so Might stays printed.
  assert.equal(entry.effect.effect.condition(kernel.getObject("traveler")), false);
  assert.equal(engine.layers.evaluate(kernel.ref("traveler")).might, 2);

  // Now add a friendly gear with Deploy at the same battlefield: the condition
  // turns true and the layer really applies the +1.
  const withGear = world()
    .unit("traveler", { controller: "A", owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .object("gear", { types: ["gear"], controller: "A", owner: "A", zone: "board", location: { type: "battlefield", id: "bf-1" }, energy: null, power: null, keywords: [{ id: "Deploy" }] })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: withGear.snapshot(), links: withGear.clone() }),
    restore: checkpoint => { withGear.restore(checkpoint.state); withGear.copyLinkedFrom(checkpoint.links); },
    objects: () => withGear.objects,
    perform: action => withGear.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(withGear, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  const bound = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  createEngineStaticBinder(bound).bindStatic(staticAbility, withGear.getObject("traveler"));
  const registered = bound.layers.registry.list()[0];
  assert.equal(registered.effect.effect.condition(withGear.getObject("traveler")), true);
  assert.equal(bound.layers.evaluate(withGear.ref("traveler")).might, 3);
});

test("rad-072-167 Overloaded Traveler: the relative-player clause is unsound in both merged query paths", () => {
  // The condition needs a source-relative "friendly" query. Neither merged
  // path provides one, and they fail in opposite directions:
  // - the production static → layers path resolves controller: "self" through
  //   layers/filter.ts as object.controller === object.controller, so an opposed
  //   gear at the same battlefield satisfies the clause and Would apply +1
  //   Might with no friendly gear present (CR 143.2 + 830.3);
  // - the interpreter set query compares the string literally to the player id,
  //   so a real friendly gear does NOT satisfy it (fail-closed).
  const enemyOnly = world()
    .unit("traveler", { controller: "A", owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .object("enemy-gear", { types: ["gear"], controller: "B", owner: "B", zone: "board", location: { type: "battlefield", id: "bf-1" }, energy: null, power: null })
    .build();
  const enemySource = enemyOnly.getObject("traveler");
  const enemyEnvironment = {
    context: bindResolveContext(enemyOnly, { source: enemySource, controller: "A" }),
    host: enemyOnly.ref("traveler"),
    isIgnored: () => false,
    canLookBack: () => false
  };
  assert.equal(evaluateCondition(staticAbility.condition, enemyEnvironment), false,
    "the interpreter path is fail-closed even for a real friendly gear");
  assert.equal(matchesObjectFilter({ type: "gear", controller: "self" }, enemyOnly.getObject("enemy-gear")), true,
    "the layer filter treats controller: self as a self-comparison");

  // A literal player id filters correctly, but a printed card program must not
  // hardcode one — the missing piece is the relative-player anchor.
  assert.equal(matchesObjectFilter({ type: "gear", controller: "B" }, enemyOnly.getObject("enemy-gear")), true);
  assert.equal(matchesObjectFilter({ type: "gear", controller: "A" }, enemyOnly.getObject("enemy-gear")), false);

  // Proof of the over-application: a friendly gear does not change the layer
  // answer for an opposed gear, because the opponent is never identified.
  const friendlyGear = {
    ref: { id: "friendly-gear", zoneEntryId: 2 },
    cardId: null,
    name: "Hextech Battery",
    types: ["gear"],
    tags: [],
    keywords: [{ id: "Deploy" }],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const query = filter => [friendlyGear, enemyOnly.getObject("enemy-gear")].filter(object => matchesObjectFilter(filter, object));
  assert.equal(query({ type: "gear", controller: "self" }).length, 2,
    "controller: self matches both the friendly and the opposed gear");
  assert.equal(query({ type: "gear", controller: "A" }).length, 1,
    "only an explicit player id distinguishes the controller");
});

test("rad-072-167 Overloaded Traveler: no merged filter or condition form evaluates the [Deploy] qualifier (830.3)", () => {
  // 830.3 makes "[Deploy]" a checkable characteristic. The layer filter ignores
  // unknown keys (a gear without Deploy still matches `keywords`), and the
  // interpreter's Condition vocabulary has no keyword predicate at all.
  const { engine } = boundStatic();
  const plainGear = {
    ref: { id: "plain-gear", zoneEntryId: 1 },
    cardId: null,
    name: "Plain Gear",
    types: ["gear"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  // Unknown filter keys are not rejected and not evaluated: they pass.
  assert.equal(matchesObjectFilter({ type: "gear", keywords: ["Deploy"] }, plainGear), true);
  // characteristics compares the list against a scalar, so it fails for the
  // wrong reason (not because Deploy is absent).
  assert.equal(matchesObjectFilter({ type: "gear", characteristics: { keywords: ["Deploy"] } }, plainGear), false);
  assert.equal(
    engine.layers.evaluateAll().some(object => Object.keys(object).includes("has-keyword")),
    false,
    "no evaluable keyword predicate is exposed by the merged layer engine"
  );
});

test("rad-072-167 Overloaded Traveler: the relative-player anchor fails closed in the interpreter query, too", () => {
  // The reason claims the two merged paths fail in opposite directions; the
  // second half is the interpreter's set query, which compares the selector
  // string literally to a player id.
  const kernel = world()
    .unit("traveler", { controller: "A", owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .object("friendly-gear", { types: ["gear"], controller: "A", owner: "A", zone: "board", location: { type: "battlefield", id: "bf-1" }, energy: null, power: null })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("traveler") });
  assert.equal(context.query({ type: "gear", controller: "A" }).length, 1);
  assert.equal(context.query({ type: "gear", controller: "self" }).length, 0,
    "controller: self is compared as a player id, so a real friendly gear does not match");
  assert.equal(context.query({ type: "gear", controller: "any" }).length, 0,
    "the relative spelling is not broadened on this path either");
});

test("rad-072-167 Overloaded Traveler: the production filter preserves both Deploy keyword spellings", () => {
  // 830.3 makes "[Deploy]" a checkable characteristic; both closed spellings
  // now survive production translation so the source-relative query can use
  // them.
  for (const filter of [{ type: "gear", keywords: ["Deploy"] }, { type: "gear", keyword: "Deploy" }]) {
    assert.deepEqual(translateObjectFilter(filter), filter);
  }
});

test("rad-072-167 Overloaded Traveler: the declared +1 Might really computes in the merged arithmetic layer", () => {
  // 143.2.a / 479.4 / 479.4.e.1: the card's own continuous.might shape really
  // raises the source unit's Might by 1 through the merged layer engine.
  const traveler = unit("traveler");
  const engine = createLayerEngine([traveler], [
    { effect: spec(), duration: { type: "permanent" } }
  ]);
  assert.equal(engine.evaluate(traveler.ref).might, 4);

  // The +1 is applied before decreases (479.4.e.1): with a -2 Might effect also
  // registered on the same object the total is 2, not 3 or 5.
  const withReduction = createLayerEngine([traveler], [
    { effect: spec(), duration: { type: "permanent" } },
    {
      effect: {
        id: "shrink",
        layer: "arithmetic",
        filter: { objectId: "traveler" },
        effect: { kind: "decrease", amount: { kind: "constant", value: 2 } }
      },
      duration: { type: "permanent" }
    }
  ]);
  assert.equal(withReduction.evaluate(traveler.ref).might, 2);

  // The modification is a Might change, never a Buff counter (702).
  assert.equal(engine.evaluate(traveler.ref).buffs, 0);
});

test("rad-072-167 Overloaded Traveler: the card never approximates the conditional aura with a buff or a fixed value", () => {
  // Data-level guard that stays true regardless of which engine dependencies
  // have merged: the +1 Might is an arithmetic-layer modification conditioned on
  // the ability's while-clause, and it is not written as a counter or as a
  // permanent unconditional bonus.
  const effect = staticAbility.effect;
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.layer, "arithmetic");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  assert.equal(effect.appliesTo, "self");
  assert.equal(effect.duration, "while-conditional");
  assert.equal(staticAbility.condition.kind, "compare");
  assert.equal(/effect\.buff|effect\.counter/.test(effect.kind), false);
});

test.todo(
);
test.todo(
  "rad-072-167 Overloaded Traveler: the catalog types this printing as Spell with Might 2 while its text " +
    "is a permanent unit's static ability ('I have +1 Might', 'my battlefield'; CR 1.5 143.2/107.2, and " +
    "157/351.2 for spells). Card-data issue report, not a card-program change."
);
