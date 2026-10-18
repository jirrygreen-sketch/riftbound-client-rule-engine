// RIFT-697 execution evidence: ../templates/keyword-static-697.test.mjs runs the card's
// exported abilities through the generic scenario harness and keeps the documented
// clauses judge-required.
// RIFT-672 execution evidence: ../templates/keyword-static-672.test.mjs (supported paths only).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/serene-ascetic.js";
import { buildCostPlan, CostPlanError } from "../../../../engine-core/dist/cost/index.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import empowerKeyword from "../../../../engine-core/dist/effects/keywords/Empower.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
// The production static binder installs card static abilities into
// the merged layer engine; the chain fixture provides that engine.
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createTargetTaxAdapter } from "../../../../engine-core/dist/target/tax/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-e5195b063794caf45ca0ef55353be70e2a69d150511f33bccf7dfe8ae729254b";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)";

const [empower, granted] = program.abilities;

test("ven-030-166 Serene Ascetic: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-030-166 Serene Ascetic: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /持续授予关键词/);
  // The static binder is merged; the remaining execution gap is the
  // Deflect target-tax consumer and the Empowered gate predicate.
  assert.match(program.judgeReason, /bindStatic/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /designation/);
  // Refreshed 2026-10-18: the reason now names the merged re-expansion layer and
  // the production consumers that are still missing.
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /TurnCombatBlockedError/);
  // Deleted stale assertions (2026-10-18 re-sweep): the previous reason cited
  // the merged RIFT-672 / RIFT-697 template tasks. Those templates stay the
  // execution evidence, but no task-number citation belongs in the reason.
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  // Deleted stale assertion (2026-10-18 re-sweep): "授予后的关键词不会随图层变化重新展开"
  // is no longer true now that programs/keyword-grants.ts re-expands grants; the
  // refreshed reason states the remaining wiring gap instead.
  assert.doesNotMatch(program.judgeReason, /不会随图层变化重新展开/);
});

test("ven-030-166 Serene Ascetic: the 3 Energy Empower cost is not a numeric keyword value", () => {
  // 827.1.c.1: Empower takes a CostSpec, not a numeric keyword value.
  // KeywordAbility cannot carry it yet; the source text and judgeReason retain it.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.params, undefined);
});

test("ven-030-166 Serene Ascetic: the [Empowered][>] dependent ability grants Deflect 1 and Shield 3 to self", () => {
  // 828.1.b.1: the whole clause after [Empowered][>] is a Dependent Ability, active
  // while the host is Empowered; the card only declares the grant, the keyword
  // expansions stay in Deflect.ts / Shield.ts (809.1.b.3 presumes 1, 814.1.b.3
  // keeps the printed Shield Value 3).
  assert.equal(granted.kind, "static");
  assert.deepEqual(granted.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [
      { id: "deflect", value: 1 },
      { id: "shield", value: 3 }
    ]
  });
  // 442.1.a / 828.1.c: the 828.1.b.1 gate reads the source's live Empowered count.
  assert.deepEqual(granted.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("ven-030-166 Serene Ascetic: the granted keywords expand with the printed values", () => {
  // 809.1.c / 814.1.c: the merged KeywordDefs turn each granted keyword into the
  // static target-tax / might shape; this is what the card relies on instead of
  // writing a per-card implementation.
  const [deflectGrant] = granted.effect.keywords;
  const [deflectAbility] = deflect.expand({ value: deflectGrant.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(deflectAbility.kind, "static");
  assert.equal(deflectAbility.effect.kind, "target.tax");
  assert.deepEqual(deflectAbility.effect.value, { kind: "constant", value: 1 });

  const shieldGrant = granted.effect.keywords[1];
  const [shieldAbility] = shield.expand({ value: shieldGrant.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(shieldAbility.effect.kind, "continuous.might");
  assert.deepEqual(shieldAbility.effect.amount, { kind: "constant", value: 3 });
  assert.equal(shieldAbility.condition.left.property, "designation");
  assert.deepEqual(shieldAbility.condition.right, { kind: "constant", value: "defender" });
});

test("ven-030-166 Serene Ascetic golden: the production static binder installs Deflect 1 and Shield 3 on the host", () => {
  // The Empowered gate itself is not executable (gap 2), so this golden runs
  // the grant effect the dependent ability declares — proving the merged
  // layer path, not the printed gating.
  const f = fixture({ cards: [{ id: "serene-ascetic", types: ["unit"] }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("serene-ascetic"),
    to: "base",
    location: { type: "base", player: "A" }
  });
  const source = f.kernel.getObject("serene-ascetic");
  const binder = createEngineStaticBinder(f.engine);

  const handle = binder.bindStatic({ kind: "static", effect: granted.effect }, source);
  const withGrant = f.engine.layers.snapshot(f.kernel.ref("serene-ascetic"));
  assert.deepEqual(withGrant && withGrant.keywords, [
    { id: "deflect", value: 1 },
    { id: "shield", value: 3 }
  ]);

  handle.unbind();
  const afterUnbind = f.engine.layers.snapshot(f.kernel.ref("serene-ascetic"));
  assert.deepEqual(afterUnbind && afterUnbind.keywords, []);
});

test.todo(
  "ven-030-166 Serene Ascetic: pass the printed 3 Energy Empower cost through KeywordAbility/programs/keywords.ts " +
    "params.cost; the registered Empower KeywordDef already supplies the not-Empowered restriction"
);

test.todo(
  "ven-030-166 Serene Ascetic: evaluate the 828.1.b.1 Empowered gate (442.1.a / 442.2) — the IR uses " +
    "self.empowered >= 1, but production ObjectSnapshot does not expose the live empowered count"
);

test.todo(
  "ven-030-166 Serene Ascetic: the merged KeywordGrantLayerEngine re-expansion has no production consumer — " +
    "turn/flow.ts builds TurnPhaseLayers and apps/game-server never constructs the grant layer, and " +
    "programs/statics.ts still has no target.tax layer mapping"
);

test("ven-030-166 golden: the merged grant layer re-expands the Empowered [Deflect]/[Shield 3] grant (no production consumer)", () => {
  // 828.1.b.1 + 809.1.c / 814.1.c (2026-10-18 re-sweep): the merged
  // programs/keyword-grants.ts layer re-expands a granted keyword through its
  // KeywordDef once the host really becomes Empowered, so Shield 3 reaches the
  // arithmetic layer as +3 Might and Deflect 1 becomes a target.tax the merged
  // cost layer can price as any-Domain Power. This is the reference-layer
  // evidence; the production path is still the todo above.
  const base = world().player("A", { energy: 20 }).player("B", { energy: 20, power: ["Calm"] })
    .unit("ascetic", {
      cardId: CANONICAL_ID, might: 3, combatRole: "defender", location: { type: "battlefield", id: "bf-1" }
    })
    .unit("victim", { owner: "B", might: 30, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const layers = new KeywordGrantLayerEngine(base.objects, {
    context: source => bindResolveContext(base, { source, controller: source.controller })
  });
  const host = createActionPipelineHost({
    checkpoint: () => base.snapshot(), restore: state => base.restore(state),
    objects: () => base.objects, perform: action => base.perform(action),
    choose: request => base.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(base, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ host, layers, turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", cleanup: () => false });
  const source = base.getObject("ascetic");
  createEngineStaticBinder(engine).bindStatic(granted, source);

  // 442.1.a: not Empowered yet, so the dependent ability is inactive.
  assert.deepEqual(layers.snapshot(source.ref).keywords, []);
  assert.equal(layers.snapshot(source.ref).might, 3, "printed Might only while not Empowered");

  assert.equal(engine.commit({ type: "empower", object: source.ref }).status, "done");
  layers.setObjects(base.objects);
  const active = layers.snapshot(source.ref);
  assert.deepEqual(active.keywords, [{ id: "Deflect", value: 1 }, { id: "Shield", value: 3 }]);
  assert.deepEqual(
    layers.keywordAbilities(source.ref).map(ability => ability.effect.kind),
    ["target.tax", "continuous.might"]
  );
  // 814.1.c: Shield 3 is a defender-gated +3 Might, so 3 + 3 = 6.
  assert.equal(active.might, 6);

  // 809.1.c.1: the re-expanded Deflect 1 prices as one Power of any Domain.
  const context = bindResolveContext(base, {
    source: base.getObject("victim"), controller: "B",
    object: ref => layers.snapshot(ref),
    query: filter => layers.evaluateAll().filter(object => matchesObjectFilter(filter, object))
  });
  const adapter = createTargetTaxAdapter(context,
    { id: "cost:opponent-ability", cost: { energy: { kind: "constant", value: 0 }, power: { kind: "constant", value: [] } } },
    { kind: "ability" });
  adapter.finalizeTargetPlan(
    { id: "ascetic", filter: { objectId: "ascetic", zone: "board" } },
    { selected: [base.ref("ascetic")] }
  );
  assert.deepEqual(adapter.costPlan.total.power, [{
    amount: 1,
    allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
  }]);

  // 814.1.d.1: the same Empowered grant contributes nothing without the Defender
  // designation, so the +3 is gated on combat role rather than on Empower alone.
  const attacking = grantFixture(null);
  assert.equal(attacking.engine.commit({ type: "empower", object: attacking.source.ref }).status, "done");
  attacking.layers.setObjects(attacking.base.objects);
  assert.equal(attacking.layers.snapshot(attacking.source.ref).might, 3, "Shield 3 needs the Defender designation");
  assert.deepEqual(attacking.layers.snapshot(attacking.source.ref).keywords, [{ id: "Deflect", value: 1 }, { id: "Shield", value: 3 }]);

  assert.equal(engine.commit({ type: "disempower", object: source.ref }).status, "done");
  layers.setObjects(base.objects);
  assert.deepEqual(layers.snapshot(source.ref).keywords, []);
  assert.equal(layers.snapshot(source.ref).might, 3);
});

/** The same world with one real Empower/Disempower-capable grant layer. */
function grantFixture(combatRole) {
  const base = world().player("A", { energy: 20 }).player("B", { energy: 20, power: ["Calm"] })
    .unit("ascetic", {
      cardId: CANONICAL_ID, might: 3, combatRole, location: { type: "battlefield", id: "bf-1" }
    })
    .unit("victim", { owner: "B", might: 30, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const layers = new KeywordGrantLayerEngine(base.objects, {
    context: source => bindResolveContext(base, { source, controller: source.controller })
  });
  const host = createActionPipelineHost({
    checkpoint: () => base.snapshot(), restore: state => base.restore(state),
    objects: () => base.objects, perform: action => base.perform(action),
    choose: request => base.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(base, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ host, layers, turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", cleanup: () => false });
  const source = base.getObject("ascetic");
  createEngineStaticBinder(engine).bindStatic(granted, source);
  return { base, layers, engine, source };
}

test("ven-030-166 Serene Ascetic gap: the printed 3 Energy Empower cost is not carried by the keyword", () => {
  // Measured evidence for judgeReason point 1: the registered KeywordDef
  // produces the not-Empowered restriction and resolution body, but the
  // printed CostSpec never reaches it, so the plan is judged unsupported rather
  // than being charged 3 Energy (827.1.c.1).
  const [expanded] = empowerKeyword.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expanded.kind, "activated");
  assert.deepEqual(expanded.cost, { kind: "empower" });
  assert.deepEqual(expanded.restriction.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "eq",
    right: { kind: "constant", value: 0 }
  });

  const kernel = world().unit("host", { cardId: CANONICAL_ID, might: 3 }).build();
  assert.throws(
    () => buildCostPlan(kernel, { id: "cost:empower", cost: expanded.cost }),
    error => error instanceof CostPlanError && error.reason === "judge-required" && /Unsupported cost kind: empower/.test(error.message)
  );
});

test("ven-030-166 Serene Ascetic gap: the granted Deflect cannot become a target tax in production", () => {
  // Measured evidence for judgeReason point 3: Deflect expands to a target.tax
  // static ability, and the production binder has no layer mapping for it —
  // so no Deflect tax can ever be attached to an opponent's target Finalize.
  const [deflectAbility] = deflect.expand({ value: 1, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(deflectAbility.effect.kind, "target.tax");
  const f = fixture({ cards: [{ id: "serene-ascetic", cardId: CANONICAL_ID, types: ["unit"] }] });
  const source = f.kernel.getObject("serene-ascetic");
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(deflectAbility, source),
    error => error.code === "judge-required" && /target\.tax has no layer mapping/.test(error.message)
  );
});

test("ven-030-166 Serene Ascetic gap: the Shield expansion reads a designation no snapshot publishes", () => {
  // Measured evidence for judgeReason point 3: 814.1.d gates Shield on the
  // defender designation, but the merged expression evaluator has no such
  // characteristic on a contract-shaped snapshot, so the +3 Might cannot be
  // evaluated even though the grant itself installs.
  const [shieldAbility] = shield.expand({ value: 3, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(shieldAbility.condition.left, {
    kind: "object-property",
    object: "self",
    property: "designation"
  });
  const kernel = world().unit("host", { cardId: CANONICAL_ID, might: 3 }).build();
  const source = kernel.getObject("host");
  assert.equal(Object.hasOwn(source, "designation"), false);
  assert.throws(
    () => evaluateExpression(shieldAbility.condition.left, {
      context: kernel,
      host: source.ref,
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false
    }),
    error => /Unavailable characteristic: designation/.test(error.message)
  );
});
