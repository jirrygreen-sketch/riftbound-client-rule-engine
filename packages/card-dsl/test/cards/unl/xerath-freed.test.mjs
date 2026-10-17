import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/xerath-freed.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-df5f8cc7c386af601102e9b0239a7e699523e75147d4cf3cfa84225e77cdc759";
const SOURCE_TEXT =
  ":rb_rune_fury:, :rb_exhaust:: Deal 3 to a unit. Use this ability only while I'm at a battlefield.";

const [ability] = program.abilities;
const [dealThree] = ability.body;
const targetSpec = dealThree.targets[0];

function fixture() {
  const base = world()
    .player("A", { energy: 0, power: ["Fury"] })
    .unit("xerath", { might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("victim", { owner: "B", might: 3 })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("xerath") });
}

test("unl-026-219 Xerath, Freed: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-026-219 Xerath, Freed: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // 377.2.b: the source location must be checked before activation.
  assert.match(program.judgeReason, /377\.2\.b/);
  assert.match(program.judgeReason, /Restriction/);
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test("unl-026-219 Xerath, Freed: 1 Fury Power + Exhaust at Action speed", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 381 / 381.1: no [Action]/[Reaction] is printed, so the default Open-State
  // Action timing applies.
  assert.equal(ability.timing, "action");
  // 404.1.a / 415.5: the printed ":rb_rune_fury:, :rb_exhaust:" is the cost.
  assert.deepEqual(ability.cost, {
    kind: "activated",
    power: { kind: "constant", value: ["Fury"] },
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.deepEqual(ability.restriction, {
    kind: "use-only-while-source-at-battlefield"
  });
});

test("unl-026-219 Xerath, Freed: 'Deal 3 to a unit' is one unrestricted unit target", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(dealThree.id, "xerath-freed.deal-3");
  assert.equal(dealThree.op, "effect.damage");
  assert.deepEqual(dealThree.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(dealThree.args.target, {
    kind: "constant",
    value: "xerath-freed.unit"
  });
  // 355.9 / 355.10: "a unit" carries no controller restriction.
  assert.deepEqual(targetSpec, {
    id: "xerath-freed.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(dealThree.picks, undefined);
  assert.equal(dealThree.linkedTo, undefined);
});

test("unl-026-219 Xerath, Freed golden: the printed 1 Fury + Exhaust cost is really payable", () => {
  const kernel = fixture();
  const plan = buildCostPlan(kernel, { id: "xerath-freed", cost: ability.cost });
  const receipt = payCostPlan(kernel, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.deepEqual(receipt.total.power[0].allowedDomains, ["Fury"]);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(kernel.object(kernel.ref("xerath")).exhausted, true);
});

test("unl-026-219 Xerath, Freed golden: the ability deals the printed 3 to the locked unit", () => {
  const kernel = fixture();
  kernel.setTargets(targetSpec.id, [kernel.ref("victim")]);
  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["xerath-freed.deal-3", "executed"]
  ]);
  assert.equal(kernel.getObject("victim").damage, 3);
  assert.equal(kernel.getObject("xerath").damage, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["damage"]);
});

test("unl-026-219 Xerath, Freed golden: a locked unit that left the Board makes the damage ignored (CR 359.3.e)", () => {
  const kernel = fixture();
  const stale = kernel.ref("victim");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets(targetSpec.id, [stale]);
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, {
    status: "ignored",
    reason: "mistargeted"
  });
});

test("unl-026-219 Xerath, Freed golden: the merged effect.damage alone applies the printed amount", () => {
  const kernel = fixture();
  const run = runInstruction(
    damage,
    { amount: dealThree.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("victim")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 3);
  assert.equal(kernel.getObject("victim").damage, 3);
});

test("unl-026-219 Xerath, Freed: an exhausted source cannot pay the Exhaust cost again (CR 415.4)", () => {
  const kernel = fixture();
  const plan = buildCostPlan(kernel, { id: "xerath-freed", cost: ability.cost });
  payCostPlan(kernel, plan);
  const second = buildCostPlan(kernel, { id: "xerath-freed:again", cost: ability.cost });
  assert.throws(
    () => payCostPlan(kernel, second),
    error =>
      error.name === "CostPlanError" &&
      error.reason === "cannot-pay-cost" &&
      /ready controlled object/.test(error.message)
  );
});

test.todo(
  "unl-026-219 Xerath, Freed: enforce source-at-battlefield before activation and reject Base without paying " +
    "the Fury + Exhaust cost (CR 377.2.b; RIFT-359 location-type Condition)"
);
