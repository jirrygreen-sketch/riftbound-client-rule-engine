// RIFT-646 single-card golden: validation, identity, judgeReason and the key
// structure of Kai'Sa, Rebel. Real execution evidence for this card (the
// whole-card scenario through the generic card harness plus the measured
// outcome of binding the expanded Reaction grant) lives in
// `test/cards/templates/keyword-static-646.test.mjs`.
//
// The card stays judge-required: the Disarm expansion's `sameLocationAs` target
// filter is rejected by the production trigger path and `attack-declared` has
// no production emitter, while the Reaction grant registers but its
// `in-showdown` condition raises MissingInformation and fails closed, so a
// friendly chain spell still has no Reaction. Only the gap-asserting probes are
// removed here; the primitive-level evidence is kept.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/kaisa-rebel.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";

const CARD_ID =
  "card.hash-9dec9472d1f77a1c3d9249566ca3fa89140e7b6a4efcb6fe375c4fab210d2e87";

const [disarm, grantReaction] = program.abilities;

test("rad-063-167 Kai'Sa, Rebel: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /831\.1\.d/);
  assert.match(program.judgeReason, /continuous\.might/);
  // Merged dependencies are no longer cited as missing; the reason names the current gaps only.
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
  // Current real gaps, each backed by a probe below.
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /in-showdown/);
  assert.match(program.judgeReason, /813\.4/);
});

test("rad-063-167 Kai'Sa, Rebel: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn).\n" +
      "While I'm in a showdown, your spells have [Reaction]. (Play them any time, " +
      "even before spells and abilities resolve.)"
  );
});

test("rad-063-167 Kai'Sa, Rebel: [Disarm] carries the printed default value 1 (831.1.c.3)", () => {
  assert.deepEqual(disarm, { kind: "keyword", keyword: "disarm", value: 1 });
});

test("rad-063-167 Kai'Sa, Rebel: the merged Disarm definition expands the printed attack trigger (831.1.d)", () => {
  const definition = keywordDefinitionsById.get("Disarm");
  assert.ok(definition);
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "sum");
  const [expanded] = definition.expand({ value: 1, host: { canonicalCardId: CARD_ID } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "attack-declared");
  assert.deepEqual(expanded.trigger.filter, { event: "attack-declared", filter: { source: "self" } });
  assert.equal(expanded.body[0].op, "continuous.might");
  assert.deepEqual(expanded.body[0].args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(expanded.body[0].args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(expanded.body[0].targets[0].filter, {
    type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source"
  });
});

test("rad-063-167 Kai'Sa, Rebel: the merged Disarm expansion registers a temporary -1 Might layer", () => {
  const definition = keywordDefinitionsById.get("Disarm");
  const [expanded] = definition.expand({ value: 1, host: { canonicalCardId: CARD_ID } });
  const base = world()
    .unit("kaisa", { controller: "A", owner: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { controller: "B", owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = bindResolveContext(base, {
    source: base.getObject("kaisa"),
    controller: "A",
    query: filter => base.query({
      ...filter,
      ...(filter.controller === "opponent" ? { controller: "B" } : {})
    })
  });
  kernel.setTargets("disarm.enemy-unit", [kernel.ref("enemy")]);
  const outcome = runAbilityBody(expanded.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(createLayerEngine(kernel.objects, kernel.continuousEffects).evaluate(kernel.ref("enemy")).might, 2);
});

test("rad-063-167 Kai'Sa, Rebel: production trigger registration rejects the Disarm sameLocationAs filter", () => {
  // The merged KeywordDef is complete, but the *body* target filter still carries
  // sameLocationAs, which programs/filters.ts translateInstructionTargets refuses
  // while translating a trigger body, so the trigger cannot subscribe (831.1.d).
  const source = {
    ref: { id: "kaisa", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "Kai'Sa, Rebel",
    types: ["unit"],
    tags: ["Kai'Sa", "The Void", "Champion"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 5,
    energy: 5,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const registered = [];
  const engine = { pipeline: { registerTrigger: registration => registered.push(registration.id), unregisterTrigger: () => {} } };
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  assert.throws(
    () => binding.registerProgramTriggers(engine, source),
    error => error instanceof ProgramBindingError && error.code === "judge-required" && /Unsupported filter field sameLocationAs/.test(error.message)
  );
  assert.equal(registered.length, 0);

  // The event-side filter alone *is* translatable: it is the expanded body's
  // target anchor that blocks registration, not the attack-declared pattern.
  assert.deepEqual(
    translateTriggerFilter(
      { event: "attack-declared", filter: { source: "self" } },
      "kaisa",
      "attack-declared"
    ),
    { event: "attack-declared", object: { objectId: "kaisa" } }
  );
});

test("rad-063-167 Kai'Sa, Rebel: the showdown grant is a conditional chain-spell static, not this card's own [Reaction] (364.3 / 813.4)", () => {
  assert.equal(grantReaction.kind, "static");
  assert.equal(grantReaction.effect.kind, "continuous.grant-keyword");
  // 813.4.a: the granted keyword targets the controller's spells on the chain, not this unit.
  assert.deepEqual(grantReaction.effect.keyword, "reaction");
  assert.deepEqual(grantReaction.effect.filter, { type: "spell", controller: "controller", zone: "chain" });
  assert.equal(grantReaction.effect.appliesTo, undefined);
  // "While I'm in a showdown" is the condition (364.3), read from the source object.
  assert.deepEqual(grantReaction.condition, {
    kind: "expression",
    value: { kind: "object-property", object: "self", property: "in-showdown" }
  });
  assert.equal(
    program.abilities.some(ability => ability.kind === "keyword"),
    true,
    "the card declares its own keyword(s)"
  );
  assert.equal(
    program.abilities
      .filter(ability => ability.kind === "keyword")
      .some(ability => ability.keyword === "reaction"),
    false,
    "this unit does not itself have [Reaction]; only its controller's chain spells are granted it (813.4)"
  );
});

test("rad-063-167 Kai'Sa, Rebel: the authored in-showdown condition is fail-closed, so chain spells get no Reaction (364.3 / 813.4)", () => {
  // ObjectSnapshot has no in-showdown characteristic, so the feature expression
  // throws MissingInformation and the production static binding catches it as
  // false. A spell on the chain therefore receives no Reaction from this card.
  const base = world().player("A")
    .unit("kaisa", { controller: "A", owner: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .card("spell-in-chain", { controller: "A", owner: "A", types: ["spell"], zone: "chain" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: base.snapshot(), links: base.clone() }),
    restore: checkpoint => { base.restore(checkpoint.state); base.copyLinkedFrom(checkpoint.links); },
    objects: () => base.objects,
    perform: action => base.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(base, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  createEngineStaticBinder(engine).bindStatic(grantReaction, base.getObject("kaisa"));
  const entry = engine.layers.registry.list()[0];
  assert.equal(typeof entry.effect.effect.condition, "function");
  assert.equal(entry.effect.effect.condition(base.getObject("spell-in-chain")), false);
  assert.deepEqual(engine.layers.evaluate(base.ref("spell-in-chain")).keywords, []);
  // Sanity check the other half: without the unreadable condition the same
  // registered effect really does grant Reaction, so the gap is exactly the
  // missing characteristic, not the static → layers path.
  const unconditional = createLayerEngine([base.getObject("spell-in-chain")], [{
    effect: { ...entry.effect, effect: { ...entry.effect.effect, condition: undefined } },
    duration: { type: "permanent" }
  }]);
  assert.deepEqual(unconditional.evaluate(base.ref("spell-in-chain")).keywords, [{ id: "reaction", value: undefined }]);
});

test("rad-063-167 Kai'Sa, Rebel: production static binding grants Reaction to a chain spell when the condition is true", () => {
  // Isolate the known missing in-showdown characteristic with an always-true
  // condition. The production static -> layers path must then grant Reaction
  // directly to the chain spell (813.4 / 813.4.a).
  const base = world().player("A")
    .unit("kaisa", { controller: "A", owner: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .card("spell-in-chain", { controller: "A", owner: "A", types: ["spell"], zone: "chain" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: base.snapshot(), links: base.clone() }),
    restore: checkpoint => { base.restore(checkpoint.state); base.copyLinkedFrom(checkpoint.links); },
    objects: () => base.objects,
    perform: action => base.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(base, { source, controller, timingPoint }),
    testTrigger: () => true
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const handle = createEngineStaticBinder(engine).bindStatic({
    ...grantReaction,
    condition: { kind: "always" }
  }, base.getObject("kaisa"));

  assert.ok(handle);
  assert.equal(engine.layers.registry.list().length, 1);
  const entry = engine.layers.registry.list()[0];
  assert.deepEqual(entry.effect.filter, { type: "spell", controller: "A", zone: "chain" });
  assert.equal(entry.effect.effect.keyword, "reaction");
  assert.equal(typeof entry.effect.effect.condition, "function");
  assert.equal(entry.effect.effect.condition(base.getObject("spell-in-chain")), true);
  assert.deepEqual(engine.layers.evaluate(base.ref("spell-in-chain")).keywords, [
    { id: "reaction", value: undefined }
  ]);
  handle?.unbind();
  assert.equal(engine.layers.registry.list().length, 0);
});

test("rad-063-167 Kai'Sa, Rebel: effect.damage and effect.buff are distinct from Disarm's Might layer", () => {
  // Evidence that the *shape* is understood: effect.buff only places Buff counters (702),
  // it never lowers Might, so Disarm cannot be approximated with it.
  const kernel = world().unit("enemy-unit", { might: 2 }).build();
  const ref = kernel.ref("enemy-unit");
  const run = runInstruction(
    buff,
    // Primitive arg shapes: mode/target are evaluated strings, amount is an Expr.
    { mode: "buff", target: "enemy" },
    { world: kernel, targets: { enemy: [ref] } }
  );
  assert.equal(run.result.status, "executed");
  // A buff is a +1 Might counter; the Disarm penalty is a temporary, negative, duration-bound
  // Might change owned by layers/continuous.might (effect.buff's own documented boundary).
  assert.equal(kernel.getObject("enemy-unit").buffs, 1);
  assert.equal(kernel.getObject("enemy-unit").damage, 0);
});

test("rad-063-167 Kai'Sa, Rebel: effect.damage is unrelated to the negative-Might gap and stays available for the attack trigger", () => {
  // Pins that damage semantics are already merged, so the remaining Disarm gap is exactly the
  // Might modification plus its per-turn duration (831.1.d.1), not target selection.
  const kernel = world().unit("enemy-unit", { might: 2 }).build();
  const ref = kernel.ref("enemy-unit");
  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 1 }, target: "enemy" },
    { world: kernel, targets: { enemy: [ref] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").damage, 1);
});

test.todo(
  "rad-063-167 Kai'Sa, Rebel: [Disarm] attack trigger gives an enemy unit here -1 Might this " +
    "turn, merging several Disarm instances into one trigger with summed values (831.1.d / " +
    "831.1.d.1 / 831.2) — production trigger registration still rejects sameLocationAs and " +
    "attack-declared has no producer (combat-start-transaction); the merged KeywordDef, " +
    "continuous.might execution and the registration rejection are covered above"
);

test.todo(
  "rad-063-167 Kai'Sa, Rebel: while this unit is in a showdown, its controller's spells on " +
    "the chain gain [Reaction] (364.3 / 813.4 / 813.4.a) — ObjectSnapshot still lacks an " +
    "in-showdown characteristic, so the authored condition remains fail-closed; the static " +
    "grant path is exercised above with the condition isolated"
);

test.todo(
  "rad-063-167 Kai'Sa, Rebel: printing diff — rad-sp4-005 (same canonicalCardId) prints 4 Might " +
    "and omits the reminder text; docs/plans/survey/ability-templates.json records blockers " +
    "[non-reminder-printing-difference, printing-stat-type-or-tag-difference] — card-data task"
);
