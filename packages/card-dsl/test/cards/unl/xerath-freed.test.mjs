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
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateRestriction } from "../../../../engine-core/dist/programs/play.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
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
  // The refreshed reason names the observed Condition/Expr surface instead of a
  // completed task number.
  assert.match(program.judgeReason, /object-property/);
  assert.match(program.judgeReason, /LocationRef\.type/);
  assert.doesNotMatch(program.judgeReason, /RIFT-359/);
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
    "the Fury + Exhaust cost (CR 377.2.b; no Condition/Expr can read LocationRef.type)"
);

test("unl-026-219 Xerath, Freed gap: the activation restriction has no decidable source-location predicate", () => {
  // The merged binding path already carries a Restriction.condition into the chain
  // draft and Finalize evaluates it; what is missing is a Condition shape that can
  // read the source's LocationRef.type. Assert that split on the real surfaces.
  // (1) The declared descriptive kind cannot be translated at all: the merged
  // adapter fails closed instead of inventing a start permission.
  assert.throws(
    () => translateRestriction(ability.restriction, "xerath"),
    /kind use-only-while-source-at-battlefield needs a rules adapter/
  );
  // (2) A condition-carrying restriction is translated as-is, so the missing piece
  // is the predicate itself, not the plumbing.
  const sourceAtBattlefield = {
    kind: "at-battlefield",
    condition: {
      kind: "compare",
      left: { kind: "count", subject: "objects", filter: { object: "self", location: "battlefield" } },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  };
  assert.deepEqual(translateRestriction(sourceAtBattlefield, "xerath"), [
    sourceAtBattlefield.condition
  ]);
  // ...but the evaluators a restriction condition actually runs through cannot
  // decide it. object-property returns the whole LocationRef, so comparing it to
  // the type string is false; the set-query spelling is only decidable where the
  // query implementation compares location *types*, which the condition path
  // does not use.
  const kernel = world()
    .unit("xerath", { might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("elsewhere", { owner: "B", location: { type: "base", player: "B" } })
    .build();
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("xerath"),
    source: kernel.ref("xerath"),
    controller: "A"
  });
  assert.deepEqual(
    context.evaluate({ kind: "object-property", object: "source", property: "location" }),
    { type: "battlefield", id: "bf-1" }
  );
  assert.equal(
    context.test({
      kind: "compare",
      left: { kind: "object-property", object: "source", property: "location" },
      operator: "eq",
      right: { kind: "constant", value: "battlefield" }
    }),
    false
  );
  assert.equal(context.test(sourceAtBattlefield.condition), false);
  // The reference kernel's set query compares `location` with the whole
  // LocationRef, so the type-string spelling matches nothing there either.
  assert.deepEqual(
    context.query({ object: "self", location: "battlefield" }).map(object => object.ref.id),
    []
  );
  assert.deepEqual(
    context.query({ location: { type: "battlefield", id: "bf-1" } }).map(object => object.ref.id),
    ["xerath"]
  );
  // layers/filter.ts *can* read the type string, but only as a set-query scalar;
  // no Condition node routes the source's own location through that matcher, and
  // the same source sitting at a Base would produce the identical filter value.
  assert.equal(
    matchesObjectFilter({ location: "battlefield" }, kernel.getObject("xerath")),
    true
  );
  assert.equal(
    matchesObjectFilter({ location: "battlefield" }, kernel.getObject("elsewhere")),
    false
  );
});

test("unl-026-219 Xerath, Freed gap: production activation fails closed instead of skipping the printed gate", () => {
  const { judgeReason: _reason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const kernel = world()
    .player("A", { energy: 0, power: ["Fury"] })
    .unit("xerath", { might: 5, location: { type: "battlefield", id: "bf-1" }, cardId: CANONICAL_ID })
    .build();
  assert.throws(
    () => binding.describeActivate(kernel.getObject("xerath"), "A", 0),
    /kind use-only-while-source-at-battlefield needs a rules adapter/
  );
});
