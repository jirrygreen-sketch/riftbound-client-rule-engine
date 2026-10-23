// Execution evidence for this card lives in ../templates/keyword-static-671.test.mjs (README 4.1); this
// card stays judge-required for the gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/tianna-crownguard.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";

const CARD_ID = "card.hash-d4d3c7fbd236daf76867733cea0af3151a9d91e178cb072e3bbb88c4391fef22";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "While I'm at a battlefield, opponents can't score points.";

const [deflectAbility, restriction] = program.abilities;

test("sfd-060-221 Tianna Crownguard: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-060-221 Tianna Crownguard: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /470/);
  assert.match(program.judgeReason, /restrictions\(\)/);
  assert.match(program.judgeReason, /at a battlefield/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /任意域 Power/);
  // 2026-10-18 re-sweep: all three gaps are named with their measured errors,
  // and the merged restriction registry must not be presented as missing.
  assert.match(program.judgeReason, /Unsupported static appliesTo/);
  assert.match(program.judgeReason, /relative-player query/);
  assert.match(program.judgeReason, /Unavailable characteristic: at-battlefield/);
  assert.match(program.judgeReason, /target\.tax has no layer mapping/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-060-221 Tianna Crownguard: [Deflect] keyword plus a conditionally active anti-score restriction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflectAbility, { kind: "keyword", keyword: "deflect" });

  assert.equal(restriction.kind, "static");
  assert.equal(restriction.effect.kind, "continuous.restrict");
  // 470/470.1: this forbids the Scoring process (471.1/471.2), it does not undo
  // points already gained and is not a damage/prevention effect.
  assert.equal(restriction.effect.operation, "score");
  assert.equal(restriction.effect.forbidden, true);
  assert.equal(restriction.effect.appliesTo, "opponents");
  // 363.2.a: the continuous effect applies only while its condition holds —
  // "While I'm at a battlefield".
  assert.equal(restriction.condition.kind, "expression");
  assert.deepEqual(restriction.condition.value, {
    kind: "object-property",
    object: "self",
    property: "at-battlefield"
  });
});

test("sfd-060-221 Tianna Crownguard: the Deflect keyword definition is merged and stacks by sum (809.2)", () => {
  assert.equal(deflect.keyword, "Deflect");
  assert.equal(deflect.stacking, "sum");
  const [tax] = deflect.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(tax.kind, "static");
  assert.equal(tax.effect.kind, "target.tax");
  // 809.1.b.3: the omitted Deflect value is presumed 1.
  assert.deepEqual(tax.effect.value, { kind: "constant", value: 1 });
});

test("sfd-060-221 Tianna Crownguard: the merged continuous.restrict primitive really registers the prohibition", () => {
  // The merged primitive writes the restriction into the layer registry;
  // production scoring still needs to consume that registry entry.
  const kernel = world().unit("tianna", { might: 4 }).build();
  const run = runInstruction(restrict, {
    mode: { kind: "constant", value: "prohibit" },
    action: { kind: "constant", value: "score" },
    appliesTo: { kind: "constant", value: { type: "unit" } }
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].effect.effect, {
    kind: "restriction",
    actions: ["score"],
    sourcePlayer: "A"
  });
});

test("sfd-060-221 Tianna Crownguard: the query side reads the registered prohibition, but the scoring flow never asks", () => {
  // restrictions() 能返回 score 禁止项（查询侧已存在）；缺口是没有任何生产方调用它。
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "tianna:restrict",
    layer: "ability",
    source: { id: "tianna", zoneEntryId: 1 },
    filter: { type: "unit" },
    effect: { kind: "restriction", actions: ["score"] }
  }, { type: "permanent" });
  const source = world().unit("tianna", { might: 4 }).build();
  assert.deepEqual(
    restrictions(registry, "score", source.ref("tianna"), source.getObject("tianna")).map((entry) => entry.actions),
    [["score"]]
  );
  assert.deepEqual(restrictions(registry, "move"), []);
});

test.todo(
  "sfd-060-221 Tianna Crownguard: 'opponents can't score points' needs a scoring-side consumer of the registered " +
    "restrictions and the 363.2.a 'at-battlefield' condition predicate from ObjectSnapshot."
);

test.todo(
  "sfd-060-221 Tianna Crownguard: [Deflect]'s target tax must be collected when an opponent chooses this unit " +
    "and paid as any-domain Power (809.1.c.1) instead of the Energy-shaped tax the chain builds today."
);

// Live evidence for all three refreshed gaps: the shipped static cannot bind,
// no bindable spelling reaches the opponent, the 363.2.a condition has no
// evaluator, and the merged [Deflect] expansion is itself unbindable.
function tiannaBindingWorld() {
  const kernel = world().player("A").player("B")
    .unit("tianna", { cardId: CARD_ID, might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 2 })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: () => { throw new Error("the static binding evidence must not require a choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  return { kernel, engine, binder: createEngineStaticBinder(engine) };
}

test("sfd-060-221 Tianna Crownguard: the shipped static binds as an opponent-targeted scoring restriction", () => {
  const { kernel, engine, binder } = tiannaBindingWorld();
  const source = kernel.getObject("tianna");
  const handle = binder.bindStatic(restriction, source);
  const registration = engine.layers.registry.list()[0];
  assert.ok(registration);
  assert.equal(registration.effect.effect.appliesTo, "opponents");
  assert.equal(registration.effect.effect.operation, "score");
  assert.equal(registration.effect.effect.forbidden, true);
  handle.unbind();
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("sfd-060-221 Tianna Crownguard: the 363.2.a 'at a battlefield' condition has no evaluator", () => {
  const { kernel } = tiannaBindingWorld();
  const source = kernel.getObject("tianna");
  // The card's own condition is an ObjectSnapshot property read, and the merged
  // snapshot has no such derived predicate even though the unit really is at a
  // battlefield.
  assert.deepEqual(source.location, { type: "battlefield", id: "bf-1" });
  assert.throws(
    () => evaluateCondition(restriction.condition, {
      context: bindResolveContext(kernel, { source, controller: "A" }),
      host: source.ref,
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false
    }),
    /Unavailable characteristic: at-battlefield/
  );
});

test("sfd-060-221 Tianna Crownguard: the merged [Deflect] expansion binds as a target tax", () => {
  const { kernel, engine, binder } = tiannaBindingWorld();
  const tax = deflect.expand({ value: undefined, host: { canonicalCardId: CARD_ID } })[0];
  const handle = binder.bindStatic(tax, kernel.getObject("tianna"));
  const [registration] = engine.layers.registry.list();
  assert.equal(registration.effect.effect.capabilityKind, "target-tax");
  assert.equal(registration.effect.effect.ability.effect.kind, "target.tax");
  handle.unbind();
  assert.deepEqual(engine.layers.registry.list(), []);
});
