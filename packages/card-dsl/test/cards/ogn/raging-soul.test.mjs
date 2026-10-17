// Golden test for Raging Soul (ogn-019-298).
//
// Execution evidence (a real discard through the merged chain, the
// no-discard and opponent-discard boundaries and the host-only keyword grants)
// lives in the RIFT-675 parameterized template golden:
// test/cards/templates/static-static-675.test.mjs.
// Existing per-card behavior and structure assertions are retained here;
// the template suite supplies additional execution evidence.
// RIFT-651 template execution evidence (pending history gating, combat-role
// designation and Ganking movement consumption): packages/card-dsl/test/cards/templates/static-static-651.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/raging-soul.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CARD_ID = "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571";
const [assaultGrant, gankingGrant] = program.abilities;

test("raging-soul: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("raging-soul: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Assault\/Ganking 的 KeywordDef/);
  // The card static binding is merged; the current condition/history and
  // designation gaps are recorded against their real consumers.
  assert.match(program.judgeReason, /programs\/statics\.ts 的 bindStaticToLayers/);
  assert.match(program.judgeReason, /ctx\.history/);
  assert.match(program.judgeReason, /条件历史查询未接通/);
  assert.ok(!/RIFT-359/.test(program.judgeReason));
  assert.ok(!/没有任何已合入消费方把卡牌 static 能力注册进图层/.test(program.judgeReason));
  assert.equal(
    program.sourceText,
    "If you've discarded a card this turn, I have [Assault] and [Ganking]. " +
      "(+1 :rb_might: while I'm an attacker. I can move from battlefield to battlefield.)"
  );
});

test("raging-soul: two static self-grants, one per keyword (807.1, 810.1)", () => {
  assert.equal(program.abilities.length, 2);
  for (const grant of program.abilities) {
    assert.equal(grant.kind, "static");
    assert.equal(grant.effect.kind, "continuous.grant-keyword");
    assert.equal(grant.effect.appliesTo, "self");
  }
  assert.equal(assaultGrant.effect.keyword, "assault");
  // 807.1.b.3: no printed Assault value, so the grant is Assault 1.
  assert.equal(assaultGrant.effect.value, undefined);
  assert.equal(gankingGrant.effect.keyword, "ganking");
});

test("raging-soul: both grants share the same 'discarded a card this turn' condition (364.3.a, 423.1)", () => {
  const expectedCondition = {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-discarded-this-turn",
      filter: { player: "controller" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  };
  assert.deepEqual(assaultGrant.condition, expectedCondition);
  assert.deepEqual(gankingGrant.condition, expectedCondition);
  assert.notEqual(assaultGrant.condition, gankingGrant.condition, "each ability owns its own condition object");
});

test("raging-soul: a real discard is observable as turn history through the merged interpreter", () => {
  // The gate's authored condition shape is the count form; the merged history
  // primitive proves that a discard executed by the merged effect.discard is
  // recorded and countable within the turn scope.
  const kernel = world().hand("fodder", { owner: "A" }).hand("kept", { owner: "A" }).build();
  kernel.setAnswers({ "discard-fodder/effect.discard%3AA": [kernel.ref("fodder")] });
  const discarded = resolveChainBody([{
    id: "discard-fodder",
    op: "effect.discard",
    args: { amount: { kind: "constant", value: 1 } }
  }], kernel);
  assert.equal(discarded.status, "executed");
  const gate = runAbilityBody([{
    id: "raging-soul.gate",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "discard" } },
      operator: { kind: "constant", value: "gte" },
      right: { kind: "constant", value: 1 }
    }
  }], kernel);
  assert.equal(gate.linkedValues["raging-soul.gate.count"], 1);
  assert.equal(gate.linkedValues["raging-soul.gate.value"], true);
  // A turn with no discard does not satisfy the gate (the false branch).
  const noDiscard = runAbilityBody([{
    id: "raging-soul.gate",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "discard" } },
      operator: { kind: "constant", value: "gte" },
      right: { kind: "constant", value: 1 }
    }
  }], world().build());
  assert.equal(noDiscard.linkedValues["raging-soul.gate.count"], 0);
  assert.equal(noDiscard.linkedValues["raging-soul.gate.value"], false);
});

test("raging-soul golden: the merged grant-keyword instruction grants both keywords to the source through the layers engine", () => {
  // The authored static abilities carry a continuous.grant-keyword effect; the
  // merged instruction primitive (RIFT-258) registers the same effect through
  // ctx.addContinuous and the ability layer grants the keyword to the host.
  for (const grant of [assaultGrant, gankingGrant]) {
    const base = world().unit("raging-soul", { owner: "A", controller: "A", might: 4 }).build();
    const kernel = base.clone({
      source: base.ref("raging-soul"),
      sourceSnapshot: base.getObject("raging-soul")
    });
    const declared = grant.effect;
    const outcome = resolveChainBody([{
      id: `raging-soul.grant-${declared.keyword}`,
      op: "continuous.grant-keyword",
      args: {
        keyword: { kind: "constant", value: declared.keyword },
        appliesTo: { kind: "constant", value: declared.appliesTo }
      }
    }], kernel);

    assert.equal(outcome.status, "executed");
    assert.equal(outcome.results[0].result.status, "executed");
    assert.equal(kernel.continuousEffects.length, 1);
    const [registration] = kernel.continuousEffects;
    assert.equal(registration.effect.layer, "ability");
    assert.equal(registration.effect.effect.keyword, declared.keyword);
    assert.deepEqual(registration.duration, { type: "permanent" });

    const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({
      effect: entry.effect,
      duration: entry.duration,
      timestamp: 1
    })));
    // 807.1.b.3: the unvalued grant carries no numeric value.
    assert.deepEqual(
      layers.evaluate(kernel.ref("raging-soul")).keywords.map(entry => [entry.id, entry.value ?? null]),
      [[declared.keyword, null]]
    );
  }
});

test("raging-soul golden: the production static binder registers both grants and the merged layer engine reads them", () => {
  // RIFT-257/258 are merged: bindStaticToLayers registers this card's static
  // continuous.grant-keyword abilities as real ContinuousEffectSpec entries and
  // the layer engine makes the granted keywords readable (807.3 / 810.3).
  const kernel = world()
    .unit("raging-soul", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const engineHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    choose: request => kernel.choose(request),
    perform: action => kernel.perform(action)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: engineHost, cleanup: () => false });
  const binder = createEngineStaticBinder(engine);
  const source = kernel.getObject("raging-soul");
  for (const ability of program.abilities) binder.bindStatic(ability, source);

  engine.layers.setObjects(kernel.objects);
  const evaluated = engine.layers.evaluate(kernel.ref("raging-soul"));
  assert.deepEqual(evaluated.keywords.map(entry => entry.id).sort(), ["assault", "ganking"]);
});

test("raging-soul TODO: the authored condition must be false on an undiscarded turn", {
  todo: "CR 364.3.a: evaluate the count condition from ctx.history({ scope: 'turn', action: 'discard' }) instead of a live set query"
}, () => {
  // 正确规则：本回合没有弃牌时条件为假。原条件的 count 走现场集合查询、相对玩家占位符
  // 无锚点，当前会把宿主自身算进去而判真；该用例记录规则预期，依赖接通后应转正。
  const kernel = world().unit("raging-soul", { owner: "A", controller: "A", might: 4 }).build();
  assert.equal(kernel.history({ scope: "turn", action: "discard" }), 0);
  // The authored compare/count condition still lacks a history consumer. Use
  // the merged history instruction to pin the equivalent rule result until
  // that consumer can evaluate the CardProgram condition itself.
  const outcome = runAbilityBody([{
    id: "raging-soul.gate",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "discard" } },
      operator: { kind: "constant", value: "gte" },
      right: { kind: "constant", value: 1 }
    }
  }], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["raging-soul.gate.value"], false);
});
test.todo(
  "raging-soul: the granted Assault still needs the Attacker designation (807.1.c/807.1.d.1, ObjectSnapshot.combatRole is only frozen in contract 3.8)"
);
test.todo(
  "raging-soul: the granted Ganking permission must reach the Standard Move legality checks — the " +
    "KeywordDef emits a string permission while layers/rules/query.ts movement() reads the normalized " +
    "permission.routes shape (810.1.c, 144.4.c)"
);
