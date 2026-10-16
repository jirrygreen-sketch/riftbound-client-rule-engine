import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/stargazer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-9570cba4ea235e9fb599afdadebd17378a1218392dfb718e244466037546deec";
const SOURCE_TEXT =
  "Spells with [Flow] you play from your trash cost :rb_energy_2: less, to a minimum of :rb_energy_1:.";

const [ability] = program.abilities;
const { effect } = ability;

/** A merged Finalize context for the Flow spell being played from the trash. */
const spellContext = () => {
  const base = world()
    .player("A")
    .card("flow-spell", { owner: "A", zone: "trash", types: ["spell"], energy: 5, power: null })
    .build();
  return base.clone({ controller: "A", sourceSnapshot: base.getObject("flow-spell") });
};

/**
 * The card's printed numbers driven through the merged cost plan. CostDiscount.amount
 * is the reduction magnitude (356.4.b) and minimum is that discount's own floor
 * (356.4.e); production still needs the CardProgram → CostPlanInput.discounts
 * wiring, so the golden supplies the discount itself.
 */
const planFor = (energy) =>
  buildCostPlan(spellContext(), {
    id: "stargazer-play",
    cost: { kind: "printed" },
    printed: { id: CANONICAL_ID, cardType: "Spell", domains: ["Chaos"], energy, power: 0 },
    discounts: [
      {
        id: "stargazer",
        resource: effect.resource,
        amount: { kind: "constant", value: 2 },
        minimum: effect.minimum
      }
    ]
  });

test("ven-098-166 Stargazer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-098-166 Stargazer: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /356\.4\.e/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("ven-098-166 Stargazer: one static -2 Energy discount with its own floor of 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 356.4 / 356.4.b: "cost [X] less" is a discount in the cost plan's discount stage.
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.appliesTo, "spell-play-cost");
  assert.equal(effect.resource, "energy");
  assert.deepEqual(effect.amount, { kind: "constant", value: -2 });
  // 356.4.e: "to a minimum of [1]" constrains this discount only.
  assert.deepEqual(effect.minimum, { kind: "constant", value: 1 });
  // 「你打出的法术」：控制者为该能力的控制者。
  assert.deepEqual(effect.filter, { type: "spell", controller: "self" });
});

test("ven-098-166 Stargazer: the Flow-from-trash gate is a named, fail-closed predicate", () => {
  // 「spells with [Flow] you play from your trash」需要读取被施放牌的关键词与来源区域；两者都
  // 没有可求值形状（见 judgeReason 第 2 点），因此用具名谓词记录门槛而不是放宽成所有法术。
  assert.deepEqual(effect.when, {
    kind: "constant",
    value: { spellHasKeyword: "flow", playedFromZone: "trash" }
  });
  assert.deepEqual(ability.condition, {
    kind: "expression",
    value: { kind: "constant", value: "spell-with-flow-played-from-your-trash" }
  });
});

test("ven-098-166 golden: the printed -2 Energy reaches a merged cost plan", () => {
  const plan = planFor(5);
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.discounts, [
    {
      id: "stargazer",
      component: null,
      resource: "energy",
      amount: 2,
      minimum: 1,
      before: 5,
      after: 3
    }
  ]);
});

test("ven-098-166 golden: the discount's own minimum of 1 stops the reduction (356.4.e)", () => {
  // 356.4.e 只约束本折扣；3→1、2→1、1→1，从不超过这 1 点地板。
  assert.equal(planFor(3).total.energy, 1);
  assert.equal(planFor(2).total.energy, 1);
  assert.equal(planFor(1).total.energy, 1);
  for (const energy of [3, 2, 1]) {
    const plan = planFor(energy);
    assert.equal(plan.discounts[0].minimum, 1, `energy=${energy}`);
    assert.equal(plan.discounts[0].after, 1, `energy=${energy}`);
  }
});

test("ven-098-166 golden: without the discount the same spell keeps its printed cost", () => {
  const plan = buildCostPlan(spellContext(), {
    id: "stargazer-plain",
    cost: { kind: "printed" },
    printed: { id: CANONICAL_ID, cardType: "Spell", domains: ["Chaos"], energy: 5, power: 0 }
  });
  assert.equal(plan.total.energy, 5);
  assert.deepEqual(plan.discounts, []);
});

test.todo(
  "ven-098-166 Stargazer: install the static discount on the Finalize cost plan of the Flow spell being " +
    "played — no merged path turns a CardProgram static continuous.cost-modification into CostPlanInput.discounts " +
    "and effects/instructions/ has no cost.modify primitive (RIFT-9 list, RIFT-89)"
);

test.todo(
  "ven-098-166 Stargazer: evaluate 'spells with [Flow] you play from your trash' (829.1.c) — the frozen " +
    "ObjectFilter has no keyword predicate, the continuous effect receives neither the played card's keywords nor " +
    "the source zone of that play, and the Flow expansion's flow.cost is itself unmerged (RIFT-261/RIFT-89)"
);
