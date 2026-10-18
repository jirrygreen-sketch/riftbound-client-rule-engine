// RIFT-654: template evidence for five judge-required cards with the
// activated+activated||effect.resources shape.
//
// Whole-card rows below keep the published program byte-for-byte and are TODO
// rows until every documented dependency lands. The executable probes use the
// card's original cost payment and body; where the full cost is unsupported,
// only the named original payment slice is isolated and the full-cost failure
// is asserted alongside it. These probes are partial evidence, never a claim
// that the card's complete activation path executes.
import assert from "node:assert/strict";
import test from "node:test";

import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

import daughterOfTheVoid from "../../../dist/cards/ogn/daughter-of-the-void.js";
import handOfNoxus from "../../../dist/cards/ogn/hand-of-noxus.js";
import ironRevenant from "../../../dist/cards/rad/iron-revenant.js";
import fireBelowTheMountain from "../../../dist/cards/sfd/fire-below-the-mountain.js";
import gold from "../../../dist/cards/sfd/gold.js";

const programs = [
  daughterOfTheVoid,
  handOfNoxus,
  ironRevenant,
  fireBelowTheMountain,
  gold,
];

const activatedAbility = (program) => {
  const ability = program.abilities.find(entry => entry.kind === "activated");
  assert.ok(ability, `${program.canonicalCardId} must retain its activated ability`);
  return ability;
};

const activate = (id) => [
  { type: "activate", object: id, player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

// The Legend Zone is absent from the frozen ZoneId union. These scenarios use a
// Board host as partial harness evidence; every whole-card row remains TODO and
// no result below is presented as a production Legend activation.
const legendSource = (program, id, extra = {}) => ({
  id,
  cardId: program.canonicalCardId,
  program,
  types: ["legend"],
  zone: "board",
  location: { type: "base", player: "A" },
  energy: null,
  power: null,
  might: null,
  ...extra,
});

// One independent whole-card row per canonical identity. The original program
// (including restriction and every printed payment) is passed to the scenario
// harness. It stays TODO until its judgeReason gaps are executable.
const wholeCardRows = defineTemplateSuite("RIFT-654 whole-card activation", [
  {
    name: "Daughter of the Void keeps the spell-use restriction and Universal Power body",
    canonicalCardId: daughterOfTheVoid.canonicalCardId,
    program: daughterOfTheVoid,
    scenario: {
      players: { A: { energy: 3, power: ["Fury"] } },
      objects: [legendSource(daughterOfTheVoid, "daughter")],
      operations: activate("daughter"),
      expect: {
        players: { A: { energy: 3 } },
        objects: { daughter: { exhausted: true, energy: null, power: null } },
      },
    },
  },
  {
    name: "Hand of Noxus cannot pay Exhaust without another finalized card this turn",
    canonicalCardId: handOfNoxus.canonicalCardId,
    program: handOfNoxus,
    scenario: {
      players: { A: { energy: 0 } },
      objects: [legendSource(handOfNoxus, "noxus")],
      operations: activate("noxus"),
      expect: {
        players: { A: { energy: 0 } },
        objects: { noxus: { exhausted: false, energy: null, power: null } },
      },
    },
  },
  {
    name: "Iron Revenant cannot activate without a unit or gear to banish from Trash",
    canonicalCardId: ironRevenant.canonicalCardId,
    program: ironRevenant,
    scenario: {
      players: { A: { energy: 3, power: ["Order"] } },
      objects: [legendSource(ironRevenant, "revenant")],
      operations: activate("revenant"),
      expect: {
        players: { A: { energy: 3, power: ["Order"] } },
        objects: { revenant: { exhausted: false, energy: null, power: null } },
      },
    },
  },
  {
    name: "Fire Below the Mountain keeps the gear-use restriction and Universal Power body",
    canonicalCardId: fireBelowTheMountain.canonicalCardId,
    program: fireBelowTheMountain,
    scenario: {
      players: { A: { energy: 3, power: ["Calm"] } },
      objects: [legendSource(fireBelowTheMountain, "fire")],
      operations: activate("fire"),
      expect: {
        players: { A: { energy: 3 } },
        objects: { fire: { exhausted: true, energy: null, power: null } },
      },
    },
  },
  {
    name: "Gold pays Kill+Exhaust and its Universal Power body remains pending",
    canonicalCardId: gold.canonicalCardId,
    program: gold,
    scenario: {
      players: { A: { energy: 3, power: ["Mind"] } },
      objects: [{
        id: "gold-token",
        cardId: gold.canonicalCardId,
        program: gold,
        isToken: true,
        types: ["gear"],
        tags: ["Token"],
        zone: "board",
        location: { type: "base", player: "A" },
        energy: null,
        power: null,
        might: null,
      }],
      operations: activate("gold-token"),
      expect: {
        players: { A: { energy: 3 } },
        objects: { "gold-token": { zone: "trash", energy: null, power: null } },
      },
    },
  },
]);

test("RIFT-654: every whole-card row retains its judge-required source program", () => {
  assert.deepEqual(wholeCardRows.map(row => row.canonicalCardId), programs.map(program => program.canonicalCardId));
  for (const program of programs) {
    assert.equal(program.status, "judge-required");
    assert.ok(program.judgeReason?.trim());
  }
});

for (const [index, row] of wholeCardRows.entries()) {
  const program = programs[index];
  test(row.name, { todo: program.judgeReason }, () => {
    assert.equal(row.canonicalCardId, program.canonicalCardId);
    if (program.status === "executable") return row.run();
  });
}

function sourceContext(program, id, { energy = 3, power = [], source = {} } = {}) {
  const kernel = world()
    .player("A", { energy, power })
    .unit(id, {
      cardId: program.canonicalCardId,
      types: ["legend"],
      zone: "board",
      energy: null,
      power: null,
      ...source,
    })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject(id) });
}

function payOriginalCost(program, id, options = {}) {
  const ability = activatedAbility(program);
  const context = sourceContext(program, id, options);
  const plan = buildCostPlan(context, { id: `${id}:original-cost`, cost: ability.cost });
  const receipt = payCostPlan(context, plan);
  return { ability, context, plan, receipt };
}

function assertUniversalBodyFailsClosed(program, id, initial) {
  const { ability, context, receipt } = payOriginalCost(program, id, initial);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject(id).exhausted, true);
  assert.equal(context.player("A").energy, initial.energy);
  assert.deepEqual(context.player("A").power, initial.power);

  const outcome = resolveChainBody(ability.body, context);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(context.player("A").energy, initial.energy, "[A] must never add Energy");
  assert.deepEqual(context.player("A").power, initial.power, "[A] must never become a chosen Domain");
  assert.deepEqual(outcome.events, []);
}

// Original cost/body probes. Hand is the only card whose complete printed cost
// and body are both representable; the four [A] bodies must fail closed until
// Universal Power is represented. Iron isolates its original Exhaust payment
// only after separately proving that the full original Banish+Exhaust cost is
// rejected by the merged cost vocabulary.
test("RIFT-654 evidence: Daughter pays its original Exhaust cost and original [A] body fails closed", () => {
  assertUniversalBodyFailsClosed(daughterOfTheVoid, "daughter", { energy: 3, power: ["Fury"] });
});

test("RIFT-654 evidence: Hand pays its original Exhaust cost and original [Add] 1 Energy body", () => {
  const initial = { energy: 2, power: ["Order"] };
  const { ability, context, receipt } = payOriginalCost(handOfNoxus, "noxus", initial);
  assert.equal(receipt.total.energy, 0);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("noxus").exhausted, true);
  assert.equal(context.player("A").energy, initial.energy);

  const beforeEvents = context.events.length;
  const outcome = resolveChainBody(ability.body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.player("A").energy, initial.energy + 1);
  assert.deepEqual(context.player("A").power, initial.power);
  assert.deepEqual(outcome.linkedValues["hand-of-noxus.add-energy.resources"], {
    player: "A", energy: 1, power: [],
  });
  assert.deepEqual(context.events.slice(beforeEvents).map(event => event.action), ["gain-energy"]);
});

test("RIFT-654 evidence: Iron keeps its full Banish cost rejected and isolates only the original Exhaust payment", () => {
  const ability = activatedAbility(ironRevenant);
  const fullContext = sourceContext(ironRevenant, "revenant", { energy: 4, power: ["Order"] });
  assert.throws(
    () => buildCostPlan(fullContext, { id: "revenant:full-cost", cost: ability.cost }),
    error => error instanceof CostPlanError && /Unsupported payment kind: banish/i.test(error.message),
  );
  assert.equal(fullContext.getObject("revenant").exhausted, false);
  assert.equal(fullContext.player("A").energy, 4);

  const exhaustPayment = ability.cost.payments.find(payment => payment.kind === "exhaust");
  assert.ok(exhaustPayment, "Iron Revenant must retain its original Exhaust payment");
  const context = sourceContext(ironRevenant, "revenant", { energy: 4, power: ["Order"] });
  const plan = buildCostPlan(context, {
    id: "revenant:original-exhaust-slice",
    cost: { kind: "activated", payments: [exhaustPayment] },
  });
  const receipt = payCostPlan(context, plan);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("revenant").exhausted, true);
  assert.equal(context.player("A").energy, 4);

  const outcome = resolveChainBody(ability.body, context);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(context.player("A").energy, 4);
  assert.deepEqual(context.player("A").power, ["Order"]);
});

test("RIFT-654 evidence: Fire pays its original Exhaust cost and original [A] body fails closed", () => {
  assertUniversalBodyFailsClosed(fireBelowTheMountain, "fire", { energy: 5, power: ["Calm"] });
});

test("RIFT-654 evidence: Gold pays its full original Kill+Exhaust cost and [A] body fails closed", () => {
  const initial = { energy: 6, power: ["Mind"] };
  const { ability, context, receipt } = payOriginalCost(gold, "gold-token", initial);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust", "kill"]);
  assert.equal(context.getObject("gold-token").zone, "trash");
  assert.equal(context.player("A").energy, initial.energy);

  const outcome = resolveChainBody(ability.body, context);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(context.player("A").energy, initial.energy);
  assert.deepEqual(context.player("A").power, initial.power);
});

// Negated boundary: all four [A] cards use their original body. The exact
// Energy and Power snapshots make an unrelated resource mutation observable.
const negatedRows = [
  { program: daughterOfTheVoid, id: "daughter", initial: { energy: 3, power: ["Fury"] } },
  { program: ironRevenant, id: "revenant", initial: { energy: 4, power: ["Order"] } },
  { program: fireBelowTheMountain, id: "fire", initial: { energy: 5, power: ["Calm"] } },
  { program: gold, id: "gold-token", initial: { energy: 6, power: ["Mind"] } },
];

for (const row of negatedRows) {
  test(`RIFT-654 boundary negated: ${row.program.canonicalCardId} [${row.id}] preserves the complete resource pool`, () => {
    const context = sourceContext(row.program, row.id, row.initial);
    const outcome = resolveChainBody(activatedAbility(row.program).body, context);
    assert.equal(outcome.status, "partial");
    assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "impossible", events: [] });
    assert.equal(context.player("A").energy, row.initial.energy);
    assert.deepEqual(context.player("A").power, row.initial.power);
    assert.deepEqual(context.events, []);
  });
}

// Already-exhausted source boundary through the original payment objects. Iron
// uses its original Exhaust slice because the full cost is blocked earlier by
// the still-missing Banish payment kind.
const exhaustedRows = [
  { program: daughterOfTheVoid, id: "daughter", energy: 3, power: ["Fury"] },
  { program: handOfNoxus, id: "noxus", energy: 0, power: [] },
  { program: ironRevenant, id: "revenant", energy: 4, power: ["Order"], slice: true },
  { program: fireBelowTheMountain, id: "fire", energy: 5, power: ["Calm"] },
  { program: gold, id: "gold-token", energy: 6, power: ["Mind"] },
];

for (const row of exhaustedRows) {
  test(`RIFT-654 boundary exhausted source: ${row.program.canonicalCardId} [${row.id}]`, () => {
    const ability = activatedAbility(row.program);
    const context = sourceContext(row.program, row.id, { energy: row.energy, power: row.power, source: { exhausted: true } });
    const payments = row.slice
      ? [ability.cost.payments.find(payment => payment.kind === "exhaust")]
      : ability.cost.payments;
    assert.ok(payments.every(Boolean));
    assert.throws(
      () => payCostPlan(context, buildCostPlan(context, {
        id: `${row.id}:exhausted`,
        cost: { kind: "activated", payments },
      })),
      error => error instanceof CostPlanError && error.reason === "cannot-pay-cost",
    );
    assert.equal(context.getObject(row.id).exhausted, true);
    assert.equal(context.player("A").energy, row.energy);
    assert.deepEqual(context.player("A").power, row.power);
  });
}

test("RIFT-654 boundary spent source: Gold in Trash cannot pay its original Kill+Exhaust cost", () => {
  const context = sourceContext(gold, "gold-token", { energy: 6, power: ["Mind"], source: {
    zone: "trash",
    location: null,
  } });
  assert.throws(
    () => payCostPlan(context, buildCostPlan(context, {
      id: "gold-token:spent",
      cost: activatedAbility(gold).cost,
    })),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost",
  );
  assert.equal(context.getObject("gold-token").zone, "trash");
  assert.equal(context.player("A").energy, 6);
  assert.deepEqual(context.player("A").power, ["Mind"]);
});

// The condition-not-satisfied boundary is preserved as a whole-card TODO. A
// primitive Exhaust payment succeeding in isolation does not bypass Legion.
test.todo(
  "RIFT-654 boundary condition-not-satisfied: Hand of Noxus with no other finalized card must refuse the original activation before Exhaust; the pre-cost Legion history binder and ActivatedAbility condition slot are still missing",
);
