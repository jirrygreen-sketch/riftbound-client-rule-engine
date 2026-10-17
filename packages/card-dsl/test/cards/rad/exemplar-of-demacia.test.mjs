
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/exemplar-of-demacia.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { DUEL_DOMAINS } from "../../../../engine-core/dist/cost/resources.js";
import { normalizeMoveArguments } from "../../../../engine-core/dist/effects/interpreter/locations.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-aeae869420081de1b84e1b857cd09233807ef065f1a55595f74684bdb08821eb";
const SOURCE_TEXT =
  "When you play a gear with [Deploy], you may exhaust me and pay :rb_rune_rainbow: to move a " +
  "friendly unit to that battlefield.";

const [ability] = program.abilities;
const [payInstruction, moveInstruction] = ability.body;

test("rad-155-167 Exemplar of Demacia: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-155-167 Exemplar of Demacia: identity, status, judgeReason, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("rad-155-167 Exemplar of Demacia: card-played trigger for a gear with [Deploy] you played", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.a / timing point "card-played": the played object is the new gear.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: {
      type: "gear",
      controller: "self",
      // CR 830.3 allows checking whether a Gear has Deploy. The merged filter
      // vocabulary has no keywords member, so this stays a declared marker
      // (see judgeReason) and is never treated as evaluated truth.
      characteristics: { deploy: true }
    }
  });
  assert.equal(ability.trigger.condition, undefined);
  // CR 383.3.a / 403.1: the leading "you may" is the triggered ability's own
  // Finalize decision, so it is carried by optional, not by a body choice node.
  assert.equal(ability.optional, true);
});

test("rad-155-167 Exemplar of Demacia: cost within instructions, then a linked move", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "exemplar-of-demacia.pay",
    "exemplar-of-demacia.move-unit"
  ]);

  // CR 383.3.b / 383.3.b.1: "exhaust me and pay [A]" follows the leading "you
  // may", so it is the triggered ability's base cost and is paid at Finalize.
  assert.equal(payInstruction.op, "cost.pay");
  assert.equal(payInstruction.linkedTo, undefined);
  // [A] remains a descriptive marker until trigger costs are bound. The cost
  // planner already represents its requirement with all six allowedDomains.
  assert.deepEqual(payInstruction.args.power, { kind: "constant", value: ["rainbow"] });
  assert.deepEqual(payInstruction.args.payments, {
    kind: "constant",
    value: [{ kind: "exhaust", object: "self" }]
  });

  // CR 383.3.b "[do X] to [do Y]": the move only happens when the cost was paid.
  assert.equal(moveInstruction.op, "effect.move");
  assert.equal(moveInstruction.linkedTo, "exemplar-of-demacia.pay");
  assert.equal(moveInstruction.condition, undefined);
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "exemplar-of-demacia.friendly-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  // "that battlefield" needs the triggering object's location; the merged
  // ObjectSelector vocabulary cannot name it, so the destination stays a
  // descriptive marker (never a real battlefield id).
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: { type: "battlefield", id: "that-battlefield" }
  });

  // CR 355.10 / 355.9.a.1: the moved friendly unit is the only target.
  assert.deepEqual(moveInstruction.targets, [
    {
      id: "exemplar-of-demacia.friendly-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(moveInstruction.picks, undefined);
});

test("rad-155-167 Exemplar of Demacia: the merged cost.pay primitive is registered", () => {
  assert.equal(instructionDefinitionsById.has("cost.pay"), true);
});

test("rad-155-167 Exemplar of Demacia golden: the declared move shape relocates a unit to a literal battlefield", () => {
  // Run the card's own objects/amount shape once a concrete destination has
  // been supplied. Binding the triggering gear's location is still pending.
  const kernel = world()
    .unit("ally", { might: 2, location: { type: "base", player: "A" } })
    .unit("gear", { types: ["gear"], location: { type: "battlefield", id: "bf-2" } })
    .build();
  const scoped = kernel.clone({ source: kernel.ref("gear"), sourceSnapshot: kernel.getObject("gear") });
  const run = runInstruction(
    move,
    {
      objects: moveInstruction.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveInstruction.args.amount
    },
    { world: scoped, targets: { "exemplar-of-demacia.friendly-unit": [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  // runInstruction executes against the supplied world (the scoped clone).
  assert.deepEqual(scoped.getObject("ally").location, { type: "battlefield", id: "bf-2" });
  assert.equal(run.linked.moved.count, 1);
});

test("rad-155-167 Exemplar of Demacia golden: LocationExpr reads an already-bound gear's battlefield through the production adapter", () => {
  // This supplies an existing binding to exercise the location adapter only;
  // it does not add a target to the card or bind the real card-played event.
  const battlefield = { type: "battlefield", id: "bf-2" };
  const kernel = world()
    .unit("ally", { might: 2, location: { type: "base", player: "A" } })
    .unit("gear", { types: ["gear"], location: battlefield })
    .build();
  kernel.setTargets("exemplar-of-demacia.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("bound-gear", [kernel.ref("gear")]);
  const args = normalizeMoveArguments({
    ...moveInstruction.args,
    to: { kind: "location", value: { kind: "target-location", target: "bound-gear" } }
  }, kernel);
  const run = runInstruction(move, args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("ally").location, battlefield);
  assert.deepEqual(kernel.getObject("gear").location, battlefield);
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["move-location"]);
});

for (const domain of DUEL_DOMAINS) {
  test(`rad-155-167 Exemplar of Demacia golden: the [A] requirement validates and allocates ${domain} Power (CR 135.2.e.5.a)`, () => {
    // Only the resource requirement, allocation and pay action are exercised.
    // Trigger Finalize and the Legend exhaust object still need binding. The
    // reference pay host does not prove Power balance debiting (see Ezreal).
    const kernel = world().player("A", { power: [domain] }).unit("source").build();
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("source") });
    const plan = buildCostPlan(scoped, {
      id: "exemplar-of-demacia:any-power",
      cost: { payments: [{
        kind: "power", amount: { kind: "constant", value: payInstruction.args.power.value.length },
        allowedDomains: DUEL_DOMAINS
      }] }
    });
    const receipt = payCostPlan(scoped, plan);

    assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
    assert.equal(receipt.paid, true);
    assert.deepEqual(receipt.actions[0].action.plan.power, [domain]);
    assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: domain, amount: 1 }]);
    assert.deepEqual(scoped.events.map(event => event.action), ["pay"]);
  });
}

test.todo(
  "rad-155-167 Exemplar of Demacia: filter the card-played event for a gear that has the " +
    "Deploy keyword (CR 830.1.a / 830.3; keyword-aware filters)"
);
test.todo(
  "rad-155-167 Exemplar of Demacia: pay the base cost (Exhaust this legend plus 1 Power of " +
    "any domain) during Finalize and remove the trigger when it cannot be paid " +
    "(CR 383.3.b.1 / 415.4 / 135.2.e.5.a; trigger-cost binding and Legend-zone object; any-domain payment already works)"
);
test.todo(
  "rad-155-167 Exemplar of Demacia: move the friendly unit to the triggering gear's " +
    "battlefield (CR 421 / 449; needs the triggering object's location bound as a destination)"
);

