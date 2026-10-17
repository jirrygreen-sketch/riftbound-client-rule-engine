import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/skystrike-squadron.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { deflectAmount, deflectCost } from "../../../../engine-core/dist/target/tax/collect.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";

const CARD_ID =
  "card.hash-0637f5fadf7db883948eb6366a512392aa80676b5a0ff45433e37f75c35961c3";

const [play, deflectKeyword] = program.abilities;
const [returnedGear] = play.cost.payments;
const [discount] = play.cost.discounts;

/** Minimal engine so the production static binder can be exercised directly. */
function binderFor() {
  const kernel = world().player("A").player("B").unit("caster", { owner: "A", types: ["unit"] }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return createEngineStaticBinder(engine);
}

test("rad-075-167 Skystrike Squadron: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /return-to-hand/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /mandatoryAdditional/);
});

test("rad-075-167 Skystrike Squadron: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "You may return a friendly gear to its owner's hand as an additional cost to play me. " +
      "If you do, I cost :rb_energy_2: less.\n" +
      "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
  );
});

test("rad-075-167 Skystrike Squadron: the additional cost is optional (356.2 / 356.4.f.1)", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.optional, true);
  assert.equal(play.cost.payments.length, 1);
  assert.deepEqual(play.body, [], "the card has no resolving effect text");
});

test("rad-075-167 Skystrike Squadron: returning the gear is a non-target cost choice (355.10.c)", () => {
  assert.equal(returnedGear.kind, "return-to-hand");
  assert.equal(returnedGear.choice.id, "skystrike-squadron.returned-gear");
  assert.equal(returnedGear.choice.min, 1);
  assert.equal(returnedGear.choice.max, 1);
  assert.equal(returnedGear.choice.selection, "one");
  assert.deepEqual(returnedGear.choice.filter, {
    type: "gear",
    controller: "controller",
    zone: "board"
  });
});

test("rad-075-167 Skystrike Squadron: 'If you do, I cost 2 less' is a conditional 2-energy discount (356.4.c)", () => {
  assert.equal(discount.kind, "cost-modification");
  assert.equal(discount.resource, "energy");
  assert.deepEqual(discount.amount, { kind: "constant", value: -2 });
  // The discount is gated on the optional cost being paid — "if you do" (356.4.f.1).
  assert.equal(discount.condition.kind, "compare");
  assert.equal(discount.condition.operator, "eq");
  assert.deepEqual(discount.condition.right, { kind: "constant", value: true });
});

test("rad-075-167 Skystrike Squadron: [Deflect] carries the printed default value 1 (809.1.b.3)", () => {
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect", value: 1 });
});

test("rad-075-167 Skystrike Squadron: the Deflect keyword expands to a 1-Power target tax (809.1.c / 809.1.c.1)", () => {
  const registered = keywordDefinitionsById.get("Deflect");
  assert.ok(registered, "Deflect is registered in the generated keyword registry");
  const [expansion] = deflect.expand({ host: { canonicalCardId: CARD_ID }, value: 1 });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test("rad-075-167 Skystrike Squadron: the merged pipeline can apply a caller-supplied 2-energy discount", () => {
  // Confirms the *amount* semantics are already supported once the discount reaches the plan;
  // what is missing is discovering it from the paid optional cost (356.4.c/f.1).
  const kernel = world().unit("skystrike-squadron", { might: 4 }).build();
  const plan = buildCostPlan(kernel, {
    id: "unit-play",
    cost: { energy: { kind: "constant", value: 5 } },
    discounts: [
      { id: "skystrike-discount", resource: "energy", amount: { kind: "constant", value: 2 } }
    ]
  });
  assert.equal(plan.total.energy, 3, "a 5 Energy cost reduced by 2");
});

test("rad-075-167 Skystrike Squadron: translateCost really refuses the declared additional cost", () => {
  // 356.2 / 356.4.f.1: the optional additional cost and its conditional discount
  // are authored on the play ability, but the card-program → cost-plan binding
  // rejects both fields before any plan exists (measured, not assumed).
  assert.throws(
    () => translateCost(play.cost, "play:skystrike-squadron-test", "play"),
    /Unsupported play cost field optional/
  );
});

test("rad-075-167 Skystrike Squadron: the cost pipeline really has no return-to-hand payment kind", () => {
  // 356.2.a/.b: "return a friendly gear to its owner's hand" is an additional
  // cost. The merged planner accepts only energy/xp/power and
  // exhaust/discard/recycle/kill/reveal/spend-buff, so the declared payment must
  // fail closed rather than be approximated.
  const kernel = world().player("A").unit("skystrike-squadron", { might: 4 }).build();
  assert.throws(
    () => buildCostPlan(kernel, {
      id: "skystrike-return-to-hand",
      cost: {
        payments: [
          { kind: "return-to-hand", choice: { id: returnedGear.choice.id, options: [], min: 1, max: 1 } }
        ]
      }
    }),
    error => error?.reason === "judge-required" && /Unsupported payment kind: return-to-hand/.test(error.message)
  );
});

test("rad-075-167 Skystrike Squadron: the merged target-tax planner charges 1 any-Domain Power, but the static binder cannot register it", () => {
  // RIFT-360 merged deflectCost: 809.1.c.1's tax is a Power requirement payable
  // by any of the six domains, and the real planner builds it without Energy.
  const taxed = world()
    .player("A", { power: ["Body"] })
    .unit("taxed", { owner: "B", controller: "B", zone: "board", keywords: [{ id: "Deflect", value: 1 }] })
    .build();
  const target = taxed.getObject("taxed");
  assert.equal(deflectAmount(target), 1);
  const plan = buildCostPlan(taxed, { id: "skystrike-tax", cost: deflectCost(1) });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }]);
  // ...but the KeywordDef expansion still has no production entry:
  // layerFor has no target.tax mapping, so the static binder throws.
  assert.throws(
    () => bindStaticAbility(binderFor(), { kind: "static", effect: { kind: "target.tax", value: { kind: "constant", value: 1 } } }, target),
    /Static ability kind target\.tax has no layer mapping/
  );
});

test.todo(
  "rad-075-167 Skystrike Squadron: charge the optional return-a-friendly-gear cost at Finalize and " +
    "apply the resulting 2-Energy discount only when it was paid (356.2 / 356.4.c / 356.4.f.1) — " +
    "translateCost rejects additional-cost/optional/discounts and plan-values has no return-to-hand kind; " +
    "cost-plan discounts come only from explicit caller input"
);

test.todo(
  "rad-075-167 Skystrike Squadron: [Deflect 1] target tax as any-Domain Power — RIFT-360's deflectCost planner " +
    "builds the exact Power requirement, but production statics binding fails because layerFor has no target.tax " +
    "mapping; after that mapping exists, chain/engine.ts finalize must consume TargetTaxCostAdapter's CostPlan " +
    "instead of writing mandatoryAdditional { energy: amount } (809.1.c.1)"
);
