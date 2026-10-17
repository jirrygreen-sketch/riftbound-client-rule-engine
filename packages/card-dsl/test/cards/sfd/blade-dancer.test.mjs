import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/blade-dancer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d511bb90ed51ac962aec938d769d68fb16ec0ef21f47c232f727712726e31cf1";
const SOURCE_TEXT =
  "When you choose a friendly unit, you may exhaust me and pay :rb_rune_rainbow: to ready it.\n" +
  "When you conquer, you may pay :rb_energy_1: to ready me.";

const [targetingEffect, conquerEffect] = program.abilities;
const optionalReady = targetingEffect.body[0];
const optionalBody = optionalReady.args.body.value;
const [payCost, readyChosen] = optionalBody;
const conquerOptional = conquerEffect.body[0];
const conquerBody = conquerOptional.args.body.value;

/** The ability host for "exhaust me"/"ready me" is the source legend itself. */
const legendWorld = ({ exhausted = false } = {}) => {
  const base = world()
    .unit("blade-dancer", { types: ["legend"], exhausted, location: { type: "base", player: "A" } })
    .unit("chosen-unit", { exhausted: true, location: { type: "base", player: "A" } })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("blade-dancer") });
};

test("sfd-195-221 Blade Dancer: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-195-221 Blade Dancer: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-64/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.match(program.judgeReason, /rainbow/);
});

test("sfd-195-221 Blade Dancer: 'when you choose a friendly unit' is a Targeting Effect at became-target", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(targetingEffect.kind, "triggered");
  // 383.4.b: the condition is a GameObject becoming targeted. "you" is the
  // ability controller and "friendly" is relative to it (740.1.a).
  assert.equal(targetingEffect.trigger.at, "became-target");
  assert.deepEqual(targetingEffect.trigger.filter, {
    event: "became-target",
    player: "self",
    target: { type: "unit", controller: "self" }
  });
  assert.equal(targetingEffect.trigger.once, undefined);
  assert.equal(targetingEffect.trigger.condition, undefined);
  // 403.1 / 383.3.a: the leading "you may" is the triggered ability's own
  // optionality, and 3.9 wraps the chosen instructions in choice.optional.
  assert.equal(targetingEffect.optional, true);
  assert.equal(targetingEffect.body.length, 1);
});

test("sfd-195-221 Blade Dancer: the may-body pays the exhaust cost then readies the chosen unit", () => {
  assert.equal(optionalReady.id, "blade-dancer.may-ready-chosen");
  assert.equal(optionalReady.op, "choice.optional");
  assert.equal(optionalReady.args.body.kind, "constant");
  assert.equal(optionalReady.linkedTo, undefined);
  assert.deepEqual(optionalReady.args.prompt, {
    kind: "constant",
    value: "Exhaust Blade Dancer and pay :rb_rune_rainbow: to ready that unit?"
  });
  assert.deepEqual(optionalBody.map(instruction => [instruction.id, instruction.op]), [
    ["blade-dancer.pay-cost", "cost.pay"],
    ["blade-dancer.ready-chosen", "effect.ready"]
  ]);

  // "exhaust me and pay :rb_rune_rainbow:": the exhaust is a cost (415.4/415.5)
  // and [A] is Universal Power (163.2.b) — kept as the descriptive ["rainbow"]
  // marker because the closed Domain set cannot execute it.
  assert.deepEqual(payCost.args, {
    power: { kind: "constant", value: ["rainbow"] },
    payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
  });

  // "to ready it" is the triggering event's unit; the static IR can only carry
  // a selector, never a runtime ObjectRef (contract 3.6).
  assert.equal(readyChosen.linkedTo, "blade-dancer.pay-cost");
  assert.deepEqual(readyChosen.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "blade-dancer.chosen-unit" }
  });
  assert.deepEqual(readyChosen.targets, [
    {
      id: "blade-dancer.chosen-unit",
      filter: { type: "unit", controller: "self", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("sfd-195-221 Blade Dancer: 'when you conquer' is a Conquer Effect paying 1 energy to ready me", () => {
  assert.equal(conquerEffect.kind, "triggered");
  assert.equal(conquerEffect.trigger.at, "conquer");
  assert.deepEqual(conquerEffect.trigger.filter, { event: "conquer", player: "self" });
  assert.equal(conquerEffect.trigger.once, undefined);
  assert.equal(conquerEffect.optional, true);
  assert.equal(conquerOptional.id, "blade-dancer.may-ready-self");
  assert.equal(conquerOptional.op, "choice.optional");
  assert.deepEqual(conquerBody.map(instruction => [instruction.id, instruction.op]), [
    ["blade-dancer.pay-energy", "cost.pay"],
    ["blade-dancer.ready-self", "effect.ready"]
  ]);
  assert.deepEqual(conquerBody[0].args, { energy: { kind: "constant", value: 1 } });
  assert.equal(conquerBody[1].linkedTo, "blade-dancer.pay-energy");
  // "ready me": effect.ready's default selection is the ability source.
  assert.deepEqual(conquerBody[1].args, {});
  assert.equal(conquerBody[1].targets, undefined);
});

test("sfd-195-221 Blade Dancer: declining the choose-trigger readies nothing (403.1)", () => {
  const kernel = legendWorld({ exhausted: true });
  kernel.setAnswers({ "blade-dancer.may-ready-chosen/optional": false });

  const outcome = resolveChainBody(targetingEffect.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status, result.result.reason]), [
    ["blade-dancer.may-ready-chosen", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("chosen-unit").exhausted, true);
  assert.equal(kernel.getObject("blade-dancer").exhausted, true);
  assert.deepEqual(kernel.events, []);
});

test("sfd-195-221 Blade Dancer: declining the conquer trigger readies nothing and pays nothing", () => {
  const kernel = legendWorld({ exhausted: true });
  kernel.addPlayer("A", { energy: 3 });
  kernel.setAnswers({ "blade-dancer.may-ready-self/optional": false });

  const outcome = resolveChainBody(conquerEffect.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status, result.result.reason]), [
    ["blade-dancer.may-ready-self", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("blade-dancer").exhausted, true);
  assert.equal(kernel.player("A").energy, 3);
  assert.deepEqual(kernel.events, []);
});

test("sfd-195-221 Blade Dancer: the printed 'ready it' runs as a real effect.ready on the locked selection", () => {
  // The trigger payload binding ("it" = the chosen unit) is a judged gap, so
  // the locked selection the Finalize step would supply is bound directly and
  // the declared instruction executes for real.
  const kernel = legendWorld({ exhausted: true });
  const run = runInstruction(
    ready,
    { objects: readyChosen.args.objects, amount: { kind: "constant", value: 1 } },
    { world: kernel, targets: { "blade-dancer.chosen-unit": [kernel.ref("chosen-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("chosen-unit").exhausted, false);
  assert.equal(kernel.getObject("blade-dancer").exhausted, true);
  assert.deepEqual(run.linked.readied.objects, [{ id: "chosen-unit", zoneEntryId: 1 }]);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
});

test("sfd-195-221 Blade Dancer: the printed exhaust cost is charged as a real exhaust payment", () => {
  // 415.4/415.5: the leading :rb_exhaust: is a cost, not effect.exhaust's state
  // change. The merged cost plan charges it against the ready source.
  const kernel = legendWorld();
  const plan = buildCostPlan(kernel, {
    id: "cost:blade-dancer",
    cost: {
      kind: "activated",
      payments: [{ kind: "exhaust", object: "self" }]
    }
  });

  assert.deepEqual(plan.total.actions.map(entry => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(kernel.getObject("blade-dancer").exhausted, true);
});

test("sfd-195-221 Blade Dancer: an already exhausted source cannot pay the exhaust cost", () => {
  // 415.4: the cost must be able to be completed, so an exhausted legend makes
  // the cost plan unpayable rather than silently succeeding.
  const kernel = legendWorld({ exhausted: true });
  const plan = buildCostPlan(kernel, {
    id: "cost:blade-dancer",
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] }
  });
  assert.throws(
    () => payCostPlan(kernel, plan),
    error => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.equal(kernel.getObject("blade-dancer").exhausted, true);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "sfd-195-221 Blade Dancer: the became-target (383.4.b.2) and conquer (383.4.c.2.b) triggers need a " +
    "CardProgram -> TriggerRegistration subscriber so they can enter the chain (RIFT-257) on top of the " +
    "merged chain/event pipeline; the become-target emission itself is already live"
);
test.todo(
  "sfd-195-221 Blade Dancer: :rb_rune_rainbow: (Universal Power, 163.2.b) has no executable value in the closed " +
    "six-domain set, and cost.pay has no merged instruction file (RIFT-261 cost ops)"
);
test.todo(
  "sfd-195-221 Blade Dancer: a Legend is not representable as a Board object — contract 3.6's ZoneId has no " +
    "Legend Zone (CR 108.3), so the 'exhaust me'/'ready me' host cannot be bound in production"
);
