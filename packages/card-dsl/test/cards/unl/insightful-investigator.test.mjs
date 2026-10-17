import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/insightful-investigator.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/index.js";

const CARD_ID =
  "card.hash-c9dc0b3daad63f09feabdf740bc69b2b327719079fe5d68568f0f4680d45abd2";
const SOURCE_TEXT =
  "When you play me, choose an opponent. They reveal their hand. You may pay 2 XP to choose a card " +
  "from their hand. If you do, they discard that card and draw 1.";

const [ability] = program.abilities;
const [chooseOpponent, revealHand, mayPay] = ability.body;
const [payXp, discardChosen, drawOne] = mayPay.args.body.value;
const pickSpec = discardChosen.picks[0];

/** The opponent link is provisioned by the caller, as the production selection pipeline must. */
const OPPONENT_KEY = "insightful-investigator.choose-opponent.chosenOpponent";

/** Strip the IR linkage/target declarations a single step would inherit from its siblings. */
function standalone(instruction) {
  const { linkedTo, targets, ...rest } = instruction;
  return rest;
}

test("unl-135-219 Insightful Investigator: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-135-219 Insightful Investigator: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /target\.player/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /结算时可选支付.*可支付性/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9|RIFT-89/);
  // The reason must name the live registry/payability evidence.
  assert.match(program.judgeReason, /Unregistered instruction opcode|注册表无该原语/);
  assert.match(program.judgeReason, /chooser-only|chooser/);
  assert.match(program.judgeReason, /cannot-pay-cost/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-135-219 Insightful Investigator: play trigger with the four printed steps", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.deepEqual(ability.body.map(step => [step.id, step.op]), [
    ["insightful-investigator.choose-opponent", "target.player"],
    ["insightful-investigator.reveal-hand", "effect.reveal"],
    ["insightful-investigator.may-pay", "choice.optional"]
  ]);
});

test("unl-135-219 Insightful Investigator: choose-an-opponent is a player choice, not an object target", () => {
  // 355.7: the text names a Player; the frozen target/pick vocabulary cannot carry it.
  assert.equal(chooseOpponent.op, "target.player");
  assert.deepEqual(chooseOpponent.args.selection, { kind: "constant", value: "one" });
  assert.deepEqual(chooseOpponent.args.chooser, { kind: "constant", value: "controller" });
  assert.deepEqual(chooseOpponent.args.linkKey, { kind: "constant", value: "chosenOpponent" });
  assert.equal(chooseOpponent.targets, undefined);
  assert.equal(chooseOpponent.picks, undefined);
});

test("unl-135-219 Insightful Investigator: the reveal shows the chosen opponent's whole hand", () => {
  // 425.1 / 425.3.a: no count printed means the whole zone.
  assert.equal(revealHand.op, "effect.reveal");
  assert.equal(revealHand.linkedTo, "insightful-investigator.choose-opponent");
  assert.deepEqual(revealHand.args.player, {
    kind: "linked-value",
    instructionId: "insightful-investigator.choose-opponent",
    key: "chosenOpponent"
  });
  assert.deepEqual(revealHand.args.zone, { kind: "constant", value: "hand" });
  assert.equal(revealHand.args.count, undefined);
  assert.equal(revealHand.targets, undefined);
});

test("unl-135-219 Insightful Investigator: the may node wraps pay, discard and draw (contract 3.9)", () => {
  assert.equal(mayPay.op, "choice.optional");
  assert.equal(mayPay.linkedTo, "insightful-investigator.reveal-hand");
  assert.deepEqual(mayPay.args.prompt, {
    kind: "constant",
    value: "Pay 2 XP to choose a card from their hand?"
  });
  assert.equal(mayPay.args.body.kind, "constant");
  assert.deepEqual(mayPay.args.body.value.map(step => [step.id, step.op]), [
    ["insightful-investigator.pay-xp", "cost.pay"],
    ["insightful-investigator.discard-chosen", "effect.discard"],
    ["insightful-investigator.draw-1", "effect.draw"]
  ]);

  // 383.3.b / 204.3.a: "pay 2 XP to choose a card" is a Cost within Instructions plus its Effect.
  assert.deepEqual(payXp.args.payments, {
    kind: "constant",
    value: { xp: 2 }
  });
  assert.equal(payXp.linkedTo, undefined);
  assert.equal(discardChosen.linkedTo, "insightful-investigator.pay-xp");
  // "discard that card and draw 1" are two independent actions (359.3.e.14.c), so no link between them.
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, {
    amount: { kind: "constant", value: 1 },
    player: {
      kind: "linked-value",
      instructionId: "insightful-investigator.choose-opponent",
      key: "chosenOpponent"
    }
  });

  // 355.10.a / 423.1.a: a card in hand is not a target; the controller chooses it before the opponent discards.
  assert.equal(discardChosen.op, "effect.discard");
  assert.deepEqual(discardChosen.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(discardChosen.args.player, {
    kind: "linked-value",
    instructionId: "insightful-investigator.choose-opponent",
    key: "chosenOpponent"
  });
  assert.deepEqual(discardChosen.args.pick, {
    kind: "constant",
    value: "insightful-investigator.revealed-card"
  });
  assert.equal(discardChosen.targets, undefined);
  assert.deepEqual(pickSpec, {
    id: "insightful-investigator.revealed-card",
    options: [
      {
        kind: "linked-value",
        instructionId: "insightful-investigator.reveal-hand",
        key: "revealed"
      }
    ],
    filter: { zone: "hand" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-135-219 Insightful Investigator golden: the reveal half lists the chosen opponent's whole hand", () => {
  const kernel = world()
    .hand("b1", { owner: "B" })
    .hand("b2", { owner: "B" })
    .hand("a1", { owner: "A" })
    .build();
  kernel.link(OPPONENT_KEY, "B");

  const outcome = resolveChainBody([standalone(revealHand)], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues["insightful-investigator.reveal-hand.revealed"], [
    { id: "b1", zoneEntryId: 1 },
    { id: "b2", zoneEntryId: 1 }
  ]);
  assert.equal(outcome.linkedValues["insightful-investigator.reveal-hand.revealedCount"], 2);
  // 425.1.a.2: revealing does not change the zone, and only the chosen player's hand is shown.
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["b1", "b2"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["a1"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "reveal"]);
});

test("unl-135-219 Insightful Investigator golden: that opponent discards the chosen card and draws 1", () => {
  const kernel = world()
    .hand("b1", { owner: "B" })
    .hand("b2", { owner: "B" })
    .deck(["bd1"], { owner: "B" })
    .build();
  kernel.link(OPPONENT_KEY, "B");
  kernel.setPicks("insightful-investigator.revealed-card", [kernel.ref("b2")]);

  // The may node is accepted by the caller; the production payment choice is
  // still the unresolved part (see judgeReason), so the executable half runs
  // through the chain interpreter as two independent body steps.
  const outcome = resolveChainBody([standalone(discardChosen), standalone(drawOne)], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["insightful-investigator.discard-chosen", "executed"],
    ["insightful-investigator.draw-1", "executed"]
  ]);
  // 423.1: hand → that player's Trash; 414.1: the drawn card goes to that player's hand.
  assert.deepEqual(kernel.zone("B", "trash").map(ref => ref.id), ["b2"]);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["b1", "bd1"]);
  assert.equal(outcome.linkedValues["insightful-investigator.discard-chosen.discarded"].player, "B");
  assert.deepEqual(outcome.events.map(event => event.action), ["discard", "draw"]);
});

test("unl-135-219 Insightful Investigator golden: a stale chosen card negates only the discard", () => {
  const kernel = world().hand("b1", { owner: "B" }).deck(["bd1"], { owner: "B" }).build();
  kernel.link(OPPONENT_KEY, "B");
  const stale = kernel.ref("b1");
  kernel.setPicks("insightful-investigator.revealed-card", [stale]);
  // The card left the hand after Finalize but before this instruction resolved.
  kernel.perform({ type: "discard", object: stale });

  const outcome = resolveChainBody([standalone(discardChosen), standalone(drawOne)], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason ?? null]), [
    ["insightful-investigator.discard-chosen", "negated", "impossible"],
    ["insightful-investigator.draw-1", "executed", null]
  ]);
  // 423.4: nothing more to discard; the independent draw sentence still resolves.
  assert.deepEqual(kernel.zone("B", "trash").map(ref => ref.id), ["b1"]);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["bd1"]);
});

test("unl-135-219 Insightful Investigator golden: declining the may node leaves the opponent's hand untouched", () => {
  const kernel = world().hand("b1", { owner: "B" }).deck(["bd1"], { owner: "B" }).build();
  kernel.link(OPPONENT_KEY, "B");
  kernel.setAnswers({ "insightful-investigator.may-pay/optional": false });

  const outcome = resolveChainBody([standalone(mayPay)], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["insightful-investigator.may-pay", "negated", "skipped"]
  ]);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["b1"]);
  assert.deepEqual(kernel.zone("B", "trash"), []);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "unl-135-219 Insightful Investigator: choose an opponent and lock the player choice at Finalize (CR 355.7) — " +
    "provide the target.player player-choice request and bind its result to the following instructions"
);
test.todo(
  "unl-135-219 Insightful Investigator: pay 2 XP during resolution and expose whether it was paid (CR 383.3.b / " +
    "204.3.a) — the payment primitive and receipt work; the optional affordability decision and failure recovery remain unbound"
);

test("unl-135-219 Insightful Investigator: the production interpreter has no target.player opcode", () => {
  // 355.7 / 355.9.a: the printed "choose an opponent" selects a Player. The merged
  // instruction registry has no target.player, so the card's own first step throws
  // instead of silently picking a seat.
  assert.equal(instructionDefinitionsById.has("target.player"), false);
  const kernel = world().hand("b1", { owner: "B" }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("b1") });
  assert.throws(
    () => resolveChainBody([standalone(chooseOpponent)], context),
    /Unregistered instruction opcode: target\.player/
  );
});

test("unl-135-219 Insightful Investigator: the discard's fallback choice belongs to the discarding opponent", () => {
  // 204.3.a / 423.1.a: the card says the ability's controller chooses the card, but
  // effect.discard's own fallback selection asks the discarding player with
  // chooser-only visibility. That is a different chooser, so it cannot substitute
  // for the printed pick.
  const kernel = world().player("A").player("B").hand("b1", { owner: "B" }).hand("b2", { owner: "B" }).build();
  // The chosen opponent is already locked by the (unimplemented) player choice.
  kernel.link(OPPONENT_KEY, "B");
  const requests = [];
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("b1"), controller: "A" });
  context.choose = question => { requests.push(question); return [question.options[0]]; };

  // The card's own pick has no bound selection, so the fallback path below is the
  // one that would run for an ordinary hand discard.
  assert.deepEqual(context.picks("insightful-investigator.revealed-card"), []);
  const fallback = { ...standalone(discardChosen), args: { ...discardChosen.args, pick: undefined } };
  delete fallback.args.pick;
  const outcome = resolveChainBody([fallback], context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(requests.map(request => [request.type, request.chooser, request.visibility]), [
    ["select-objects", "B", "chooser-only"]
  ]);
  // 423.1: the selected card still leaves that player's hand.
  assert.deepEqual(context.zone("B", "trash").map(ref => ref.id), ["b1"]);
});

test("unl-135-219 Insightful Investigator: the merged cost.pay fails closed when 2 XP cannot be paid", () => {
  // 383.3.b / 203.3: paying 2 XP is part of the instruction, so an unaffordable
  // payment must abort rather than let the dependent discard and draw run. Only one
  // XP is available, so the merged planner raises and nothing is spent.
  const kernel = world().player("A", { xp: 1 }).build();
  assert.throws(
    () => runInstruction(costPay, payXp.args, { world: kernel }),
    error => {
      assert.ok(error instanceof CostPlanError);
      assert.equal(error.reason, "cannot-pay-cost");
      assert.match(error.message, /Insufficient XP/);
      return true;
    }
  );
  assert.equal(kernel.player("A").xp, 1);
});

test("unl-135-219 Insightful Investigator golden: the original cost.pay instruction spends exactly 2 XP and returns a receipt", () => {
  const kernel = world().player("A", { xp: 5, energy: 3 }).build();
  const run = runInstruction(costPay, payXp.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 3);
  assert.equal(kernel.player("A").energy, 3);
  assert.equal(run.linked.payment.paid, true);
  assert.equal(run.linked.payment.player, "A");
  assert.equal(run.events.filter(event => event.action === "spend-xp").length, 1);
});
