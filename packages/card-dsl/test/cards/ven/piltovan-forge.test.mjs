import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/piltovan-forge.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-be867d899429959061bfc2cece46b8a8f554894791ea014d6a288b4075a635e9";
const SOURCE_TEXT =
  "While you control this battlefield, the first friendly gear activated ability played each turn costs " +
  ":rb_energy_1: less.";

const [ability] = program.abilities;
const { effect } = ability;

/** A merged Finalize context for the gear whose activated ability is played. */
function contextFor(printed = { energy: 3, power: null }) {
  const base = world()
    .unit("gear", { types: ["gear"], ...printed, location: { type: "battlefield", id: "piltovan" } })
    .build();
  return base.clone({ sourceSnapshot: base.object(base.ref("gear")) });
}

/** The declared -1 Energy discount in the merged cost-plan shape (356.4). */
function discount() {
  return {
    id: "piltovan-forge.first-activation",
    resource: "energy",
    amount: { kind: "constant", value: 1 },
    minimum: { kind: "constant", value: 0 }
  };
}

test("ven-161-166 Piltovan Forge: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-161-166 Piltovan Forge: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /RIFT-89/);
  // The golden must prove the new program reaches the shared generated index,
  // not just the file system (scripts/gen-registries.mjs builds it from src/cards/**).
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ven-161-166 Piltovan Forge: one static -1 Energy discount for the first friendly gear activation each turn", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");

  // 356.4 / 356.4.b: "costs :rb_energy_1: less" is a discount; 356.6 is the
  // floor of 0, declared as the discount's own minimum (356.4.e).
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.resource, "energy");
  assert.deepEqual(effect.amount, { kind: "constant", value: -1 });
  assert.deepEqual(effect.minimum, { kind: "constant", value: 0 });

  // 377.1 / 377.2 / 151.1: the modified cost is the gear's activated ability.
  assert.equal(effect.appliesTo, "activated-ability-cost");

  // "the first … each turn": the one-shot window with no IR shape (see
  // judgeReason); the spelled value is descriptive, not executable.
  assert.equal(effect.duration, "per-turn-first-activation");

  // 190.6.a / 190.6.d: "friendly" is the Battlefield controller's gear.
  assert.deepEqual(effect.filter, { type: "gear", controller: "self" });
});

test("ven-161-166 Piltovan Forge golden: the -1 Energy discount reduces a merged activated-ability cost (356.4)", () => {
  // A representative 3-Energy activated ability of a friendly gear: the merged
  // plan applies the declared discount and reports the applied reduction.
  const ctx = contextFor({ energy: 3, power: null });
  const plan = buildCostPlan(ctx, {
    id: "piltovan-forge",
    cost: { kind: "activated", energy: { kind: "constant", value: 3 } },
    discounts: [discount()]
  });

  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.discounts, [
    {
      id: "piltovan-forge.first-activation",
      component: null,
      resource: "energy",
      amount: 1,
      minimum: 0,
      before: 3,
      after: 2
    }
  ]);
});

test("ven-161-166 Piltovan Forge golden: a 0-Energy activation is not driven below 0 (356.6 / 356.4.e)", () => {
  const ctx = contextFor({ energy: 0, power: null });
  const plan = buildCostPlan(ctx, {
    id: "piltovan-forge-floor",
    cost: { kind: "activated", energy: { kind: "constant", value: 0 } },
    discounts: [discount()]
  });

  assert.equal(plan.total.energy, 0);
  // 356.4.e / 356.6: the discount's own minimum clamps only this discount.
  assert.deepEqual(plan.discounts, [
    {
      id: "piltovan-forge.first-activation",
      component: null,
      resource: "energy",
      amount: 1,
      minimum: 0,
      before: 0,
      after: 0
    }
  ]);
});

test("ven-161-166 Piltovan Forge golden: the discount touches Energy only, never the non-standard payments", () => {
  // 415.5: a non-standard part of a cost is not an Energy or Power component,
  // so an Energy discount cannot remove it.
  const ctx = contextFor({ energy: 2, power: null });
  const plan = buildCostPlan(ctx, {
    id: "piltovan-forge-exhaust",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 2 },
      payments: [{ kind: "exhaust" }]
    },
    discounts: [discount()]
  });

  assert.equal(plan.total.energy, 1);
  assert.equal(plan.total.actions.length, 1);
  assert.equal(plan.total.actions[0].action.type, "exhaust");
});

test.todo(
  "ven-161-166 Piltovan Forge: install the -1 Energy discount on the later gear activation's cost plan — cost.modify " +
    "(merged) latches a modifier into a full CostPlan, but no merged path reads the CardProgram's static " +
    "continuous.cost-modification and turns it into that activation's CostPlanInput.discounts (RIFT-89 wiring)"
);

test.todo(
  "ven-161-166 Piltovan Forge: gate the discount to 'the first … each turn' — the per-turn one-shot window needs a history " +
    "subject for qualifying gear activations, but HistoryQuery is limited to {scope, action, timingPoint, player, object} " +
    "(contract 3.6) and Duration has no one-shot window (same gap as sfd/ornns-forge, rad/hunters-circle)"
);

test.todo(
  "ven-161-166 Piltovan Forge: identify the gear whose activated ability is being played (151.1 / 377.1) and honour " +
    "190.6 battlefield-ability control — no channel exposes the activation's source or the battlefield controller"
);
