import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/risen-altar.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-fbf366107dc56ccff37dc34defc026e822358e66fe7bb2e1c905d067292ea927";
const SOURCE_TEXT = "[Empower] costs of your units here cost :rb_energy_1: or :rb_rune_rainbow: less.";

const SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

const [ability] = program.abilities;
const { effect } = ability;

/** A merged Finalize context whose printed characteristics are supplied explicitly. */
function contextFor(energy) {
  const base = world().hand("source", { types: ["unit"], energy, power: null }).build();
  return base.clone({ sourceSnapshot: base.object(base.ref("source")) });
}

test("ven-163-166 Risen Altar: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-163-166 Risen Altar: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /sameLocationAs/);
});

test("ven-163-166 Risen Altar: the discount states both printed branches over your units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 356.4.b ("costs [amount] less") + 827.1.c.3 (it counts whenever the Empower
  // cost is determined for any reason).
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.appliesTo, "empower-cost");

  // "… :rb_energy_1: or :rb_rune_rainbow: less": the printed "or" is recorded as
  // the two branches. The frozen CostDiscount carries one resource per entry
  // and has no either/or shape (see judgeReason), so both branches stay data
  // instead of one being picked for the card.
  assert.deepEqual(effect.options, {
    kind: "constant",
    value: [
      { resource: "energy", amount: -1 },
      { resource: "power", amount: -1, domains: SIX_DOMAINS }
    ]
  });

  // 053.3 "here" + 190.6.d "your": the controller's units at this battlefield.
  assert.deepEqual(effect.filter, {
    type: "unit",
    controller: "self",
    sameLocationAs: "self"
  });
});

test("ven-163-166 Risen Altar golden: the -1 Energy branch really reduces a merged Empower-shaped cost (CR 356.4)", () => {
  // 827.1.c.1: the Empower cost is an activated cost; the golden supplies a
  // representative 2-Energy Empower cost and the card's own -1 Energy delta.
  const plan = buildCostPlan(contextFor(2), {
    id: "empower",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 2 },
      payments: [{ kind: "exhaust" }]
    },
    // CostDiscount.amount is the reduction magnitude (CR 356.4.b), so the merged
    // plan takes the absolute value of the recorded -1 delta (356.6 clamps at 0).
    discounts: [
      { id: "risen-altar", resource: "energy", amount: { kind: "constant", value: 1 } }
    ]
  });

  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.discounts, [
    {
      id: "risen-altar",
      component: null,
      resource: "energy",
      amount: 1,
      minimum: 0,
      before: 2,
      after: 1
    }
  ]);
  // 415.5: the non-standard part of the cost is untouched by an Energy discount.
  assert.equal(plan.total.actions.length, 1);
  assert.equal(plan.total.actions[0].action.type, "exhaust");
});

test("ven-163-166 Risen Altar golden: the -1 [A] branch removes one any-Domain Power requirement (135.2.e.5.a)", () => {
  const plan = buildCostPlan(contextFor(0), {
    id: "empower-power",
    // 827.1.c.2: an Empower cost may be a resource cost; [A] is payable by Power
    // of any Domain, so the requirement allows all six domains.
    cost: {
      kind: "activated",
      power: { kind: "constant", value: 1 }
    },
    domains: SIX_DOMAINS,
    discounts: [
      {
        id: "risen-altar-power",
        resource: "power",
        amount: { kind: "constant", value: 1 },
        domains: SIX_DOMAINS
      }
    ]
  });

  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.discounts, [
    {
      id: "risen-altar-power",
      component: null,
      resource: "power",
      amount: 1,
      minimum: 0,
      before: 1,
      after: 0
    }
  ]);
});

test("ven-163-166 Risen Altar golden: a discount never drives the cost below zero (CR 356.6)", () => {
  const plan = buildCostPlan(contextFor(0), {
    id: "empower-clamped",
    cost: { kind: "activated", energy: { kind: "constant", value: 0 } },
    discounts: [
      { id: "risen-altar-power", resource: "power", amount: { kind: "constant", value: 1 }, domains: SIX_DOMAINS }
    ]
  });

  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
});

test.todo(
  "ven-163-166 Risen Altar: install the static reduction on the affected Empower cost — no merged path turns a " +
    "CardProgram's static continuous.cost-modification into the CostPlanInput.discounts of the later activation, and " +
    "effects/instructions/ has no cost.modify primitive (in-flight RIFT-261); RIFT-257's statics.ts is only a callback slot"
);

test.todo(
  "ven-163-166 Risen Altar: resolve what 'or :rb_rune_rainbow: less' means for the discount shape — the frozen " +
    "CostDiscount is a single-resource record with no either/or form, so the printed energy-vs-[A] choice cannot be " +
    "declared without picking a branch (contract change request)"
);

test.todo(
  "ven-163-166 Risen Altar: the Empower/Empowered keyword expansion (827.1.c.1 activation cost + 828.1.b.1 dependent " +
    "ability) — effects/keywords/registry.generated.ts has no Empower/Empowered KeywordDef (RIFT-81~88 batch excludes them)"
);

test.todo(
  "ven-163-166 Risen Altar: restrict 'your units here' to this battlefield — layers/filter.ts does not implement the " +
    "sameLocationAs (053.3 'here') anchor (the interpreter query path has it), so the declared filter would apply at " +
    "every battlefield"
);
