import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/unlicensed-armory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";

const CANONICAL = "card.hash-ddece30c6d18303c9787328b9faf639d34a6e7c0fa1d4d6f6ff5202877e1a0af";

const [activated] = program.abilities;
const [registerReplacement] = activated.body;
const targetSpec = registerReplacement.targets[0];

test("ogn-023-298 Unlicensed Armory: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /recall/i);
  assert.match(program.judgeReason, /457/);
  assert.equal(
    program.sourceText,
    "Discard 1, :rb_exhaust:: Choose a friendly unit. The next time it dies this turn, " +
      "you may pay :rb_rune_fury: to recall it exhausted instead. (Send it to base. This isn't a move.)"
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Unlicensed Armory structure: discard-1 plus exhaust cost, one friendly-unit target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.equal(activated.cost.kind, "activated");

  // “Discard 1, :rb_exhaust::” — both are activation costs (CR 423.3, 415.3.a).
  const payments = activated.cost.payments;
  assert.equal(payments.length, 2);
  const [discardPayment, exhaustPayment] = payments;
  assert.equal(discardPayment.kind, "discard");
  assert.deepEqual(discardPayment.amount, { kind: "constant", value: 1 });
  assert.equal(discardPayment.choice.id, "unlicensed-armory.discarded-card");
  assert.deepEqual(discardPayment.choice.options, ["card-in-controller-hand"]);
  assert.equal(discardPayment.choice.min, 1);
  assert.equal(discardPayment.choice.max, 1);
  assert.equal(discardPayment.choice.selection, "one");
  assert.deepEqual(exhaustPayment, { kind: "exhaust" });

  // “Choose a friendly unit.” — a target (CR 355.10, explicitly per 355.10.c).
  assert.equal(activated.body.length, 1);
  assert.equal(registerReplacement.id, "unlicensed-armory.register-death-replacement");
  assert.equal(registerReplacement.op, "replacement.event");
  assert.equal(registerReplacement.targets.length, 1);
  assert.equal(targetSpec.id, "unlicensed-armory.friendly-unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", controller: "controller", zone: "board" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");

  // The replacement window, its optional payment and the instead-body are described
  // with symbolic selectors only (no runtime ObjectRef in static IR).
  assert.deepEqual(registerReplacement.args.event, { kind: "constant", value: "object-killed" });
  assert.deepEqual(registerReplacement.args.window, {
    kind: "constant",
    value: "next-time-this-turn"
  });
  assert.deepEqual(registerReplacement.args.optional, { kind: "constant", value: true });
  assert.deepEqual(registerReplacement.args.cost, {
    kind: "constant",
    value: { power: 1, domain: "Fury" }
  });
  const insteadBody = registerReplacement.args.instead.value;
  assert.equal(insteadBody.length, 1);
  const [recall] = insteadBody;
  assert.equal(recall.id, "unlicensed-armory.recall");
  assert.equal(recall.op, "effect.move");
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recall.args.state, { kind: "constant", value: "exhausted" });
  assert.deepEqual(recall.args.objects, {
    kind: "target",
    id: "unlicensed-armory.friendly-unit"
  });
});

test("Unlicensed Armory golden: the exhaust half of the activation cost is charged for real", () => {
  const base = world()
    .unit("unlicensed-armory", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("unlicensed-armory") });
  // The exhaust payment of the printed cost, executed through the merged cost plan.
  const plan = buildCostPlan(kernel, {
    id: "cost:unlicensed-armory",
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] }
  });
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ["exhaust"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(kernel.getObject("unlicensed-armory").exhausted, true);
});

test("Unlicensed Armory golden: the discard cost only discards the card the payer picked", () => {
  const base = world()
    .unit("unlicensed-armory", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .hand("hand-card")
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("unlicensed-armory") });
  // The card's own cost carries a static (non-ref) hand-choice placeholder, so the merged cost
  // plan cannot build it; this executes the discard payment with the Finalize-time pick supplied
  // directly, which is the hand-off the cost plan still needs (see the TODO below).
  kernel.setPicks("unlicensed-armory.discarded-card", [base.ref("hand-card")]);
  const plan = buildCostPlan(kernel, {
    id: "cost:unlicensed-armory",
    cost: {
      kind: "activated",
      payments: [
        {
          kind: "discard",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "unlicensed-armory.discarded-card",
            options: [kernel.ref("hand-card")],
            min: 1,
            max: 1,
            selection: "one"
          }
        }
      ]
    }
  });
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ["discard"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.zone("A", "trash").length, 1);
});

test("Unlicensed Armory golden: with nothing in hand the discard payment is not possible", () => {
  const base = world()
    .unit("unlicensed-armory", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("unlicensed-armory") });
  assert.equal(kernel.player("A").handSize, 0);
  assert.throws(
    () =>
      buildCostPlan(kernel, {
        id: "cost:unlicensed-armory",
        cost: {
          kind: "activated",
          payments: [
            {
              kind: "discard",
              amount: { kind: "constant", value: 1 },
              choice: { id: "unlicensed-armory.discarded-card", options: [], min: 1, max: 1, selection: "one" }
            }
          ]
        }
      }),
    error => error.name === "CostPlanError"
  );
  assert.equal(kernel.getObject("unlicensed-armory").exhausted, false);
});

test.todo(
  "Unlicensed Armory: paying the printed “Discard 1” needs the Finalize-time hand pick bound into " +
    "the cost plan (the static card cost can only name the choice, never the runtime hand cards); " +
    "Assembly Rig (sfd-019-221) carries the same gap, owned by RIFT-89."
);

test.todo(
  "Unlicensed Armory: the “next time it dies this turn” delayed replacement needs a delayed " +
    "replacement registration (contract 3.5 replacement family; ResolveContext.registerDelayedTrigger " +
    "has no merged instruction primitive, and the engine only exposes an internal registerReplacement)."
);

test.todo(
  "Unlicensed Armory: the instead-body recalls the chosen unit exhausted. effect.move mode " +
    "\"recall\" is explicitly blocked (CR v1.5 457–460: a Recall is not a Move) and the frozen " +
    "move-location action cannot distinguish the two, so the Recall needs RIFT-109 to add it."
);

test.todo(
  "Unlicensed Armory: the optional :rb_rune_fury: payment inside the replacement needs cost.pay " +
    "(no such primitive is merged; RIFT-89) plus the paid/declined receipt the replacement reads."
);
