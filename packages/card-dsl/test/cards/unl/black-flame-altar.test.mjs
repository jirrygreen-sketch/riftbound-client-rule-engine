// RIFT-668 partial execution / boundaries: ../templates/static-668.test.mjs.
// Published status stays judge-required; existing component coverage is retained below.
// RIFT-643: static|| execution evidence is consolidated in ../templates/static-643.test.mjs.
// This file retains the card's identity, status, sourceText, and key IR guards.

import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/black-flame-altar.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import grant from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56";
const SOURCE_TEXT =
  "Units here with [Temporary] have [Shield]. (+1 :rb_might: while they're defenders.)";

const [ability] = program.abilities;

test("unl-208-219 Black Flame Altar: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-208-219 Black Flame Altar: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /staticFilter/);
  assert.match(program.judgeReason, /Unsupported static filter field keywords/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /combatRole/);
  // Third-sweep refresh: the reason names the concrete missing production
  // wirings (keyword characteristic filter, default-layer location matching,
  // keyword-grant adapter integration, and Battlefield Board lifecycle).
  assert.match(program.judgeReason, /applyLayer/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.match(program.judgeReason, /object-enters-board/);
  assert.doesNotMatch(program.judgeReason, /不会重新进入关键词展开/);
  assert.doesNotMatch(program.judgeReason, /designation.*不存在/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-208-219 Black Flame Altar: one static ability-layer keyword grant scoped to units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.3: granting a keyword changes the abilities of the object in the
  // ability layer of the contract §3.4 order (copy → trait → ability →
  // arithmetic).
  assert.equal(ability.effect.kind, "continuous.grant-keyword");
  assert.equal(ability.effect.layer, "ability");
  // 814.1.b.3: printed [Shield] without a value is Shield 1; the expansion
  // (defender-gated +1 Might) lives in keywords/Shield.ts, not here.
  assert.deepEqual(ability.effect.keywords, [{ id: "Shield", value: 1 }]);

  // 053.3/199.1: "here" is this Battlefield; 816.3: "with [Temporary]" is a
  // keyword-characteristic gate. Static binding translates the location anchor;
  // keyword filtering and value-based LocationRef matching remain incomplete.
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self",
    keywords: ["Temporary"]
  });
});

test("Black Flame Altar: the real grant instruction registers Shield 1 in the ability layer", () => {
  // The grant primitive is executable here. The printed static gate remains
  // blocked in the production binder; the specialized Shield expansion is
  // covered by the adapter scenario below.
  const kernel = world()
    .unit("temporary-unit", { keywords: [{ id: "Temporary" }], might: 3 })
    .unit("other-unit", { might: 3 })
    .build();
  const run = runInstruction(grant, {
    target: "grant-recipient", keywords: { kind: "constant", value: ability.effect.keywords }
  }, { world: kernel, targets: { "grant-recipient": [kernel.ref("temporary-unit")] } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.deepEqual(layers.evaluate(kernel.ref("temporary-unit")).keywords.map(keyword => [keyword.id, keyword.value]), [
    ["Temporary", undefined], ["Shield", 1]
  ]);
  assert.deepEqual(layers.evaluate(kernel.ref("other-unit")).keywords, []);
});

test("unl-208-219 Black Flame Altar: the Temporary KeywordDef is merged and keeps this card's gate meaningful", () => {
  // CR 816.1/816.3: the merged effects/keywords/Temporary.ts definition means
  // "with [Temporary]" is now a real registry characteristic; what remains is
  // the production filter predicate and adapter integration.
  const temporary = keywordDefinitionsById.get("Temporary");
  assert.ok(temporary, "effects/keywords/Temporary.ts must be registered");
  assert.equal(temporary.valued, false);
  assert.equal(temporary.stacking, "single");
  const [expanded] = temporary.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "beginning-start");
});

test("unl-208-219 Black Flame Altar: the production static binder still rejects the Temporary keyword gate (CR 053.3/816.3)", () => {
  // Evidence for gap (1): the authored filter needs a keyword predicate. The
  // merged binder rejects the whole declaration instead of narrowing the set,
  // and dropping the gate would grant Shield to every unit here.
  const f = fixture({ cards: [
    { id: "altar", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null, zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("altar"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  assert.throws(() => createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("altar")),
    /Unsupported static filter field keywords/);
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("unl-208-219 Black Flame Altar: the resolved here-scope does not match even a unit in the same battlefield (CR 053.3/199.1)", () => {
  // Evidence for gap (2): dropping the keyword gate would not widen the grant to
  // "every unit here" either. The binder resolves sameLocationAs:self to a
  // structured LocationRef, and the layer application path compares structured
  // location values by reference while only falling back to the location *type*
  // string, so an object's own location object never satisfies it.
  const scoped = {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keywords: [{ id: "Shield", value: 1 }],
      layer: "ability",
      filter: { type: "unit", zone: "board", sameLocationAs: "self" }
    }
  };
  const f = fixture({ cards: [
    { id: "altar", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null, zone: "board", location: { type: "battlefield", id: "bf-1" } },
    { id: "here-unit", types: ["unit"], might: 3, zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("altar"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("here-unit"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  createEngineStaticBinder(f.engine).bindStatic(scoped, f.kernel.getObject("altar"));

  const entry = f.engine.layers.registry.list()[0];
  // The binder really did resolve the anchor to the altar's own battlefield.
  assert.deepEqual(entry.effect.filter.location, { type: "battlefield", id: "bf-1" });

  f.engine.layers.setObjects(f.kernel.objects);
  const unit = f.kernel.getObject("here-unit");
  assert.deepEqual(f.engine.layers.evaluate(unit.ref).keywords, [],
    "a matching structured location must be compared by value before this grant can apply");
});

test("unl-208-219 Black Flame Altar: the granted Shield's defender clause is still fail-closed (CR 814.1.c/814.1.d)", () => {
  // The default production binder still uses the base expression evaluator.
  // The merged KeywordGrantLayerEngine has a separate designation → combatRole
  // adapter; the positive adapter path is covered below.
  const f = fixture({ cards: [
    { id: "altar", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null, zone: "board", location: { type: "battlefield", id: "bf-1" } },
    { id: "shielded", types: ["unit"], might: 3, keywords: [{ id: "Shield", value: 1 }], zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("altar"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("shielded"), to: "board", location: { type: "battlefield", id: "bf-1" } });

  const shield = keywordDefinitionsById.get("Shield");
  assert.ok(shield, "effects/keywords/Shield.ts must be registered");
  const [expansion] = shield.expand({ host: { canonicalCardId: CANONICAL }, value: 1 });
  // Shield keeps the contract spelling "designation"; the specialized keyword
  // layer maps it from ObjectSnapshot.combatRole when that adapter is installed.
  assert.deepEqual(expansion.condition.left, {
    kind: "object-property", object: "self", property: "designation"
  });
  const binder = createEngineStaticBinder(f.engine);
  binder.bindStatic(expansion, f.kernel.getObject("shielded"));

  const shielded = f.kernel.getObject("shielded");
  // 3.8: the actual combat identity is combatRole; there is no own designation
  // field for the default binder's base evaluator to read.
  assert.equal(shielded.combatRole, null);
  assert.equal(Object.hasOwn(shielded, "designation"), false);
  assert.equal(f.engine.layers.evaluate(shielded.ref).might, 3,
    "the defender bonus must not be claimed while designation is unreadable");
});

test("unl-208-219 Black Flame Altar: the merged keyword layer re-expands granted Shield for a defender (CR 814.1.c/814.1.d)", () => {
  // The merged keyword adapter is executable even though the card's production
  // filter and Battlefield lifecycle are still blocked.
  const kernel = world()
    .unit("shielded-defender", { might: 3, combatRole: "defender" })
    .unit("plain-unit", { might: 3 })
    .build();
  const run = runInstruction(grant, {
    target: "grant-recipient",
    keywords: { kind: "constant", value: ability.effect.keywords }
  }, { world: kernel, targets: { "grant-recipient": [kernel.ref("shielded-defender")] } });
  assert.equal(run.result.status, "executed");

  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => bindResolveContext(kernel, { source, controller: source.controller })
  });
  for (const entry of kernel.continuousEffects) layers.addContinuous(entry.effect, entry.duration);

  const defender = layers.evaluate(kernel.ref("shielded-defender"));
  assert.deepEqual(defender.keywords.map(keyword => [keyword.id, keyword.value]), [["Shield", 1]]);
  assert.equal(defender.might, 4);
  assert.equal(layers.keywordAbilities(kernel.ref("shielded-defender"))[0].effect.kind, "continuous.might");
  assert.equal(layers.evaluate(kernel.ref("plain-unit")).might, 3);
});

test("unl-208-219 Black Flame Altar: production binds only on object-enters-board, which a Chain-zone Battlefield never emits", () => {
  // Third-sweep evidence for gap (4): game/lifecycle.ts creates Battlefields as
  // Chain-zone tokens, so the merged lifecycle never reaches this card's
  // static binding at all.
  const f = fixture({ cards: [
    { id: "altar", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null, controller: "A" }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("altar"), to: "chain" });
  const source = f.kernel.getObject("altar");
  assert.equal(source.zone, "chain");
  const binding = createProgramBinding({ cardPrograms: [program] });
  const lifecycle = binding.attachLifecycle(f.engine);
  assert.deepEqual(f.engine.layers.registry.list(), []);
  // Binding the declaration directly from the Chain fails even earlier than the
  // keyword gate: a Chain-zone source has no location for sameLocationAs:self.
  assert.throws(() => createEngineStaticBinder(f.engine).bindStatic(ability, source),
    /sameLocationAs source has no location/);
  lifecycle.detach();
});

test.todo("black-flame-altar: bind the Temporary keyword gate to the here-scoped unit set in the production path (CR 053.3/816.3; needs a keyword filter field, default-layer value-based structured location matching, KeywordGrantLayerEngine integration, and Battlefield Board lifecycle)");
