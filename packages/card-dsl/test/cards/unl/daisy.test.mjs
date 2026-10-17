import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/daisy.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

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
  // The reason must name the three live gaps with their verified evidence:
  // the unmapped static cost.modify, the missing cross-object tag-union count,
  // and the unbindable dynamic location anchor.
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /CostPlanInput\.discounts/);
  assert.match(program.judgeReason, /ObjectFilter\.tags/);
  assert.match(program.judgeReason, /evaluateExpression/);
  assert.match(program.judgeReason, /queryObjects/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /registerProgramTriggers/);
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
  // This fixture has only Bird and Cat among the controller's units, so the
  // printed all-four-tags condition is not met and the stun body is skipped.
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

test("unl-196-219 Daisy! golden: production play applies the entry replacement before Board entry", () => {
  // ProgramRegistry only binds executable cards. The local executable clone
  // isolates the already-supported replacement path while the shipped program
  // remains judge-required for its unresolved discount and attack clauses.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const f = fixture({
    cards: [{ id: "daisy", cardId: CANONICAL_ID, types: ["unit"], energy: 9, power: [], might: 8 }],
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(f.engine);
  f.engine.commit({
    type: "play",
    object: f.kernel.ref("daisy"),
    player: "A",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.engine.advance();
  resolveAll(f.engine);

  assert.equal(f.kernel.getObject("daisy").zone, "board");
  assert.equal(f.kernel.getObject("daisy").exhausted, false);
  const entry = f.engine.pipeline.events.find(event =>
    event.timingPoint === "object-enters-board" && event.object?.ref.id === "daisy"
  );
  assert.equal(entry.object.exhausted, false, "the first Board snapshot is already ready");
  assert.equal(f.engine.pipeline.events.filter(event =>
    ["object-readied", "object-exhausted"].includes(event.timingPoint) && event.object?.ref.id === "daisy"
  ).length, 0, "entry orientation produces no intermediate ready/exhaust event on Board");
});

test("unl-196-219 Daisy!: the declared static cost.modify has no layer mapping, so the production binder rejects it", () => {
  // 356.4 / 356.4.b: the discount declaration exists, but programs/statics.ts
  // layerFor maps only copy/trait/ability/arithmetic/... kinds and throws for
  // cost.modify. The lifecycle swallows that as a binding failure, so the
  // printed discount never reaches Finalize. Fail closed — not approximated.
  const kernel = world().unit("daisy", { exhausted: true }).build();
  const source = kernel.getObject("daisy");
  const engine = {
    layers: { addContinuous() {}, removeContinuous() {} },
    pipeline: { host: { objects: () => [source], context() { throw new Error("no engine context"); } } }
  };
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(discount, source),
    (error) => error.name === "ProgramBindingError" && /no layer mapping/.test(error.message)
  );
});

test("unl-196-219 Daisy!: the declared four-tag count silently counts the wrong objects (union predicate still missing)", () => {
  // 133.8 / 133.8.a / 740.1.a: the printed amount is the cross-object DISTINCT
  // tag union among the controller's units (Bird, Cat, Dog, Poro each counted
  // at most once; an opponent's unit never counts). No merged count predicate
  // can express it: CountExpr's subject is inert and evaluateExpression returns
  // queryObjects(filter).length. This test records the actual wrong value, so
  // the card cannot be marked executable on this declaration.
  const kernel = world()
    .player("A")
    .unit("friendly-bird", { tags: ["Bird"], controller: "A" })
    .unit("friendly-cat", { tags: ["Cat"], controller: "A" })
    .unit("enemy-both", { tags: ["Bird", "Cat"], owner: "B", controller: "B" })
    .build();
  const context = kernel.clone({ source: kernel.ref("friendly-bird"), sourceSnapshot: kernel.getObject("friendly-bird") });
  const environment = {
    context,
    host: kernel.ref("friendly-bird"),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  };
  // The declared subject string is inert; only the filter decides the count.
  assert.equal(discount.effect.amount.subject, "controller-units-distinct-listed-tags-union");
  assert.equal(evaluateExpression(discount.effect.amount, environment), 3);
  // The controller's true distinct union is Bird + Cat = 2, and the opponent's
  // dual-tag unit must never contribute.
  assert.deepEqual(
    queryObjects({ player: "controller" }, environment).map((object) => object.ref.id),
    ["friendly-bird", "friendly-cat", "enemy-both"]
  );
  // The far more direct per-object every-match would return only the opponent's unit.
  assert.deepEqual(
    queryObjects({ tags: ["Bird", "Cat"] }, environment).map((object) => object.ref.id),
    ["enemy-both"]
  );
});

test("unl-196-219 Daisy!: the attack trigger's sameLocationAs anchor is rejected by the program binder", () => {
  // 355.9 / 359.3.f.1: "an enemy unit here" needs the attack event's
  // battlefield. The interpreter's queryObjects resolves the anchor, but
  // programs/filters.ts translateObjectFilter rejects the field, so
  // registerProgramTriggers cannot register the attack-declared trigger.
  assert.throws(
    () => translateInstructionTargets(attackTrigger.body),
    (error) => error.name === "ProgramBindingError" && /Unsupported filter field sameLocationAs/.test(error.message)
  );
  // The interpreter side really does resolve the anchor against the source.
  const kernel = world()
    .unit("daisy", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("daisy"), source: kernel.ref("daisy") });
  const environment = {
    context: scoped,
    query: (filter) => scoped.query(filter),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  };
  assert.deepEqual(
    queryObjects({ type: "unit", owner: "B", sameLocationAs: "source" }, environment)
      .map((object) => object.ref.id),
    ["enemy-here"]
  );
});
