import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/kraken-hunter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { evaluateExtendedExpression } from "../../../../engine-core/dist/effects/interpreter/expr-ext/index.js";

const CANONICAL = "card.hash-763d40ad13566634b64cc2de5da621393c0cf40858bb36abd9052e741aba4c2f";

/** A real chain engine so the production static binder and cost planner run. */
function engineFor() {
  const kernel = world()
    .player("A", { energy: 20, power: ["Body"] })
    .player("B", { energy: 20 })
    .unit("kraken", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 5, buffs: 2, combatRole: "attacker" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}

test("ogn-150-298 Kraken Hunter: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
      "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
      "As you play me, you may spend any number of buffs as an additional cost. Reduce my cost by :rb_rune_body: for each buff you spend."
  );
});

test("ogn-150-298 Kraken Hunter: judgeReason cites the variable additional cost and linked discount", () => {
  assert.match(program.judgeReason, /spend-buff/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /payCostPlan/);
  // Restored from the pre-resweep assertion /cost\.pay \/ cost\.modify/, split
  // because the refreshed reason names the merged primitives separately.
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /固定数量的 cost\.modify 已能执行/);
  assert.match(program.judgeReason, /cost\/discounts/);
  assert.match(program.judgeReason, /356\.4\.c/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /expr-ext\/evaluate\.ts/);
  assert.match(program.judgeReason, /MissingInformation/);
});

test("ogn-150-298 Kraken Hunter: Accelerate and Assault stay keyword declarations only", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "assault" });
  // No hand-rolled expansion of either keyword: 805.1.b / 807.1.b.3 are owned by
  // the KeywordDef files (cards/README.md section 5).
  assert.equal(program.abilities.some(ability => ability.kind === "static"), false);
  assert.equal(program.abilities.some(ability => ability.kind === "replacement"), false);
});

test("ogn-150-298 Kraken Hunter: the merged Assault KeywordDef expands the printed keyword (807)", () => {
  const assault = keywordDefinitionsById.get("Assault");
  assert.ok(assault, "Assault KeywordDef must be registered");
  assert.equal(assault.valued, true);
  assert.equal(assault.stacking, "sum");
  const [expanded] = assault.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  // 807.1.b.3: no printed Assault Value means 1.
  assert.deepEqual(expanded.effect.amount, { kind: "constant", value: 1 });
  assert.equal(expanded.effect.kind, "continuous.might");
  assert.equal(expanded.condition.left.property, "designation");
  assert.deepEqual(expanded.condition.right, { kind: "constant", value: "attacker" });
});

test("ogn-150-298 Kraken Hunter: the merged Accelerate KeywordDef declares the optional [1][C] cost (805.1.b)", () => {
  const accelerate = keywordDefinitionsById.get("Accelerate");
  assert.ok(accelerate, "Accelerate KeywordDef must be registered");
  assert.equal(accelerate.valued, false);
  assert.equal(accelerate.stacking, "single");
  const expanded = accelerate.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.length, 2);
  const [cost, replacement] = expanded;
  assert.equal(cost.kind, "static");
  assert.equal(cost.effect.kind, "accelerate.cost");
  assert.deepEqual(cost.effect.cost.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } },
    { kind: "power", amount: { kind: "constant", value: 1 } }
  ]);
  assert.equal(cost.effect.cost.optional, true);
  assert.equal(replacement.kind, "replacement");
  assert.equal(replacement.replaces.event, "object-enters-board");
});

test("ogn-150-298 Kraken Hunter: the expanded accelerate.cost still has no static layer mapping", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("kraken");
  const expanded = createProgramBinding({ cardPrograms: [program] }).inspect(source).abilities;
  const accelerateCost = expanded.find(ability => ability.kind === "static" && ability.effect.kind === "accelerate.cost");
  assert.ok(accelerateCost, "[Accelerate] must expand to the declared accelerate.cost static");
  const error = (() => {
    try {
      createEngineStaticBinder(engine).bindStatic(accelerateCost, source);
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error, "the merged static binder must still refuse accelerate.cost while the gap is open");
  assert.equal(error.code, "judge-required");
  assert.match(error.message, /accelerate\.cost has no layer mapping/);
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("ogn-150-298 Kraken Hunter: the expanded Assault Might is inert because designation has no producer", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("kraken");
  const assault = createProgramBinding({ cardPrograms: [program] }).inspect(source).abilities
    .find(ability => ability.kind === "static" && ability.effect.kind === "continuous.might");
  const handle = createEngineStaticBinder(engine).bindStatic(assault, source);
  const registered = engine.layers.registry.list()[0];
  // The bundled condition evaluates against `designation`, which no merged
  // producer writes; the snapshot only carries combatRole (contract 3.8).
  assert.equal(registered.effect.effect.condition(kernel.getObject("kraken")), false);
  assert.equal(kernel.getObject("kraken").combatRole, "attacker");
  assert.equal(Object.hasOwn(kernel.getObject("kraken"), "designation"), false);
  assert.equal(engine.layers.evaluate(kernel.ref("kraken")).might, 5);
  // 2026-10-17 re-sweep: the gap is dispatch, not the characteristic. The
  // default evaluator throws MissingInformation for "designation" and the
  // binder swallows it, while the merged expr-ext evaluator (RIFT-711) already
  // resolves the same expression to combatRole.
  assert.throws(
    () => evaluateCondition(assault.condition, {
      context: bindResolveContext(kernel, { source, controller: "A", timingPoint: "main-start" }),
      host: source.ref,
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false,
      query: filter => kernel.query(filter)
    }),
    /Unavailable characteristic: designation/
  );
  assert.equal(
    evaluateExtendedExpression(assault.condition.left, {
      context: bindResolveContext(kernel, { source, controller: "A", timingPoint: "main-start" }),
      host: source.ref,
      linked: () => undefined,
      canLookBack: () => true,
      isIgnored: () => false,
      query: filter => kernel.query(filter)
    }),
    "attacker"
  );
  handle.unbind();
});

test("ogn-150-298 Kraken Hunter: a fixed-count spend-buff is buildable but a paid-count discount is not", () => {
  const base = world()
    .player("A", { energy: 20, power: ["Body"] })
    .unit("kraken", { cardId: CANONICAL, owner: "A", controller: "A", types: ["unit"], might: 5, buffs: 2 })
    .build();
  const context = base.clone({ controller: "A", sourceSnapshot: base.getObject("kraken") });
  const source = context.getObject("kraken");
  const cost = { id: "kraken.probe", cost: { energy: { kind: "constant", value: 3 } } };
  // A fixed amount is expressible; the printed "any number" is not, and the
  // per-buff discount cannot read that amount back through a linked value.
  const plan = buildCostPlan(context, {
    ...cost,
    optionalAdditional: [{
      id: "kraken.buffs",
      kind: "additional",
      selected: true,
      cost: { payments: [{ kind: "spend-buff", objects: [source.ref], amount: { kind: "constant", value: 2 } }] }
    }],
    discounts: [{ id: "kraken.per-buff", resource: "power", amount: { kind: "constant", value: 1 } }]
  });
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ["spend-buff"]);

  const error = (() => {
    try {
      buildCostPlan(context, {
        ...cost,
        discounts: [{ id: "kraken.per-buff", resource: "power", amount: { kind: "linked-value", instructionId: "cost.pay", key: "spentCount" } }]
      });
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error, "a paid-count discount must still be rejected while the gap is open");
  assert.match(error.message, /Discount must be a nonnegative safe integer/);

  // The merged cost.modify can only carry a *fixed* spend-buff count, and the
  // resulting plan exposes that count on CostPlan.total.actions while every
  // discount slot still requires a plain number, so nothing can turn the paid
  // count into "one Body per buff you spend" (356.4.c).
  const fixed = runInstruction(costModify, {
    id: "kraken.per-buff",
    cost: { payments: [{ kind: "spend-buff", objects: [source.ref], amount: { kind: "constant", value: 2 } }] },
    linkKey: "plan"
  }, { world: context });
  assert.equal(fixed.result.status, "executed");
  const paidPlan = fixed.linked.plan;
  assert.deepEqual(paidPlan.total.actions.map(entry => entry.action.amount), [2]);
  assert.equal(paidPlan.discounts.length, 0);
  assert.equal("paidAmount" in paidPlan.total.actions[0].action, false);
  const receipt = payCostPlan(context, paidPlan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.events.map(event => event.action), ["pay", "spend-buff"]);
  assert.equal(context.getObject("kraken").buffs, 0);
});

test.todo(
  "ogn-150-298 Kraken Hunter: 'you may spend any number of buffs as an additional cost' needs a " +
    "variable-count optional additional cost at Finalize (CR v1.5 356.4 / 203.x); the merged " +
    "cost-plan optionalAdditional is a per-component boolean (cost/README.md), not an unbounded count, " +
    "and the payment result is not fed back into the play cost plan."
);
test.todo(
  "ogn-150-298 Kraken Hunter: 'Reduce my cost by [Body] for each buff you spend' needs a component " +
    "discount that reads the paid spend-buff count (CR v1.5 356.4.c); CostDiscount.amount only takes a " +
    "static Expr today."
);
