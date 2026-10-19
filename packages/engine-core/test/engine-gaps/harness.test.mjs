import assert from "node:assert/strict";
import test from "node:test";

import { runCardScenario } from "../../dist/effects/testing/scenario/index.js";
import { runInstruction, world } from "../../dist/effects/testing/index.js";
import costPay from "../../dist/effects/instructions/cost.pay.js";
import { CostPlanError } from "../../dist/cost/plan-types.js";
import baccaiReaper from "../../../card-dsl/dist/cards/ven/baccai-reaper.js";

const constant = value => ({ kind: "constant", value });
const executableBaccaiReaper = { ...baccaiReaper, status: "executable", judgeReason: undefined };

function withSource(kernel, id = "source") {
  return kernel.clone({ sourceSnapshot: kernel.getObject(id), controller: "A" });
}

function baccaiScenario(power, optional) {
  return {
    players: { A: { power }, B: {} },
    answers: { optional },
    objects: [{
      id: "reaper",
      program: executableBaccaiReaper,
      cardId: baccaiReaper.canonicalCardId,
      types: ["unit"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      might: 4,
    }],
    operations: [
      { type: "trigger", timingPoint: "attack-declared", object: "reaper", player: "A" },
    ],
  };
}

test("EG-HARNESS pay debits the exact Power domains and exposes an exact receipt", () => {
  const base = world()
    .player("A", { energy: 2, power: ["Fury", "Calm"], xp: 1 })
    .hand("source", { types: ["spell"], energy: 0, power: [] })
    .build();
  const kernel = withSource(base);

  const run = runInstruction(costPay, {
    payments: constant({ energy: 1, power: ["Fury"], xp: 1 }),
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.player("A"), {
    id: "A",
    energy: 1,
    power: ["Calm"],
    runePool: [],
    runes: [],
    xp: 0,
    score: 0,
    handSize: 1,
    handCount: 1,
    deckSize: 0,
    deckCount: 0,
    runeDeckSize: 0,
    runeDeckCount: 0,
  });

  const receipt = run.linked.payment;
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: "Fury", amount: 1 }]);
  assert.deepEqual(receipt.actions.map(entry => entry.action), [
    { type: "pay", player: "A", plan: { finalized: true, energy: 1, power: ["Fury"] } },
    { type: "spend-xp", player: "A", amount: 1 },
  ]);
  assert.deepEqual(run.events.map(event => ({ action: event.action, energy: event.energy, power: event.power })), [
    { action: "pay", energy: 1, power: ["Fury"] },
    { action: "spend-xp", energy: undefined, power: undefined },
  ]);
});

test("EG-HARNESS pay rejects an invalid domain and prevents an exhausted Power pool", () => {
  const invalid = world().player("A", { power: ["Fury"] }).build();
  const invalidBefore = invalid.player("A");
  const invalidOutcome = invalid.perform({
    type: "pay",
    player: "A",
    plan: { finalized: true, power: ["NotARealDomain"] },
  });
  assert.equal(invalidOutcome.status, "impossible");
  assert.deepEqual(invalid.player("A"), invalidBefore);

  const prevented = world().player("A", { power: ["Fury"] }).build();
  const preventedBefore = prevented.player("A");
  const preventedOutcome = prevented.perform({
    type: "pay",
    player: "A",
    plan: { finalized: true, power: ["Fury", "Fury"] },
  });
  assert.equal(preventedOutcome.status, "prevented");
  assert.deepEqual(prevented.player("A"), preventedBefore);
});

test("EG-HARNESS late payment rejection rolls back Energy, Power and earlier cost actions", () => {
  const base = world()
    .player("A", { energy: 2, power: ["Fury"] })
    .unit("gear", { location: { type: "battlefield", id: "bf-1" } })
    .hand("source", { types: ["spell"], energy: 0, power: [] })
    .build();
  const kernel = withSource(base);
  const gear = kernel.ref("gear");
  kernel.addReplacement(action => action.type === "exhaust" ? "prevented" : null);
  const before = kernel.snapshot();

  assert.throws(
    () => runInstruction(costPay, {
      cost: constant({ finalized: true, energy: 1, power: ["Fury"], exhaust: [gear] }),
    }, { world: kernel }),
    error => error instanceof CostPlanError && error.reason === "cannot-pay-cost" && error.outcome?.status === "prevented",
  );
  assert.deepEqual(kernel.snapshot(), before);
  assert.deepEqual(kernel.player("A").power, ["Fury"]);
  assert.equal(kernel.getObject("gear").exhausted, false);
  assert.deepEqual(kernel.events, []);
});

test("EG-HARNESS production scenario pays Baccai Reaper's original Fury Power IR", () => {
  const result = runCardScenario(executableBaccaiReaper, {
    ...baccaiScenario(["Fury"], true),
    expect: {
      players: { A: { energy: 0, power: [] } },
      events: { includes: [
        { timingPoint: "chain-item-finalize" },
      ] },
    },
  });
  result.asserts();
  assert.equal(result.state.players.A.power.length, 0);
  assert.ok(result.events.some(event => event.timingPoint === "chain-item-finalize"));
});

test("EG-HARNESS production scenario declines Baccai Reaper's optional payment without a receipt", () => {
  const result = runCardScenario(executableBaccaiReaper, baccaiScenario(["Fury"], false));
  assert.deepEqual(result.state.players.A.power, ["Fury"]);
  assert.equal(result.links["baccai-reaper.grant-assault.granted.count"], undefined);
});

test("EG-HARNESS production scenario fails closed when Baccai Reaper's Fury Power is unavailable", () => {
  const result = runCardScenario(executableBaccaiReaper, baccaiScenario([], true));
  assert.deepEqual(result.state.players.A.power, []);
  assert.equal(result.links["baccai-reaper.grant-assault.granted.count"], undefined);
  assert.equal(result.events.some(event => event.timingPoint === "chain-item-finalize"), false);
});
