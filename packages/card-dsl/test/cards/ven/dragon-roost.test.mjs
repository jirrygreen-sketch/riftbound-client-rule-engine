import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/dragon-roost.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-3c9c1ccb78aab17f295eb8db5ff0c0e32b4b941002aaf23a31a6d820c6a0193a";
const SOURCE_TEXT =
  "Any player may pay :rb_rune_rainbow::rb_rune_rainbow: as an additional cost to play a Dragon. " +
  "If they do, they play it to this battlefield.";

const SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

const [ability] = program.abilities;
const { effect } = ability;

/**
 * A merged cost context: the Dragon being played carries its printed cost, and
 * the player's Rune Pool (357.1) is supplied separately so the merged payment
 * allocator can actually pay the [A][A].
 */
function contextFor(pool, printed = { energy: 0, power: [] }) {
  const base = world()
    .player("A", pool)
    .hand("dragon", { types: ["unit"], tags: ["Dragon"], ...printed })
    .build();
  return base.clone({ sourceSnapshot: base.object(base.ref("dragon")) });
}

/** The card's declared optional additional cost in the merged cost-plan shape. */
function additionalCost(selected) {
  return {
    id: "dragon-roost.additional-cost",
    kind: "additional",
    selected,
    cost: { payments: effect.payments }
  };
}

test("ven-157-166 Dragon Roost: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-157-166 Dragon Roost: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /Dragon/);
  // The golden must prove the new program reaches the shared generated index,
  // not just the file system (scripts/gen-registries.mjs builds it from src/cards/**).
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ven-157-166 Dragon Roost: one optional additional cost of [A][A] for a Dragon", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 356.2.b / 356.2.b.1: an optional additional cost declared by a passive
  // ability; 356.2.a.1 shows the mandatory form must omit "may", which this
  // card does not.
  assert.equal(effect.kind, "cost.additional");
  assert.equal(effect.id, "dragon-roost.additional-cost");
  assert.equal(effect.optional, true);
  assert.equal(effect.stage, "optional-additional");

  // 133.8: "a Dragon" is the printed tag predicate.
  assert.deepEqual(effect.filter, { type: "unit", tags: ["Dragon"] });

  // 135.2.e.5 / 135.2.e.5.a: each :rb_rune_rainbow: is one [A] Power
  // requirement payable by Power of any Domain. The printed "[A][A]" stays two
  // separate 1-Power requirements instead of one 2-Power requirement.
  assert.deepEqual(effect.payments, [
    { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: SIX_DOMAINS },
    { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: SIX_DOMAINS }
  ]);

  // 355.17 / 355.17.a: paying makes "play it to this battlefield" a mandatory
  // requirement; 356.4.f.1 is the paid proof. The binding itself is unmerged
  // (see judgeReason).
  assert.deepEqual(effect.then, {
    kind: "play-to-source-battlefield",
    requirement: "mandatory",
    paidGate: "optional-additional"
  });
});

test("ven-157-166 Dragon Roost golden: paying the optional cost really adds two any-Domain Power requirements", () => {
  // 356.2 / 356.2.a: the additional cost is applied as its own cost component.
  // The merged cost planner takes exactly this shape (optionalAdditional with
  // kind "additional"), and the any-Domain allocator accepts two Power of
  // different Domains (135.2.e.5.a / 163.2.b).
  const ctx = contextFor({ energy: 2, power: ["Fury", "Order"] });
  const plan = buildCostPlan(ctx, {
    id: "dragon-roost",
    // A representative printed Dragon cost; the card's own cost is untouched.
    cost: { energy: { kind: "constant", value: 2 } },
    optionalAdditional: [additionalCost(true)]
  });

  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: SIX_DOMAINS },
    { amount: 1, allowedDomains: SIX_DOMAINS }
  ]);
  assert.deepEqual(plan.selectedAdditional, [
    { id: "dragon-roost.additional-cost", kind: "additional" }
  ]);
  assert.deepEqual(plan.declinedAdditional, []);

  // 357.1: the extra [A][A] is paid from the Rune Pool together with the
  // card's own cost; two Power of different Domains cover both requirements.
  const prepared = prepareCostPayment(ctx, plan);
  assert.equal(prepared.actions[0].action.type, "pay");
  assert.equal(prepared.actions[0].action.plan.energy, 2);
  assert.deepEqual(prepared.actions[0].action.plan.power, ["Fury", "Order"]);
});

test("ven-157-166 Dragon Roost golden: a player without the two [A] cannot pay the optional cost", () => {
  // The player's decision to pay does not weaken the cost: one Power cannot
  // cover two [A] requirements (356.2.b / 357.1), and the merged payment
  // preparation rejects the shortfall instead of reducing the printed cost.
  const ctx = contextFor({ energy: 0, power: ["Fury"] });
  const plan = buildCostPlan(ctx, {
    id: "dragon-roost-short",
    cost: { energy: { kind: "constant", value: 0 } },
    optionalAdditional: [additionalCost(true)]
  });

  assert.equal(plan.total.power.length, 2);
  assert.throws(
    () => prepareCostPayment(ctx, plan),
    error => error?.reason === "cannot-pay-cost"
  );
  // Nothing was charged, and the shortfall did not rewrite the requirement
  // down to one Power.
  assert.equal(ctx.player("A").energy, 0);
  assert.deepEqual(ctx.player("A").power, ["Fury"]);
});

test("ven-157-166 Dragon Roost golden: declining the optional cost leaves the card's own cost untouched", () => {
  // The printed "may" makes declining legal (355.1.a / 356.2.b.1); the merged
  // plan then reports the decline and charges only the card's own cost.
  const ctx = contextFor({ energy: 3, power: ["Fury"] });
  const plan = buildCostPlan(ctx, {
    id: "dragon-roost-declined",
    cost: { energy: { kind: "constant", value: 3 } },
    optionalAdditional: [additionalCost(false)]
  });

  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.selectedAdditional, []);
  assert.deepEqual(plan.declinedAdditional, ["dragon-roost.additional-cost"]);
});

test.todo(
  "ven-157-166 Dragon Roost: charge the optional [A][A] additional cost and feed 356.4.f.1's paid proof into " +
    "\"If they do\" — cost.additional / cost.pay instructions exist and buildCostPlan consumes an " +
    "explicit optionalAdditional, but no producer wires the card program's declared cost and pay decision into Chain Finalize"
);

test.todo(
  "ven-157-166 Dragon Roost: turn payment of the additional cost into the 355.17/355.17.a mandatory play-to-this-battlefield " +
    "requirement — Finalize validates play locations (355.2.b / 420.3.b.2) but no merged consumer reads a play-location " +
    "requirement gated on a cost receipt"
);

test.todo(
  "ven-157-166 Dragon Roost: evaluate the 'a Dragon' predicate (133.8 tag) against any player's card as it is finalized — " +
    "the cost/location plan's object population is supplied by the caller, so the card program cannot name the played Dragon"
);
