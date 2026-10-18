// Golden test for Brutal Hunter (ven-070-166).
//
// Execution evidence (the real printed 3 Energy + 1 Body Power payment, the
// Empowered-gated +2 Might and Ganking grant with its Disempower boundary and
// the blocked printed [Empower] activation) lives in the RIFT-673 parameterized
// template golden: test/cards/templates/keyword-static-static-673.test.mjs.
// Original behavior and structure assertions remain in this file; the
// template adds execution evidence without replacing these checks.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/brutal-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3f9f5a7cd793affe45d17580dab715f09ada17e0f10121517e9abce676d36e2b";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [empower, mightBonus, gankingGrant] = program.abilities;

/** The real Chain + layers engine the production static binder needs. */
function engineFor(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  return new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
}

test("ven-070-166 Brutal Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-070-166 Brutal Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The current gaps: the printed Empower cost cannot reach expand (contract
  // 3.8.3 production side) and the cost pipeline has no empower payment kind.
  assert.match(program.judgeReason, /827\.1\.c/);
  assert.match(program.judgeReason, /3\.8\.3/);
  assert.match(program.judgeReason, /Unsupported cost kind empower|Unsupported payment kind/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine|attachProgramLifecycle/);
  // The stale "no Empower/Empowered KeywordDef" and "no status predicate"
  // claims are gone: RIFT-593 merged both.
  assert.ok(!/没有 Empower \/ Empowered 的 KeywordDef/.test(program.judgeReason));
  assert.ok(!/没有 Empowered 状态谓词/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-070-166 Brutal Hunter: [Empower] is declared as a keyword ability", () => {
  // Keep the keyword declaration check while recording the printed 3 Energy.
  // value is a review-only record; it cannot carry params.cost into expansion.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 3 });
  assert.equal(empower.value, 3);
  assert.equal(empower.params, undefined);
  // 827.1.c.1 的印刷费用仍无法传入已有展开，不伪造启动能力。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-070-166 Brutal Hunter: 'I have +2 :rb_might:' is a gated arithmetic layer effect", () => {
  assert.equal(mightBonus.kind, "static");
  assert.equal(mightBonus.effect.kind, "continuous.might");
  assert.equal(mightBonus.effect.mode, "add");
  assert.equal(mightBonus.effect.layer, "arithmetic");
  assert.deepEqual(mightBonus.effect.amount, { kind: "constant", value: 2 });
  assert.equal(mightBonus.effect.appliesTo, "self");
  // 442.1.a / 828.1.c：Empowered 门槛，属性拼写与已合入 Empower.ts 的展开一致。
  assert.equal(mightBonus.condition.kind, "compare");
  assert.equal(mightBonus.condition.operator, "gte");
  assert.deepEqual(mightBonus.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empowered"
  });
  assert.deepEqual(mightBonus.condition.right, { kind: "constant", value: 1 });
});

test("ven-070-166 Brutal Hunter: 'and [Ganking]' is a gated ability-layer keyword grant", () => {
  assert.equal(gankingGrant.kind, "static");
  assert.equal(gankingGrant.effect.kind, "continuous.grant-keyword");
  // 810.1.b：被授予的关键词本体由已合入的 keywords/Ganking.ts 展开。
  assert.equal(gankingGrant.effect.keyword, "Ganking");
  assert.equal(gankingGrant.effect.appliesTo, "self");
  assert.deepEqual(gankingGrant.condition, mightBonus.condition);
  assert.equal(mightBonus.effect.buffs, undefined);
});

test("ven-070-166 Brutal Hunter: review evidence — the grant primitives and the Empower def are merged", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
  // RIFT-593: the keyword now exists, so the old "defs are not merged" claim is stale.
  assert.equal(keywordDefinitionsById.has("Empower"), true);
});

test("ven-070-166 Brutal Hunter golden: the card's own [Empowered] clauses register +2 Might and Ganking through the production static binder", () => {
  // The production path (programs/statics.ts createEngineStaticBinder → layers)
  // binds the card's declared static abilities, including their 828.1.c
  // condition. Nothing here re-authors the effect shape or the gate.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("brutal-hunter", { types: ["unit"], zone: "board", owner: "A", controller: "A", might: 4 })
    .build();
  const engine = engineFor(kernel);
  const binder = createEngineStaticBinder(engine);
  const source = kernel.getObject("brutal-hunter");
  for (const ability of [mightBonus, gankingGrant]) binder.bindStatic(ability, source);

  const evaluate = () => {
    engine.layers.setObjects(kernel.objects);
    return engine.layers.evaluate(kernel.ref("brutal-hunter"));
  };

  // 828.1.c: the Dependent Ability is inactive while the source is not Empowered.
  const before = evaluate();
  assert.equal(before.empowered, 0);
  assert.equal(before.might, 4);
  assert.deepEqual(before.keywords.map(keyword => keyword.id), []);

  // 442.1.a: becoming Empowered activates both clauses (143.2.a arithmetic
  // Might, 810.1.b ability-layer keyword).
  kernel.perform({ type: "empower", object: kernel.ref("brutal-hunter"), amount: 1 });
  const after = evaluate();
  assert.equal(after.empowered, 1);
  assert.equal(after.might, 6);
  assert.deepEqual(after.keywords.map(keyword => [keyword.id, keyword.value]), [["Ganking", undefined]]);
});

test("ven-070-166 Brutal Hunter golden: the merged keyword-grant adapter expands Ganking into movement permission", () => {
  const kernel = world().unit("brutal-hunter", {
    types: ["unit"], zone: "board", owner: "A", controller: "A", might: 4,
    location: { type: "battlefield", id: "bf-1" }
  }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("brutal-hunter") });
  const outcome = runAbilityBody([{
    id: "brutal-hunter.grant-ganking",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: "Ganking" },
      appliesTo: { kind: "constant", value: "self" }
    }
  }], context);
  assert.equal(outcome.status, "executed");
  const layers = new KeywordGrantLayerEngine(context.objects, {
    context: source => bindResolveContext(context, { source, controller: source.controller })
  });
  for (const entry of context.continuousEffects) {
    layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
  }
  const snapshot = layers.snapshot(context.ref("brutal-hunter"));
  assert.deepEqual(snapshot.keywords, [{ id: "Ganking" }]);
  assert.equal(snapshot.movement.canGank, true);
});

test("ven-070-166 Brutal Hunter: a missing Empowered reading is information-missing, never a satisfied gate", () => {
  // The gate reads object-property self.empowered. An adapter that cannot
  // expose the status must make evaluation throw MissingInformation, and the
  // production binder must then treat the gate as unmet rather than true.
  const kernel = world()
    .player("A")
    .player("B")
    .unit("brutal-hunter", { types: ["unit"], zone: "board", owner: "A", controller: "A", might: 4 })
    .build();
  const { empowered: _omitted, ...withoutStatus } = kernel.getObject("brutal-hunter");
  assert.equal(Object.hasOwn(withoutStatus, "empowered"), false);
  // The layer engine only hands the bound condition the snapshot it evaluated,
  // so an adapter whose snapshot lacks the status makes the read information-
  // missing. evaluateExpression must then throw rather than compare a falsy 0.
  const expressionContext = {
    context: {
      ...kernel,
      object: () => withoutStatus
    },
    host: kernel.ref("brutal-hunter"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.throws(
    () => evaluateExpression(mightBonus.condition.left, expressionContext),
    /Unavailable characteristic: empowered/
  );

  // And through the production binder the same missing reading yields no grant.
  const engine = engineFor(kernel);
  const binder = createEngineStaticBinder(engine);
  const source = kernel.getObject("brutal-hunter");
  for (const ability of [mightBonus, gankingGrant]) binder.bindStatic(ability, source);
  engine.layers.setObjects([withoutStatus]);
  const evaluated = engine.layers.evaluate(kernel.ref("brutal-hunter"));
  assert.equal(evaluated.might, 4);
  assert.deepEqual(evaluated.keywords.map(keyword => keyword.id), []);
});

test("ven-070-166 Brutal Hunter: no keyword is declared unconditionally on the card face", () => {
  // [Ganking] 只在 Empowered 后获得；不得写成卡级关键词能力（那会变成始终拥有）。
  assert.equal(program.abilities.filter(ability => ability.kind === "keyword").length, 1);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "empower", value: 3 });
});

test.todo(
  "ven-070-166 Brutal Hunter: the printed [Empower] cost (827.1.c) still cannot reach the expansion — " +
    "contract 3.1's KeywordAbility has no params field and expandProgram calls def.expand({ value, host }), " +
    "and the cost pipeline has no empower payment kind (cost/plan-values.ts rejects it as an unsupported payment kind)"
);
