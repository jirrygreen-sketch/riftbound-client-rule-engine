// Golden test for Invigorating Bloom (rad-035-167).
//
// judge-required (see the program's judgeReason): the +3 Might change needs the
// unmerged temporary-Might primitive, the Exhaust-a-[Mighty]-unit cost needs a
// filter-based cost selection, and the [Mighty] predicate has no filter
// vocabulary. The runnable evidence is the activation's exhaust cost and the
// merged Draw 1.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/invigorating-bloom.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import mighty, { MIGHTY_THRESHOLD } from "../../../../engine-core/dist/effects/keywords/Mighty.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-22d854738a427311b36ac63f3aaf6f45c1c921fc638e338c8a2144a374c635e7";
const SOURCE_TEXT =
  "When you play this, give a friendly unit +3 :rb_might: this turn.\n" +
  "Exhaust a friendly [Mighty] unit, :rb_exhaust:: Draw 1. (A unit is Mighty while it has 5+ :rb_might:.)";

const [playEffect, activated] = program.abilities;
const [giveMight] = playEffect.body;
const [costUnitPayment, costSelfPayment] = activated.cost.payments;
const [drawInstruction] = activated.body;

test("rad-035-167 Invigorating Bloom: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-035-167 Invigorating Bloom: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: name each missing piece and its owner task.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /355\.10\.c\.1/);
  assert.match(program.judgeReason, /RIFT-88/);
  assert.match(program.judgeReason, /cardType Unit/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-035-167 Invigorating Bloom: 'When you play this' give-+3-Might trigger", () => {
  assert.equal(playEffect.kind, "triggered");
  assert.deepEqual(playEffect.trigger, {
    at: "card-played",
    filter: { event: "card-played", filter: { source: "self", player: "self" } }
  });
  assert.equal(playEffect.optional, false);
  // "give a friendly unit +3 Might this turn" — temporary Might, not a Buff.
  assert.equal(giveMight.op, "continuous.might");
  assert.deepEqual(giveMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(giveMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(giveMight.targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "controller"
  });
  assert.equal(giveMight.targets[0].selection, "one");
});

test("rad-035-167 Invigorating Bloom: the activation cost is a Mighty unit plus exhausting itself", () => {
  // CR 355.10.c.1: the [do X] to [do Y] exhaust is an instruction cost, not a target.
  assert.equal(costUnitPayment.kind, "exhaust");
  assert.equal(costUnitPayment.choice.id, "invigorating-bloom.mighty-unit");
  assert.equal(costUnitPayment.choice.mighty, true);
  assert.equal(costUnitPayment.choice.zone, "board");
  assert.equal(costUnitPayment.choice.owner, "controller");
  assert.equal(costUnitPayment.choice.selection, "one");
  // CR 415.3.a / 415.5: :rb_exhaust: pays by exhausting the source.
  assert.deepEqual(costSelfPayment, { kind: "exhaust", object: "self" });
  assert.equal(activated.timing, "action");
});

test("rad-035-167 Invigorating Bloom: 'Draw 1' is a plain controller draw (414.3 / 190.6.d)", () => {
  assert.equal(drawInstruction.id, "invigorating-bloom.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, {
    amount: { kind: "constant", value: 1 }
  });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("rad-035-167 Invigorating Bloom: the Draw 1 half really draws and exhausts nothing extra", () => {
  const kernel = world().hand("bloom").deck(["card-1"]).deck(["card-2"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 2);
  // "Draw 1" is not an exhaust: the source is untouched by the draw step.
  assert.equal(kernel.getObject("bloom").exhausted, false);
});

test("rad-035-167 Invigorating Bloom: the self-exhaust half of the cost is really payable", () => {
  // The Mighty-unit half cannot be built from static IR (see the next test), so
  // only the source-exhaust component is measured here against the real planner.
  const kernel = world().unit("bloom", { might: 3 }).unit("mighty-unit", { might: 5 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("bloom") });
  const plan = buildCostPlan(context, {
    id: "bloom.activate",
    cost: { kind: "activated", payments: [costSelfPayment] }
  });
  assert.equal(plan.total.actions.length, 1);
  assert.deepEqual(plan.total.actions[0].action, {
    type: "exhaust",
    object: kernel.ref("bloom")
  });
  assert.equal(payCostPlan(context, plan).paid, true);
  assert.equal(context.getObject("bloom").exhausted, true);
});

test("rad-035-167 Invigorating Bloom: the Mighty cost selection cannot be built from static IR", () => {
  // cost/plan-values.ts choiceObjects requires an exact ObjectRef per option; a
  // static card program can only write a placeholder, which is rejected.
  const kernel = world().unit("bloom", { might: 3 }).unit("mighty-unit", { might: 5 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("bloom") });
  assert.throws(
    () => buildCostPlan(context, { id: "bloom.activate", cost: activated.cost }),
    /exact object reference/
  );
  assert.equal(kernel.getObject("mighty-unit").exhausted, false);
});

test("rad-035-167 Invigorating Bloom: the [Mighty] predicate is a description, not a keyword (706-711)", () => {
  // The Mighty KeywordDef expansion is merged, but it is a condition.value
  // predicate: a cost/filter cannot ask for it, and 710 evaluates a board unit
  // by its current Might (5+).
  assert.equal(keywordDefinitionsById.get("Mighty"), mighty);
  assert.equal(MIGHTY_THRESHOLD, 5);
  assert.equal(mighty.valued, false);
  // No instruction primitive carries a Mighty filter for cost selection.
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
});

test.todo(
  "Invigorating Bloom: 'give a friendly unit +3 :rb_might: this turn' — blocked because temporary Might modification has no " +
    "merged primitive (contract 3.6's closed GameAction set has no might change; effect.buff delegates it to layers " +
    "continuous.might) and the layers consumer is unmerged (RIFT-83/84, RIFT-91)"
);

test.todo(
  "Invigorating Bloom: 'Exhaust a friendly [Mighty] unit' as a cost — blocked because CostSpec choices require exact " +
    "ObjectRefs and the filter vocabulary has no current-Might>=5 predicate for 710 (RIFT-88/RIFT-89, same gap as Garbage Grabber)"
);

test.todo(
  "Invigorating Bloom: data issue (not changed) — the local catalog records printing rad-035-167 as cardType Unit with no " +
    "printed power and no printed Might while its text is unit-shaped; the unit's Might is required by nothing on this card, " +
    "but a null-Might Unit is suspicious and reported rather than fixed"
);
