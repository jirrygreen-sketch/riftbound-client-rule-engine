import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import meditation from "../../../dist/cards/ogn/meditation.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-5f2d6f607453430a6a4ce49c58ea5afd8af16815ac3b16ed3cdf9526ba7f074f";

const [keyword, play] = meditation.abilities;
const [drawTwo, drawOne] = play.body;

test("Meditation program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(meditation);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Meditation identity, ruleset, status and printed text", () => {
  assert.equal(meditation.canonicalCardId, CANONICAL);
  assert.equal(meditation.rulesetVersion, "core-1.5");
  assert.equal(meditation.status, "judge-required");
  assert.match(meditation.judgeReason, /415\.4/);
  assert.match(meditation.judgeReason, /CostPlanInput/);
  assert.match(meditation.judgeReason, /programs\/play\.ts/);
  assert.equal(cardRegistryById.get(meditation.canonicalCardId), meditation);
  assert.equal(
    meditation.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "As an additional cost to play this, you may exhaust a friendly unit. " +
      "If you do, draw 2. Otherwise, draw 1."
  );
});

test("Meditation keeps the printed [Reaction] keyword (CR 813)", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
});

test("Meditation records the optional additional exhaust cost (CR 204.2 / 356.2.b / 415.4)", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "cost.additional");
  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "cost.exhaust");
  assert.equal(payment.choice.id, "meditation.exhaust-choice");
  assert.equal(payment.choice.selection, "one");
  assert.deepEqual(payment.choice.filter, { type: "unit", controller: "controller" });
});

test("Meditation body: draw 2 when the cost was paid, draw 1 otherwise", () => {
  assert.equal(play.body.length, 2);
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["draw-2-if-paid", "effect.draw"],
      ["draw-1-otherwise", "effect.draw"]
    ]
  );
  assert.deepEqual(drawTwo.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  // "If you do / Otherwise" are mutually exclusive result branches; the two
  // instructions are deliberately independent (an ignored branch must not
  // suppress the other) and each reads the finalized optional-cost receipt.
  assert.equal(drawTwo.linkedTo, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  assert.deepEqual(drawTwo.condition, {
    kind: "result",
    result: "additional-cost-paid",
    id: "meditation.exhaust"
  });
  assert.deepEqual(drawOne.condition, {
    kind: "not",
    condition: {
      kind: "result",
      result: "additional-cost-paid",
      id: "meditation.exhaust"
    }
  });
});

test("Meditation golden: the Draw 2 and Draw 1 halves each draw through effect.draw", () => {
  // The two draw amounts are the card's own values and resolve through the
  // real primitive: CR 414.1 draws from the top of the Main Deck. Branch
  // selection is covered below with a finalized cost receipt.
  const paid = world().deck(["a", "b", "c"], { owner: "A" }).build();
  const drawTwoRun = runInstruction(draw, drawTwo.args, { world: paid });
  assert.equal(drawTwoRun.result.status, "executed");
  assert.equal(drawTwoRun.linked.drawn, 2);
  assert.equal(paid.player("A").handSize, 2);
  assert.deepEqual(paid.zone("A", "hand").map(ref => ref.id), ["a", "b"]);

  const declined = world().deck(["a", "b", "c"], { owner: "A" }).build();
  const drawOneRun = runInstruction(draw, drawOne.args, { world: declined });
  assert.equal(drawOneRun.result.status, "executed");
  assert.equal(drawOneRun.linked.drawn, 1);
  assert.deepEqual(declined.zone("A", "hand").map(ref => ref.id), ["a"]);
});

test("Meditation golden: the merged cost plan accepts and pays the optional additional exhaust (204.2/415.4)", () => {
  // The merged planner's optional-additional component + the exhaust payment
  // action is the executable half of the printed cost; the golden pays the
  // real plan and asserts the chosen friendly unit ends exhausted.
  const kernel = world()
    .player("A", { energy: 10 })
    .unit("meditation", { types: ["spell"], owner: "A" })
    .unit("friendly-unit", { owner: "A" })
    .build();
  const friendly = kernel.ref("friendly-unit");
  kernel.setPicks("meditation.exhaust-choice", [friendly]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("meditation") });
  const plan = buildCostPlan(context, {
    id: "cost:meditation",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    optionalAdditional: [{
      id: "meditation.exhaust",
      kind: "additional",
      selected: true,
      cost: { payments: [{ kind: "exhaust", choice: { id: "meditation.exhaust-choice", options: [friendly], min: 1, max: 1, selection: "one" } }] }
    }]
  });
  assert.deepEqual(plan.selectedAdditional, [{ id: "meditation.exhaust", kind: "additional" }]);
  assert.deepEqual(plan.total.actions.map(action => action.action.type), ["exhaust"]);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("friendly-unit").exhausted, true);
  assert.deepEqual(receipt.additional, [{ id: "meditation.exhaust", kind: "additional", paid: true }]);
});

test("Meditation golden: declining the additional cost charges only the base cost and exhausts nothing", () => {
  const kernel = world()
    .player("A", { energy: 10 })
    .unit("meditation", { types: ["spell"], owner: "A" })
    .unit("friendly-unit", { owner: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("meditation") });
  const plan = buildCostPlan(context, {
    id: "cost:meditation-decline",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    optionalAdditional: [{ id: "meditation.exhaust", kind: "additional", selected: false, cost: { payments: [{ kind: "exhaust" }] } }]
  });
  assert.deepEqual(plan.selectedAdditional, []);
  assert.deepEqual(plan.declinedAdditional, ["meditation.exhaust"]);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay"]);
  assert.equal(context.getObject("friendly-unit").exhausted, false);
});

test("Meditation golden: an optional additional cost that cannot be completed aborts the payment (415.4)", () => {
  // CR 415.4 requires the cost action to be completable; an exhausted friendly
  // unit cannot be exhausted again, so paying the selected component fails and
  // the Finalize transaction would abort rather than play for free.
  const kernel = world()
    .player("A", { energy: 10 })
    .unit("meditation", { types: ["spell"], owner: "A" })
    .unit("friendly-unit", { owner: "A", exhausted: true })
    .build();
  const friendly = kernel.ref("friendly-unit");
  kernel.setPicks("meditation.exhaust-choice", [friendly]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("meditation") });
  const plan = buildCostPlan(context, {
    id: "cost:meditation-blocked",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    optionalAdditional: [{
      id: "meditation.exhaust",
      kind: "additional",
      selected: true,
      cost: { payments: [{ kind: "exhaust", choice: { id: "meditation.exhaust-choice", options: [friendly], min: 1, max: 1, selection: "one" } }] }
    }]
  });
  assert.throws(() => payCostPlan(context, plan), error => error.reason === "cannot-pay-cost");
});

test("Meditation golden: the printed exhaust payment is a real exhaust of a friendly unit (CR 415.4)", () => {
  // CR 415.4 requires the cost action to be completable; this executes the
  // exact exhaust action the finalized cost plan would submit for a chosen
  // friendly unit (the card's filter), leaving the unit exhausted.
  const kernel = world().unit("friendly-unit", { exhausted: false }).build();
  const run = runInstruction(
    exhaust,
    { target: "meditation.exhaust-choice" },
    { world: kernel, targets: { "meditation.exhaust-choice": [kernel.ref("friendly-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").exhausted, true);
  assert.equal(run.linked.exhausted.count, 1);
});

test.todo(
  "Meditation optional additional cost: declare and pay \"you may exhaust a friendly unit\" during " +
    "Finalize (CR 204.2 / 356.2.b / 355.1.a) and fail the play when it cannot be completed (CR 415.4) " +
    "- the merged planner pays a constructed optional-additional exhaust component (golden), but " +
    "programs/play.ts still does not translate the card's cost.additional declaration into " +
    "CostPlanInput.optionalAdditional"
);

test("Meditation golden: condition.result selects Draw 2 only when the optional cost was paid", () => {
  const paid = world()
    .player("A", { energy: 10 })
    .unit("meditation", { types: ["spell"], owner: "A" })
    .unit("friendly-unit", { owner: "A" })
    .deck(["a", "b", "c"], { owner: "A" })
    .build();
  const paidRef = paid.ref("friendly-unit");
  paid.setPicks("meditation.exhaust-choice", [paidRef]);
  const paidContext = paid.clone({ sourceSnapshot: paid.getObject("meditation") });
  const paidPlan = buildCostPlan(paidContext, {
    id: "cost:meditation-result-paid",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    optionalAdditional: [{
      id: "meditation.exhaust",
      kind: "additional",
      selected: true,
      cost: { payments: [{ kind: "exhaust", choice: { id: "meditation.exhaust-choice", options: [paidRef], min: 1, max: 1, selection: "one" } }] }
    }]
  });
  const paidReceipt = payCostPlan(paidContext, paidPlan);
  const paidOutcome = resolveChainBody(play.body, paidContext, { cost: { plan: paidPlan, receipt: paidReceipt } });
  assert.deepEqual(paidOutcome.results.map(result => [result.id, result.result.status]), [
    ["draw-2-if-paid", "executed"],
    ["draw-1-otherwise", "negated"]
  ]);
  assert.equal(paidContext.player("A").handSize, 2);

  const declined = world()
    .player("A", { energy: 10 })
    .unit("meditation", { types: ["spell"], owner: "A" })
    .unit("friendly-unit", { owner: "A" })
    .deck(["a", "b", "c"], { owner: "A" })
    .build();
  const declinedContext = declined.clone({ sourceSnapshot: declined.getObject("meditation") });
  const declinedPlan = buildCostPlan(declinedContext, {
    id: "cost:meditation-result-declined",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    optionalAdditional: [{
      id: "meditation.exhaust",
      kind: "additional",
      selected: false,
      cost: { payments: [{ kind: "exhaust" }] }
    }]
  });
  const declinedReceipt = payCostPlan(declinedContext, declinedPlan);
  const declinedOutcome = resolveChainBody(play.body, declinedContext, { cost: { plan: declinedPlan, receipt: declinedReceipt } });
  assert.deepEqual(declinedOutcome.results.map(result => [result.id, result.result.status]), [
    ["draw-2-if-paid", "negated"],
    ["draw-1-otherwise", "executed"]
  ]);
  assert.equal(declinedContext.player("A").handSize, 1);
});
