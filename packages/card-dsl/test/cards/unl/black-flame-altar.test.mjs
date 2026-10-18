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
  assert.match(program.judgeReason, /combatRole/);
  // Third-sweep refresh: the reason names the concrete missing wirings (keyword
  // characteristic filter, layer location matching, granted-keyword
  // re-expansion, defender identity condition) plus the Battlefield Board
  // lifecycle, instead of the merged task references.
  assert.match(program.judgeReason, /applyLayer/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.doesNotMatch(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /object-enters-board/);
  assert.match(program.judgeReason, /不会重新进入关键词展开/);
  // The reason now names where the reference comparison really sits: the binder
  // resolves sameLocationAs to source.location, and the *layer application*
  // path compares that structured value by reference.
  assert.doesNotMatch(program.judgeReason, /按引用比较/);
  assert.match(program.judgeReason, /走引用比较/);
  assert.match(program.judgeReason, /layers\/engine\.ts 的 applyLayer/);
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
  // Only the grant is executable here. The printed static gate and subsequent
  // Shield expansion remain distinct unresolved parts of the card.
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
  // CR 816.1/816.3: RIFT-265 merged effects/keywords/Temporary.ts, so
  // "with [Temporary]" is now a real registry characteristic; what is missing is
  // the filter predicate and the dynamically granted keyword expansion.
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
  // Evidence for gap (2): Shield expands to a static continuous.might gated on
  // the "designation" characteristic. The merged ObjectSnapshot exposes
  // combatRole instead, so the condition can never match and the +1 Might stays
  // inactive even for an actual defender.
  const f = fixture({ cards: [
    { id: "altar", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null, zone: "board", location: { type: "battlefield", id: "bf-1" } },
    { id: "shielded", types: ["unit"], might: 3, keywords: [{ id: "Shield", value: 1 }], zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("altar"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("shielded"), to: "board", location: { type: "battlefield", id: "bf-1" } });

  const shield = keywordDefinitionsById.get("Shield");
  assert.ok(shield, "effects/keywords/Shield.ts must be registered");
  const [expansion] = shield.expand({ host: { canonicalCardId: CANONICAL }, value: 1 });
  // The expansion reads a designation the contract never exposes.
  assert.deepEqual(expansion.condition.left, {
    kind: "object-property", object: "self", property: "designation"
  });
  const binder = createEngineStaticBinder(f.engine);
  binder.bindStatic(expansion, f.kernel.getObject("shielded"));

  const shielded = f.kernel.getObject("shielded");
  // 3.8: the actual combat identity is combatRole; there is no designation field.
  assert.equal(shielded.combatRole, null);
  assert.equal(Object.hasOwn(shielded, "designation"), false);
  assert.equal(f.engine.layers.evaluate(shielded.ref).might, 3,
    "the defender bonus must not be claimed while designation is unreadable");
});

test("unl-208-219 Black Flame Altar: a layer-granted Shield lands on the snapshot but never becomes a Might modifier (CR 814.1.c/814.1.d)", () => {
  // Third-sweep evidence for gap (3): the grant really writes Shield 1 into the
  // recipient's layered keywords, but nothing re-expands that granted keyword
  // into its static continuous.might, so the defender clause never contributes.
  const f = fixture({ cards: [
    { id: "altar", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null, zone: "board", controller: "A", location: { type: "battlefield", id: "bf-1" } },
    { id: "shielded-defender", types: ["unit"], might: 3, combatRole: "defender", controller: "A", zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  for (const id of ["altar", "shielded-defender"]) {
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "board", location: { type: "battlefield", id: "bf-1" } });
  }
  const grant = {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keywords: [{ id: "Shield", value: 1 }],
      layer: "ability",
      filter: { objectId: "shielded-defender", zone: "board" }
    }
  };
  const handle = createEngineStaticBinder(f.engine).bindStatic(grant, f.kernel.getObject("altar"));
  f.engine.layers.setObjects(f.kernel.objects);
  const layered = f.engine.layers.evaluate(f.kernel.ref("shielded-defender"));
  // The grant itself worked: Shield 1 is on the layered characteristic list.
  assert.deepEqual(layered.keywords.map(keyword => [keyword.id, keyword.value]), [["Shield", 1]]);
  // 814.1.c would add +1 while defending, but no expansion is registered, so
  // the arithmetic result stays at the printed Might.
  assert.equal(f.engine.layers.registry.list().length, 1);
  assert.equal(layered.might, 3);
  // And the Shield KeywordDef's own condition still reads a characteristic the
  // contract never exposes, so even a direct binding cannot contribute.
  const [expansion] = keywordDefinitionsById.get("Shield").expand({ host: { canonicalCardId: CANONICAL }, value: 1 });
  const direct = createEngineStaticBinder(f.engine).bindStatic(expansion, f.kernel.getObject("shielded-defender"));
  const [directEntry] = f.engine.layers.registry.list().slice(-1);
  assert.equal(directEntry.effect.filter.objectId, "shielded-defender");
  assert.equal(directEntry.effect.effect.condition(f.kernel.getObject("shielded-defender")), false);
  handle.unbind();
  direct.unbind();
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

test.todo("black-flame-altar: bind the Temporary keyword gate to the here-scoped unit set (CR 053.3/816.3; needs a keyword filter field and value-based structured location matching in the layer path)");

test.todo("black-flame-altar: expand dynamically granted Shield and bind its defender designation to combatRole (CR 814.1.c/814.1.d; needs granted-keyword re-expansion and a combatRole-based defender condition)");
