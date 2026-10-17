// Scenario execution evidence: ../templates/static-replacement-effect-ready-663.test.mjs (XP and entry dependencies remain blocked).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/wuju-master.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-8b7f21bf0986b17b411aeaaeffd500931ea02096c94389c90265a214f7707ab4";
const SOURCE_TEXT =
  "[Level 6][>] Your units have +1 :rb_might:. (While you have 6+ XP, get the effect.)\n" +
  "[Level 11][>] Your units enter ready.";

const [levelSix, levelEleven] = program.abilities;
const enterReady = levelEleven.with[0];

test("unl-191-219 Wuju Master: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-191-219 Wuju Master: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /XP/);
  assert.match(program.judgeReason, /continuous\.might/);
  // Re-sweep: RIFT-260's replacement binding is merged, so the reason now names
  // the remaining per-object entry window instead of "no consumer".
  assert.match(program.judgeReason, /RIFT-260/);
});

test("unl-191-219 Wuju Master: [Level 6][>] is a static +1 Might layer scoped to your units", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(levelSix.kind, "static");
  // 824.1.b.1: functionally "while you have 6+ XP, this card gains '[Text]'".
  assert.equal(levelSix.effect.kind, "continuous.might");
  assert.equal(levelSix.effect.mode, "add");
  assert.equal(levelSix.effect.layer, "arithmetic");
  assert.deepEqual(levelSix.effect.amount, { kind: "constant", value: 1 });
  // "Your units": battlefield units controlled by the ability's controller.
  assert.deepEqual(levelSix.effect.filter, {
    zone: "board",
    type: "unit",
    controller: "controller"
  });
  // The XP gate: 824.1.c / 824.1.d; retained shape only (see judgeReason).
  assert.equal(levelSix.condition.kind, "result");
  assert.equal(levelSix.condition.operator, "gte");
  assert.deepEqual(levelSix.condition.right, { kind: "constant", value: 6 });
  assert.equal(levelSix.condition.result, "wuju-master.controller-xp");
});

test("unl-191-219 Wuju Master: [Level 11][>] is an enter-ready replacement gated on 11 XP", () => {
  assert.equal(levelEleven.kind, "replacement");
  // 143.4 / 359.2.c: units enter exhausted; this replaces that with ready entry
  // (as opposed to Accelerate 805.6, which is the same replacement shape).
  assert.deepEqual(levelEleven.replaces, {
    event: "object-enters-board",
    filter: { controller: "self", type: "unit", exhausted: true }
  });
  assert.equal(levelEleven.condition.kind, "result");
  assert.equal(levelEleven.condition.operator, "gte");
  assert.deepEqual(levelEleven.condition.right, { kind: "constant", value: 11 });
  assert.equal(levelEleven.condition.result, "wuju-master.controller-xp");
  assert.equal(levelEleven.with.length, 1);
  assert.equal(enterReady.id, "wuju-master.enter-ready");
  assert.equal(enterReady.op, "effect.ready");
  assert.deepEqual(enterReady.args.objects, {
    kind: "constant",
    value: { linked: "replacement.object" }
  });
});

test("unl-191-219 Wuju Master: missing live XP results cannot be replaced with an object count", () => {
  const kernel = world().player("A", { xp: 0 })
    .unit("master", { types: ["legend"], controller: "A" })
    .unit("one").unit("two").unit("three").unit("four").unit("five").unit("six")
    .build();
  const context = bindResolveContext(kernel, { source: kernel.getObject("master"), controller: "A" });
  for (const ability of [levelSix, levelEleven]) {
    assert.throws(() => evaluateCondition(ability.condition, {
      context,
      host: kernel.ref("master"),
      linked: key => kernel.linked(key),
      canLookBack: () => true,
      isIgnored: () => false
    }), /Unavailable condition result: wuju-master\.controller-xp/);
  }
  assert.equal(kernel.player("A").xp, 0);
});

test("unl-191-219 Wuju Master golden: the declared +1 Might really applies to your units only", () => {
  // RIFT-258's continuous.might consumes the declared scope through the
  // production filter translation (programs/filters.ts) and the arithmetic layer
  // applies +1 Might to the controller's units only.
  const base = world()
    .unit("master", { types: ["legend"], owner: "A", controller: "A", might: null })
    .unit("ally", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 3 })
    .build();
  const translated = translateObjectFilter(levelSix.effect.filter);
  assert.deepEqual(translated, { zone: "board", type: "unit", controller: "self" });

  const chainQuery = (filter) => base.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "self" ? "A" : value])),
    object
  ));
  const kernel = bindResolveContext(base, { source: base.getObject("master"), controller: "A", query: chainQuery });
  const outcome = runAbilityBody([{
    id: "wuju-master.plus-1",
    op: "continuous.might",
    args: {
      amount: levelSix.effect.amount,
      mode: { kind: "constant", value: levelSix.effect.mode },
      filter: { kind: "constant", value: translated }
    }
  }], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["wuju-master.plus-1.affected.objects"], [base.ref("ally")]);
  const layers = createLayerEngine(base.objects, base.continuousEffects);
  assert.equal(layers.evaluate(base.ref("ally")).might, 4);
  assert.equal(layers.evaluate(base.ref("enemy")).might, 3);
  // "Your units" never includes the Legend itself, so its characteristics stay
  // exactly as the kernel built them.
  assert.equal(
    layers.evaluate(base.ref("master")).might,
    base.getObject("master").might
  );
});

test("unl-191-219 Wuju Master: the entry binder blocks the correct entering-unit selector", () => {
  // The old accepted body readied the Legend source. That binding assertion
  // depended on the incorrect target and cannot prove “Your units enter ready”.
  const kernel = world().unit("master", { types: ["legend"], controller: "A" }).build();
  const pipeline = new EventPipeline(createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: checkpoint => kernel.restore(checkpoint),
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    context: () => kernel
  }), ["A", "B"], "A");
  assert.throws(() => bindReplacement(levelEleven, kernel.ref("master"), {
    host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
    pipeline
  }), /Unsupported entry body target value/);
});

test.todo(
  "unl-191-219 Wuju Master: make 'Your units enter ready' apply to friendly units — RIFT-260's entry " +
    "declaration only supports the source orientation (CR 369.3 / 143.4)"
);
test.todo(
  "unl-191-219 Wuju Master: evaluate ability.condition (the 11+ XP gate) on the entry-declaration path — " +
    "replacement/bind.ts matchesEnterAction does not call testCondition, so the declared gate is not honoured (CR 824.1.c)"
);

test.todo(
  "unl-191-219 Wuju Master: bind the [Level N][>] dependent abilities with dynamic Active/Inactive " +
    "re-evaluation (CR 824.1.b.1 / 824.1.c.1 / 824.1.d) — keywords/Level.ts publishes only the " +
    "condition.predicate declaration and no compiler attaches it to this card's dependent text (RIFT-268 follow-up)"
);
