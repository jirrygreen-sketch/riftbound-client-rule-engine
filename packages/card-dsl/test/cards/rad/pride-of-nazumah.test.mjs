import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/pride-of-nazumah.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL_ID =
  "card.hash-429ae86450b57eb8b5283953594d1e2375732b2cc9c460d030a5a5b418afd418";
const SOURCE_TEXT =
  ':rb_energy_1:, :rb_exhaust:: Give a friendly unit "I have [Assault] equal to my [Shield]" ' +
  "this turn. (+1 :rb_might: for each instance of Assault while it's an attacker.)";

const [ability] = program.abilities;
const [grant] = ability.body;

test("rad-147-167 Pride of Nazumah: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-147-167 Pride of Nazumah: identity, status, judgeReason, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The gap must stay concrete: which primitive is missing and which task owns it.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Shield Value/);
  // The reason must name the merged code that rejects each half, not a task id.
  assert.match(program.judgeReason, /MissingInformation/);
  assert.match(program.judgeReason, /non-negative integer/);
  assert.match(program.judgeReason, /cannot-pay-cost/);
  assert.match(program.judgeReason, /board\/rune-zone/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
  // The generated card registry indexes this program by canonicalCardId.
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("rad-147-167 Pride of Nazumah: activated ability charges 1 Energy plus Exhaust this", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.restriction, undefined);
  // CR 204.1.b / 415.5: the printed cost before the colon; CR 415.4 makes the
  // exhaust a payment that must be completable, not an effect state change.
  assert.deepEqual(ability.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [{ kind: "exhaust", object: "self" }]
  });
});

test("rad-147-167 Pride of Nazumah: body grants Assault equal to the target's Shield, this turn", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "pride-of-nazumah.grant-assault"
  ]);
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.equal(grant.linkedTo, undefined);
  assert.equal(grant.condition, undefined);
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  // CR 814.1.b.2: the granted value is the recipient's Shield Value, read from
  // the selected unit itself (a placeholder expression, see judgeReason).
  assert.deepEqual(grant.args.value, {
    kind: "object-property",
    object: { target: "pride-of-nazumah.friendly-unit" },
    property: "shield"
  });
  // CR 807.1.d.1 / 814.1.d.1: the grant lasts until end of turn.
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // CR 355.9.a.1 / 355.10: one friendly unit is targeted, nothing else.
  assert.equal(grant.picks, undefined);
  assert.deepEqual(grant.targets, [
    {
      id: "pride-of-nazumah.friendly-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-147-167 Pride of Nazumah: the dynamic Shield read is not representable by the merged expression language", () => {
  // The declared value read is not resolvable: ObjectSnapshot exposes keywords
  // as a list, not a "shield" property, so the merged interpreter's
  // object-property path raises MissingInformation. That is exactly the open
  // gap judgeReason names, and no static Assault value is substituted for it.
  const { targets, ...bodyOnly } = grant;
  const kernel = world()
    .unit("ally", { might: 2, keywords: [{ id: "Shield", value: 2 }] })
    .build();
  kernel.setTargets("pride-of-nazumah.friendly-unit", [kernel.ref("ally")]);
  const outcome = runAbilityBody([bodyOnly], kernel, undefined, { host: kernel.ref("ally") });
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status, result.result.reason]),
    [[
      "pride-of-nazumah.grant-assault",
      "ignored",
      "mistargeted"
    ]]
  );
  // The recipient kept exactly its current keywords — nothing was approximated.
  assert.deepEqual(kernel.getObject("ally").keywords, [{ id: "Shield", value: 2 }]);
});

test("rad-147-167 Pride of Nazumah: a fixed Assault value does execute through the merged grant", () => {
  // The merged continuous.grant-keyword op is what the card will run once a
  // readable keyword-value expression exists; proving the grant lands keeps the
  // remaining gap precisely on the dynamic value read and the Legend Zone cost,
  // not on the keyword mechanics.
  const kernel = world()
    .unit("ally", { might: 2, keywords: [{ id: "Shield", value: 2 }] })
    .build();
  const { targets, ...bodyOnly } = grant;
  const run = runInstruction(
    grantKeyword,
    {
      ...bodyOnly.args,
      value: { kind: "constant", value: 2 },
      target: "pride-of-nazumah.friendly-unit"
    },
    { world: kernel, targets: { "pride-of-nazumah.friendly-unit": [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.grant-keyword");
  assert.equal(kernel.continuousEffects[0].effect.effect.keyword, "Assault");
  assert.equal(kernel.continuousEffects[0].effect.effect.keywordValue, 2);
});

test.todo(
  "rad-147-167 Pride of Nazumah: dynamically grant [Assault] with a value read from the " +
    "recipient's Shield Value (CR 814.1.b.2) — the IR has no keyword-value read expression " +
    "(contract change request), so the merged continuous.grant-keyword cannot be fed"
);

test("rad-147-167 Pride of Nazumah: the merged grant consumes a keyword value only as an integer", () => {
  // Both merged paths fail on the same missing expression. The interpreter route
  // reports ignored/mistargeted; the primitive route rejects the evaluated value
  // outright, so no Assault is ever placed.
  const { targets, ...bodyOnly } = grant;
  const kernel = world()
    .unit("ally", { might: 2, keywords: [{ id: "Shield", value: 2 }] })
    .build();
  assert.throws(
    () => runInstruction(
      grantKeyword,
      { ...bodyOnly.args, target: "pride-of-nazumah.friendly-unit" },
      { world: kernel, targets: { "pride-of-nazumah.friendly-unit": [kernel.ref("ally")] } }
    ),
    (error) => error instanceof TypeError && /value must be a non-negative integer/.test(error.message)
  );
  assert.equal(kernel.continuousEffects.length, 0);
  assert.deepEqual(kernel.getObject("ally").keywords, [{ id: "Shield", value: 2 }]);
});

test("rad-147-167 Pride of Nazumah: the authored cost plans but the exhaust payment cannot commit", () => {
  // CR 204.1.b / 415.4 / 415.5: the merged planner reads the printed "activated"
  // cost, but the payer requires a ready controlled Board/rune-zone object, and
  // CR 107.4 puts a Champion Legend outside the Board zones the contract knows.
  const kernel = world()
    .player("A", { energy: 3 })
    .card("legend", { types: ["legend"], zone: "deck" })
    .build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("legend"),
    controller: "A",
    timingPoint: "main-start"
  });

  const plan = buildCostPlan(context, { id: "cost:pride", cost: ability.cost });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.total.actions.map(entry => [entry.action.type, entry.action.object.id]), [
    ["exhaust", "legend"]
  ]);

  assert.throws(
    () => payCostPlan(context, plan),
    (error) => error instanceof CostPlanError && error.reason === "cannot-pay-cost" &&
      /ready controlled object on the Board/.test(error.message)
  );
});
