import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bard-mercurial.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d0bb5c231d56b1471ca1416b33625cc0bae9efda10d8be949cbeec564cbf0a70";
const MOVE_ID = "bard-mercurial.move-units";
const TARGET_ID = "bard-mercurial.units";

const [additionalCost, playTrigger] = program.abilities;
const [moveInstruction] = playTrigger.body;

// "your units" resolves through the controller placeholder: the chain's
// Finalize/query wrapper normalizes `controller`/`owner` "self" to the item's
// controller (chain/engine.ts), and the production object matcher lives in
// layers/filter.ts. Bind both so the declared TargetSpec is legalized by the
// real pipeline instead of the reference kernel's value-only comparison.
const boundWorld = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "self" ? kernel.controller : value])),
    object
  ))
});

test("sfd-079-221 Bard, Mercurial: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "You may exhaust your legend as an additional cost to play me.\n" +
      "When you play me, if you paid the additional cost, move any number of your units to an open battlefield."
  );
});

test("sfd-079-221 Bard, Mercurial: judgeReason names the cost, legend-zone, receipt and destination gaps", () => {
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /legend-zone/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /170\.11\.c/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-079-221 Bard, Mercurial: the optional cost exhausts the controller's legend", () => {
  // 356.2.b/356.2.b.1: Optional Additional Cost from the card's own Passive
  // Ability; 415.3.a/415.5: exhausting as a payment belongs to the cost plan.
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "bard-mercurial.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.equal(additionalCost.effect.payments.length, 1);
  const [payment] = additionalCost.effect.payments;
  assert.equal(payment.kind, "exhaust");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  // 107.4/355.9.a.4: "your legend" lives in the Legend Zone; that zone is not
  // in the frozen ZoneId vocabulary, so the option set is a descriptive
  // placeholder rather than a runnable choice (see judgeReason).
  assert.equal(payment.choice.id, "bard-mercurial.your-legend");
  assert.deepEqual(payment.choice.options, ["runtime:controller-legend-zone-legends"]);
  assert.deepEqual(payment.choice.filter, { type: "legend", owner: "self" });
  assert.equal(payment.choice.selection, "one");
});

test("sfd-079-221 Bard, Mercurial: the play trigger moves any number of the controller's units", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playTrigger.trigger.condition, undefined);

  assert.deepEqual(playTrigger.body.map((instruction) => [instruction.id, instruction.op]), [
    [MOVE_ID, "effect.move"]
  ]);
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: TARGET_ID }
  });
  // "any number" may be zero (355.13) and is bounded by the actually chosen
  // units (359.3.e.11).
  assert.equal(moveInstruction.args.amount.kind, "count");
  assert.deepEqual(moveInstruction.args.amount.filter, { object: { target: TARGET_ID } });
  assert.deepEqual(moveInstruction.targets, [
    {
      id: TARGET_ID,
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 0,
      selection: "up-to"
    }
  ]);
  assert.equal(moveInstruction.picks, undefined);
  // 356.4.f.1's paid receipt has no binding in the frozen IR, so the move is not
  // gated by an invented always-true condition.
  assert.equal(moveInstruction.condition, undefined);
});

test("sfd-079-221 Bard, Mercurial: 'to an open battlefield' is recorded as a derived destination", () => {
  // 355.4 / 421.1 / 449.1 / 170.11.c: the destination is one currently open
  // battlefield, derived from the board state; static IR cannot enumerate it, so
  // the declared shape keeps effect.move's choose form with a descriptive
  // option list instead of pinning a battlefield (see judgeReason and the
  // merged ogn/ride-the-wind precedent).
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "bard-mercurial.destination",
      options: ["runtime:open-battlefields"]
    }
  });
});

test("sfd-079-221 Bard, Mercurial golden: with a player-chosen destination the units really move", () => {
  const battlefield = { type: "battlefield", id: "open-battlefield" };
  const kernel = world()
    .unit("bard", { might: 4, location: { type: "base", player: "A" } })
    .unit("unit-a", { might: 2, location: { type: "base", player: "A" } })
    .unit("unit-b", { might: 2, location: { type: "base", player: "A" } })
    .unit("enemy-unit", { might: 2, owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .build();
  kernel.setTargets(TARGET_ID, [kernel.ref("unit-a"), kernel.ref("unit-b")]);

  // The destination is what the acting player chose during the Move's choice
  // step (355.4); the golden supplies it, exactly like Finalize-locked targets.
  const body = [{
    ...moveInstruction,
    args: { ...moveInstruction.args, to: { kind: "constant", value: battlefield } }
  }];
  const outcome = resolveChainBody(body, boundWorld(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    [MOVE_ID, "executed"]
  ]);
  assert.deepEqual(kernel.getObject("unit-a").location, battlefield);
  assert.deepEqual(kernel.getObject("unit-b").location, battlefield);
  // "your units": the opponent's unit was never a legal target and does not move.
  assert.deepEqual(kernel.getObject("enemy-unit").location, { type: "base", player: "B" });
  // effect.move links its receipt under the declared linkKey.
  assert.deepEqual(outcome.linkedValues[MOVE_ID + ".moved"], {
    count: 2,
    objects: [
      { id: "unit-a", zoneEntryId: 1 },
      { id: "unit-b", zoneEntryId: 1 }
    ],
    movements: [
      {
        object: { id: "unit-a", zoneEntryId: 1 },
        from: { type: "base", player: "A" },
        to: { type: "battlefield", id: "open-battlefield" }
      },
      {
        object: { id: "unit-b", zoneEntryId: 1 },
        from: { type: "base", player: "A" },
        to: { type: "battlefield", id: "open-battlefield" }
      }
    ]
  });
});

test("sfd-079-221 Bard, Mercurial golden: choosing no units leaves everyone in place", () => {
  const battlefield = { type: "battlefield", id: "open-battlefield" };
  const kernel = world()
    .unit("bard", { might: 4, location: { type: "base", player: "A" } })
    .unit("unit-a", { might: 2, location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets(TARGET_ID, []);

  const body = [{
    ...moveInstruction,
    args: { ...moveInstruction.args, to: { kind: "constant", value: battlefield } }
  }];
  const outcome = resolveChainBody(body, boundWorld(kernel));

  // "any number" includes zero (355.13): the emptied selection makes effect.move
  // report mistargeting (contract 3.6 primitive rule 3) without moving anything.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]), [
    [MOVE_ID, "ignored", "mistargeted"]
  ]);
  assert.deepEqual(kernel.getObject("unit-a").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "sfd-079-221 Bard, Mercurial: charge the optional additional cost 'exhaust your legend' through the " +
    "Finalize cost plan and gate the Move on the 356.4.f.1 paid receipt (cost.additional wiring + " +
    "condition.result, RIFT-89)"
);
test.todo(
  "sfd-079-221 Bard, Mercurial: the Legend Zone source space (CR 107.4/355.9.a.4) is not in the frozen " +
    "ZoneId vocabulary, so the exhaust-cost choice cannot enumerate legal legends — contract change request"
);
test.todo(
  "sfd-079-221 Bard, Mercurial: derive 'an open battlefield' (CR 170.11.c: unoccupied and uncontrolled) " +
    "into the Move's destination choice (355.4) — the Finalize/location-choice lifecycle (RIFT-84/RIFT-90)"
);
test.todo(
  "sfd-079-221 Bard, Mercurial: the card-played trigger enters the chain as a Pending item after the unit " +
    "is played (CR 383.4.a.2/420.4.a) via the CardProgram -> trigger/chain adapter (RIFT-120)"
);
