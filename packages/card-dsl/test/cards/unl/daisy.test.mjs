import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/daisy.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-feadeed8b5695723dd7f149d233160c40dea1625510f9fd7eb248c153d97e305";
const SOURCE_TEXT =
  "I enter ready.\n" +
  "Reduce my cost by :rb_energy_1: for each of the following tags among your units — Bird, Cat, Dog, and Poro.\n" +
  "When I attack while your units have all 4 tags, [Stun] an enemy unit here. (It doesn't deal combat damage this turn.)";

const [enterReady, discount, attackTrigger] = program.abilities;
const [stunInstruction] = attackTrigger.body;
const [enemyHere] = stunInstruction.targets;

test("unl-196-219 Daisy!: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-196-219 Daisy!: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /cost\.modify|减费/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-196-219 Daisy!: 'I enter ready' is an entry replacement of the exhausted entry state", () => {
  assert.equal(enterReady.kind, "replacement");
  // 143.4 / 359.2.c / 369.3 / 805.6: replace "enters exhausted" with "enters ready" —
  // one effect.ready in the with body, never an exhaust-then-ready pair.
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.equal(enterReady.condition, undefined);
  assert.equal(enterReady.with.length, 1);
  assert.equal(enterReady.with[0].op, "effect.ready");
  assert.deepEqual(enterReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
});

test("unl-196-219 Daisy!: the cost reduction is 1 Energy per listed tag, capped by the four printed tags", () => {
  // 356.4 / 356.4.b: the discount is applied at the total-cost stage; 356.4.e: no
  // minimum is printed, so none is invented. The amount is the cross-object
  // distinct-tag union (retained shape) capped at the four printed tags.
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "cost.modify");
  assert.equal(discount.effect.appliesTo, "self");
  assert.equal(discount.effect.resource, "energy");
  assert.equal(discount.effect.stage, "discount");
  assert.equal(discount.effect.amount.kind, "count");
  assert.equal(discount.effect.amount.subject, "controller-units-distinct-listed-tags-union");
  assert.deepEqual(discount.effect.amount.filter, { player: "controller" });
  assert.deepEqual(discount.effect.maximum, { kind: "constant", value: 4 });
  assert.equal(discount.effect.minimum, undefined);
});

test("unl-196-219 Daisy!: the attack trigger carries the four-tag condition and stuns an enemy unit here", () => {
  // 383.4.e: Attack Trigger; 383.2.a.1: the following "while your units have all 4
  // tags" clause is part of the trigger condition and is evaluated when it fires.
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  const condition = attackTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 4 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "controller-units-distinct-listed-tags-union");
  assert.deepEqual(condition.left.filter, { player: "controller" });
  assert.equal(attackTrigger.optional, false);

  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "daisy.enemy-here" }
  });
  assert.deepEqual(enemyHere.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "source"
  });
  assert.equal(enemyHere.min, 1);
  assert.equal(enemyHere.max, 1);
  assert.equal(enemyHere.selection, "one");
});

test("unl-196-219 Daisy! golden: the entry replacement's with body readies the source unit", () => {
  const base = world().unit("daisy", { exhausted: true }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("daisy") });
  const run = runInstruction(ready, { objects: { kind: "source" } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("daisy").exhausted, false);
  assert.equal(run.linked.readied.count, 1);
});

test("unl-196-219 Daisy! golden: the four-tag condition really gates the attack trigger", () => {
  // The union predicate is a retained shape: on the reference kernel it evaluates
  // false, so the trigger condition is not met and the stun body must not run.
  const kernel = world()
    .unit("daisy", { tags: ["Ivern", "Ionia"] })
    .unit("bird-unit", { tags: ["Bird"] })
    .unit("cat-unit", { tags: ["Cat"] })
    .build();
  assert.equal(kernel.test(attackTrigger.trigger.condition), false);

  const guard = {
    id: "daisy.trigger-probe",
    op: "sequence",
    args: { body: { kind: "constant", value: [] } },
    condition: attackTrigger.trigger.condition
  };
  const outcome = runAbilityBody([guard], kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.result.status, entry.result.reason]), [
    ["negated", "skipped"]
  ]);
});

test("unl-196-219 Daisy! golden: the printed stun resolves on a locked enemy unit here", () => {
  const kernel = world()
    .unit("daisy", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const run = runInstruction(stun, { target: enemyHere.id }, {
    world: kernel,
    targets: { [enemyHere.id]: [kernel.ref("enemy-here")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-here").stunned, true);
  assert.equal(kernel.getObject("enemy-elsewhere").stunned, false);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);

  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("daisy"), source: kernel.ref("daisy") });
  const environment = {
    context: scoped,
    query: filter => scoped.query(filter),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  };
  assert.deepEqual(
    queryObjects({ type: "unit", sameLocationAs: "source" }, environment).map(object => object.ref.id),
    ["daisy", "enemy-here"]
  );
});

test.todo(
  "unl-196-219 Daisy!: run the entry replacement through a real replacement pipeline (143.4/359.2.c/369.3) — " +
    "no CardProgram -> ReplacementRegistration wiring and effect.ready must not be used as an after-the-fact ready (RIFT-120)"
);
test.todo(
  "unl-196-219 Daisy!: apply the per-tag Energy discount at Finalize (356.4/356.4.b) — cost/cost-plan.ts only consumes caller-supplied discounts " +
    "and there is no CardProgram -> CostPlan wiring (RIFT-89)"
);
test.todo(
  "unl-196-219 Daisy!: evaluate the cross-object four-tag union ('your units have all 4 tags') — ObjectFilter.tags is a per-object every-match " +
    "(layers/filter.ts, reference kernel), so the union needs a new predicate (contract change request)"
);
test.todo(
  "unl-196-219 Daisy!: reach the attack-declared timing point from the real combat flow and register the CardProgram trigger (engine batch 4/5, RIFT-120)"
);
