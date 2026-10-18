// Golden test for Raging Soul (ogn-019-298) — per cards/README.md section 4.
//
// The card stays judge-required: history conditions, default keyword-layer
// integration, and combat designation production still block it. The injected
// keyword adapter's Assault/Ganking behavior has separate execution evidence.
// The merged parts —
// validation, identity, the two conditional grants and their ability-layer
// registration after a real discard — are asserted as real execution, not as
// structure alone. Template-level execution evidence for the same card lives in
// test/cards/templates/static-static-675.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/raging-soul.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";

const CARD_ID = "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571";
const [assaultGrant, gankingGrant] = program.abilities;
const HERE = { type: "battlefield", id: "raging-soul-bf" };

/**
 * Bind this card's published static abilities through the production static
 * binder and read them back through the merged layer engine. The source is the
 * live object on the test kernel's Board, so the layer query sees the same
 * snapshot the engine would produce.
 */
function bindStatics(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    choose: request => kernel.choose(request),
    perform: action => kernel.perform(action)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host, cleanup: () => false });
  const binder = createEngineStaticBinder(engine);
  const source = kernel.getObject("raging-soul");
  for (const ability of program.abilities) binder.bindStatic(ability, source);
  engine.layers.setObjects(kernel.objects);
  return engine;
}

/** A real discard of one card from the named player's Hand, through effect.discard. */
function discardOne(kernel, player) {
  const cardId = player === "A" ? "fodder" : "enemy-fodder";
  kernel.setAnswers({ [`discard-${cardId}/effect.discard%3A${player}`]: [kernel.ref(cardId)] });
  return resolveChainBody([{
    id: `discard-${cardId}`,
    op: "effect.discard",
    args: { amount: { kind: "constant", value: 1 }, player: { kind: "constant", value: player } }
  }], kernel);
}

test("raging-soul: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("raging-soul: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /bindStaticToLayers/);
  assert.match(program.judgeReason, /attachProgramLifecycle/);
  // Each remaining gap is recorded against its real consumer, with the rule
  // anchor that makes it a gap.
  assert.match(program.judgeReason, /ctx\.history/);
  assert.match(program.judgeReason, /364\.3\.a|423\.1/);
  // The current gap is stated against its real consumer: no Condition
  // evaluates the turn history, so the count cannot reach ctx.history.
  assert.match(program.judgeReason, /条件消费方|Condition 消费方/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /默认 ChainEngine.*普通 LayerEngine/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.match(program.judgeReason, /movement/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.match(program.judgeReason, /动态授予展开/);
  // The reason names only current, source-verifiable gaps, never a task number
  // or the superseded "no consumer registered the static ability" claim.
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.ok(!/没有任何已合入消费方把卡牌 static 能力注册进图层/.test(program.judgeReason));
  assert.ok(!/条件历史查询未接通/.test(program.judgeReason));
  // 807.1.b.3: the unvalued grant is Assault 1, so the grant carries no value.
  assert.equal(assaultGrant.effect.value, undefined);
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
  assert.equal(gankingGrant.effect.keyword, "ganking");
  // 810.2: Ganking is redundant across instances, so no value is authored.
  assert.equal(gankingGrant.effect.value, undefined);
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
  // The merged condition.history primitive reads the real turn history: one
  // discard is countable, a turn without one is not. This is the rule result the
  // card's authored compare/count condition must eventually produce (364.3.a).
  const kernel = world()
    .unit("raging-soul", { owner: "A", controller: "A", might: 4, location: HERE })
    .hand("fodder", { owner: "A" }).build();
  const discarded = discardOne(kernel, "A");
  assert.equal(discarded.status, "executed");
  assert.equal(kernel.getObject("fodder").zone, "trash");
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

test("raging-soul: the merged continuous.grant-keyword primitive grants each authored keyword to the source", () => {
  // The authored static effects are submitted through the merged instruction
  // primitive (RIFT-258) with this card's own arguments; the ability layer then
  // exposes the granted keyword to the host and to nobody else.
  for (const grant of [assaultGrant, gankingGrant]) {
    const base = world()
      .unit("raging-soul", { owner: "A", controller: "A", might: 4, location: HERE })
      .unit("bystander", { owner: "A", controller: "A", might: 3, location: HERE }).build();
    const kernel = base.clone({
      source: base.ref("raging-soul"),
      sourceSnapshot: base.getObject("raging-soul")
    });
    const outcome = resolveChainBody([{
      id: `raging-soul.grant-${grant.effect.keyword}`,
      op: "continuous.grant-keyword",
      args: {
        keyword: { kind: "constant", value: grant.effect.keyword },
        appliesTo: { kind: "constant", value: grant.effect.appliesTo }
      }
    }], kernel);

    assert.equal(outcome.status, "executed");
    assert.equal(outcome.results[0].result.status, "executed");
    assert.equal(kernel.continuousEffects.length, 1);
    const [registration] = kernel.continuousEffects;
    assert.equal(registration.effect.layer, "ability");
    assert.equal(registration.effect.effect.keyword, grant.effect.keyword);
    assert.deepEqual(registration.duration, { type: "permanent" });

    const layers = createLayerEngine(kernel.objects, kernel.continuousEffects.map(entry => ({
      effect: entry.effect,
      duration: entry.duration,
      timestamp: 1
    })));
    // 807.1.b.3: the unvalued grant carries no numeric value of its own.
    assert.deepEqual(
      layers.evaluate(kernel.ref("raging-soul")).keywords.map(entry => [entry.id, entry.value ?? null]),
      [[grant.effect.keyword, null]]
    );
    // "I have" (364.3.a): the bystander never receives the granted keyword.
    assert.deepEqual(layers.evaluate(kernel.ref("bystander")).keywords, []);
  }
});

test("raging-soul: a real discard registers both keywords through the production static binder", () => {
  // RIFT-258/257 are merged: after the discard has really happened, the
  // production binder registers this card's two static grants and the merged
  // layer engine exposes both keywords on the host (807.3 / 810.3).
  const kernel = world()
    .unit("raging-soul", { owner: "A", controller: "A", might: 4, location: HERE })
    .hand("fodder", { owner: "A" })
    .unit("ally", { owner: "A", controller: "A", might: 2, location: HERE }).build();
  const discarded = discardOne(kernel, "A");
  assert.equal(discarded.status, "executed");
  assert.equal(kernel.history({ scope: "turn", action: "discard" }), 1);

  const engine = bindStatics(kernel);
  const evaluated = engine.layers.evaluate(kernel.ref("raging-soul"));
  assert.deepEqual(
    evaluated.keywords.map(entry => entry.id).sort(),
    ["assault", "ganking"],
    "both granted keywords are readable on the host"
  );
  // The grants are self-only: a friendly co-located unit receives neither.
  const ally = engine.layers.evaluate(kernel.ref("ally"));
  assert.deepEqual(ally.keywords, []);
  assert.equal(ally.might, 2);
});

// --- Remaining gaps: live repros, kept as TODO so the wrong behaviour is never
// --- presented as the expected rule outcome. Each body runs the merged paths.

test("raging-soul TODO: the authored condition must be false on an undiscarded turn", {
  todo: "CR 364.3.a/423.1: evaluate the count condition from ctx.history({ scope: 'turn', action: 'discard' }) " +
    "instead of a live set query; layers/filter.ts#matchesObjectFilter ignores both the relative player and the " +
    "descriptive subject, so with no discard the host itself is counted and both keywords are granted"
}, () => {
  // 正确规则：本回合没有弃牌时条件为假，两个关键词都不授予。
  const kernel = world().unit("raging-soul", { owner: "A", controller: "A", might: 4, location: HERE }).build();
  assert.equal(kernel.history({ scope: "turn", action: "discard" }), 0);
  const engine = bindStatics(kernel);
  const evaluated = engine.layers.evaluate(kernel.ref("raging-soul"));
  assert.deepEqual(evaluated.keywords, []);
  assert.equal(evaluated.might, 4);
});

test("raging-soul TODO: an opponent's discard must not satisfy \"you've discarded\"", {
  todo: "CR 364.3.a/423.1: the relative-player placeholder in the count filter has no anchor in a set query, so an " +
    "opponent's discard satisfies the gate; the Condition consumer must read the controller's turn history"
}, () => {
  // 正确规则："you've discarded" 只看本卡控制者自己的弃牌。
  const kernel = world()
    .unit("raging-soul", { owner: "A", controller: "A", might: 4, location: HERE })
    .hand("enemy-fodder", { owner: "B" }).build();
  const discarded = discardOne(kernel, "B");
  assert.equal(discarded.status, "executed");
  // The turn really contains one discard, and it belongs to B (the card sits in
  // B's Trash). A owns no discard event this turn.
  assert.equal(kernel.history({ scope: "turn", action: "discard" }), 1);
  assert.equal(kernel.getObject("enemy-fodder").zone, "trash");
  const engine = bindStatics(kernel);
  const evaluated = engine.layers.evaluate(kernel.ref("raging-soul"));
  assert.deepEqual(evaluated.keywords, []);
});

test("raging-soul TODO: the granted Assault needs a live Attacker designation for +1 Might", {
  todo: "CR 807.1.c/807.1.d.1: default ChainEngine has not integrated KeywordGrantLayerEngine; " +
    "the adapter already maps combatRole to designation, but combat/flow.ts still blocks combat-start-transaction"
}, () => {
  // 正确规则：本回合弃过牌 + 保持 Attacker designation 时，宿主应为 4 + 1 = 5 Might。
  const kernel = world()
    .unit("raging-soul", {
      owner: "A", controller: "A", might: 4, location: HERE, combatRole: "attacker"
    })
    .hand("fodder", { owner: "A" }).build();
  assert.equal(discardOne(kernel, "A").status, "executed");
  const engine = bindStatics(kernel);
  const evaluated = engine.layers.evaluate(kernel.ref("raging-soul"));
  assert.deepEqual(evaluated.keywords.map(entry => entry.id).sort(), ["assault", "ganking"]);
  assert.equal(evaluated.might, 5);
});

test("raging-soul TODO: the granted Ganking must reach the Standard Move legality check", {
  todo: "CR 810.1.c/144.4.c.1: default ChainEngine has not integrated KeywordGrantLayerEngine; " +
    "the adapter already expands the grant and normalizes its movement permission"
}, () => {
  // 正确规则：本回合弃过牌后，宿主应能按 144.4.c.1 从战场移动到战场。
  const kernel = world()
    .unit("raging-soul", { owner: "A", controller: "A", might: 4, location: HERE })
    .hand("fodder", { owner: "A" }).build();
  assert.equal(discardOne(kernel, "A").status, "executed");
  const engine = bindStatics(kernel);
  const evaluated = engine.layers.evaluate(kernel.ref("raging-soul"));
  assert.deepEqual(evaluated.keywords.map(entry => entry.id).sort(), ["assault", "ganking"]);
  const permission = movement(engine.layers.registry, kernel.ref("raging-soul"), evaluated, "A");
  assert.equal(permission.canGank, true);
});

test("raging-soul: the merged keyword adapter expands both grants after a real discard", () => {
  // Initial combatRole tests the layer consumer, not combat-start production.
  for (const [combatRole, might] of [["attacker", 5], ["defender", 4], [null, 4]]) {
    const kernel = world()
      .unit("raging-soul", { owner: "A", controller: "A", might: 4, combatRole, location: HERE })
      .unit("ally", { owner: "A", controller: "A", might: 2, location: HERE })
      .hand("fodder", { owner: "A" }).build();
    assert.equal(discardOne(kernel, "A").status, "executed");
    const engine = bindStatics(kernel);
    const layers = new KeywordGrantLayerEngine(kernel.objects, {
      registry: engine.layers.registry,
      context: source => bindResolveContext(kernel, { source, controller: source.controller })
    });
    const evaluated = layers.evaluate(kernel.ref("raging-soul"));
    assert.deepEqual(evaluated.keywords, [{ id: "Assault", value: 1 }, { id: "Ganking" }]);
    assert.equal(evaluated.might, might);
    assert.equal(movement(layers.registry, evaluated.ref, evaluated, "A").canGank, true);
    assert.deepEqual(layers.evaluate(kernel.ref("ally")).keywords, []);
    assert.equal(layers.evaluate(kernel.ref("ally")).might, 2);
  }
});
