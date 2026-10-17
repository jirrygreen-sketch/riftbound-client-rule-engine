import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/dominus.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-981bce17b37bbc9e61b2bc56b12191d12b4c0d17be51ad4a950324e1e4941c5a";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "This turn, double a unit's Might and give it \":rb_rune_rainbow::rb_rune_rainbow:: Ready me.\"";

const [actionKeyword, play] = program.abilities;
const [readMight, doubleMight, grantReadyAbility] = play.body;
const targetSpec = readMight.targets[0];
const SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];
// Only the supported prefix: granting an activated ability remains judge-required.
const doublingBody = play.body.slice(0, 2);

test("ven-142-166 Dominus: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-142-166 Dominus: judgeReason distinguishes the missing grant from supported doubling and [A]", () => {
  assert.match(program.judgeReason, /continuous\.grant-ability/);
  assert.match(program.judgeReason, /433/);
  assert.match(program.judgeReason, /condition\.value/);
  assert.match(program.judgeReason, /continuous\.might add/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9\d/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-142-166 Dominus: [Action] plus Might doubling and a granted activated ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["dominus.read-might", "condition.value"],
    ["dominus.double-might", "continuous.might"],
    ["dominus.grant-ready-ability", "continuous.grant-ability"]
  ]);

  // 433.1: doubling adds an amount equal to the current Might for this turn; it is an
  // arithmetic-layer modification (475), never a CR 702 Buff counter.
  assert.deepEqual(readMight.args, {
    value: {
      kind: "object-attribute",
      object: { target: "dominus.unit" },
      attribute: "might"
    },
    key: { kind: "constant", value: "currentMight" }
  });
  assert.deepEqual(doubleMight.args, {
    mode: { kind: "constant", value: "add" },
    amount: {
      kind: "linked-value",
      instructionId: "dominus.read-might",
      key: "currentMight"
    },
    objects: { kind: "constant", value: { kind: "target", id: "dominus.unit" } },
    duration: { kind: "constant", value: "this-turn" }
  });
  // "a unit" is one chosen Board unit (355.7/355.9.a.1/355.10).
  assert.deepEqual(targetSpec, {
    id: "dominus.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(readMight.linkedTo, undefined);
  assert.equal(doubleMight.linkedTo, readMight.id);

  // The granted ability pays two [A] Power (135.2.e.5.a / 163.2.b), each accepting all six
  // domains. Its body is the merged effect.ready on its own source ("me" = the granted host).
  assert.equal(grantReadyAbility.op, "continuous.grant-ability");
  assert.deepEqual(grantReadyAbility.args.target, { kind: "constant", value: "dominus.unit" });
  assert.deepEqual(grantReadyAbility.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(grantReadyAbility.args.ability.kind, "constant");
  const granted = grantReadyAbility.args.ability.value;
  assert.equal(granted.kind, "activated");
  assert.equal(granted.timing, "action");
  assert.deepEqual(granted.cost, {
    kind: "activated",
    payments: [
      { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: SIX_DOMAINS },
      { kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: SIX_DOMAINS }
    ]
  });
  assert.deepEqual(granted.body.map((instruction) => [instruction.id, instruction.op]), [
    ["dominus.granted-ready", "effect.ready"]
  ]);
  // "Ready me": the default selection of effect.ready is the ability source (416.1).
  assert.deepEqual(granted.body[0].args, { objects: { kind: "constant", value: { kind: "source" } } });
  assert.equal(grantReadyAbility.linkedTo, undefined);

  assert.equal(keywordDefinitionsById.has("Action"), true);
  assert.equal(instructionDefinitionsById.get("effect.ready"), ready);
});

test("ven-142-166 Dominus golden: the granted ability's Ready body readies its host (416.1)", () => {
  // The grant/duration wiring is unmerged (judgeReason), but the granted body itself is the
  // real primitive: running it readies the exhausted host exactly as "Ready me" says.
  const kernel = world()
    .unit("renekton", { owner: "A", controller: "A", might: 5, exhausted: true })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("renekton") });

  const outcome = resolveChainBody(grantReadyAbility.args.ability.value.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready"]);
  assert.equal(scoped.getObject("renekton").exhausted, false);
  assert.deepEqual(outcome.linkedValues["dominus.granted-ready.readied"], {
    count: 1,
    objects: [{ id: "renekton", zoneEntryId: 1 }]
  });
});

test("ven-142-166 Dominus golden: the granted [A][A] cost plans two independent any-domain payments", () => {
  const kernel = world()
    .player("A", { power: ["Fury", "Order"] })
    .unit("renekton", { might: 5 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("renekton") });
  const plan = buildCostPlan(context, {
    id: "dominus.granted-ready.cost",
    cost: grantReadyAbility.args.ability.value.cost
  });
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: SIX_DOMAINS },
    { amount: 1, allowedDomains: SIX_DOMAINS }
  ]);
  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.power.power.map(allocation => allocation.from), ["Fury", "Order"]);
});

test("ven-142-166 Dominus golden: freeze 5 Might, add 5 this turn, then restore 5 at turn end", () => {
  const kernel = world().unit("unit", { might: 5 }).unit("other", { might: 7 }).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("unit")]);

  const outcome = resolveChainBody(doublingBody, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["dominus.read-might", "executed"],
    ["dominus.double-might", "executed"]
  ]);
  assert.equal(outcome.linkedValues["dominus.read-might.currentMight"], 5);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.amount, 5);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 10);
  assert.equal(layers.evaluate(kernel.ref("other")).might, 7);
  assert.equal(kernel.getObject("unit").buffs, 0);
  assert.deepEqual(layers.advance({ id: "turn-end" }), [registration.effect.id]);
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 5);
});

test("ven-142-166 Dominus golden: the frozen increase includes existing Might effects and stays fixed when they end (433.1.a)", () => {
  const kernel = world().unit("unit", { might: 3 }).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("unit")]);
  // Supply the initial +2 through the registered instruction.
  const prior = resolveChainBody([{
    id: "prior.plus-two",
    op: "continuous.might",
    args: {
      amount: { kind: "constant", value: 2 },
      settlementId: { kind: "constant", value: "prior.plus-two" },
      objects: doubleMight.args.objects
    }
  }], kernel);
  assert.equal(prior.status, "executed");
  const [priorRegistration] = kernel.continuousEffects;
  const before = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(before.evaluate(kernel.ref("unit")).might, 5);
  // Like ChainEngine.context, read effective characteristics through the actual layers engine.
  const context = bindResolveContext(kernel, { object: ref => before.evaluate(ref) });
  const outcome = resolveChainBody(doublingBody, context);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["dominus.read-might.currentMight"], 5);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 10);
  layers.removeContinuous(priorRegistration.effect.id);
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 8);
  layers.advance({ id: "turn-end" });
  assert.equal(layers.evaluate(kernel.ref("unit")).might, 3);
});

test("ven-142-166 Dominus golden: a unit that left the Board is not doubled (359.3.e.7)", () => {
  const kernel = world().unit("unit", { might: 5 }).build();
  const stale = kernel.ref("unit");
  kernel.setTargets(targetSpec.id, [stale]);
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const outcome = resolveChainBody(doublingBody, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["dominus.read-might", "ignored", "mistargeted"],
    ["dominus.double-might", "ignored", "linked-ignored"]
  ]);
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "ven-142-166 Dominus: grant the unit the activated ability \"[A][A]: Ready me.\" for this turn " +
    "(399-406, 135.4.b) — needs continuous.grant-ability host binding and expiry; its two " +
    "any-domain Power payments (135.2.e.5.a/163.2.b) and Ready body already execute"
);
