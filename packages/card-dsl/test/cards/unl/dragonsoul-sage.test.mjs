import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/dragonsoul-sage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-774ce414b4ee3d0b43aea5f3068e27d3c37a9ea7ef7a2dc53a6716201702d11f";
const SOURCE_TEXT =
  "[Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. (Abilities that add resources can't be reacted to.)";

const [reaction, ability] = program.abilities;
const [addEnergy] = ability.body;

function fixture({ exhausted = false } = {}) {
  const kernel = world()
    .unit("dragonsoul-sage", {
      zone: "board",
      location: { type: "base", player: "A" },
      exhausted
    })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("dragonsoul-sage") });
}

test("unl-093-219 Dragonsoul Sage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-093-219 Dragonsoul Sage: identity, status, no judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-093-219 Dragonsoul Sage: [Reaction] keyword plus one reaction-timed exhaust ability", () => {
  assert.equal(program.abilities.length, 2);
  // 813.1.d: the printed "[Reaction][>]" belongs to the activated ability.
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(ability.kind, "activated");
  // 813.1.c.2: the permission to activate during Closed States; the IR keeps
  // the card's own speed declaration (contract 3.1 / 3.5).
  assert.equal(ability.timing, "reaction");
  assert.equal(ability.restriction, undefined);
  // 415.3.a / 415.5: ":rb_exhaust:" before the ":" is the cost "Exhaust this".
  assert.deepEqual(ability.cost, { kind: "activated", payments: [{ kind: "exhaust" }] });
});

test("unl-093-219 Dragonsoul Sage: the body adds exactly one Energy and never Power", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(addEnergy.id, "dragonsoul-sage.add-energy");
  assert.equal(addEnergy.op, "effect.resources");
  // 430.1 / 430.5: "[Add] :rb_energy_1:" adds exactly one Energy.
  assert.deepEqual(addEnergy.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(addEnergy.args.power, undefined);
  assert.equal(addEnergy.targets, undefined);
  assert.equal(addEnergy.picks, undefined);
  assert.equal(addEnergy.linkedTo, undefined);
});

test("unl-093-219 Dragonsoul Sage golden: paying the exhaust cost then resolving really adds 1 Energy", () => {
  const ctx = fixture();
  const plan = buildCostPlan(ctx, { id: "dragonsoul-sage.activate", cost: ability.cost });
  assert.deepEqual(plan.total.energy, 0);
  assert.deepEqual(
    plan.total.actions.map(entry => entry.action.type),
    ["exhaust"]
  );

  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(ctx.object(ctx.ref("dragonsoul-sage")).exhausted, true);

  const outcome = resolveChainBody(ability.body, ctx);
  assert.equal(outcome.status, "executed");
  assert.equal(ctx.player("A").energy, 1);
  assert.deepEqual(ctx.player("A").power, []);
  assert.deepEqual(
    outcome.linkedValues["dragonsoul-sage.add-energy.resources"],
    { player: "A", energy: 1, power: [] }
  );
  assert.deepEqual(ctx.events.map(event => event.action), ["pay", "exhaust", "gain-energy"]);
});

test("unl-093-219 Dragonsoul Sage golden: an already-exhausted Sage cannot pay, so the ability is not activated", () => {
  const ctx = fixture({ exhausted: true });
  const plan = buildCostPlan(ctx, { id: "dragonsoul-sage.activate", cost: ability.cost });
  // 415.1.b / 415.1.c: an exhausted object cannot be exhausted again, so the
  // Finalize cost check refuses payment (CR 415.4 / 415.5).
  assert.throws(
    () => payCostPlan(ctx, plan),
    error => error.name === "CostPlanError" && /exhaust cost requires a ready/.test(error.message)
  );
  assert.equal(ctx.player("A").energy, 0);
  assert.equal(ctx.object(ctx.ref("dragonsoul-sage")).exhausted, true);
});

test("unl-093-219 Dragonsoul Sage golden: a replaced gain still consumes the paid exhaust cost", () => {
  const ctx = fixture();
  ctx.addReplacement(action => (action.type === "gain-energy" ? "prevented" : null));
  const plan = buildCostPlan(ctx, { id: "dragonsoul-sage.activate", cost: ability.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);

  const outcome = resolveChainBody(ability.body, ctx);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [["dragonsoul-sage.add-energy", "negated", "skipped"]]
  );
  // The cost is a cost: it still happened; the actual Energy addition is 0.
  assert.equal(ctx.player("A").energy, 0);
  assert.equal(ctx.object(ctx.ref("dragonsoul-sage")).exhausted, true);
});

test.todo(
  "unl-093-219 Dragonsoul Sage: the [Reaction] permission itself (CR 813.1.c.2 / 813.2: closed-state " +
    "activation, and 430.3 Add during payment) is expanded by the keyword registry into a " +
    "continuous.timing static ability; the production chain reads the ability's own timing field, " +
    "and the layer consumer is RIFT-91"
);
