// Scenario execution evidence: ../../templates/static-642.test.mjs.
// This file keeps the validation and identity checks plus the key structural
// assertions; the real execution path for this card lives in that template row.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/orianna-mechanical-marvel.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CARD_ID =
  "card.hash-d4ef90d20d4782edbcabe8cd157c2b6565e5c53b930df73f688bd58c0289d3a1";

const [costModification] = program.abilities;

test("rad-068-167 Orianna, Mechanical Marvel: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /Finalize/);
  // The usage window is still the live gap: the collector refuses `once`, so
  // the reason must name the missing per-turn counter.
  assert.match(program.judgeReason, /Once each turn/);
  assert.match(program.judgeReason, /per-turn 使用计数/);
  // The production static binder rejects this kind outright; the reason must
  // record that and the unsupported beneficiary appliesTo shape.
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /Static ability kind continuous\.cost-modification has no layer mapping/);
  assert.match(program.judgeReason, /staticTarget/);
});

test("rad-068-167 Orianna, Mechanical Marvel: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "Once each turn, while I'm at a battlefield, you may pay :rb_energy_1::rb_rune_rainbow: less to play a gear."
  );
});

test("rad-068-167 Orianna, Mechanical Marvel: the discount is a static cost modification, not a resolving instruction (366.2 / 404.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "continuous.cost-modification");
  // "1 Energy and one rainbow rune" = 1 Energy plus 1 Power of any domain
  // (135.2.e.5): one reduction per resource, both consumed by the merged
  // finalizeCostPlan collector.
  assert.deepEqual(costModification.effect.reductions, [
    { resource: "energy", amount: { kind: "constant", value: -1 } },
    {
      resource: "power",
      amount: { kind: "constant", value: -1 },
      universal: true
    }
  ]);
  assert.equal(Object.hasOwn(costModification.effect, "resource"), false);
  assert.equal(Object.hasOwn(costModification.effect, "amount"), false);
  assert.deepEqual(costModification.effect.appliesTo, {
    kind: "constant",
    value: { type: "gear", controller: "controller" }
  });
  assert.deepEqual(costModification.effect.stage, {
    kind: "constant",
    value: "total-cost"
  });
  // "Once each turn" is the usage limit of this continuous effect.
  assert.deepEqual(costModification.effect.once, { kind: "constant", value: "per-turn" });
});

test("rad-068-167 Orianna, Mechanical Marvel: the announced 1 Energy + 1 any-domain Power discount really prices a gear play", () => {
  // Real execution of the printed reduction through the merged cost collector
  // (cost/discounts/collect.ts, RIFT-709). The collector consumes `reductions`,
  // the beneficiary `appliesTo` filter and `stage: total-cost`; every assertion
  // below is the printed outcome, not a fixture-side settlement.
  const { once, ...effect } = costModification.effect;
  void once;
  const sources = (ctx) => ({
    statics: [{ id: "orianna:0", source: ctx.ref("orianna"), ability: { ...costModification, effect } }]
  });

  const atBattlefield = world()
    .player("A", { energy: 5 })
    .unit("orianna", { location: { type: "battlefield", id: "bf-1" } })
    .hand("gear", { types: ["gear"], energy: 1, power: ["Mind"] })
    .player("B", { energy: 5 })
    .hand("enemy-gear", { owner: "B", controller: "B", types: ["gear"], energy: 1, power: ["Mind"] })
    .build();
  const ownCtx = atBattlefield.clone({ sourceSnapshot: atBattlefield.getObject("gear") });
  const discounted = finalizeCostPlan(ownCtx, { id: "gear-play", cost: { kind: "printed" }, domains: ["Mind"] }, sources(ownCtx));
  assert.equal(discounted.total.energy, 0, "1 Energy becomes 0");
  assert.deepEqual(discounted.total.power, [], "the 1 any-domain Power requirement is removed");
  assert.deepEqual(
    discounted.discounts.map(entry => [entry.resource, entry.amount, entry.before, entry.after]),
    [["energy", 1, 1, 0], ["power", 1, 1, 0]]
  );
  assert.equal(discounted.printed.energy, 1, "the printed cost stays independent of the discount");

  const enemyCtx = atBattlefield.clone({ sourceSnapshot: atBattlefield.getObject("enemy-gear"), controller: "A" });
  const enemy = finalizeCostPlan(enemyCtx, { id: "enemy-gear-play", cost: { kind: "printed" }, domains: ["Mind"] }, sources(enemyCtx));
  assert.deepEqual(enemy.discounts, [], "the beneficiary filter is the controller's gear (366.2.a)");
  assert.equal(enemy.total.energy, 1);

  const atBase = world()
    .player("A", { energy: 5 })
    .unit("orianna", { location: { type: "base", player: "A" } })
    .hand("gear", { types: ["gear"], energy: 1, power: ["Mind"] })
    .build();
  const baseCtx = atBase.clone({ sourceSnapshot: atBase.getObject("gear") });
  const off = finalizeCostPlan(baseCtx, { id: "gear-play", cost: { kind: "printed" }, domains: ["Mind"] }, sources(baseCtx));
  assert.deepEqual(off.discounts, [], "\"while I'm at a battlefield\" is false at the Base (364.3)");
  assert.equal(off.total.energy, 1);
});

test("rad-068-167 Orianna, Mechanical Marvel: the printed once-per-turn limit is still refused, so no per-gear approximation is installed", () => {
  // The usage window is the remaining gap: the collector's field whitelist has
  // no `once`, so a declaration carrying it fails closed instead of silently
  // discounting every gear of the turn.
  const kernel = world()
    .player("A", { energy: 5 })
    .unit("orianna", { location: { type: "battlefield", id: "bf-1" } })
    .hand("gear", { types: ["gear"], energy: 1, power: ["Mind"] })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("gear") });
  assert.throws(
    () => finalizeCostPlan(
      ctx,
      { id: "gear-play", cost: { kind: "printed" }, domains: ["Mind"] },
      { statics: [{ id: "orianna:0", source: ctx.ref("orianna"), ability: costModification }] }
    ),
    error => error instanceof CostPlanError && error.reason === "judge-required" &&
      /Unsupported cost modification field once/.test(error.message)
  );
});

test("rad-068-167 Orianna, Mechanical Marvel: 'while I'm at a battlefield' is the source location condition (364.3)", () => {
  // The location predicate has to read the layer/filter vocabulary: the
  // object-property spelling compares ObjectSnapshot.location (a LocationRef
  // object) against the string "battlefield" and is always false.
  assert.deepEqual(costModification.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "objects",
      filter: { object: "self", location: "battlefield" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  const atBattlefield = world()
    .unit("orianna", { might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const atBase = world()
    .unit("orianna", { might: 5, location: { type: "base", player: "A" } })
    .build();
  const evaluateIn = (kernel) => {
    const host = kernel.getObject("orianna");
    return evaluateCondition(costModification.condition, {
      context: bindResolveContext(kernel, { source: host, controller: host.controller }),
      host: host.ref,
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false,
      query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(filter, object))
    });
  };
  assert.equal(evaluateIn(atBattlefield), true, "the source is at a battlefield");
  assert.equal(evaluateIn(atBase), false, "the source at its Base is not at a battlefield");
});

test("rad-068-167 Orianna, Mechanical Marvel: the merged cost pipeline only takes caller-supplied discounts", () => {
  // A discount applied by the caller works (RIFT-89's existing API) ...
  const kernel = world().unit("orianna", { might: 5 }).build();
  const withDiscount = buildCostPlan(kernel, {
    id: "gear-play",
    cost: { energy: { kind: "constant", value: 3 } },
    discounts: [
      { id: "orianna-discount", resource: "energy", amount: { kind: "constant", value: 1 } }
    ]
  });
  assert.equal(withDiscount.total.energy, 2);
  // ... but nothing in the pipeline reads a continuous effect to discover that discount,
  // and the printed Power component cannot be reduced this way without a domain choice.
  assert.equal(withDiscount.total.power.length, 0);
});

test("rad-068-167 Orianna, Mechanical Marvel: the +1 Energy / +1 Power discount cannot be approximated by a plain energy reduction", () => {
  // Documents the second half of the discount so the missing any-domain Power reduction is
  // visible: an energy-only discount would under-apply the printed card text.
  const kernel = world().unit("orianna", { might: 5 }).build();
  const plan = buildCostPlan(kernel, {
    id: "gear-play",
    cost: {
      energy: { kind: "constant", value: 0 },
      power: { kind: "constant", value: 1 }
    },
    domains: ["Fury"]
  });
  assert.equal(plan.total.power.length, 1);
  assert.deepEqual(plan.total.power[0].allowedDomains, ["Fury"]);
});

function oriannaFixture() {
  const engine = () => ({
    layers: { registry: { list: () => [] }, addContinuous: () => {}, removeContinuous: () => {}, currentTimingPoint: "main-start" },
    pipeline: { host: {} }
  });
  return {
    engine,
    source: {
      ref: { id: "orianna", zoneEntryId: 1 },
      cardId: CARD_ID,
      name: "Orianna, Mechanical Marvel",
      types: ["unit"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      might: 5,
      energy: 5,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    }
  };
}

test("rad-068-167 Orianna, Mechanical Marvel: the production static binder refuses the declared beneficiary filter", () => {
  // staticTarget() only accepts self/source or an omitted appliesTo. The printed
  // beneficiary is a gear filter with a relative controller (366.2 / 366.2.a),
  // so binding stops here before any layer mapping is consulted.
  const { engine, source } = oriannaFixture();
  assert.throws(
    () => createEngineStaticBinder(engine()).bindStatic(costModification, source),
    error => error.code === "judge-required" &&
      /Unsupported static appliesTo \{"type":"gear","controller":"controller"\}/.test(error.message)
  );
  assert.equal(engine().layers.registry.list().length, 0);
});

test("rad-068-167 Orianna, Mechanical Marvel: with the beneficiary filter removed, layerFor still has no cost-modification mapping", () => {
  // Isolating the second gap: even a self-applied static of this kind cannot
  // reach the layer registry, because layerFor has no continuous.cost-modification
  // branch. That is why no Finalize consumer can ever see this effect.
  const { engine, source } = oriannaFixture();
  const { appliesTo, ...withoutBeneficiary } = costModification.effect;
  void appliesTo;
  for (const effect of [
    withoutBeneficiary,
    { ...costModification.effect, appliesTo: { kind: "constant", value: "self" } }
  ]) {
    assert.throws(
      () => createEngineStaticBinder(engine()).bindStatic({ ...costModification, effect }, source),
      error => error.code === "judge-required" &&
        /Static ability kind continuous\.cost-modification has no layer mapping/.test(error.message)
    );
  }
  assert.equal(engine().layers.registry.list().length, 0);
});

test.todo(
  "rad-068-167 Orianna, Mechanical Marvel: bind and consume the continuous cost modification " +
    "(1 Energy + 1 any-domain Power less for a gear the controller plays, once each turn, while " +
    "the source is at a battlefield) — needs a staticTarget beneficiary-filter adapter, a " +
    "layerFor mapping for continuous.cost-modification, a Finalize reader wired into " +
    "chain/engine.ts, and a per-turn use counter on continuous effects. The discount arithmetic " +
    "itself (including the any-domain Power reduction and 356.4.c ordering) is executed by the " +
    "announced-discount test above."
);
