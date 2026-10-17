import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world, runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import empowerDefinition from "../../../../engine-core/dist/effects/keywords/Empower.js";
import empowerEffect from "../../../../engine-core/dist/effects/instructions/effect.empower.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/dame-the-despoiler.js";

const CANONICAL_ID =
  "card.hash-e48e6f95280cf803b6c17421f260f0c2e1b9e75ab27c4786c880d741b26084c9";
const SOURCE_TEXT =
  "[Empower] :rb_energy_5::rb_rune_body: (:rb_energy_5::rb_rune_body:: Empower me. Use only if not " +
  "Empowered.)\n" +
  "[Empowered][>] When I attack or defend, choose a unit here. Increase my Might to its Might " +
  "this turn, then give me +1 :rb_might: this turn.";

const [empower, attackTrigger, defendTrigger] = program.abilities;
const attackBody = attackTrigger.body;
const defendBody = defendTrigger.body;
const [setMight, increaseMight, plusOneMight] = attackBody;
const [defendSetMight, defendIncreaseMight, defendPlusOneMight] = defendBody;

test("ven-079-166 Dame the Despoiler: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-079-166 Dame the Despoiler: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-079-166 Dame the Despoiler: [Empower] is declared without faking its printed cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  // 827.1.c.1 的印刷费 5 Energy + 1 Body Power 无承载字段，不伪造启动能力。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-079-166 Dame the Despoiler: 'When I attack or defend' is two independent combat triggers", () => {
  // 383.4.e 的 Attack Trigger 与 383.4.f 的 Defend Trigger 并列。
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.optional, false);
  assert.equal(attackTrigger.trigger.once, undefined);

  assert.equal(defendTrigger.kind, "triggered");
  assert.equal(defendTrigger.trigger.at, "defense-declared");
  assert.deepEqual(defendTrigger.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(defendTrigger.optional, false);
  assert.equal(defendTrigger.trigger.once, undefined);
});

test("ven-079-166 Dame the Despoiler: 'choose a unit here' is a real target spec (355.7/355.9)", () => {
  for (const [label, instruction] of [["attack", setMight], ["defend", defendSetMight]]) {
    assert.equal(instruction.op, "condition.value", label);
    assert.equal(instruction.targets.length, 1, label);
    const [spec] = instruction.targets;
    assert.equal(spec.id, "dame-the-despoiler.unit-here", label);
    // “a unit here”：Board 上的单位，位置与来源相同。
    assert.deepEqual(spec.filter, { type: "unit", zone: "board", sameLocationAs: "self" }, label);
    assert.equal(spec.min, 1, label);
    assert.equal(spec.max, 1, label);
    assert.equal(spec.selection, "one", label);
    assert.equal(instruction.picks, undefined, label);
  }
});

test("ven-079-166 Dame the Despoiler: measure a nonnegative increase, apply it, then independently give +1", () => {
  for (const [measure, increase, plus] of [[setMight, increaseMight, plusOneMight], [defendSetMight, defendIncreaseMight, defendPlusOneMight]]) {
    assert.deepEqual(measure.args.value, {
      kind: "arithmetic", operator: "max", operands: [
        { kind: "constant", value: 0 },
        { kind: "arithmetic", operator: "sub", operands: [
          { kind: "object-property", object: { target: "dame-the-despoiler.unit-here" }, property: "might" },
          { kind: "object-property", object: "self", property: "might" }
        ] }
      ]
    });
    assert.equal(increase.op, "continuous.might");
    assert.equal(increase.linkedTo, measure.id);
    assert.deepEqual(increase.args.amount, { kind: "linked-value", instructionId: measure.id, key: "value" });
    assert.deepEqual(increase.args.appliesTo, { kind: "constant", value: "self" });
    assert.deepEqual(plus.args.amount, { kind: "constant", value: 1 });
    assert.deepEqual(plus.args.appliesTo, { kind: "constant", value: "self" });
    for (const instruction of [increase, plus]) assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
    assert.equal(plus.linkedTo, undefined);
  }
});

test("ven-079-166 Dame the Despoiler: both combat bodies have matching measurements and independent ids", () => {
  assert.deepEqual(setMight.args, defendSetMight.args);
  assert.deepEqual(setMight.targets, defendSetMight.targets);
  assert.deepEqual(plusOneMight.args, defendPlusOneMight.args);
  assert.equal(attackBody.some(instruction => defendBody.some(other => other.id === instruction.id)), false);
});


test("dame-the-despoiler: the review records the current blockers", () => {
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.match(program.judgeReason, /sameLocationAs/);
});

test.todo("dame-the-despoiler: 827/828: pass the printed Empower cost through KeywordAbility and guarantee empowered in production ObjectSnapshot adapters");

test("Dame Empower: the merged definition preserves 5 Energy plus Body and the pipeline records the required payment", () => {
  const cost = { kind: "activated", energy: { kind: "constant", value: 5 },
    payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Body"] }] };
  const [activation] = empowerDefinition.expand({ host: { canonicalCardId: CANONICAL_ID }, params: { cost } });
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  assert.deepEqual(activation.cost, cost);
  assert.equal(activation.body[0].op, "effect.empower");
  assert.equal(activation.body[0].targets, undefined);
  const kernel = world().player("A", { energy: 6, power: ["Body", "Mind"] }).unit("dame").build();
  const receipt = payCostPlan(kernel, buildCostPlan(kernel, { id: "dame.empower", cost: activation.cost }));
  assert.equal(receipt.paid, true);
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(receipt.actions[0].action.plan.power, ["Body"]);
  assert.deepEqual(receipt.power.power.map(({ from, amount }) => ({ from, amount })), [{ from: "Body", amount: 1 }]);
  // TestWorld's pay action debits Energy only; Power consumption still needs host verification.
});

test("Dame Empowered gate: both combat subscriptions read live status rather than a truthy string", () => {
  const base = world().unit("dame").build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dame") });
  for (const trigger of [attackTrigger, defendTrigger]) {
    assert.deepEqual(trigger.trigger.condition, {
      kind: "compare", left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gt", right: { kind: "constant", value: 0 }
    });
    assert.equal(kernel.test(trigger.trigger.condition), false);
  }
  const run = runInstruction(empowerEffect, { amount: { kind: "constant", value: 1 } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["empower"]);
  for (const trigger of [attackTrigger, defendTrigger]) assert.equal(kernel.test(trigger.trigger.condition), true);
});

test.todo("dame-the-despoiler: 355.9: translate sameLocationAs into program target binding");

function combatWorld(chosenMight = 9, sourceMight = 5) {
  const kernel = world().unit("dame", { might: sourceMight }).unit("chosen", { might: chosenMight }).build();
  kernel.setTargets("dame-the-despoiler.unit-here", [kernel.ref("chosen")]);
  return kernel.clone({ sourceSnapshot: kernel.getObject("dame") });
}
function layersOf(kernel) {
  return createLayerEngine(kernel.objects, kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 })));
}

test("Dame supported body: both combat bodies lock a nonnegative increase, then +1, and expire at turn end", () => {
  for (const body of [attackBody, defendBody]) {
    const kernel = combatWorld();
    const outcome = resolveChainBody(body, kernel);
    assert.equal(outcome.status, "executed");
    assert.equal(outcome.linkedValues[`${body[0].id}.value`], 4);
    assert.deepEqual(kernel.continuousEffects.map(entry => entry.effect.effect.amount), [4, 1]);
    assert.deepEqual(kernel.continuousEffects.map(entry => entry.duration), [{ type: "end-of-turn" }, { type: "end-of-turn" }]);
    const layers = layersOf(kernel);
    assert.equal(layers.evaluate(kernel.ref("dame")).might, 10);
    layers.advance({ id: "turn-end", player: "A" });
    assert.equal(layers.evaluate(kernel.ref("dame")).might, 5);
  }
});

test("Dame supported body: choosing a lower-Might unit never reduces Dame and still gives +1", () => {
  const kernel = combatWorld(3, 8);
  const outcome = resolveChainBody(attackBody, kernel);
  assert.equal(outcome.linkedValues[`${setMight.id}.value`], 0);
  assert.equal(outcome.results[1].result.status, "negated");
  assert.equal(outcome.results[1].result.reason, "skipped");
  assert.equal(outcome.results[2].result.status, "executed");
  assert.equal(layersOf(kernel).evaluate(kernel.ref("dame")).might, 9);
});

test("Dame supported body: a later change to the chosen Might does not change the remembered increase", () => {
  const kernel = combatWorld();
  resolveChainBody(attackBody, kernel);
  const run = runInstruction(might, { target: "later", amount: { kind: "constant", value: 4 } }, {
    world: kernel, targets: { later: [kernel.ref("chosen")] }
  });
  assert.equal(run.result.status, "executed");
  const layers = layersOf(kernel);
  assert.equal(layers.evaluate(kernel.ref("chosen")).might, 13);
  assert.equal(layers.evaluate(kernel.ref("dame")).might, 10);
});

test("Dame supported body: stale or elsewhere targets suppress the increase while independent +1 resolves", () => {
  for (const action of ["return-to-hand", "move-location"]) {
    const kernel = combatWorld();
    const target = kernel.ref("chosen");
    assert.equal(kernel.perform(action === "return-to-hand"
      ? { type: action, object: target }
      : { type: action, object: target, to: { type: "battlefield", id: "elsewhere" } }).status, "done");
    const outcome = resolveChainBody(attackBody, kernel);
    assert.equal(outcome.results[0].result.status, "ignored");
    assert.equal(outcome.results[1].result.status, "ignored");
    assert.equal(outcome.results[2].result.status, "executed");
    assert.equal(layersOf(kernel).evaluate(kernel.ref("dame")).might, 6);
  }
});

test.todo("dame-the-despoiler: emit attack-declared / defense-declared from actual combat designation changes (383.4.e/f)");
