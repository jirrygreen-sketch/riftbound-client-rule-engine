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

test("sfd-029-221 Rek'Sai, Breacher: judgeReason names the current registration, predicate and condition gaps", () => {
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /staticFilter/);
  assert.match(program.judgeReason, /playedFromZoneNot/);
  assert.match(program.judgeReason, /createEngineStaticBinder/);
  assert.match(program.judgeReason, /accelerate\.cost has no layer mapping/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /evaluateCondition/);
  assert.match(program.judgeReason, /Might.*3/);
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
  assert.deepEqual(layers.evaluate(context.ref("friendly-poro")).keywords, [{ id: "accelerate", value: undefined }]);
  assert.deepEqual(layers.evaluate(context.ref("rekai")).keywords, []);
  assert.deepEqual(layers.evaluate(context.ref("enemy-poro")).keywords, []);
});

test("sfd-029-221 Rek'Sai, Breacher: [Assault] uses designation while the object contract exposes combatRole", () => {
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

  // The production static binder evaluates the compare condition through the
  // base interpreter (effects/interpreter/condition.ts -> expr.ts), which has no
  // "designation" property: the missing characteristic throws MissingInformation
  // and the binder's catch-all treats it as false, so printed Might 3 stays 3.
  // The extended evaluator that maps designation to combatRole
  // (effects/interpreter/expr-ext/evaluate.ts) is not on that path. Measured
  // below with a real attacker designation.
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

test("sfd-029-221 Rek'Sai, Breacher: a real attacker designation still does not reach the Assault Might", () => {
  // 807.1.c/.d.1: Assault 2 must read the attacker designation. The reference
  // kernel really carries it, and the extended evaluator really reads it — but
  // the production static binder resolves the condition through the BASE
  // interpreter, so the merged path still yields printed Might 3. Both halves are
  // measured here so the remaining gap is unambiguous.
  // createEngineStaticBinder, createLayerEngine and evaluateExtendedExpression
  // are imported at the top of this file.
  const kernel = world()
    .unit("rekai", { owner: "A", controller: "A", might: 3, zone: "board", combatRole: "attacker" })
    .unit("defender", { owner: "B", controller: "B", might: 3, zone: "board", combatRole: "defender" })
    .build();
  const source = kernel.getObject("rekai");
  const [expansion] = keywordDefinitionsById.get("Assault").expand({ value: undefined, host: { canonicalCardId: CARD_ID } });

  // The extended evaluator does map designation onto combatRole.
  const extendedEnvironment = {
    context: kernel.clone({ sourceSnapshot: source }), host: source.ref,
    linked: () => undefined, canLookBack: () => true, isIgnored: () => false
  };
  assert.equal(evaluateExtendedExpression(expansion.condition.left, extendedEnvironment), "attacker");

  // The production static binder does not use it: the attacker keeps Might 3.
  for (const id of ["rekai", "defender"]) {
    const layers = createLayerEngine(kernel.objects, []);
    const binder = createEngineStaticBinder({
      layers,
      pipeline: { host: { objects: () => kernel.objects, context: (snapshot) => kernel.clone({ sourceSnapshot: snapshot }) } }
    });
    binder.bindStatic({ kind: "static", effect: expansion.effect, condition: expansion.condition }, kernel.getObject(id));
    layers.setObjects(kernel.objects);
    assert.equal(layers.evaluate(kernel.ref(id)).might, 3, `${id} must stay at the printed Might`);
    // The layer registration exists; only the condition never becomes true.
    const [entry] = layers.registry.list();
    assert.equal(entry.effect.layer, "arithmetic");
    assert.equal(entry.effect.effect.kind, "continuous.might");
  }

  // Without the condition the same expansion really does add 2 Might, which
  // proves the arithmetic path itself is merged.
  const unconditional = createLayerEngine(kernel.objects, []);
  createEngineStaticBinder({
    layers: unconditional,
    pipeline: { host: { objects: () => kernel.objects, context: (snapshot) => kernel.clone({ sourceSnapshot: snapshot }) } }
  }).bindStatic({ kind: "static", effect: { ...expansion.effect, amount: { kind: "constant", value: 2 } } }, source);
  unconditional.setObjects(kernel.objects);
  assert.equal(unconditional.evaluate(source.ref).might, 5);
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
test.todo(
  "sfd-029-221 Rek'Sai, Breacher: [Assault] needs its compare(object-property(self, designation)) condition aligned " +
    "with the ObjectSnapshot combatRole characteristic (or a designation producer); the production static binder " +
    "evaluates the condition and fails closed when designation is absent, so the unit remains at Might 3 - upstream contract alignment"
);

// Direct evidence for the first recorded gap: the production static binder
// (the default binder used by attachProgramLifecycle) translates the grant
// through staticFilter, whose whitelist rejects the card's playedFromZoneNot
// placeholder with a judge-required ProgramBindingError.
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
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

test("sfd-029-221 Rek'Sai, Breacher: no consumer turns the Accelerate expansion into CostPlanInput", () => {
  // Evidence for the [Accelerate] cost gap: the merged keyword expansion
  // declares accelerate.cost, but the production static binder has no layer
  // mapping for that effect kind and the play-cost translator rejects the
  // authored additional-cost shape instead of approximating the charge.
  const kernel = world()
    .unit("breacher", { might: 3, zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const binder = createEngineStaticBinder({
    layers: createLayerEngine(kernel.objects, []),
    pipeline: {
      host: {
        objects: () => kernel.objects,
        context: (snapshot) => kernel.clone({ sourceSnapshot: snapshot, source: snapshot.ref })
      }
    }
  });
  const [declaration] = keywordDefinitionsById.get("Accelerate").expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(declaration.kind, "static");
  assert.equal(declaration.effect.kind, "accelerate.cost");
  assert.throws(
    () => binder.bindStatic(declaration, kernel.getObject("breacher")),
    /Static ability kind accelerate\.cost has no layer mapping/
  );
  assert.throws(
    () => translateCost(declaration.effect.cost, "reksai-breacher.accelerate", "play"),
    /Unsupported play cost field optional/
  );
  // 805.6.a: the merged entry replacement really readies the paid unit when the
  // cost decision is supplied by a caller (the missing piece is the binding from
  // the keyword declaration).
  const [replacement] = keywordDefinitionsById.get("Accelerate").expand({ host: { canonicalCardId: CARD_ID } }).slice(1);
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.with.map((instruction) => instruction.op), ["effect.ready"]);
});

