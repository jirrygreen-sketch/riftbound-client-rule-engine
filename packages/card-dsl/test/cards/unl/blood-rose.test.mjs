import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/blood-rose.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const CANONICAL_ID =
  "card.hash-ba305afc626a1b8699b28237b162d74c5c553675696baec7c3488296aa55cdf6";
const SOURCE_TEXT =
  "When you play a unit, you may pay :rb_energy_1: to gain 1 XP.\n" +
  "Spend 3 XP, :rb_exhaust:: Ready a unit.";

const [triggered, activated] = program.abilities;
const [mayPay] = triggered.body;
const [pay, gainXp] = mayPay.args.body.value;
const [readyUnit] = activated.body;
const targetSpec = readyUnit.targets[0];

test("unl-109-219 Blood Rose: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-109-219 Blood Rose: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-109-219 Blood Rose: 'When you play a unit' is a card-played trigger over a friendly unit", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(triggered.kind, "triggered");
  // 383.4.a.4: a trigger on another object being played is not a Play Effect.
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    object: { type: "unit", controller: "self" }
  });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.optional, false);
});

test("unl-109-219 Blood Rose: the may-pay is one choice.optional wrapping pay then gain 1 XP (contract 3.9)", () => {
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["blood-rose.may-pay-for-xp"]);
  assert.equal(mayPay.op, "choice.optional");
  assert.deepEqual(mayPay.args.prompt, { kind: "constant", value: "Pay 1 energy to gain 1 XP?" });
  // 403.1 / contract 3.9: the chosen instructions live inside body, never as
  // "place a choice, then link the next instruction with linkedTo".
  assert.equal(mayPay.args.body.kind, "constant");
  assert.deepEqual(mayPay.args.body.value.map(instruction => instruction.id), [
    "blood-rose.pay",
    "blood-rose.gain-xp"
  ]);
  assert.equal(mayPay.targets, undefined);
  assert.equal(mayPay.picks, undefined);

  // 204.3.a / 205: the in-effect payment; the op is not merged (see judgeReason).
  assert.equal(pay.op, "cost.pay");
  assert.equal(pay.args.energy.value, 1);
  // 730.1 / 414.3: "pay ... to gain" chains the XP gain to the payment.
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args.amount, { kind: "constant", value: 1 });
  assert.equal(gainXp.linkedTo, "blood-rose.pay");
});

test("unl-109-219 Blood Rose: the activated ability costs 3 XP plus the exhaust symbol at action timing", () => {
  assert.equal(activated.kind, "activated");
  // 151 / 151.2: Gear activated abilities default to action speed.
  assert.equal(activated.timing, "action");
  assert.equal(activated.cost.kind, "activated");
  // 730.2: Spend 3 XP is a player-resource cost; 415.5: the exhaust symbol.
  assert.deepEqual(activated.cost.payments, [
    { kind: "xp", amount: { kind: "constant", value: 3 } },
    { kind: "exhaust" }
  ]);
  assert.equal(activated.cost.energy, undefined);
});

test("unl-109-219 Blood Rose: 'Ready a unit' is one chosen Board target, not a pick", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(readyUnit.id, "blood-rose.ready-unit");
  assert.equal(readyUnit.op, "effect.ready");
  assert.deepEqual(readyUnit.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "blood-rose.unit" }
  });
  // 355.9.b / 355.10.g: the ready-a-legend exception does not apply to "a unit".
  assert.deepEqual(targetSpec, {
    id: "blood-rose.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(readyUnit.picks, undefined);
  assert.equal(readyUnit.linkedTo, undefined);
});

test("unl-109-219 Blood Rose golden: 3 XP plus exhaust is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { xp: 4 })
    .unit("blood-rose", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      controller: "A",
      owner: "A",
      exhausted: false
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("blood-rose") });
  const plan = buildCostPlan(context, { id: "blood-rose:ready", cost: activated.cost });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.equal(plan.total.xp, 3);

  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.xp, 3);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust", "spend-xp"]);
  assert.equal(context.player("A").xp, 1);
  assert.equal(context.getObject("blood-rose").exhausted, true);
});

test("unl-109-219 Blood Rose golden: the activated body really readies the chosen exhausted unit", () => {
  const kernel = world()
    .unit("blood-rose", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      controller: "A",
      owner: "A"
    })
    .unit("sleepy-unit", { zone: "board", exhausted: true, controller: "A", owner: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("blood-rose") });
  context.setTargets(targetSpec.id, [kernel.ref("sleepy-unit")]);

  const outcome = resolveChainBody(activated.body, context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["blood-rose.ready-unit", "executed"]
  ]);
  assert.equal(context.getObject("sleepy-unit").exhausted, false);
  assert.deepEqual(context.events.map(event => event.action), ["ready"]);
});

test("unl-109-219 Blood Rose golden: readying an already-ready unit does nothing (416.1.b / 416.1.c)", () => {
  const kernel = world()
    .unit("blood-rose", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      controller: "A",
      owner: "A"
    })
    .unit("awake-unit", { zone: "board", exhausted: false, controller: "A", owner: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("blood-rose") });
  context.setTargets(targetSpec.id, [kernel.ref("awake-unit")]);

  const outcome = resolveChainBody(activated.body, context);
  // No state change and no event: the instruction still completes, the linked
  // count is 0 (416.1.b "nothing additional happens").
  assert.equal(outcome.status, "executed");
  assert.deepEqual(context.events, []);
  assert.equal(outcome.linkedValues["blood-rose.ready-unit.readied"].count, 0);
});

test("unl-109-219 Blood Rose golden: a unit that left the Board makes the ready instruction ignored", () => {
  const kernel = world()
    .unit("blood-rose", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      controller: "A",
      owner: "A"
    })
    .unit("fleeing-unit", { zone: "board", exhausted: true, controller: "A", owner: "A" })
    .build();
  const stale = kernel.ref("fleeing-unit");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("blood-rose") });
  context.setTargets(targetSpec.id, [stale]);

  const outcome = resolveChainBody(activated.body, context);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["blood-rose.ready-unit", "ignored", "mistargeted"]
  ]);
});

test.todo(
  "unl-109-219 Blood Rose: the 'you may pay 1 energy' base cost of the triggered ability (CR 383.3.a / 383.3.b / " +
    "383.3.b.1) needs a cost slot on TriggeredAbility (contract 3.1) plus Finalize payment wiring; the merged " +
    "contract has no such slot"
);
test.todo(
  "unl-109-219 Blood Rose: the in-effect 1-energy payment needs the cost.pay instruction primitive (CR 204.3.a / 205; " +
    "RIFT-89 cost.* workstream is not merged)"
);
test.todo(
  "unl-109-219 Blood Rose: register the card-played trigger as a TriggerRegistration and run it from the real play " +
    "pipeline (CR 383.4.a.4; contract 3.5, RIFT-120 follow-up)"
);
