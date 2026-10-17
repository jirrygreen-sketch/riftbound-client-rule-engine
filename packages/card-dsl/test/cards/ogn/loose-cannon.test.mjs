import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/loose-cannon.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/timing-points.js";

const CANONICAL_ID =
  "card.hash-6725e8158faf2110c1c44cc6e73ac51a68eb3031e134f604a57dc4ef7e8b84a3";
const SOURCE_TEXT =
  "At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.";

const [ability] = program.abilities;
const [drawOne] = ability.body;

/**
 * chain/engine.ts normalizes `controller: "self"` to the ability controller and
 * runs the production matcher; the reference kernel's own query compares filter
 * values literally. Bind the production query so the card's declared condition
 * is the one under test.
 */
const productionQuery = (kernel, filter, controller) => {
  const normalized = { ...filter };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.objects.filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const boundContext = (kernel, controller = "A") => bindResolveContext(kernel, {
  controller,
  query: filter => productionQuery(kernel, filter, controller)
});

test("ogn-251-298 Loose Cannon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-251-298 Loose Cannon: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /beginning-start/);
});

test("ogn-251-298 Loose Cannon: beginning-start trigger for the controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 315.2 / 315.2.a.1: “At start of your Beginning Phase” = the closed
  // "beginning-start" timing point.
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(ability.trigger.once, undefined);
  // The hand clause is part of the EFFECT, not the trigger condition
  // (383.2.a.1 names Loose Cannon explicitly), so it lives on the
  // instruction, not on the trigger.
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
});

test("ogn-251-298 Loose Cannon: draw 1 guarded by the one-or-fewer hand clause", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(drawOne.id, "loose-cannon.draw-one");
  assert.equal(drawOne.op, "effect.draw");
  // 414.1 / 414.3: “draw 1” is effect.draw; the implied drawer is the
  // controller (190.6.d), so no player/target/pick is supplied.
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
  // The clause is checked when the instruction resolves (135.2.b.3 /
  // 359.3.f.2); 108.7.e makes the hand SIZE public while contents stay private.
  assert.deepEqual(drawOne.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-in-your-hand",
      filter: { zone: "hand", controller: "self" }
    },
    operator: "lte",
    right: { kind: "constant", value: 1 }
  });
});

test("ogn-251-298 Loose Cannon: the draw half executes and moves the top card to hand", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, { amount: { kind: "constant", value: 1 } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("ogn-251-298 Loose Cannon: with an empty hand the guard passes and the instruction draws 1", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const outcome = resolveChainBody(ability.body, boundContext(kernel));
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["loose-cannon.draw-one", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
});

test("ogn-251-298 Loose Cannon: with exactly one card in hand the guard passes and the instruction draws 1", () => {
  const kernel = world().deck(["top-card"]).hand("held").build();
  const outcome = resolveChainBody(ability.body, boundContext(kernel));
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["loose-cannon.draw-one", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 2);
});

test("ogn-251-298 Loose Cannon: with two cards in hand the guard fails and no card is drawn (135.2.b.3)", () => {
  const kernel = world().deck(["top-card"]).hand("held-1").hand("held-2").build();
  const outcome = resolveChainBody(ability.body, boundContext(kernel));
  assert.deepEqual(outcome.results.map(result => [result.id, result.result]), [
    ["loose-cannon.draw-one", { status: "negated", reason: "skipped", events: [] }]
  ]);
  assert.equal(kernel.player("A").handSize, 2);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-card"]);
});

test("ogn-251-298 Loose Cannon: the hand count reads the controller's own hand, not the opponent's (190.6.d)", () => {
  // The controller (A) holds two cards, the opponent (B) none: the clause must
  // fail for A's draw even though the table holds few cards overall.
  const kernel = world()
    .deck(["top-card"])
    .hand("held-1")
    .hand("held-2")
    .hand("enemy-held", { owner: "B" })
    .build();
  const outcome = resolveChainBody(ability.body, boundContext(kernel, "A"));
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(kernel.player("A").handSize, 2);
  // The opponent's single-card hand does not satisfy A's clause either: the
  // clause reads the ability controller's own hand.
  assert.equal(kernel.player("B").handSize, 1);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["enemy-held"]);
});

test("ogn-251-298 Loose Cannon: the trigger's timing point is a registered point owned by the turn flow", () => {
  // 315.2.a.1: beginning-start is emitted by the Beginning Phase transition;
  // the card's trigger subscribes to exactly that closed timing point.
  assert.equal(getTimingPoint("beginning-start").emittedBy, "turn");
  assert.equal(ability.trigger.at, "beginning-start");
});

test.todo(
  "ogn-251-298: register the card's beginning-start trigger from the CardProgram and accept the " +
    "timing-point-anchored filter spelling (RIFT-257 program binding plus the EventPattern vocabulary — " +
    "the closed event list does not include timing-point names, so the declared filter cannot be " +
    "registered as-is); the condition and the draw body already execute through the merged interpreter"
);
