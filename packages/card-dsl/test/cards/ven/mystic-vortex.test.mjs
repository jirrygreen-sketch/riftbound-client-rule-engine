// Template execution evidence: ../templates/static-645.test.mjs.
// This card remains judge-required; the template covers only the traversable
// lifecycle and the closed-showdown boundary.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/mystic-vortex.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-a4ce11641e7d44ba07514cd00f7c63e4ce2fa82ef76ff2dd5a8391481ba04da9";
const SOURCE_TEXT =
  "During showdowns here, cards with [Reaction] cost :rb_rune_rainbow: more to play. " +
  "(Hidden cards have [Reaction].)";

const SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

const [ability] = program.abilities;
const { effect } = ability;

/** A merged cost context for a card being played at this Battlefield. */
function contextFor(printed, pool = {}) {
  const base = world()
    .player("A", pool)
    .hand("reaction-card", { types: ["spell"], ...printed })
    .build();
  return base.clone({ sourceSnapshot: base.object(base.ref("reaction-card")) });
}

/** The printed increase, applied through the merged cost-plan increase stage. */
function increaseComponent() {
  return {
    id: "mystic-vortex.increase",
    cost: { payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: SIX_DOMAINS }] }
  };
}

test("ven-160-166 Mystic Vortex: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-160-166 Mystic Vortex: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /ObjectSnapshot\.keywords/);
  assert.match(program.judgeReason, /Showdown/);
  // The golden must prove the new program reaches the shared generated index,
  // not just the file system (scripts/gen-registries.mjs builds it from src/cards/**).
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ven-160-166 Mystic Vortex: one static +1 [A] cost increase gated on a showdown here and Reaction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");

  // 356.3: "cost … more" is the cost-increase step (356.4 is the discount
  // step); 479.4.f lists both spellings as arithmetic-layer phrases.
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.appliesTo, "play-cost");
  assert.equal(effect.resource, "power");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  // 135.2.e.5.a / 163.2: one [A] is payable by Power of any Domain.
  assert.deepEqual(effect.domains, SIX_DOMAINS);

  // 813.1 / 813.5: the population is the cards with Reaction; 811.6's Hidden
  // remainder is reminder text, not a second ability.
  assert.deepEqual(effect.filter, { keywords: ["Reaction"] });

  // 345 / 347.2.a / 466.2.b: "During showdowns here" is the Showdown Open
  // state at this Battlefield; the named predicate is the unmerged gate.
  assert.deepEqual(ability.condition, {
    kind: "expression",
    value: { kind: "constant", value: "showdown-open-at-source-battlefield" }
  });
});

test("ven-160-166 Mystic Vortex golden: the printed increase really adds one any-Domain Power requirement", () => {
  // 356.3 / 357.1: a reaction card that would cost 2 Energy and no Power costs
  // 2 Energy and one [A] after the increase; the merged planner consumes the
  // increase component and keeps the two amounts separate.
  const ctx = contextFor({ energy: 2, power: null });
  const plan = buildCostPlan(ctx, {
    id: "mystic-vortex",
    cost: { energy: { kind: "constant", value: 2 }, payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: SIX_DOMAINS }] },
    increases: [increaseComponent()]
  });

  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: SIX_DOMAINS },
    { amount: 1, allowedDomains: SIX_DOMAINS }
  ]);
  assert.deepEqual(plan.finalized, true);
});

test("ven-160-166 Mystic Vortex golden: a reaction card with no Power to pay the increase cannot be played", () => {
  // 356.3 adds a real requirement; the merged payment preparation rejects the
  // shortfall instead of letting the increase disappear (356.6 only floors
  // discounts at 0, it never removes an increase).
  const ctx = contextFor({ energy: 0, power: null });
  const plan = buildCostPlan(ctx, {
    id: "mystic-vortex-unpayable",
    cost: { energy: { kind: "constant", value: 0 } },
    increases: [increaseComponent()]
  });

  assert.equal(plan.total.power.length, 1);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: SIX_DOMAINS }]);

  // The player has 0 Energy and a Power pool of one Fury: the increase requires
  // an additional Power that the Rune Pool does not contain (357.1), so the
  // merged preparation refuses to pay rather than dropping the requirement.
  const payable = contextFor({ energy: 0, power: null }, { energy: 0, power: ["Fury"] });
  const payablePlan = buildCostPlan(payable, {
    id: "mystic-vortex-payable",
    cost: { energy: { kind: "constant", value: 0 } },
    increases: [increaseComponent()]
  });
  const prepared = prepareCostPayment(payable, payablePlan);
  assert.deepEqual(prepared.actions[0].action.plan.power, ["Fury"]);

  assert.throws(
    () => prepareCostPayment(ctx, plan),
    error => error?.reason === "cannot-pay-cost"
  );
});

test.todo(
  "ven-160-166 Mystic Vortex: install the +1 [A] increase on the affected play's cost plan (356.3) — cost.modify " +
    "is present, but no merged path turns a CardProgram static cost modification into CostPlanInput.increases"
);

test.todo(
  "ven-160-166 Mystic Vortex: decide 'during showdowns here' — Showdown state is owned by chain/engine.ts (showdown-open / " +
    "showdown-close, 345/347.2.a/466.2.b) with no query exposed to a card program, and layers/filter.ts has no sameLocationAs " +
    "(053.3) anchor, so the Battlefield's showdown identity cannot be tested"
);

test.todo(
  "ven-160-166 Mystic Vortex: evaluate 'cards with [Reaction]' (813.5 characteristic) — the merged filter has no keyword " +
    "predicate, and the Hidden remainder (811.6: Hidden cards gain Reaction) needs the Hidden/facedown machinery"
);
