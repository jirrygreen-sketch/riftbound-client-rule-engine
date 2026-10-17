import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/vex-cheerless.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-f53634b94e6fae93d877ca3bb7f92c97c1f881953a9d82fc5a297b398f35d3ad";
const SOURCE_TEXT =
  "While I'm in combat, friendly spells cost :rb_energy_1::rb_rune_rainbow: less to a minimum of :rb_energy_1:, " +
  "and enemy spells cost :rb_energy_1::rb_rune_rainbow: more.";

const [friendly, enemy] = program.abilities;

const IN_COMBAT_CONDITION = {
  kind: "compare",
  left: { kind: "count", subject: "self-in-combat", filter: { object: "self" } },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

const vexWorld = () => {
  const kernel = world()
    .player("A")
    .object("vex", {
      name: "Vex, Cheerless",
      cardId: CARD_ID,
      types: ["unit"],
      tags: ["Champion"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      energy: 5,
      power: ["Chaos"],
      might: 5,
      combatRole: "attacker"
    })
    .hand("spell", { energy: 2, power: ["Fury"] })
    .build();
  return kernel;
};

test("sfd-146-221 Vex, Cheerless: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-146-221 Vex, Cheerless: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason names the concrete current gaps, not a stale one.
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.e/);
  assert.match(program.judgeReason, /740\.2\.c/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-146-221 Vex, Cheerless: friendly spells get a minimum-bounded [1]/[A] discount while in combat", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(friendly.kind, "static");
  // 356.4 / 356.4.b: "cost [amount] less"; 356.4.e: the minimum belongs to this
  // discount only (the rule's own example is Eager Apprentice's same shape).
  assert.equal(friendly.effect.kind, "continuous.cost-modification");
  assert.equal(friendly.effect.stage, "discount");
  assert.equal(friendly.effect.resource, "energy");
  assert.deepEqual(friendly.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(friendly.effect.minimum, { kind: "constant", value: 1 });
  // "or [A]": 163.2.b Universal Power kept as its own alternative.
  assert.deepEqual(friendly.effect.alternative, { resource: "power", universal: true, amount: 1 });
  // 740.1.a: "friendly" is relative to the spell's caster.
  assert.deepEqual(friendly.effect.appliesTo, { type: "spell", controller: "caster" });
  // 740.2.c: "While I'm in combat" — the recorded condition shape; the layer
  // path has no in-combat predicate (see judgeReason).
  assert.deepEqual(friendly.condition, IN_COMBAT_CONDITION);
});

test("sfd-146-221 Vex, Cheerless: enemy spells get a [1]/[A] increase while in combat", () => {
  assert.equal(enemy.kind, "static");
  // 356.2: an increase (mandatory additional cost) on the total spell cost.
  assert.equal(enemy.effect.kind, "continuous.cost-modification");
  assert.equal(enemy.effect.stage, "increase");
  assert.equal(enemy.effect.resource, "energy");
  assert.deepEqual(enemy.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(enemy.effect.alternative, { resource: "power", universal: true, amount: 1 });
  // 740.1.b: "enemy" is relative to the spell's caster.
  assert.deepEqual(enemy.effect.appliesTo, { type: "spell", controller: "caster-opponent" });
  assert.deepEqual(enemy.condition, IN_COMBAT_CONDITION);
});

test("sfd-146-221 Vex, Cheerless golden: the merged cost planner really applies a caller-supplied discount like the printed one", () => {
  // The cost engine can already apply this shape when a caller supplies it
  // (CostPlanInput.discounts, 356.4/356.4.e); what is missing is the consumer that
  // projects the card's static ability into that input (see judgeReason). The
  // golden proves the arithmetic path the card would feed, on the same
  // caller-supplied base cost shape (a spell's finalized plan).
  const kernel = vexWorld();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("vex"),
    sourceSnapshot: kernel.getObject("vex"),
    controller: "A"
  });
  const plan = buildCostPlan(context, {
    id: "vex-friendly-spell",
    cost: { kind: "explicit", energy: { kind: "constant", value: 2 } },
    discounts: [{
      id: "vex.in-combat-discount",
      resource: "energy",
      amount: { kind: "constant", value: 1 },
      minimum: { kind: "constant", value: 1 }
    }]
  });
  // 356.4.e: the minimum of 1 belongs to this discount, so a 2-Energy spell pays 1.
  assert.equal(plan.total.energy, 1);
  const discount = plan.discounts.find((entry) => entry.id === "vex.in-combat-discount");
  assert.equal(discount.amount, 1);
  assert.equal(discount.minimum, 1);
  assert.equal(discount.before, 2);
  assert.equal(discount.after, 1);
});

test("sfd-146-221 Vex, Cheerless golden: the same discount cannot push a 1-Energy spell below its printed minimum", () => {
  const kernel = vexWorld();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("vex"),
    sourceSnapshot: kernel.getObject("vex"),
    controller: "A"
  });
  kernel.getObject("spell");
  const plan = buildCostPlan(context, {
    id: "vex-cheap-spell",
    cost: { kind: "explicit", energy: { kind: "constant", value: 1 } },
    discounts: [{
      id: "vex.in-combat-discount",
      resource: "energy",
      amount: { kind: "constant", value: 1 },
      minimum: { kind: "constant", value: 1 }
    }]
  });
  assert.equal(plan.total.energy, 1);
});

test("sfd-146-221 Vex, Cheerless golden: the merged cost planner applies a caller-supplied increase like the printed one", () => {
  // 356.2: the enemy-spell increase the card declares, applied through the same
  // cost-plan pipeline at the mandatory-additional stage.
  const kernel = vexWorld();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("vex"),
    sourceSnapshot: kernel.getObject("vex"),
    controller: "A"
  });
  const plan = buildCostPlan(context, {
    id: "vex-enemy-spell",
    cost: { kind: "explicit", energy: { kind: "constant", value: 1 } },
    mandatoryAdditional: [{ id: "vex.in-combat-increase", cost: { kind: "explicit", energy: { kind: "constant", value: 1 } } }]
  });
  assert.equal(plan.total.energy, 2);
});

test.todo(
  "sfd-146-221 Vex, Cheerless: project the card's static cost modifications into the Finalize cost plan " +
    "(356.4/356.4.e/356.2) with the caster's friendly/enemy relation (740.1.a-b) - needs the card static -> " +
    "CostPlanInput.discounts/increases consumer (programs/statics.ts defaults to noopStaticBinder, RIFT-257 " +
    "follow-up; cost.pay/cost.modify are RIFT-261)."
);

test.todo(
  "sfd-146-221 Vex, Cheerless: represent and charge the '[A]' (163.2.b Universal Power) term of both modifiers - " +
    "the closed Domain type and CostDiscount.resource cannot express it (effect.resources keeps [A] unsupported; " +
    "contract change request)."
);

test.todo(
  "sfd-146-221 Vex, Cheerless: evaluate \"While I'm in combat\" (740.2.c: a battlefield with combat ongoing plus a " +
    "combat designation) on the layer path - layers/engine.ts conditionMatches returns true for compare/count, so " +
    "binding the card would apply both modifiers unconditionally (RIFT-91 follow-up)."
);
