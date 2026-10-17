import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { finalizeTargetPlan, queryTargetCandidates, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import firestorm from "../../../dist/cards/ogs/firestorm.js";
import avalanche from "../../../dist/cards/rad/avalanche.js";
import convergence from "../../../dist/cards/rad/parallel-convergence.js";
import swimmer from "../../../dist/cards/rad/shimmering-swimmer.js";
import grenade from "../../../dist/cards/unl/dancing-grenade.js";
import retreat from "../../../dist/cards/ogn/retreat.js";

const battlefield = { type: "battlefield", id: "battlefield-1" };
const resolveSpell = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

// Each original card has its own intended scenario and expectations. A TODO
// means no full-card execution evidence: the scenario API accepts executable
// programs only. Never turn an unsupported-operation rejection into a pass.
// Swimmer's corrected IR is play(cost) + triggered(damage), not play(damage).
const rows = [
  {
    name: "Firestorm · all enemy units at the chosen battlefield",
    canonicalCardId: "card.hash-4f827e86263468c7ee54c70750f747df55cb193818954ea93bd73791d1bf837a",
    program: firestorm,
    blocked: "RIFT-659 / RIFT-9: effect.damage has no non-target objects/query set consumer (CR 355.10.d)",
    scenario: {
      players: { A: { energy: 6, power: ["Fury"] } },
      objects: [
        { id: "spell", cardId: firestorm.canonicalCardId, types: ["spell"], zone: "hand", energy: 6, power: ["Fury"], might: null },
        { id: "battlefield", types: ["battlefield"], zone: "board", location: battlefield, energy: null, power: null, might: null },
        { id: "enemy-1", owner: "B", zone: "board", location: battlefield, might: 7 },
        { id: "enemy-2", owner: "B", zone: "board", location: battlefield, might: 6 },
        { id: "ally", zone: "board", location: battlefield, might: 5 },
        { id: "elsewhere", owner: "B", zone: "board", location: { type: "battlefield", id: "battlefield-2" }, might: 5 },
        { id: "base-unit", owner: "B", zone: "board", location: { type: "base", player: "B" }, might: 5 },
      ],
      answers: { "target:firestorm.battlefield": ["battlefield"] },
      operations: resolveSpell,
    },
    expect: {
      objects: { spell: { zone: "trash" }, "enemy-1": { damage: 3 }, "enemy-2": { damage: 3 }, ally: { damage: 0 }, elsewhere: { damage: 0 }, "base-unit": { damage: 0 } },
      players: { A: { energy: 0, power: [] } },
      events: { includes: [
        { timingPoint: "became-target", target: { ref: "battlefield" } },
        { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy-1", amount: 3 } },
        { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy-2", amount: 3 } },
      ] },
    },
  },
  {
    name: "Avalanche · both players' bases, excluding battlefields and gear",
    canonicalCardId: "card.hash-93ccf4a04222adbd61db565ce07b24bcbe42a6cf03edc5ff3ab1d63feb45bad5",
    program: avalanche,
    blocked: "RIFT-659 / RIFT-9: non-target batch damage and simultaneous-set execution remain unavailable (CR 355.10.d / 418.1.d)",
    scenario: {
      players: { A: { energy: 5, power: ["Body", "Body"] } },
      objects: [
        { id: "spell", cardId: avalanche.canonicalCardId, types: ["spell"], zone: "hand", energy: 5, power: ["Body", "Body"], might: null },
        { id: "friendly-base", zone: "board", location: { type: "base", player: "A" }, might: 5 },
        { id: "enemy-base", owner: "B", zone: "board", location: { type: "base", player: "B" }, might: 6 },
        { id: "battlefield-unit", owner: "B", zone: "board", location: battlefield, might: 7 },
        { id: "base-gear", types: ["gear"], zone: "board", location: { type: "base", player: "A" }, energy: null, power: null, might: null },
      ],
      operations: resolveSpell,
    },
    expect: {
      objects: { spell: { zone: "trash" }, "friendly-base": { damage: 3 }, "enemy-base": { damage: 3 }, "battlefield-unit": { damage: 0 }, "base-gear": { damage: 0, energy: null, power: null } },
      players: { A: { energy: 0, power: [] } },
      events: { includes: [
        { timingPoint: "damage-dealt", action: { target: "friendly-base", amount: 3 } },
        { timingPoint: "damage-dealt", action: { target: "enemy-base", amount: 3 } },
      ] },
    },
  },
  {
    name: "Parallel Convergence · mandatory friendly return, then 5 at a battlefield",
    canonicalCardId: "card.hash-84ee715c26888cfa3850f44083e64823f41b5db0dc23a4f0511c4eb127d52175",
    program: convergence,
    blocked: "RIFT-659: programs/play additional-cost translation and return-to-hand cost payment are missing (CR 356.2.a.1)",
    scenario: {
      players: { A: { energy: 2, power: ["Mind"] } },
      objects: [
        { id: "spell", cardId: convergence.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Mind"], might: null },
        { id: "returned-unit", owner: "B", controller: "A", zone: "board", location: { type: "base", player: "A" }, might: 3 },
        { id: "enemy", owner: "B", zone: "board", location: battlefield, might: 8 },
        { id: "enemy-base", owner: "B", zone: "board", location: { type: "base", player: "B" }, might: 8 },
      ],
      answers: { "target:unit-at-battlefield": ["enemy"] },
      // The future cost bridge must query the friendly-unit pick at Finalize;
      // there is exactly one eligible unit, owned by B and controlled by A.
      operations: resolveSpell,
    },
    expect: {
      objects: { spell: { zone: "trash" }, "returned-unit": { zone: "hand", owner: "B" }, enemy: { damage: 5 }, "enemy-base": { damage: 0 } },
      players: { A: { energy: 0, power: [] }, B: { handSize: 1 } },
      events: { sequence: [
        { timingPoint: "object-enters-hand", object: { ref: "returned-unit" } },
        { timingPoint: "damage-dealt", action: { target: "enemy", amount: 5 } },
      ] },
    },
  },
  {
    name: "Shimmering Swimmer · declined optional cost creates no damage trigger",
    canonicalCardId: "card.hash-05acd78d132bf8780fd8fba892925f17226694182298a6fdeac69e8a824941e1",
    program: swimmer,
    blocked: "RIFT-659: optional kill-cost binding and original payment receipt in the trigger condition are missing (CR 356.2.b.1 / 383.2.a.1)",
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        { id: "swimmer", cardId: swimmer.canonicalCardId, zone: "hand", energy: 3, power: null, might: 3 },
        { id: "friendly-gear", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "enemy", owner: "B", zone: "board", might: 5 },
      ],
      answers: { optional: false },
      operations: [{ type: "play", object: "swimmer", player: "A" }],
    },
    expect: {
      objects: { swimmer: { zone: "board", location: { type: "base", player: "A" }, power: null }, "friendly-gear": { zone: "board" }, enemy: { damage: 0 } },
      players: { A: { energy: 0, power: [] } },
      events: { includes: [{ timingPoint: "card-played", object: { ref: "swimmer" } }] },
    },
  },
  {
    name: "Dancing Grenade · first damage; full replay and history bonus pending",
    canonicalCardId: "card.hash-4609651295618e769925ca1121b1e4b5f1589eaef0c44d494c4efea35f85899c",
    program: grenade,
    blocked: "RIFT-659: resolving-spell replay, alternate-cost lifecycle and per-card damage history/bonus are unavailable (CR 158.3 / 420.3 / 712–715)",
    scenario: {
      players: { A: { energy: 2, power: ["Fury"] } },
      objects: [
        { id: "spell", cardId: grenade.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Fury"], might: null },
        { id: "enemy", owner: "B", zone: "board", location: { type: "base", player: "B" }, might: 5 },
      ],
      answers: { "target:dancing-grenade.unit": ["enemy"] },
      operations: resolveSpell,
    },
    expect: {
      objects: { spell: { zone: "trash" }, enemy: { damage: 2 } },
      players: { A: { energy: 0, power: [] } },
      events: { sequence: [
        { timingPoint: "became-target", target: { ref: "enemy" } },
        { timingPoint: "damage-dealt", action: { source: "spell", target: "enemy", amount: 2 } },
        { timingPoint: "card-played", object: { ref: "spell" } },
      ] },
      links: { "dancing-grenade.deal-2.dealt": 2, "dancing-grenade.deal-2.dealtCount": 1 },
    },
  },
];

for (const [index, entry] of defineTemplateSuite("play/effect.damage RIFT-659 · full card", rows).entries()) {
  if (rows[index].program.status === "executable") test(entry.name, entry.run);
  else test.todo(`${entry.name} — ${rows[index].blocked}`);
}

// Explicit partial evidence: run only the already-authored first Deal 2.
// The scenario API's status guard needs an in-memory executable view. Keep
// every original ability, printed cost, target and condition by identity; this
// does not implement the omitted replay clause or promote the source program.
const firstDealOnly = { ...grenade, status: "executable" };
delete firstDealOnly.judgeReason;
const firstDealRow = rows[4];
const partialRows = [
  {
    ...firstDealRow,
    name: "Dancing Grenade · supported first Deal 2 only, after Finalize and target locking",
    program: firstDealOnly,
    // The shared TestWorld pay action currently debits Energy only. Keep the
    // full-card row's Power-consumption expectation pending above; this row
    // proves damage/targets and does not claim complete resource payment.
    expect: { ...firstDealRow.expect, players: { A: { energy: 0 } } },
  },
  {
    name: "Dancing Grenade · supported first Deal 2 ignores a target returned by a real Reaction",
    canonicalCardId: grenade.canonicalCardId,
    program: firstDealOnly,
    scenario: {
      players: { A: { energy: 2, power: ["Fury"] }, B: { energy: 1 } },
      objects: [
        { id: "spell", cardId: grenade.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Fury"], might: null },
        { id: "retreat", program: retreat, owner: "B", types: ["spell"], zone: "hand", energy: 1, power: null, might: null },
        { id: "enemy", owner: "B", zone: "board", location: battlefield, might: 5 },
        { id: "other-unit", owner: "B", zone: "board", location: battlefield, might: 6 },
      ],
      // Retreat still executes its complete original body. B's Rune Deck is
      // empty, a legal Channel shortfall (431.3); no fixture performs a return.
      answers: { "target:dancing-grenade.unit": ["enemy"], "target:friendly-unit": ["enemy"] },
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "play", object: "retreat", player: "B" },
        { type: "pass", player: "B" },
        { type: "pass", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
    },
    expect: {
      objects: { spell: { zone: "trash" }, retreat: { zone: "trash", power: null }, enemy: { zone: "hand", damage: 0 }, "other-unit": { zone: "board", damage: 0 } },
      players: { A: { energy: 0 }, B: { energy: 0, handSize: 1, runeDeckSize: 0 } },
      events: { sequence: [
        { timingPoint: "became-target", target: { ref: "enemy" }, source: { ref: "spell" } },
        { timingPoint: "object-enters-hand", object: { ref: "enemy" } },
        { timingPoint: "card-played", object: { ref: "retreat" } },
        { timingPoint: "card-played", object: { ref: "spell" } },
      ] },
    },
  },
];

for (const [index, entry] of defineTemplateSuite("play/effect.damage RIFT-659 · partial IR only", partialRows).entries()) {
  test(entry.name, () => {
    assert.equal(grenade.status, "judge-required");
    assert.equal(firstDealOnly.abilities, grenade.abilities);
    const result = entry.run();
    assert.deepEqual(result.state.chain, []);
    if (index === 1) assert.deepEqual(result.events.filter(event => event.timingPoint === "damage-dealt"), []);
  });
}

// The remaining supported bodies cannot enter runCardScenario without deleting
// mandatory/optional costs. Keep those original programs intact and probe their
// exact bodies/predicates with the lower-level real kernel (README section 4).
test(`Parallel Convergence · supported target Finalize/Resolve and damage body only [${convergence.canonicalCardId}]`, () => {
  const kernel = world()
    .hand("spell", { types: ["spell"], cardId: convergence.canonicalCardId, energy: 2, power: ["Mind"] })
    .unit("battlefield-unit", { owner: "B", location: battlefield, might: 8 })
    .base("base-unit", { owner: "B", location: { type: "base", player: "B" }, might: 8 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("spell"), controller: "A" });
  const play = convergence.abilities.find(ability => ability.kind === "play");
  const [translated] = translateInstructionTargets(play.body);
  const [spec] = translated.targets;
  assert.deepEqual(queryTargetCandidates(context, spec).map(ref => ref.id), ["battlefield-unit"]);
  const plan = finalizeTargetPlan(context, spec, { selected: [context.ref("battlefield-unit")] });
  const resolution = resolveTargetPlan(context, plan);
  assert.equal(resolution.status, "resolved");
  context.setTargets(spec.id, resolution.selected);
  const result = resolveChainBody(play.body, context);
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(context.getObject("battlefield-unit").damage, 5);
  assert.equal(context.getObject("base-unit").damage, 0);
  assert.equal(result.results[0].result.linkedValues.dealt, 5);
});

for (const row of [
  { name: "paid kill of friendly unit", type: "unit", selected: true, condition: true, victimZone: "trash" },
  { name: "paid kill of friendly gear", type: "gear", selected: true, condition: true, victimZone: "trash" },
  { name: "declined kill cost", type: "gear", selected: false, condition: false, victimZone: "board" },
]) {
  test(`Shimmering Swimmer · supported cost receipt / trigger predicate only · ${row.name} [${swimmer.canonicalCardId}]`, () => {
    const kernel = world()
      .player("A", { energy: 3 })
      .hand("swimmer", { cardId: swimmer.canonicalCardId, energy: 3, power: null, might: 3 })
      .object("victim", { owner: "A", types: [row.type], zone: "board", location: battlefield, energy: null, power: null, might: 3 })
      .unit("enemy", { owner: "B", might: 5 })
      .build();
    const context = kernel.clone({ sourceSnapshot: kernel.getObject("swimmer"), controller: "A" });
    const play = swimmer.abilities.find(ability => ability.kind === "play");
    const trigger = swimmer.abilities.find(ability => ability.kind === "triggered");
    const payment = play.cost.payments[0];
    const id = payment.choice.id;
    if (row.selected) context.setPicks(id, [context.ref("victim")]);
    const plan = buildCostPlan(context, {
      id: "swimmer:cost",
      cost: { kind: "printed" },
      optionalAdditional: [{
        id, kind: "additional", selected: row.selected,
        cost: { payments: [{ ...payment, choice: { ...payment.choice, options: [context.ref("victim")] } }] },
      }],
    });
    const receipt = payCostPlan(context, plan);
    assert.equal(plan.printed.power, null);
    assert.deepEqual(plan.total.power, []);
    assert.equal(context.player("A").energy, 0);
    assert.equal(context.getObject("victim").zone, row.victimZone);
    assert.equal(context.getObject("victim").energy, null);
    assert.equal(context.getObject("victim").power, null);
    assert.equal(evaluateCondition(trigger.trigger.condition, {
      context, cost: { plan, receipt }, linked: key => context.linked(key),
      canLookBack: () => true, isIgnored: () => false,
    }), row.condition);
    if (row.selected) {
      context.setTargets("shimmering-swimmer.unit", [context.ref("enemy")]);
      const result = resolveChainBody(trigger.body, context);
      assert.equal(result.results[0].result.status, "executed");
      assert.equal(context.getObject("enemy").damage, 2);
    }
  });
}
