import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/gardens-of-becoming.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-ea5887640ac2868198c368d889903ebf8fd5895f4ac0b6e2f8db54a5178aad74";
const SOURCE_TEXT = 'Units here have ":rb_exhaust:: Gain 1 XP."';

const [ability] = program.abilities;
const granted = ability.effect.ability;
const [gainXp] = granted.body;

test("unl-213-219 Gardens of Becoming: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-213-219 Gardens of Becoming: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-213-219 Gardens of Becoming: judgeReason names the grant, cost and 'here' gaps", () => {
  assert.match(program.judgeReason, /continuous\.grant-ability/);
  assert.match(program.judgeReason, /describeActivate/);
  assert.match(program.judgeReason, /被授予能力的启动入口/);
  assert.match(program.judgeReason, /图层消费者/);
  // The "no static registration path" and "controller literal compare"
  // claims are stale (the merged binder resolves the anchors); the reason
  // records that and no longer carries the fourth item.
  assert.match(program.judgeReason, /普通静态绑定/);
  assert.ok(!/④/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-213-219 Gardens of Becoming: a static 'have' grant of the quoted exhaust-to-gain-XP ability", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.3 / 479.3.b: "have" identifies the Ability-Altering layer that grants
  // the quoted ability to the units at this Battlefield (053.3 "here").
  assert.equal(ability.effect.kind, "continuous.grant-ability");
  assert.equal(ability.effect.appliesTo, "units-here");
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(ability.effect.filter.controller, undefined);

  // The quoted ability: [E] cost (415.5) then Gain 1 XP (728/730.1/733).
  assert.equal(granted.kind, "activated");
  assert.equal(granted.timing, "action");
  assert.deepEqual(granted.cost, { payments: [{ kind: "exhaust", object: "self" }] });
  assert.equal(granted.body.length, 1);
  assert.equal(gainXp.id, "gardens-of-becoming.granted-gain-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args.amount, { kind: "constant", value: 1 });
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
  assert.equal(gainXp.condition, undefined);
});

test("unl-213-219 Gardens of Becoming: the granted body gains exactly 1 XP for the activating player (730.1)", () => {
  // 190.6.d: the implicit "you" of a Battlefield ability is its controller,
  // which for the granted ability is the unit's controller.
  const kernel = world().unit("unit-here", { owner: "A" }).build();
  const run = runInstruction(xp, { amount: gainXp.args.amount }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(run.linked.gained, 1);
  assert.equal(run.linked.gainedTo, "A");
  assert.deepEqual(run.events.map(event => event.action), ["gain-xp"]);
});

test("unl-213-219 Gardens of Becoming: the [E] cost of the granted ability exhausts the unit itself (415.5)", () => {
  const base = world()
    .unit("unit-here", { zone: "board" })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("unit-here") });
  const plan = buildCostPlan(kernel, {
    id: "cost:gardens-of-becoming",
    cost: granted.cost
  });
  const receipt = payCostPlan(kernel, plan);

  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("unit-here").exhausted, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
});

test("unl-213-219 Gardens of Becoming: an already exhausted unit cannot pay the [E] cost (415.4)", () => {
  const base = world()
    .unit("unit-here", { zone: "board", exhausted: true })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("unit-here") });
  const plan = buildCostPlan(kernel, {
    id: "cost:gardens-of-becoming",
    cost: granted.cost
  });

  assert.throws(() => payCostPlan(kernel, plan), /exhaust/i);
  assert.equal(kernel.getObject("unit-here").exhausted, true);
});

test.todo(
  "unl-213-219 Gardens of Becoming: grant the quoted activated ability to the units at this " +
    "Battlefield through a merged continuous.grant-ability / layers consumer (CR 479.3/479.3.b, " +
    "053.3) — needs continuous.grant-ability: grant-keyword is merged but " +
    "keyword-only, layers cannot consume ability bodies, and statics layerFor rejects grant-ability"
);

test.todo(
  "unl-213-219 Gardens of Becoming: start the granted ability through the chain, paying the " +
    "Exhaust cost and resolving Gain 1 XP for the activating player (415.5, 381.1, 730.1) — needs " +
    "a granted-ability activation entry (describeActivate covers only a card's own program)"
);

test.todo(
  "unl-213-219 Gardens of Becoming: scope the grant to 'here' so only units at this Battlefield " +
    "have the ability (CR 053.3) — the binder stores the resolved absolute location, but the layer " +
    "filter matches locations by reference identity while kernels clone snapshots, so per-object " +
    "location matching is still needed"
);
