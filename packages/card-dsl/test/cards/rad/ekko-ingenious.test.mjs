import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ekko-ingenious.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-4e3817bb5cbd6b0566c6696ba86ac4b5b31ef599a37c2c9b8a3254e0c9e4665b";

const [ganking, play] = program.abilities;
const [costPayment] = play.cost.payments;

test("rad-061-167 Ekko, Ingenious: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /return-to-hand/);
  assert.match(program.judgeReason, /CostPlanError/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /zones\/movement\.ts/);
});

test("rad-061-167 Ekko, Ingenious: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "As an additional cost to play me, return a friendly unit to its owner's hand.\n" +
      "[Ganking] (I can move from battlefield to battlefield.)"
  );
});

test("rad-061-167 Ekko, Ingenious: [Ganking] is declared without a value (810.1)", () => {
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
});

test("rad-061-167 Ekko, Ingenious: the additional cost is mandatory, not optional (356.2)", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.optional, false);
  assert.equal(play.cost.payments.length, 1);
});

test("rad-061-167 Ekko, Ingenious: the returned unit is a non-target cost choice, not a target (355.10.c)", () => {
  assert.equal(costPayment.kind, "return-to-hand");
  assert.equal(costPayment.choice.id, "ekko-ingenious.returned-unit");
  assert.equal(costPayment.choice.min, 1);
  assert.equal(costPayment.choice.max, 1);
  assert.equal(costPayment.choice.selection, "one");
  assert.deepEqual(costPayment.choice.filter, {
    type: "unit",
    controller: "controller",
    zone: "board"
  });
  // Costs use picks; a TargetSpec here would wrongly fire "becomes a target" (355.10.c.1).
  assert.equal(costPayment.choice.targets, undefined);
});

test("rad-061-167 Ekko, Ingenious: the card has no effect body beyond cost and Ganking", () => {
  assert.deepEqual(play.body, []);
  assert.equal(program.abilities.length, 2);
});

test("rad-061-167 Ekko, Ingenious: the intended cost move is expressible by effect.zone (evidence for the missing cost kind)", () => {
  // The movement the cost wants exists (move a friendly unit to its owner's hand); what is
  // missing is charging it as a play cost (cost/plan-values.ts has no "return-to-hand" kind).
  const kernel = world().unit("friendly-unit").build();
  const ref = kernel.ref("friendly-unit");
  const run = runInstruction(
    zone,
    {
      // effect.zone takes the PickSpec id literally (its schema rejects an Expr here).
      pick: "ekko-ingenious.returned-unit",
      to: { kind: "constant", value: "hand" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, picks: { "ekko-ingenious.returned-unit": [ref] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").zone, "hand");
  assert.equal(kernel.player("A").handSize, 1);
  // 417.1.c style routing belongs to the action layer; here the owner's hand is the default.
  assert.equal(kernel.getObject("friendly-unit").owner, "A");
  // The kernel routes the move through the closed return-to-hand action (417/423.1).
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test("rad-061-167 Ekko, Ingenious: effect.ready is merged and remains available for the Ganking move permission path", () => {
  // Not an execution claim for Ganking: continuous.movement has no consumer yet. This only
  // pins that the merged primitive used elsewhere in the same keyword family stays wired.
  const kernel = world().unit("unit", { exhausted: true }).build();
  const ref = kernel.ref("unit");
  const run = runInstruction(ready, { objects: ref }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("unit").exhausted, false);
});

test("rad-061-167 Ekko, Ingenious: the declared cost kind is rejected by the merged cost pipeline", () => {
  // This assertion documents the blocking dependency instead of approximating it.
  assert.equal(costPayment.kind, "return-to-hand");
  assert.equal(play.cost.kind, "additional-cost");
});

test.todo(
  "rad-061-167 Ekko, Ingenious: charge the mandatory additional cost (return a friendly unit to " +
    "its owner's hand) at Finalize — cost/plan-values.ts accepts only energy/xp/power and " +
    "exhaust/discard/recycle/kill/reveal/spend-buff, so buildCostPlan throws " +
    "CostPlanError(judge-required, 'Unsupported payment kind: return-to-hand') (RIFT-89)"
);

test.todo(
  "rad-061-167 Ekko, Ingenious: [Ganking] standard-move permission (battlefield-to-battlefield) " +
    "— effects/keywords/Ganking.ts expands to continuous.movement, but zones/movement.ts has no " +
    "consumer for that permission (no assigned RIFT task)"
);
