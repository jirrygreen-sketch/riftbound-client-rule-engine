import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import meditation from "../../../dist/cards/ogn/meditation.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import exhaust from "../../../../engine-core/dist/effects/instructions/effect.exhaust.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(meditation.judgeReason, /CostSpec/);
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
  // suppress the other) and each carries its own condition.
  assert.equal(drawTwo.linkedTo, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawTwo.condition.kind, "expression");
  assert.deepEqual(drawOne.condition.kind, "not");
  assert.equal(drawOne.condition.condition.kind, "expression");
  assert.deepEqual(drawTwo.condition.value, drawOne.condition.condition.value);
});

test("Meditation golden: the Draw 2 and Draw 1 halves each draw through effect.draw", () => {
  // The branch itself is unexecutable (no cost receipt binding), but the two
  // draw amounts are the card's own values and must resolve through the real
  // primitive: CR 414.1 draws from the top of the Main Deck.
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

test("Meditation interpreter: the result branch fails closed instead of guessing a draw", () => {
  // "If you do" reads whether the optional additional cost was paid; no
  // merged ResolveContext path exposes that receipt, so the characteristic
  // read is unavailable and both conditional draws are ignored. Neither draw
  // happens by accident and nothing is approximated.
  assert.equal(instructionDefinitionsById.has("condition.result"), false);
  const kernel = world().deck(["a", "b", "c"], { owner: "A" }).build();
  const outcome = runAbilityBody(play.body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["draw-2-if-paid", "draw-1-otherwise"]);
  assert.deepEqual(outcome.results.map(result => result.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 3);
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
    "- needs an optional-additional exhaust component in the Frozen CostSpec (RIFT-89)"
);

test.todo(
  "Meditation result branch: draw 2 when the additional cost was paid and draw 1 otherwise " +
    "(CR 359 result binding) - needs the cost receipt exposed to the body (condition.result, unmerged primitive)"
);
