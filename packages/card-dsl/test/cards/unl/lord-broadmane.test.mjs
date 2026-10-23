import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lord-broadmane.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding, createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

// Execution evidence for the supported card-played/grant body:
// templates/keyword-triggered-card-played-continuous-704.test.mjs.

const CANONICAL_ID =
  "card.hash-7fca30537894dafdae14a16780cb746b71b61799934fb26663599e56c55fe2bd";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play me, give your other units here [Assault] this turn. " +
  "(+1 :rb_might: while they're attackers.)";

const [keyword, triggered] = program.abilities;
const [grantAssault] = triggered.body;
const grantedFilter = grantAssault.args.objects.value.filter;

/** Mirrors chain/engine.ts's normalization of the static controller spellings. */
function chainQuery(kernel, controller) {
  return value => {
    const normalized = { ...value };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = controller;
    }
    return kernel.listObjects().filter(object => {
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

test("unl-012-219 Lord Broadmane: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-012-219 Lord Broadmane: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822\.1\.b/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  // Ambush's KeywordDef and the generic timing query are merged now, so the
  // reason names the remaining conditional location/binder mismatch.
  assert.match(program.judgeReason, /play-location-permission|appliesTo/);
  assert.doesNotMatch(program.judgeReason, /canAct\(\).*不读取|没有读取 layers\/rules\/query\.ts/);
  assert.match(program.judgeReason, /designation/);
  // Re-checked against the merged sources: both Ambush declarations are
  // rejected by the production static binder, and the granted Assault fails
  // closed instead of degenerating into a permanent +1.
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /Unsupported static appliesTo/);
  assert.match(program.judgeReason, /evaluateCondition/);
  assert.doesNotMatch(program.judgeReason, /未识别时按 true|常驻 \+1\.|实测无指定也会 \+2/);
});

test("unl-012-219 Lord Broadmane: Ambush keyword plus a self play trigger", () => {
  assert.equal(program.abilities.length, 2);
  // 822.1 / 822.1.a: Ambush is a Passive Ability keyword, normally on Units, and
  // 822 has no numeric form.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "ambush" });
  assert.equal(keyword.value, undefined);

  // 383.4.a / 383.4.a.1: "When you play me…" is a Play Effect for this card.
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.optional, false);
});

test("unl-012-219 Lord Broadmane: the registered trigger host binding resolves the self anchor", () => {
  // programs/filters.ts normalises {source: "self"} to the host object filter
  // and programs/triggers.ts registers the subscription, so the Play Effect
  // half has a production path.
  const translated = translateInstructionTargets(triggered.body);
  assert.equal(translated.length, 1);
  assert.deepEqual(translated[0].args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        zone: "board",
        type: "unit",
        controller: "self",
        exclude: "self",
        sameLocationAs: "self"
      }
    }
  });
});

test("unl-012-219 Lord Broadmane: the granted Assault lasts this turn and exempts the source itself", () => {
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["lord-broadmane.grant-assault"]);
  // 801.3.a: another effect may grant a Keyword; 801.3.a.2: the granting effect
  // states the duration, printed here as "this turn".
  assert.equal(grantAssault.op, "continuous.grant-keyword");
  assert.deepEqual(grantAssault.args.keyword, { kind: "constant", value: "assault" });
  assert.deepEqual(grantAssault.args.duration, { kind: "constant", value: "end-of-turn" });
  // 807.1.b.3: the reminder's "+1" is the granted Assault's default value, so the
  // grant itself carries no value and is not invented here.
  assert.equal(grantAssault.args.value, undefined);
  assert.equal(grantAssault.targets, undefined, "355.10.d: the set is programmatic, so it is not a TargetSpec");
  assert.equal(grantAssault.picks, undefined, "355.10.d: not a pick either");
  assert.equal(grantAssault.linkedTo, undefined);
});

test("unl-012-219 Lord Broadmane: 'your other units here' is a same-location set excluding the source", () => {
  assert.deepEqual(grantedFilter, {
    zone: "board",
    type: "unit",
    controller: "self",
    exclude: "self",
    sameLocationAs: "self"
  });
  // README section 3: object anchors are symbolic selectors, never runtime refs.
  assert.equal(grantedFilter.sameLocationAs, "self");
  assert.equal(grantedFilter.exclude, "self");

  const kernel = world()
    .unit("broadmane", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly-here", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly-elsewhere", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-2" } })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const matched = queryObjects(grantedFilter, {
    context: kernel,
    host: kernel.ref("broadmane"),
    query: chainQuery(kernel, "A"),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  }).map(object => object.ref.id);
  // "other" excludes the source (355.9.c); "here" keeps only the same location
  // (053.3); "your" excludes the opposing unit (740.1.a).
  assert.deepEqual(matched, ["friendly-here"]);
});

test("unl-012-219 Lord Broadmane: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-012-219 Lord Broadmane golden: the merged grant registers on exactly the other friendly units here", () => {
  const kernel = world()
    .unit("broadmane", { owner: "A", controller: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly-here", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("friendly-elsewhere", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "bf-2" } })
    .unit("enemy-here", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  // The card's filter uses the "self" controller placeholder; the production
  // chain normalises it to the ability controller (the same helper the
  // siphon-power golden uses), and the reference kernel applies the anchor
  // semantics of effects/interpreter/selectors.ts.
  const ctx = new Proxy(kernel.clone({ sourceSnapshot: kernel.getObject("broadmane"), controller: "A" }), {
    get(target, key) {
      if (key === "query") return chainQuery(target, "A");
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  const outcome = resolveChainBody(translateInstructionTargets(triggered.body), ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["lord-broadmane.grant-assault", "executed"]
  ]);
  // One ability-layer registration per affected unit: only the other friendly
  // unit at the host's battlefield ("other" excludes the source, "here" keeps
  // the same location, "your" excludes the enemy unit).
  assert.deepEqual(ctx.continuousEffects.map(entry => entry.effect.filter.objectId), ["friendly-here"]);
  assert.deepEqual(ctx.continuousEffects.map(entry => entry.effect.layer), ["ability"]);
  // layers/ops buildKeywordGrantSpec writes the grant plus its non-promotion
  // guard; the keyword and the ability layer are the parts that matter here.
  assert.deepEqual(
    ctx.continuousEffects.map(entry => [entry.effect.effect.kind, entry.effect.effect.keyword]),
    [["continuous.grant-keyword", "assault"]]
  );
  assert.deepEqual(ctx.continuousEffects.map(entry => entry.duration), [{ type: "end-of-turn" }]);

  // The layers engine really applies the granted keyword (478.1.a ability
  // layer), so the granting half is executable behaviour, not a data shape.
  const engine = createLayerEngine(kernel.objects, ctx.continuousEffects.map(entry => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: 1
  })));
  const keywordIds = (id) => engine.evaluate(kernel.ref(id)).keywords.map(keyword => keyword.id);
  assert.deepEqual(keywordIds("friendly-here"), ["assault"]);
  assert.deepEqual(keywordIds("friendly-elsewhere"), []);
  assert.deepEqual(keywordIds("enemy-here"), []);
  assert.deepEqual(keywordIds("broadmane"), []);
});

test("unl-012-219 Lord Broadmane: the granted Assault's expansion is the attacker-gated Might modifier (807.1.c)", async () => {
  // The grant is the card's own instruction; what the granted keyword means is
  // Assault's expansion, so the golden pins that the granted keyword expands to
  // the attacker-gated +1 (rather than being restated in the card).
  const { default: assault } = await import("../../../../engine-core/dist/effects/keywords/Assault.js");
  const [expansion] = assault.expand({ value: 1, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 1 });
  assert.equal(expansion.effect.layer, "arithmetic");
  assert.deepEqual(expansion.condition.left, {
    kind: "object-property",
    object: "self",
    property: "designation"
  });
  assert.equal(expansion.condition.operator, "eq");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "attacker" });
});

test("unl-012-219 Lord Broadmane: Ambush expansion preserves both static permission declarations", () => {
  const ambush = keywordDefinitionsById.get("Ambush");
  assert.ok(ambush, "keywords/Ambush.ts must be registered");
  const expansion = ambush.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansion.map(ability => ability.effect.kind), ["play-location-permission", "continuous.timing"]);
  assert.equal(expansion[0].effect.kind, "play-location-permission");
  assert.equal(expansion[1].effect.kind, "continuous.timing");
  assert.deepEqual(expansion[1].effect.grants, ["showdown", "closed-state"]);
});

test("unl-012-219 Lord Broadmane: both Ambush declarations bind through production (CR 822.1.b)", () => {
  // The KeywordDef is merged, but neither declaration reaches the layers: the
  // play-location-permission kind has no layerFor mapping, and the conditional
  // timing declaration's appliesTo spelling is unsupported.
  const ambush = keywordDefinitionsById.get("Ambush");
  const expansion = ambush.expand({ host: { canonicalCardId: CANONICAL_ID } });
  const f = fixture({
    cards: [{ id: "broadmane", cardId: CANONICAL_ID, types: ["unit"], energy: 5, power: ["Fury"], might: 5 }]
  });
  const source = { ...f.kernel.getObject("broadmane"), cardId: CANONICAL_ID, zone: "board" };
  const binder = createEngineStaticBinder(f.engine);
  const location = binder.bindStatic(expansion[0], source);
  const timing = binder.bindStatic(expansion[1], source);
  assert.deepEqual(f.engine.layers.registry.list().map(entry => entry.effect.effect.kind), [
    "location",
    "continuous.timing"
  ]);
  timing.unbind();
  location.unbind();
});

test("unl-012-219 Lord Broadmane: the granted Assault fails closed for a declared attacker (CR 807.1.c/807.1.d.1)", () => {
  // A declared Attacker with the granted Assault keeps its printed Might, so the
  // grant is real data but not yet executable semantics.
  const f = fixture({
    cards: [{ id: "ally", cardId: CANONICAL_ID, types: ["unit"], energy: 1, power: [], might: 3 }]
  });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("ally"),
    to: "board",
    location: { type: "battlefield", id: "bf-1" }
  });
  const source = { ...f.kernel.getObject("ally"), combatRole: "attacker" };
  f.engine.layers.setObjects([source]);
  const binder = createEngineStaticBinder(f.engine);
  const keywordHandle = binder.bindStatic({
    kind: "static",
    effect: { kind: "continuous.grant-keyword", keyword: "assault" }
  }, source);
  const [assaultExpansion] = keywordDefinitionsById.get("Assault").expand({
    value: 1,
    host: { canonicalCardId: CANONICAL_ID }
  });
  const mightHandle = binder.bindStatic(assaultExpansion, source);
  const evaluated = f.engine.layers.evaluate(source.ref);
  assert.deepEqual(evaluated.keywords, [{ id: "assault", value: undefined }]);
  assert.equal(evaluated.might, 3);
  mightHandle.unbind();
  keywordHandle.unbind();
});

test.todo(
  "unl-012-219 Lord Broadmane: play [Ambush] from the real play flow (CR 822.1.b/.c) — the KeywordDef and generic " +
    "timing query are merged, but Finalize does not consume play-location-permission and static binding cannot bind " +
    "the conditional appliesTo: [card] / location timing scope"
);

test.todo(
  "unl-012-219 Lord Broadmane: apply the granted Assault as +1 Might while the unit is an attacker (CR 807.1.c/807.1.d) — " +
    "Assault's compare against the \"designation\" characteristic cannot be evaluated (ObjectSnapshot exposes combatRole, " +
    "layers/engine.ts treats an unknown compare condition as true)"
);
