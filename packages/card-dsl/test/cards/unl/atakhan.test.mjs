import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/atakhan.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-828f8b87c552d0b972bcc9a40a8e2ec7760cfe5125ba1d735038c830884900c3";
const SOURCE_TEXT =
  "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_1: less " +
  "for each Energy it costs and :rb_rune_order: less for each Power it costs.\n" +
  "[Ganking] (I can move from battlefield to battlefield.)\n" +
  "When I attack, the defender must kill one of their units here.";
const DEFENDER_UNIT_HERE = "atakhan.defender-unit-here";

const [additionalCost, energyDiscount, powerDiscount, gankingKeyword, attackTrigger] = program.abilities;
const [killInstruction] = attackTrigger.body;
const defenderPick = killInstruction.picks[0];

test("unl-170-219 Atakhan: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-170-219 Atakhan: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /206/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-170-219 Atakhan: the optional additional cost kills one friendly unit as a cost component (356.2.b.1 / 355.10.c)", () => {
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "atakhan.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");

  assert.equal(additionalCost.effect.payments.length, 1);
  const [payment] = additionalCost.effect.payments;
  assert.equal(payment.kind, "kill");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  // 355.10.c: the killed unit is part of the cost, so the choice is a
  // non-targeting cost pick made by the paying player.
  assert.equal(payment.choice.id, "atakhan.friendly-unit");
  assert.deepEqual(payment.choice.options, ["friendly-unit"]);
  assert.equal(payment.choice.type, "unit");
  assert.equal(payment.choice.zone, "board");
  assert.equal(payment.choice.selection, "one");
  assert.equal(payment.choice.controller, "self");
});

test("unl-170-219 Atakhan: the two component discounts read the killed unit's printed energy/power (356.4.b-c, 206)", () => {
  // 356.4.f.1: the discounts are granted by the paid optional additional cost.
  for (const discount of [energyDiscount, powerDiscount]) {
    assert.equal(discount.kind, "static");
    assert.equal(discount.effect.kind, "continuous.cost-modification");
    assert.equal(discount.effect.appliesTo, "self");
    assert.equal(discount.effect.stage, "discount");
    assert.equal(discount.effect.grantedBy, "atakhan.additional-cost");
    // The amount must be derived from the killed unit's printed cost (206); the
    // recorded shape names that subject instead of a static constant, and it
    // stays fail-closed until the cost receipt exists (see judgeReason).
    assert.equal(discount.effect.amount.kind, "count");
    assert.equal(discount.effect.amount.filter.zone, "cost-receipt");
  }
  assert.equal(energyDiscount.effect.resource, "energy");
  assert.equal(energyDiscount.effect.amount.subject, "energy-cost-of-the-killed-unit");
  assert.equal(powerDiscount.effect.resource, "power");
  assert.deepEqual(powerDiscount.effect.domains, ["Order"]);
  // :rb_rune_order: is a specific-domain Power symbol, not the universal one.
  assert.equal(powerDiscount.effect.amount.subject, "order-power-cost-of-the-killed-unit");
});

test("unl-170-219 Atakhan: [Ganking] is declared as a bare keyword and expands through the merged KeywordDef (810)", () => {
  assert.deepEqual(gankingKeyword, { kind: "keyword", keyword: "ganking" });
  const registered = keywordDefinitionsById.get("Ganking");
  assert.ok(registered, "effects/keywords/Ganking.ts must be registered");
  assert.equal(registered.valued, false);
  // 810.2: multiple instances are redundant.
  assert.equal(registered.stacking, "single");
  const [expansion] = registered.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.movement");
  assert.equal(expansion.effect.permission, "battlefield-to-battlefield");
});

test("unl-170-219 Atakhan: the attack trigger is a forced kill of a defender unit here (383.4.e)", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(attackTrigger.optional, false);
  assert.equal(attackTrigger.body.length, 1);

  assert.equal(killInstruction.id, "atakhan.defender-kills");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.picks, { kind: "constant", value: DEFENDER_UNIT_HERE });
  assert.equal(killInstruction.args.target, undefined);
  assert.equal(killInstruction.args.self, undefined);
  assert.equal(killInstruction.linkedTo, undefined);

  assert.equal(defenderPick.id, DEFENDER_UNIT_HERE);
  assert.deepEqual(defenderPick.options, ["defender-unit-here"]);
  // 359.3.f: "here" is the location the attacker is at, expressed with the
  // contract 3.6 sameLocationAs anchor; the defender's controller scope has no
  // IR form and is not silently dropped (see judgeReason).
  assert.deepEqual(defenderPick.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "source"
  });
  assert.equal(defenderPick.min, 1);
  assert.equal(defenderPick.max, 1);
  assert.equal(defenderPick.selection, "one");
});

test("unl-170-219 Atakhan golden: the forced kill really kills the locked defender unit here (429.6)", () => {
  const kernel = world()
    .unit("atakhan", { might: 7, location: { type: "battlefield", id: "bf-1" } })
    .unit("defender-unit", {
      owner: "B",
      controller: "B",
      might: 3,
      location: { type: "battlefield", id: "bf-1" }
    })
    .player("B")
    .build();
  const run = runInstruction(
    kill,
    { picks: killInstruction.args.picks.value },
    { world: kernel, picks: { [DEFENDER_UNIT_HERE]: [kernel.ref("defender-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("defender-unit").zone, "trash");
  assert.deepEqual(run.linked.killed, [{ id: "defender-unit", zoneEntryId: 1 }]);
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("unl-170-219 Atakhan golden: a defender unit that already left makes the kill ignored (359.3.e.6)", () => {
  const kernel = world()
    .unit("atakhan", { might: 7, location: { type: "battlefield", id: "bf-1" } })
    .unit("defender-unit", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const stale = kernel.ref("defender-unit");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "hand" }).status, "done");
  const run = runInstruction(
    kill,
    { picks: killInstruction.args.picks.value },
    { world: kernel, picks: { [DEFENDER_UNIT_HERE]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-170-219 Atakhan: an optional additional cost op plus the CardProgram -> CostPlan wiring that charges the kill " +
    "during Finalize and exposes a paid receipt (356.2.b.1 / 356.4.f.1) — RIFT-9 / RIFT-89"
);
test.todo(
  "unl-170-219 Atakhan: component discounts whose amount reads the killed unit's PRINTED energy/power cost (206 / " +
    "356.4.b-c) and that are granted only by the selected optional cost — the receipt has no such expression"
);
test.todo(
  "unl-170-219 Atakhan: the attack trigger needs the defender's identity from the combat flow plus per-player fan-out " +
    "for \"the defender must kill one of their units here\" (383.4.e / 355.10.d) — no IR form yet"
);
