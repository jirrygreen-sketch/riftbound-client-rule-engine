import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/atakhan.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder, translateCost } from "../../../../engine-core/dist/programs/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /206/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  // Second-sweep refresh: the cost instructions exist, but neither the play
  // cost translator nor the static binder consumes the declarations.
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /createEngineStaticBinder/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-170-219 Atakhan: the merged play-cost translator still rejects the optional additional cost (356.2.b.1)", () => {
  // Evidence for gap (1): the declarations are authored per 356.2.b/356.4.f.1
  // but the production Finalize path refuses them instead of granting the
  // discount, so the card cannot claim the cost reduction is wired.
  assert.throws(() => translateCost({ kind: "additional", payments: [] }, "atakhan", "play"),
    /Additional costs are not bound/);
  assert.throws(() => translateCost({ kind: "cost.additional", payments: [] }, "atakhan", "play"),
    /Additional costs are not bound/);
});

test("unl-170-219 Atakhan: the production static binder has no layer mapping for the discount or the additional cost", () => {
  // 356.4.f.1: the discounts are granted by the paid optional cost. Neither
  // declaration reaches the layer registry through the merged binder.
  const f = fixture({ cards: [
    { id: "atakhan", cardId: CANONICAL_ID, types: ["unit"], energy: 1, power: [], zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("atakhan"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  const binder = createEngineStaticBinder(f.engine);
  const source = f.kernel.getObject("atakhan");
  assert.throws(() => binder.bindStatic(additionalCost, source), /cost\.additional has no layer mapping/);
  for (const discount of [energyDiscount, powerDiscount]) {
    assert.throws(() => binder.bindStatic(discount, source), /continuous\.cost-modification has no layer mapping/);
  }
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("unl-170-219 Atakhan: the merged Ganking expansion registers, but its permission string is not consumed as a movement route (810.1.c)", () => {
  // Evidence for gap (4): the expansion now binds through the production static
  // binder, yet it still carries a permission *string* while layers/rules/query.ts
  // builds permission routes only from permission.routes. The Standard Move query
  // therefore reports no Battlefield-to-Battlefield permission for the holder.
  const f = fixture({ cards: [
    { id: "atakhan", cardId: CANONICAL_ID, types: ["unit"], energy: 1, power: [], zone: "board", location: { type: "battlefield", id: "bf-1" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("atakhan"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  const registered = keywordDefinitionsById.get("Ganking");
  const [expansion] = registered.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.effect.permission, "battlefield-to-battlefield",
    "the merged KeywordDef still publishes a permission string, not routes");
  createEngineStaticBinder(f.engine).bindStatic(expansion, f.kernel.getObject("atakhan"));
  const object = f.kernel.getObject("atakhan");
  const view = movement(f.engine.layers.registry, object.ref, object, "A");
  // The declaration really is registered (the layer entry exists) ...
  assert.deepEqual(f.engine.layers.registry.list().map(entry => entry.effect.effect.kind), ["continuous.movement"]);
  // ... but it contributes no route, so no move permission is derivable.
  assert.equal(view.permissions.length, 0);
  assert.equal(view.canGank, false);
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
  // The reduction is Order Power; its amount counts every printed/copied
  // Power symbol of the killed unit, regardless of that unit's domains.
  assert.equal(powerDiscount.effect.amount.subject, "power-cost-of-the-killed-unit");
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

test.todo("atakhan: bind static optional kill costs and grantedBy discounts to Finalize, including the chosen printed/copied cost (CR 206/356.4.f.1)");

test.todo("atakhan: produce attack-declared and bind defender, chooser and attack location to the forced kill (CR 383.4.e; RIFT-357)");

test.todo("atakhan: normalize the Ganking static expansion into permission.routes before Standard Move consumes it (CR 810.1.c; the declaration binds but exposes only a permission string)");

for (const selected of [true, false]) {
  test(`Atakhan: the isolated optional kill component selected=${selected} produces the actual payment receipt`, () => {
    // Isolate the supported optional kill component. Reading the chosen unit's
    // printed costs for the card's reductions remains a separate blocker.
    const kernel = world().player("A")
      .hand("atakhan", { cardId: CANONICAL_ID, energy: 10, power: ["Order", "Order", "Order"] })
      .unit("cost-unit", { might: 2, energy: 2, power: null }).build();
    const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("atakhan") });
    const modify = runInstruction(costModify, {
      // No printed-cost payment is claimed here: this executes only the
      // additional component declared by the card, with an empty base cost.
      id: "atakhan:optional", cost: { payments: [] },
      optionalAdditional: [{ id: additionalCost.effect.id, kind: "additional", selected,
        cost: { payments: [{ kind: "kill", object: ctx.ref("cost-unit") }] } }]
    }, { world: ctx });
    assert.equal(modify.result.status, "executed");
    assert.deepEqual(modify.linked.cost.total.power, []);
    assert.equal(ctx.getObject("cost-unit").zone, "board", "Finalize planning does not pay the kill");
    const payment = runInstruction(costPay, {
      cost: { kind: "constant", value: modify.linked.cost }
    }, { world: ctx });
    assert.equal(payment.result.status, "executed");
    assert.equal(ctx.player("A").energy, 0);
    assert.deepEqual(ctx.player("A").power, []);
    assert.equal(ctx.getObject("cost-unit").zone, selected ? "trash" : "board");
    assert.equal(payment.linked.payment.paid, true);
    assert.deepEqual(modify.linked.cost.declinedAdditional, selected ? [] : [additionalCost.effect.id]);
    assert.deepEqual(payment.linked.payment.additional, selected ? [
      { id: additionalCost.effect.id, kind: "additional", paid: true }
    ] : []);
    assert.deepEqual(payment.events.map(event => event.action), selected ? ["pay", "kill"] : ["pay"]);
  });
}
