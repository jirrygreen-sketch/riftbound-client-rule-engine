import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/sandswept-tomb.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-0ad8407dc26ccc74fcc0edb028e217e9d5f82966e99a5ac3e28141b11504ae5b";
const SOURCE_TEXT =
  "Each spell that chooses one or more units here that are friendly to it costs :rb_rune_rainbow: less.";

const SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

const [ability] = program.abilities;
const { effect } = ability;

/** A merged Finalize context for the spell being played. */
function spellContext() {
  const base = world().hand("spell", { types: ["spell"], energy: 0, power: null }).build();
  return base.clone({ sourceSnapshot: base.object(base.ref("spell")) });
}

/** The printed spell cost the discount applies to: one [A] (a Power of any Domain). */
function planWithDiscount() {
  return buildCostPlan(spellContext(), {
    id: "play",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 0 },
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: SIX_DOMAINS }]
    },
    domains: SIX_DOMAINS,
    // CostDiscount.amount is the reduction magnitude (CR 356.4.b); the card
    // records the printed -1 Power delta (356.4.c.2/356.6 clamp that component
    // at 0). The domains carry the card's any-Domain (135.2.e.5.a) reach.
    discounts: [
      {
        id: "sandswept-tomb",
        resource: effect.resource,
        amount: { kind: "constant", value: 1 },
        domains: effect.domains
      }
    ]
  });
}

test("ven-164-166 Sandswept Tomb: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-164-166 Sandswept Tomb: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("ven-164-166 Sandswept Tomb: one static -1 any-Domain Power discount for the chantless spell cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");

  // 356.4/356.4.b: "costs … less" is a discount on the played spell's cost.
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.appliesTo, "play-cost");
  assert.equal(effect.resource, "power");
  assert.deepEqual(effect.amount, { kind: "constant", value: -1 });
  // 135.2.e.5/135.2.e.5.a: [A] is paid by Power of any Domain, so the discount
  // has to be able to strike a requirement of any of the six domains.
  assert.deepEqual(effect.domains, SIX_DOMAINS);
  assert.equal(effect.minimum, undefined);

  // The spell population the discount watches.
  assert.deepEqual(effect.filter, { type: "spell" });

  // "Each spell that chooses one or more units here that are friendly to it":
  // the gate is a named predicate because the frozen Condition has no shape for
  // reading the played spell's finalized target plan (see judgeReason).
  assert.equal(ability.condition.kind, "expression");
  assert.deepEqual(ability.condition.value, {
    kind: "constant",
    value: "spell-chooses-one-or-more-units-here-friendly-to-it"
  });
});

test("ven-164-166 Sandswept Tomb golden: the discount removes one any-Domain Power requirement in a merged cost plan", () => {
  const plan = planWithDiscount();

  // 135.2.e.5.a: the [A] requirement was payable with Power of any Domain, and
  // the card's -1 Power discount removes it entirely.
  assert.deepEqual(plan.total.power, []);
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.discounts, [
    {
      id: "sandswept-tomb",
      component: null,
      resource: "power",
      amount: 1,
      minimum: 0,
      before: 1,
      after: 0
    }
  ]);
});

test("ven-164-166 Sandswept Tomb golden: without the discount the same spell still costs one any-Domain Power", () => {
  const plan = buildCostPlan(spellContext(), {
    id: "play-plain",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: 0 },
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: SIX_DOMAINS }]
    },
    domains: SIX_DOMAINS
  });

  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: SIX_DOMAINS }]);
  assert.deepEqual(plan.discounts, []);
});

test.todo(
  "ven-164-166 Sandswept Tomb: install the static discount on the chosen spell's cost plan — no merged path turns " +
    "a CardProgram's static continuous.cost-modification into CostPlanInput.discounts, and effects/instructions/ has " +
    "no cost.modify primitive (in-flight RIFT-261); RIFT-257's statics.ts is only a callback slot"
);

test.todo(
  "ven-164-166 Sandswept Tomb: evaluate 'chooses one or more units here that are friendly to it' (355.7/355.15, 053.3 " +
    "'here', 740.1.a 'friendly to it') against the spell's finalized target plan — the frozen Condition has no " +
    "played-spell-target predicate (RIFT-90's TargetPlan is consumed inside the chain only), layers/filter.ts does " +
    "not read the sameLocationAs anchor, and no selector reads 'the controller of the spell being played'"
);
