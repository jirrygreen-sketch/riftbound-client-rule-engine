import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/hold-em.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-6241ef3881abbc30d79cdaf37ca912ade70c601045279aed082fc727f4ace85c";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "This costs :rb_energy_2: less if you've played a unit or gear to a battlefield this turn.\n" +
  "Give a unit +3 :rb_might: this turn.";

const [action, discount, play] = program.abilities;
const [mightInstruction] = play.body;
const [targetSpec] = mightInstruction.targets;

test("rad-070-167 Hold 'Em: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-070-167 Hold 'Em: judgeReason names the cost-plan wiring and the history gate", () => {
  // cards README section 2: the reason must name the missing primitive/rule and
  // the dependency task instead of a stale description.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /CostPlanInput\.discounts|static-program binder/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /objectFilter/);
  // Second-sweep refresh: name the observed binder failure and the missing
  // Condition kind instead of a generic "no consumer".
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /condition\.history/);
});

test("rad-070-167 Hold 'Em gap: the production static binder rejects the discount declaration", () => {
  // The discount is authored per the contract, but the merged binder has no
  // layer for it, so it can never reach a play's CostPlanInput.discounts.
  const f = fixture({ cards: [{ id: "src", cardId: CANONICAL, types: ["spell"], energy: 3, power: [] }] });
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(
    () => binder.bindStatic(discount, f.kernel.getObject("src")),
    /continuous\.cost-modification has no layer mapping/
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("rad-070-167 Hold 'Em gap: a printed-cost plan receives no discount without caller-supplied input", () => {
  // cost/cost-plan.ts applies only the discounts the caller passes, so the
  // declared card effect leaves the printed 3 Energy cost untouched.
  const base = world().hand("src", { types: ["spell"], energy: 3 }).build();
  const ctx = base.clone({ sourceSnapshot: base.getObject("src") });
  const plan = buildCostPlan(ctx, {
    id: "play",
    cost: { kind: "printed" },
    printed: { id: "src", cardType: "Spell", domains: ["Body"], energy: 3, power: 0 }
  });
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.discounts, []);
});

test("rad-070-167 Hold 'Em gap: the declared gate is a descriptive constant, and Condition has no history kind", () => {
  // The gate is not executable: it evaluates truthy regardless of the turn's
  // history, and the merged Condition evaluator has no history kind that could
  // gate a static cost effect.
  const kernel = world().build();
  const environment = { context: kernel, linked: () => undefined, canLookBack: () => true, isIgnored: () => false };
  assert.equal(evaluateCondition(discount.condition, environment), true);
  assert.equal(discount.condition.kind, "expression");
  assert.equal(discount.condition.value.kind, "constant");
  assert.throws(() => evaluateCondition({ kind: "history" }, environment), /Unsupported condition: history/);
});

test("rad-070-167 Hold 'Em: structure — Action keyword and the printed energy-3 cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  // power: null means no printed power; the field is absent, not 0.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("rad-070-167 Hold 'Em: the discount is declared but its gate stays descriptive", () => {
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.equal(discount.effect.resource, "energy");
  assert.deepEqual(discount.effect.amount, { kind: "constant", value: -2 });
  assert.deepEqual(discount.effect.minimum, { kind: "constant", value: 0 });
  assert.equal(discount.effect.appliesTo, "self");

  // The gate is a turn-scoped event history over plays of a unit or gear to a
  // battlefield. It stays descriptive constant data because a static cost
  // effect has no cost-plan consumer and the play destination is not
  // part of HistoryQuery — no merged condition silently approximates it.
  assert.equal(discount.condition.kind, "expression");
  const gate = discount.condition.value;
  assert.equal(gate.kind, "constant");
  assert.deepEqual(gate.value, {
    history: "cards-you-played-this-turn",
    scope: "turn",
    action: "play",
    player: "controller",
    objectTypes: ["unit", "gear"],
    to: "battlefield"
  });
});

test("rad-070-167 Hold 'Em: the Might clause is a layers effect on one target, not a Buff counter", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mightInstruction.id, "hold-em.give-plus-3-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "unit" }
  });
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.picks, undefined);

  assert.equal(mightInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-070-167 Hold 'Em golden: the chosen unit really gets +3 Might this turn", () => {
  const base = world().unit("target", { owner: "A", controller: "A", might: 2 }).build();
  const kernel = base.clone({
    sourceSnapshot: base.getObject("target"),
    targets: new Map([["unit", [base.ref("target")]]])
  });
  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [["hold-em.give-plus-3-might", "executed"]]
  );

  // 143.2.a arithmetic layer, 317.2.c end-of-turn expiry.
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 3);
  assert.deepEqual(registration.effect.filter, {
    objectId: "target",
    zone: "board",
    zoneEntryId: 1
  });
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(kernel.objects, [{ ...registration, timestamp: 1 }]);
  assert.equal(layers.evaluate(kernel.ref("target")).might, 5);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("target")).might, 2);
});

test("rad-070-167 Hold 'Em golden: a lost unit target ignores the Might instruction (359.3.e.6/e.7)", () => {
  const base = world().unit("target", { owner: "A", controller: "A", might: 2 }).build();
  const stale = base.ref("target");
  assert.equal(base.perform({ type: "kill", object: stale }).status, "done");
  const kernel = base.clone({
    sourceSnapshot: base.getObject("target"),
    targets: new Map([["unit", [stale]]])
  });

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(kernel.continuousEffects, []);
});

test.todo(
  "rad-070-167 Hold 'Em: applying the printed -2 energy discount to the finalized cost plan of a card " +
    "played after a unit/gear went to a battlefield this turn needs a CardProgram-static-to-CostPlan " +
    "discount binding and a play-destination history predicate."
);
