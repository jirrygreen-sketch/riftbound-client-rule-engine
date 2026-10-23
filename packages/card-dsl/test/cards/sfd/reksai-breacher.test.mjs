// Golden test for Rek'Sai, Breacher (sfd-029-221).
//
// Execution evidence for the real base play/payment path lives in the RIFT-698
// parameterized template golden:
// test/cards/templates/keyword-keyword-static-698.test.mjs.
// The card keeps judge-required: the production static binder translates the
// grant through staticFilter, whose whitelist rejects the card's descriptive
// playedFromZoneNot key, the printed "played from anywhere other than a
// player's hand" has no play-origin predicate, and the Accelerate entry
// replacement/Assault attacker condition have no consumers. The grant itself is
// exercised for real through the merged continuous.grant-keyword primitive and
// the merged layer engine.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/reksai-breacher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { evaluateExtendedExpression } from "../../../../engine-core/dist/effects/interpreter/expr-ext/index.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-6eb6345b70c561ae3d2ed335eb50fdd0958d942af912aaceba44ad0038813815";

const [accelerate, assault, grant] = program.abilities;

const c = (value) => ({ kind: "constant", value });

/**
 * chain/engine.ts resolves the static controller/owner spellings before it
 * calls the production matcher: 'self' becomes the ability controller and
 * 'opponent' excludes that player's objects. The reference kernel compares
 * filter values literally, so the goldens go through the same normalization the
 * production chain applies (the merged siphon-power / switcheroo goldens use
 * this exact helper).
 */
const chainQuery = (kernel, controller) => (filter) => kernel.query({}).filter((object) => {
  for (const key of ["controller", "owner"]) {
    if (filter[key] === "opponent" && object[key] === controller) return false;
  }
  return matchesObjectFilter({
    ...filter,
    ...(filter.controller === "self" ? { controller } : {}),
    ...(filter.controller === "opponent" ? { controller: "any" } : {}),
    ...(filter.owner === "opponent" ? { owner: "any" } : {})
  }, object);
});

const productionContext = (kernel) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, target.source.controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

const layerAfter = (kernel) =>
  createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );

test("sfd-029-221 Rek'Sai, Breacher: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-029-221 Rek'Sai, Breacher: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
      "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
      "Friendly units played from anywhere other than a player's hand have [Accelerate]."
  );
});

test("sfd-029-221 Rek'Sai, Breacher: judgeReason names the current registration, predicate and cost gaps", () => {
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /staticFilter/);
  assert.match(program.judgeReason, /playedFromZoneNot/);
  assert.match(program.judgeReason, /createEngineStaticBinder/);
  assert.match(program.judgeReason, /accelerate\.cost has no layer mapping/);
  assert.match(program.judgeReason, /playedFromZoneNot/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /attacker 条件/);
  assert.match(program.judgeReason, /Unsupported static filter field playedFromZoneNot/);
  // RIFT-257/258/261 are merged; the reason names the concrete consumers that
  // are still missing instead of an in-progress cost batch.
  assert.doesNotMatch(program.judgeReason, /RIFT-91|conditionMatches|落到 true|RIFT-261 费用批次/);
  assert.doesNotMatch(program.judgeReason, /依赖：[^。]*RIFT-(257|258|261)/);
});

test("sfd-029-221 Rek'Sai, Breacher: [Accelerate] and [Assault] are declared without values", () => {
  assert.equal(program.abilities.length, 3);
  // 805.1.b: the printed cost is fixed at 1 energy + 1 power, so the keyword
  // carries no value; 807.1.b.3: an omitted Assault value presumes 1.
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault" });
  assert.equal(accelerate.value, undefined);
  assert.equal(assault.value, undefined);
});

test("sfd-029-221 Rek'Sai, Breacher: the third ability is a static Accelerate grant to non-hand-played units", () => {
  // 364.1 / 364.2: a statement-sentence passive ability, not a keyword
  // declaration; contract 3.7 gives keyword granting its own continuous shape.
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "accelerate");
  assert.deepEqual(grant.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    playedFromZoneNot: "hand"
  });
  assert.equal(grant.condition, undefined);
});

test("sfd-029-221 Rek'Sai, Breacher golden: the merged grant primitive really gives a matching friendly unit Accelerate", () => {
  const kernel = world()
    .unit("rekai", { owner: "A", controller: "A", might: 3 })
    .unit("friendly-poro", { owner: "A", controller: "A", might: 2, types: ["unit"], tags: ["Poro"] })
    .unit("enemy-poro", { owner: "B", controller: "B", might: 2, types: ["unit"], tags: ["Poro"] })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("rekai") });
  const bound = productionContext(context);

  // The executed filter uses only vocabulary the merged matcher understands
  // (the card's descriptive playedFromZoneNot key has no semantics, so the
  // golden exercises the grant against an explicit tag filter).
  // The grant instruction runs through the same production adapter the merged
  // program binding uses, over the chain-normalized query.
  const outcome = resolveChainBody(
    [{ id: "grant", op: "continuous.grant-keyword",
      args: { keyword: c("accelerate"), filter: { type: "unit", controller: "self", tags: ["Poro"] } } }],
    bound
  );

  assert.equal(outcome.status, "executed");
  assert.deepEqual(context.continuousEffects.map((entry) => entry.effect.filter.objectId), ["friendly-poro"]);
  assert.equal(context.continuousEffects[0].effect.layer, "ability");
  assert.equal(context.continuousEffects[0].effect.effect.keyword, "accelerate");
  const layers = layerAfter(context);
  // 478.1.a ability layer: only the matching friendly unit gains the keyword.
  assert.deepEqual(layers.evaluate(context.ref("friendly-poro")).keywords, [{ id: "accelerate" }]);
  assert.deepEqual(layers.evaluate(context.ref("rekai")).keywords, []);
  assert.deepEqual(layers.evaluate(context.ref("enemy-poro")).keywords, []);
});

test("sfd-029-221 Rek'Sai, Breacher: Assault's declared condition uses designation", () => {
  const definition = keywordDefinitionsById.get("Assault");
  assert.ok(definition, "the merged Assault KeywordDef must be registered");
  const [expansion] = definition.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  // Assault's expansion carries the value as an Expr (contract 3.2).
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 1 });
  // 807.1.b.3: the omitted value presumes Assault 1.
  assert.deepEqual(expansion.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });

  // The ordinary production binder still evaluates this direct synthetic
  // declaration through the base interpreter; the runtime-grant re-expander
  // uses the extended designation/combatRole alias, as the next test proves.
  const executable = {
    ...program,
    canonicalCardId: "card.synthetic-reksai-assault",
    status: "executable",
    judgeReason: undefined,
    abilities: [expansion],
    sourceText: "synthetic Assault"
  };
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const board = fixture({
    cards: [{ id: "rekai", cardId: executable.canonicalCardId, types: ["unit"], energy: 3, power: null, might: 3 }],
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(board.engine);
  board.engine.commit({
    type: "move-zone",
    object: board.kernel.ref("rekai"),
    to: "battlefield",
    location: { type: "battlefield", id: "bf-1" }
  });
  board.engine.layers.setObjects(board.kernel.objects);
  assert.equal(board.engine.layers.snapshot(board.kernel.ref("rekai")).might, 3);
});

test("sfd-029-221 Rek'Sai, Breacher: the merged keyword layer consumes Assault on an attacker", () => {
  // 807.1.c/.d.1: the merged re-expander aliases KeywordDef's designation to
  // ObjectSnapshot.combatRole and applies the attacker-only Might effect.
  const kernel = world()
    .unit("rekai", { owner: "A", controller: "A", might: 3, zone: "board", combatRole: "attacker" })
    .unit("defender", { owner: "B", controller: "B", might: 3, zone: "board", combatRole: "defender" })
    .build();
  const layers = new KeywordGrantLayerEngine(kernel.objects, {
    context: source => bindResolveContext(kernel, { source, controller: source.controller })
  });
  layers.addContinuous({
    id: "reksai.assault-grant",
    layer: "ability",
    source: kernel.ref("rekai"),
    filter: { objectId: "rekai", zone: "board" },
    effect: { kind: "continuous.grant-keyword", keyword: "Assault" }
  }, { type: "permanent" });
  assert.equal(layers.evaluate(kernel.ref("rekai")).might, 4);
  assert.deepEqual(layers.evaluate(kernel.ref("rekai")).keywords, [{ id: "Assault", value: 1 }]);
  assert.equal(layers.evaluate(kernel.ref("defender")).might, 3);
  assert.equal(evaluateExtendedExpression(
    { kind: "object-property", object: "self", property: "designation" },
    { context: kernel.clone({ sourceSnapshot: kernel.getObject("rekai") }), host: kernel.ref("rekai"), linked: () => undefined, canLookBack: () => true, isIgnored: () => false }
  ), "attacker");
});

test.todo(
  "sfd-029-221 Rek'Sai, Breacher: the card's static continuous.grant-keyword ability cannot pass the production " +
    "static binder — programs/statics.ts staticFilter rejects playedFromZoneNot with ProgramBindingError(" +
    "'judge-required', 'Unsupported static filter field playedFromZoneNot')"
);
test.todo(
  "sfd-029-221 Rek'Sai, Breacher: 'played from anywhere other than a player's hand' needs a play-origin zone " +
    "predicate; neither layers/filter.ts matchesObjectFilter nor the programs/statics.ts staticFilter whitelist " +
    "(type/controller/owner/zone/states/tags/characteristics) has an origin-zone-of-play match"
);
test.todo(
  "sfd-029-221 Rek'Sai, Breacher: [Accelerate] payment and enter-ready replacement end to end through the cost " +
    "pipeline and entry replacement (CR 805.1.b, 805.2.b, 805.6.a) — no consumer turns the keyword expansion's " +
    "accelerate.cost static declaration into CostPlanInput (createEngineStaticBinder throws " +
    "\"Static ability kind accelerate.cost has no layer mapping\")"
);

// Direct evidence for the first recorded gap: the production static binder
// (the default binder used by attachProgramLifecycle) translates the grant
// through staticFilter, whose whitelist rejects the card's playedFromZoneNot
// placeholder with a judge-required ProgramBindingError.
import { createEngineStaticBinder, staticCostSources } from "../../../../engine-core/dist/programs/statics.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";

test("sfd-029-221 Rek'Sai, Breacher: the production static binder rejects the grant's playedFromZoneNot placeholder", () => {
  const kernel = world()
    .unit("breacher", { might: 3, zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const layers = createLayerEngine(kernel.objects, []);
  const binder = createEngineStaticBinder({
    layers,
    pipeline: {
      host: {
        objects: () => kernel.objects,
        context: (snapshot, controller, timingPoint) =>
          kernel.clone({ sourceSnapshot: snapshot, source: snapshot.ref })
      }
    }
  });

  assert.throws(
    () => binder.bindStatic(grant, kernel.getObject("breacher")),
    (error) => {
      assert.ok(error instanceof ProgramBindingError);
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /Unsupported static filter field playedFromZoneNot/);
      return true;
    }
  );
});

test("sfd-029-221 Rek'Sai, Breacher: the production binder exposes the Accelerate declaration as a Finalize cost source", () => {
  // The static binder now registers accelerate.cost as a cost capability. The
  // selected optional component still remains unavailable until the play
  // adapter consumes this binding, so only the binding is claimed here.
  const { engine, kernel } = fixture({
    cards: [{ id: "breacher", cardId: CARD_ID, types: ["unit"], might: 3, keywords: [{ id: "Frenzy" }] }]
  });
  const binder = createEngineStaticBinder(engine);
  const [declaration] = keywordDefinitionsById.get("Accelerate").expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(declaration.kind, "static");
  assert.equal(declaration.effect.kind, "accelerate.cost");
  const handle = binder.bindStatic(declaration, kernel.getObject("breacher"));
  const [source] = staticCostSources(engine);
  assert.equal(source.ability.effect.kind, "cost.additional");
  assert.equal(source.ability.effect.optional, true);
  assert.deepEqual(source.ability.effect.payments, [
    { kind: "energy", amount: c(1) },
    { kind: "power", amount: c(1) }
  ]);
  // Inspect the optional play component without substituting an Accelerate
  // decision; the shipped program's play adapter remains the consumer gap.
  assert.throws(() => translateCost(declaration.effect.cost, "reksai-breacher.accelerate", "play"), /Additional costs require the program cost adapter/);
  const [replacement] = keywordDefinitionsById.get("Accelerate").expand({ host: { canonicalCardId: CARD_ID } }).slice(1);
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.with.map((instruction) => instruction.op), ["effect.ready"]);
  handle.unbind();
});

