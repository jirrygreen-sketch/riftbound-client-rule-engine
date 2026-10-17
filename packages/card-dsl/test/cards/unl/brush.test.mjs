import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/brush.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

/** Minimal engine so the production static binder can be exercised directly. */
function binderFor(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: (request) => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  return { binder: createEngineStaticBinder(engine), engine };
}

const CANONICAL_ID =
  "card.hash-8624ca0fcb3cd60db66cadac14c3f88e0dc422d1061843d35d39845b60616015";
const SOURCE_TEXT =
  "Bird, Cat, Dog, Poro, and Ivern units here have +1 :rb_might:.\n" +
  "When you score here, you may replace this with the battlefield it replaced.";

const [might, scoreAbility] = program.abilities;
const [optIn] = scoreAbility.body;
const [swapBack] = optIn.args.body.value;

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
    might: 2,
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

/** The ContinuousEffectSpec the card declares: layer + filter + the arithmetic effect. */
function spec(source) {
  return {
    id: "brush",
    layer: might.effect.layer,
    // This Battlefield token is the ability's source; the 053.3 "here" anchor in
    // the declared filter resolves against it once that anchor is implemented.
    source,
    filter: might.effect.filter,
    effect: might.effect
  };
}

test("unl-t03 Brush: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-t03 Brush: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /133\.8/);
  assert.match(program.judgeReason, /tagsAnyOf/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /439\.7/);
  assert.match(program.judgeReason, /here/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(91|257|270)/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-t03 Brush: one static arithmetic +1 Might for the five tagged units here", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(might.kind, "static");
  assert.equal(might.condition, undefined);

  // 479.4 / 479.4.e.1: +1 Might is an arithmetic-layer addition.
  assert.equal(might.effect.kind, "continuous.might");
  assert.equal(might.effect.mode, "add");
  assert.equal(might.effect.layer, "arithmetic");
  assert.deepEqual(might.effect.amount, { kind: "constant", value: 1 });

  // 133.8 / 187.8: Bird, Cat, Dog, Poro, Ivern — a set of units carrying ANY of
  // those tags (the merged tags key means ALL of them, so the set semantics are
  // recorded with the descriptive tagsAnyOf key, see judgeReason), at this
  // Battlefield (053.3).
  assert.deepEqual(might.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self",
    tagsAnyOf: ["Bird", "Cat", "Dog", "Poro", "Ivern"]
  });
  assert.equal(might.effect.filter.tags, undefined);
});

test("unl-t03 Brush: the merged arithmetic layer really applies the declared +1 Might", () => {
  // The layer engine consumes the declared continuous.might effect when a caller
  // registers it (the registration path itself is the judged part). The Might 2
  // unit goes to 3 through the real arithmetic sublayer (479.4).
  const battlefield = unit("brush", {
    name: "Brush",
    cardId: program.canonicalCardId,
    types: ["battlefield"],
    tags: ["Token"],
    isToken: true
  });
  const here = unit("poro-here", { tags: ["Poro"] });
  const engine = createLayerEngine([battlefield, here], [
    { effect: spec(battlefield.ref), duration: { type: "permanent" }, timestamp: 1 }
  ]);
  assert.equal(engine.evaluate(here.ref).might, 3);
});

test("unl-t03 Brush golden: the binding expands the declared keyword-free program and exposes its statics", () => {
  // The production binding reads this CardProgram. The static Might ability keeps its declared arithmetic-layer
  // shape, and the layer engine above proves that shape is executable — the
  // remaining card-specific blocker is the tagsAnyOf filter semantics.
  const executable = {
    canonicalCardId: program.canonicalCardId,
    rulesetVersion: program.rulesetVersion,
    status: "executable",
    abilities: program.abilities,
    sourceText: program.sourceText
  };
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const battlefield = unit("brush", {
    name: "Brush",
    cardId: program.canonicalCardId,
    types: ["battlefield"],
    tags: ["Token"],
    isToken: true
  });
  const inspected = binding.inspect(battlefield);
  assert.equal(inspected.program.canonicalCardId, program.canonicalCardId);
  assert.deepEqual(
    inspected.abilities.map((ability) => ability.kind),
    ["static", "triggered"]
  );
  const [staticAbility] = inspected.abilities;
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.layer, "arithmetic");
  assert.deepEqual(staticAbility.effect.amount, { kind: "constant", value: 1 });
});

test("unl-t03 Brush: score trigger with the optional swap-back wrapped in the choice body", () => {
  // 470.1/470.3/471/473.2 with 383.4: a Score trigger at this Battlefield; "you"
  // is the Battlefield's controller (190.6.d).
  assert.equal(scoreAbility.kind, "triggered");
  assert.equal(scoreAbility.trigger.at, "score");
  assert.deepEqual(scoreAbility.trigger.filter, {
    event: "score",
    here: true,
    player: "controller"
  });
  assert.equal(scoreAbility.trigger.condition, undefined);
  assert.equal(scoreAbility.trigger.once, undefined);
  // "you may": contract 3.9 wraps the chosen instruction inside the body.
  assert.equal(scoreAbility.optional, true);
  assert.equal(scoreAbility.body.length, 1);
  assert.equal(optIn.id, "brush.swap-back-opt");
  assert.equal(optIn.op, "choice.optional");
  assert.deepEqual(optIn.args.body.value.map(instruction => instruction.id), ["brush.swap-back"]);
  assert.equal(optIn.linkedTo, undefined);

  // 439.3 / 439.7: the Replace (swap-back) action is not in the closed GameAction
  // set, and "the battlefield it replaced" is the replaced card stored by the
  // Replace action — contract 3.6 has no selector for that record.
  assert.equal(swapBack.op, "effect.replace");
  assert.deepEqual(swapBack.args.mode, { kind: "constant", value: "swap-back" });
  assert.deepEqual(swapBack.args.object, { kind: "constant", value: "self" });
  assert.deepEqual(swapBack.args.with, {
    kind: "constant",
    value: "the-battlefield-this-replaced"
  });
  assert.equal(swapBack.targets, undefined);
  assert.equal(swapBack.picks, undefined);
  assert.equal(swapBack.linkedTo, undefined);
});

test("unl-t03 Brush: declining the may-clause performs no replacement", () => {
  const kernel = world().build();
  kernel.setAnswers({ "brush.swap-back-opt/optional": false });
  const outcome = runAbilityBody(scoreAbility.body, kernel);
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [["brush.swap-back-opt", "negated", "skipped"]]
  );
  assert.deepEqual(kernel.events, []);
});

test("unl-t03 Brush: the production static binder rejects the declared OR-tag filter (133.8)", () => {
  // The merged filter vocabulary has only `tags`, which requires every listed tag;
  // the printed set is an OR over five tags. The production static binder rejects
  // the descriptive tagsAnyOf key before any layer can be registered. Dropping the
  // key would silently widen the effect to every unit at this Battlefield.
  const kernel = world()
    .object("brush", {
      cardId: CANONICAL_ID, owner: "A", controller: "A", types: ["battlefield"],
      zone: "board", location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const source = kernel.getObject("brush");
  const { binder, engine } = binderFor(kernel);
  assert.throws(
    () => binder.bindStatic(might, source),
    /Unsupported static filter field tagsAnyOf/
  );
  // With the unsupported key removed the same declaration does bind, which shows
  // the refusal is the tag-set semantics and not the arithmetic layer.
  const { tagsAnyOf, ...filter } = might.effect.filter;
  binder.bindStatic({ ...might, effect: { ...might.effect, filter: { ...filter, tags: ["Poro"] } } }, source);
  assert.equal(engine.layers.registry.list().length, 1);
});

test("unl-t03 Brush: the score filter with here: true is refused by the trigger translator (383.4 / 053.3)", () => {
  assert.throws(
    () => translateTriggerFilter(scoreAbility.trigger.filter, "brush", "score"),
    /Unsupported filter field here/
  );
  // The score production event carries no source battlefield object, so even a
  // translated subscription could not bind to this Battlefield.
  assert.equal(matchesTriggerEvent(
    { event: "score", object: { objectId: "brush" } },
    { timingPoint: "score", kind: "score", player: "A", details: { battlefieldId: "bf-1" } },
    "A"
  ), false);
});

test.todo(
  "unl-t03 Brush: add an any-of tag-set predicate for Unit filters (133.8: Bird, Cat, Dog, Poro, " +
    "Ivern) — the merged `tags` key requires every listed tag, so the printed OR-set cannot be stated"
);

test.todo(
  "unl-t03 Brush: implement the Replace / Swap-Back action (439.3, 439.5, 439.7, 439.7.b, 439.7.c) " +
    "so scoring may return the replaced battlefield card from Banishment into the token's space with " +
    "its current effects and statuses, and the token ceases to exist"
);

test.todo(
  "unl-t03 Brush: read the battlefield this token replaced (the Replace action's stored reference) " +
    "from IR — contract 3.6 offers only self/source/target/pick/linked"
);
