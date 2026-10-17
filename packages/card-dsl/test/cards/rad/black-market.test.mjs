import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/black-market.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan, prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-886b8c03b5b72474abc834112983d7b6adab55b1a3525aeddd44a39898736bb3";
const [ability] = program.abilities;

test("black-market: passes validateCardProgram and carries the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    ":rb_rune_rainbow::rb_rune_rainbow:: Draw 1. Each player may use this ability once on their turn (even if they don't control this battlefield)."
  );
});

test("black-market: judgeReason names the any-player permission and the once-per-turn limit", () => {
  assert.match(program.judgeReason, /378\.2/);
  assert.match(program.judgeReason, /381\.3/);
  assert.match(program.judgeReason, /once on their turn/);
});

test("black-market: one action-speed activated ability with the two-[A] rune cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.cost.kind, "activated");
  assert.equal(ability.cost.payments.length, 1);
  const [power] = ability.cost.payments;
  assert.equal(power.kind, "power");
  assert.deepEqual(power.amount, { kind: "constant", value: 2 });
  assert.deepEqual(power.allowedDomains, ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
  assert.deepEqual(ability.restriction, {
    kind: "usage-limit",
    scope: "once-per-turn-per-player",
    activator: "any-player",
    ignoresControl: true
  });
});

test("black-market: body is one unlinked Draw 1 for the ability controller", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "black-market.draw-1");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.targets, undefined);
});

test("black-market: the two-[A] rune cost plans and pays through the merged cost system", () => {
  // 135.2.e.5.a: [A] can be paid by Power of any Domain, so two differently
  // domained runes cover the requirement. The payment path is the merged cost
  // plan; only the any-player permission and the usage limit stay
  // judged on the card program itself.
  const kernel = world().player("A", { power: ["Fury", "Calm"] }).build();
  const plan = buildCostPlan(kernel, { id: "black-market:ability", cost: ability.cost });
  assert.equal(plan.finalized, true);
  assert.deepEqual(plan.total.power, [
    { amount: 2, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
  const prepared = prepareCostPayment(kernel, plan);
  assert.deepEqual(prepared.power.power, [
    { requirementIndex: 0, from: "Fury", amount: 1 },
    { requirementIndex: 0, from: "Calm", amount: 1 }
  ]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.total.power, [
    { amount: 2, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
});

test("black-market: the Draw 1 body executes against the reference kernel", () => {
  // An array deck() block is ordered top-to-bottom, so "top-card" is drawn.
  const kernel = world().deck(["top-card", "bottom-card"]).build();
  // The production chain path: primitives receive their authored Expr nodes
  // (the raw interpreter pre-evaluates arguments, which effect.draw rejects).
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [["black-market.draw-1", "executed"]]
  );
  assert.deepEqual(outcome.events.map((event) => event.action), ["draw"]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(
    kernel.zone("A", "hand").map((ref) => ref.id),
    ["top-card"]
  );
});

test.todo(
  "black-market: any player may activate the Battlefield ability even without controlling it " +
    "(378.2 / 381.3; needs a per-activator permission the activation model does not carry)"
);
test.todo(
  "black-market: each activator may use the ability only once on their own turn " +
    "(383.3.e-style frequency; no merged usage-limit consumer)"
);
