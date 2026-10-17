import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/wielder-of-water.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core, so golden execution loads
// the built engine through its workspace layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: continuousMight } = await import(new URL("effects/instructions/continuous.might.js", engineCore));
const { createLayerEngine } = await import(new URL("layers/index.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", engineCore));
const { ChainEngine } = await import(new URL("chain/engine.js", engineCore));
const { createEngineStaticBinder } = await import(new URL("programs/statics.js", engineCore));

const CANONICAL =
  "card.hash-2cbbc0b067da2370a522b50188aead6aa06a594259be55b5951e6f51601e59ef";
const SOURCE_TEXT = "While I'm attacking or defending alone, I have +2 :rb_might:.";

const [staticAbility] = program.abilities;

test("ogn-055-298 Wielder of Water: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-055-298 Wielder of Water: identity, ruleset, status and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.match(program.judgeReason, /filter\.ts:62/);
  assert.match(program.judgeReason, /相对 controller/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-055-298 Wielder of Water: the +2 Might is a static arithmetic-layer effect on self", () => {
  // 364.3/364.3.a: a Conditional Passive Ability; 365.1: active while on the
  // Board. The effect never enters the chain (contract 3.4).
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.mode, "add");
  assert.equal(staticAbility.effect.layer, "arithmetic");
  assert.equal(staticAbility.effect.appliesTo, "self");
  assert.deepEqual(staticAbility.effect.amount, { kind: "constant", value: 2 });
  assert.equal(staticAbility.effect.value, undefined);
});

test("ogn-055-298 Wielder of Water: the condition is combat role plus the friendly lone predicate", () => {
  const condition = staticAbility.condition;
  assert.equal(condition.kind, "all");
  assert.equal(condition.conditions.length, 2);

  // "I'm attacking or defending": 461 designations on ObjectSnapshot.combatRole.
  const combat = condition.conditions[0];
  assert.equal(combat.kind, "compare");
  assert.deepEqual(combat.left, {
    kind: "object-property",
    object: "self",
    property: "combatRole"
  });
  assert.equal(combat.operator, "in");
  assert.deepEqual(combat.right, { kind: "constant", value: ["attacker", "defender"] });

  // "alone" (740.2.a): no other *friendly* unit at the same location; the
  // count keeps the friendly scope via controller:'self', whose static-path
  // defect is documented in the program's judgeReason.
  const lone = condition.conditions[1];
  assert.equal(lone.kind, "compare");
  assert.equal(lone.operator, "eq");
  assert.deepEqual(lone.right, { kind: "constant", value: 0 });
  assert.equal(lone.left.kind, "count");
  assert.deepEqual(lone.left.filter, {
    type: "unit",
    controller: "self",
    sameLocationAs: "self",
    exclude: "self"
  });
});

test("ogn-055-298 Wielder of Water golden: the merged continuous.might primitive applies +2 through the real layer engine", () => {
  // The declared amount/mode/layer reach the layer engine through the merged
  // instruction primitive; the binder golden below proves the same declared
  // effect is registered by the production static binder with its condition.
  const kernel = world().unit("wielder", { might: 2 }).build();
  // The card's static ability targets its own host, so bind the source
  // snapshot the way the card-program static path would.
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("wielder") });
  const run = runInstruction(
    continuousMight,
    {
      amount: staticAbility.effect.amount,
      mode: { kind: "constant", value: staticAbility.effect.mode },
      duration: { kind: "constant", value: "this-turn" },
      appliesTo: { kind: "constant", value: "self" }
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);

  const registrations = scoped.continuousEffects.map((entry) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: 1
  }));
  const engine = createLayerEngine(scoped.objects, registrations);
  assert.equal(engine.evaluate(scoped.ref("wielder")).might, 4);
});

function chainEngineFor(kernel) {
  const decide = (request) => { throw new Error("Unexpected choice: " + request.id); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  return new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
}

test("ogn-055-298 Wielder of Water golden: the production static binder grants +2 Might while attacking alone", () => {
  // 461: the Attacker designation is combatRole; 740.2.a: alone. The static
  // binder compiles the declared condition into the merged interpreter
  // predicate and the continuous.might effect into the real arithmetic layer.
  const kernel = world().player("A")
    .unit("wielder", { might: 2, combatRole: "attacker", controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-elsewhere", { might: 2, controller: "A", owner: "A", location: { type: "base", player: "A" } })
    .unit("enemy-elsewhere", { might: 2, controller: "B", owner: "B", location: { type: "base", player: "B" } })
    .build();
  const engine = chainEngineFor(kernel);
  const handle = createEngineStaticBinder(engine).bindStatic(staticAbility, kernel.getObject("wielder"));

  assert.equal(engine.layers.evaluate(kernel.ref("wielder")).might, 4);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-elsewhere")).might, 2);
  assert.equal(engine.layers.evaluate(kernel.ref("enemy-elsewhere")).might, 2);
  handle?.unbind();
  assert.equal(engine.layers.evaluate(kernel.ref("wielder")).might, 2);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-elsewhere")).might, 2);
});

test("ogn-055-298 Wielder of Water golden: the production static binder does not apply the bonus while out of combat even when alone", () => {
  const kernel = world().player("A")
    .unit("wielder", { might: 2, combatRole: null, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const engine = chainEngineFor(kernel);
  const handle = createEngineStaticBinder(engine).bindStatic(staticAbility, kernel.getObject("wielder"));
  assert.equal(engine.layers.evaluate(kernel.ref("wielder")).might, 2);
  handle?.unbind();
});

test("ogn-055-298 Wielder of Water: the static binder's filter bridge over-matches enemies into the 740.2.a friendly count (documented gap, pinned)", () => {
  // layers/filter.ts:62 evaluates controller candidates against each
  // candidate's own controller, so controller:'self' matches every
  // candidate at the location and cannot express the rule's
  // friendly-only scope. The pin asserts the documented defect in its
  // over-matching direction: an enemy at the same location is wrongly
  // counted as friendly, so a lone-attacker board that SHOULD be alone
  // (rule truth: +2 might, 740.2.a) is wrongly denied the bonus
  // (observed: might 2). A friendly co-located blocker over-matches the
  // same way; the rule also denies the bonus there, so that outcome is
  // rule-correct only by coincidence. Both directions are pinned below.
  // Fixing the defect and flipping these pins is the dependency named
  // in judgeReason.
  const kernel = world().player("A")
    .unit("wielder", { might: 2, combatRole: "defender", controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { might: 2, controller: "B", owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const engine = chainEngineFor(kernel);
  const handle = createEngineStaticBinder(engine).bindStatic(staticAbility, kernel.getObject("wielder"));
  assert.equal(engine.layers.evaluate(kernel.ref("wielder")).might, 2);
  handle?.unbind();
});

test("ogn-055-298 Wielder of Water golden: a friendly co-located unit suppresses the bonus (over-match direction, outcome matches the rule)", () => {
  // The same over-match counts a friendly blocker; 740.2.a also denies
  // alone here, so might 2 is rule-correct, but only by coincidence of
  // the documented filter defect (see the pin above).
  const kernel = world().player("A")
    .unit("wielder", { might: 2, combatRole: "defender", controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("friend-here", { might: 2, controller: "A", owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const engine = chainEngineFor(kernel);
  const handle = createEngineStaticBinder(engine).bindStatic(staticAbility, kernel.getObject("wielder"));
  assert.equal(engine.layers.evaluate(kernel.ref("wielder")).might, 2);
  handle?.unbind();
});

test.todo(
  "ogn-055-298 Wielder of Water: the 740.2.a friendly-only count needs a relative-controller query path " +
    "for static count conditions (layers/filter.ts selectorMatches compares candidates against their own " +
    "controller, so controller:'self' matches every candidate at the location) or dedicated 740.2.a " +
    "support in the static binder's condition evaluation"
);
