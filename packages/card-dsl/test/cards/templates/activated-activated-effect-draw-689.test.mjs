// RIFT-689 template-level golden: activated + activated || effect.draw
// (README 4.1).
//
// Garbage Grabber, Black Market and Prodigal Explorer have the same structural
// signature (one activated ability whose body is a single effect.draw) but each
// carries a different printed cost and activation gate. All three stay
// judge-required: every row below reports the exact merged gap it measured
// (see `declared`), and the executable rows run the supported slice through the
// real CardProgram binding, ChainEngine, cost plan and event pipeline.
//
// The slice used by a row removes ONLY the one printed field that the frozen
// contract cannot bind yet (the RIFT-605-style supported-view idiom from the
// sibling template goldens). The card programs themselves are never mutated and
// their own status is asserted on every row.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan, prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import garbageGrabber from "../../../dist/cards/ogn/garbage-grabber.js";
import blackMarket from "../../../dist/cards/rad/black-market.js";
import prodigalExplorer from "../../../dist/cards/sfd/prodigal-explorer.js";

const GARBAGE_GRABBER = "card.hash-00d819e309a473483d8a8fe1f5b4cd6332aed4778597aa7272e310eba60023c8";
const BLACK_MARKET = "card.hash-886b8c03b5b72474abc834112983d7b6adab55b1a3525aeddd44a39898736bb3";
const PRODIGAL_EXPLORER = "card.hash-0f2d2889821a45fbe61cc42c0f59fd9c445a9a0a9cab9d8af29603770ea28aff";

/** Only the harness's status guard is relaxed; every ability field is preserved. */
function executableSlice(program) {
  return { ...program, status: "executable", judgeReason: undefined };
}

/**
 * Garbage Grabber's slice drops the printed recycle payment: cost/plan-values
 * `choiceObjects` requires an exact ObjectRef per option and the card program
 * cannot name the cards in the controller's Trash (RIFT-689 gap 1). The 1
 * energy and "exhaust me" costs and the Draw 1 body are the merged slice.
 */
function garbageGrabberSlice() {
  const slice = executableSlice(garbageGrabber);
  return {
    ...slice,
    abilities: slice.abilities.map(ability => ({
      ...ability,
      cost: {
        ...ability.cost,
        payments: ability.cost.payments.filter(payment => payment.kind !== "recycle")
      }
    }))
  };
}

/**
 * Black Market and Prodigal Explorer keep their printed costs and bodies whole;
 * only the declared Restriction is dropped, because `translateRestriction`
 * fail-closes on both `usage-limit` and `use-only-if` (measured below).
 */
function withoutRestriction(program) {
  const slice = executableSlice(program);
  return {
    ...slice,
    abilities: slice.abilities.map(({ restriction: _restriction, ...ability }) => ability)
  };
}

const garbageSlice = garbageGrabberSlice();
const marketSlice = withoutRestriction(blackMarket);
const explorerSlice = withoutRestriction(prodigalExplorer);

const base = (id, owner = "A") => ({
  id,
  owner,
  types: ["unit"],
  zone: "deck",
  energy: null,
  power: null,
  might: null
});

// Every row carries its own scenario, its own printed numbers and its own
// expectations. `declared` pins the measured gap on the published program.
const rows = [
  {
    name: "Garbage Grabber · exhaust + 1 energy + Draw 1 through the real chain [recycle payment blocked]",
    canonicalCardId: GARBAGE_GRABBER,
    program: garbageSlice,
    scenario: {
      players: { A: { energy: 4, power: [] }, B: {} },
      objects: [
        {
          id: "grabber",
          cardId: GARBAGE_GRABBER,
          program: garbageSlice,
          types: ["gear"],
          zone: "board",
          location: { type: "base", player: "A" },
          energy: 2,
          power: null,
          might: null
        },
        base("top-1"),
        base("top-2")
      ],
      operations: [
        { type: "activate", object: "grabber", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          // energy/power stay null (no printed value on this non-unit Gear,
          // never rewritten to 0); the reference kernel derives a Board might
          // for a non-unit source, so no might assertion is made here.
          grabber: { zone: "board", exhausted: true, energy: 2, power: null },
          "top-1": { zone: "hand" },
          "top-2": { zone: "deck" }
        },
        players: { A: { energy: 3, handSize: 1, deckSize: 1 } },
        links: { "draw-1.drawn": 1, "draw-1.drawnTo": "A" },
        events: {
          sequence: [
            { timingPoint: "chain-item-pending", object: { ref: "grabber" } },
            { timingPoint: "object-exhausted", action: { type: "exhaust", object: { id: "grabber" } } },
            { timingPoint: "chain-item-finalize" },
            { timingPoint: "card-drawn", action: { type: "draw", player: "A", amount: 1 } },
            { timingPoint: "chain-item-resolve" }
          ]
        }
      }
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /417\.6/);
      assert.match(program.judgeReason, /choiceObjects/);
      assert.match(program.judgeReason, /417\.5/);
      assert.match(program.judgeReason, /Cost requires an exact object reference/);
      // 417.3: the cost is exactly 3 cards, so the declared bounds cannot be "up-to".
      const [recycle] = program.abilities[0].cost.payments;
      assert.equal(recycle.kind, "recycle");
      assert.equal(recycle.choice.min, 3);
      assert.equal(recycle.choice.max, 3);
      assert.equal(recycle.choice.selection, undefined);
    }
  },
  {
    name: "Black Market · two [A] runes are paid, then Draw 1 for the activator",
    canonicalCardId: BLACK_MARKET,
    program: marketSlice,
    scenario: {
      turnPlayer: "A",
      priority: "A",
      players: { A: { power: ["Fury", "Calm"] }, B: {} },
      objects: [
        {
          id: "market",
          cardId: BLACK_MARKET,
          program: marketSlice,
          types: ["battlefield"],
          zone: "board",
          location: { type: "battlefield", id: "battlefield-1" },
          energy: null,
          power: null,
          might: null
        },
        base("top-1")
      ],
      operations: [
        { type: "activate", object: "market", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          market: { zone: "board", location: { type: "battlefield", id: "battlefield-1" }, energy: null, power: null },
          "top-1": { zone: "hand" }
        },
        // The scenario now consumes the two selected Power from the pool.
        players: { A: { energy: 0, power: [], handSize: 1 } },
        links: { "black-market.draw-1.drawn": 1, "black-market.draw-1.drawnTo": "A" },
        events: {
          sequence: [
            { timingPoint: "chain-item-pending", object: { ref: "market" } },
            { timingPoint: "chain-item-finalize" },
            { timingPoint: "card-drawn", action: { type: "draw", player: "A", amount: 1 } },
            { timingPoint: "chain-item-resolve" }
          ]
        }
      }
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /378\.2/);
      assert.match(program.judgeReason, /381\.3/);
      assert.match(program.judgeReason, /377\.2\.b/);
      assert.match(program.judgeReason, /386/);
      assert.match(program.judgeReason, /assertCanControl/);
      assert.match(program.judgeReason, /Restriction/);
      assert.deepEqual(program.abilities[0].restriction, {
        kind: "usage-limit",
        scope: "once-per-turn-per-player",
        activator: "any-player",
        ignoresControl: true
      });
    }
  },
  {
    name: "Prodigal Explorer · Reaction exhaust then Draw 1 for the controller [use-only-if blocked]",
    canonicalCardId: PRODIGAL_EXPLORER,
    program: explorerSlice,
    scenario: {
      players: { A: {}, B: {} },
      objects: [
        {
          id: "ezreal",
          cardId: PRODIGAL_EXPLORER,
          program: explorerSlice,
          types: ["legend"],
          zone: "board",
          location: { type: "base", player: "A" },
          energy: null,
          power: null,
          might: null
        },
        base("top-1")
      ],
      operations: [
        { type: "activate", object: "ezreal", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          ezreal: { zone: "board", location: { type: "base", player: "A" }, exhausted: true, energy: null, power: null },
          "top-1": { zone: "hand" }
        },
        players: { A: { energy: 0, handSize: 1, deckSize: 0 } },
        links: { "prodigal-explorer.draw-1.drawn": 1, "prodigal-explorer.draw-1.drawnTo": "A" },
        events: {
          sequence: [
            { timingPoint: "chain-item-pending", object: { ref: "ezreal" } },
            { timingPoint: "object-exhausted", action: { type: "exhaust", object: { id: "ezreal" } } },
            { timingPoint: "chain-item-finalize" },
            { timingPoint: "card-drawn", action: { type: "draw", player: "A", amount: 1 } },
            { timingPoint: "chain-item-resolve" }
          ]
        }
      }
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /054\.2/);
      assert.match(program.judgeReason, /use-only-if/);
      assert.match(program.judgeReason, /107\.4/);
      assert.match(program.judgeReason, /HistoryQuery/);
      assert.match(program.judgeReason, /412\.4/);
      assert.match(program.judgeReason, /754/);
    }
  }
];

for (const [index, entry] of defineTemplateSuite(
  "RIFT-689 activated+activated||effect.draw",
  rows.map(({ name, canonicalCardId, program, scenario }) => ({ name, canonicalCardId, program, scenario }))
).entries()) {
  test(entry.name, () => {
    rows[index].declared(
      [garbageGrabber, blackMarket, prodigalExplorer].find(program => program.canonicalCardId === entry.canonicalCardId)
    );
    // The published program must never pass the production binding: the harness
    // only runs the supported slice above. This is measured, not assumed.
    const published = [garbageGrabber, blackMarket, prodigalExplorer].find(
      program => program.canonicalCardId === entry.canonicalCardId
    );
    const kernel = world().unit("probe", {
      types: published.canonicalCardId === BLACK_MARKET ? ["battlefield"] : published.canonicalCardId === PRODIGAL_EXPLORER ? ["legend"] : ["gear"],
      cardId: published.canonicalCardId,
      location: { type: "base", player: "A" }
    }).build();
    const binding = createProgramBinding({ cardPrograms: [published] });
    assert.throws(
      () => binding.describeActivate(kernel.getObject("probe"), "A", 0),
      error => error?.name === "ProgramBindingError" && /judge-required/.test(error.code ?? ""),
      `${entry.canonicalCardId}: the published program must stay un-activatable`
    );
    const result = entry.run();
    assert.deepEqual(result.state.chain, []);
  });
}

// Boundary rows. The template needs at least one group-level boundary; these
// four cover the three cards' real gates (an unpayable cost, an unavailable
// cost object, a non-controller activator, and an exhausted source), and each
// asserts the measured failure instead of inventing a resolution.
const boundaryRows = [
  {
    name: "Garbage Grabber boundary · no Energy for the printed 1-energy cost",
    canonicalCardId: GARBAGE_GRABBER,
    program: garbageSlice,
    scenario: {
      players: { A: { energy: 0 }, B: {} },
      objects: [
        { id: "grabber", cardId: GARBAGE_GRABBER, program: garbageSlice, types: ["gear"], zone: "board", location: { type: "base", player: "A" }, energy: 2, power: null, might: null }
      ],
      operations: [{ type: "activate", object: "grabber", player: "A" }]
    },
    failure: /insufficient Energy/,
    declared: program => assert.equal(program.status, "judge-required")
  },
  {
    name: "Garbage Grabber boundary · an empty Trash cannot complete the printed recycle cost",
    canonicalCardId: GARBAGE_GRABBER,
    program: executableSlice(garbageGrabber),
    scenario: {
      players: { A: { energy: 4 }, B: {} },
      objects: [
        { id: "grabber", cardId: GARBAGE_GRABBER, program: executableSlice(garbageGrabber), types: ["gear"], zone: "board", location: { type: "base", player: "A" }, energy: 2, power: null, might: null },
        base("trash-1")
      ],
      operations: [{ type: "activate", object: "grabber", player: "A" }]
    },
    failure: /Cost choice cannot be completed from the current zone/,
    declared: program => assert.match(program.judgeReason, /choiceObjects/)
  },
  {
    name: "Black Market boundary · another player's turn is refused because the any-player permission is not modeled",
    canonicalCardId: BLACK_MARKET,
    program: marketSlice,
    scenario: {
      turnPlayer: "B",
      priority: "B",
      players: { A: { power: ["Fury", "Calm"] }, B: {} },
      objects: [
        { id: "market", cardId: BLACK_MARKET, program: marketSlice, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, energy: null, power: null, might: null }
      ],
      // 381/381.3: the printed ability may be used on each activator's own
      // turn, but the merged activation model has no per-activator permission,
      // so A is refused on B's turn.
      operations: [{ type: "activate", object: "market", player: "A" }]
    },
    failure: /Action is not legally timed/,
    declared: program => assert.match(program.judgeReason, /381\.3/)
  },
  {
    name: "Prodigal Explorer boundary · an exhausted legend cannot pay the exhaust cost",
    canonicalCardId: PRODIGAL_EXPLORER,
    program: explorerSlice,
    scenario: {
      players: { A: {}, B: {} },
      objects: [
        { id: "ezreal", cardId: PRODIGAL_EXPLORER, program: explorerSlice, types: ["legend"], zone: "board", location: { type: "base", player: "A" }, energy: null, power: null, might: null, exhausted: true }
      ],
      operations: [{ type: "activate", object: "ezreal", player: "A" }]
    },
    failure: /exhaust cost requires a ready controlled object/,
    declared: program => assert.match(program.judgeReason, /415\.4|415\.5/)
  }
];

for (const [index, entry] of defineTemplateSuite(
  "RIFT-689 boundary",
  boundaryRows.map(({ name, canonicalCardId, program, scenario }) => ({ name, canonicalCardId, program, scenario }))
).entries()) {
  test(entry.name, () => {
    const published = [garbageGrabber, blackMarket, prodigalExplorer].find(
      program => program.canonicalCardId === entry.canonicalCardId
    );
    boundaryRows[index].declared(published);
    assert.throws(entry.run, boundaryRows[index].failure);
  });
}

// The empty-deck rows are the "negated/impossible" bound of the common draw
// body: effect.draw still executes and links 0 drawn (414.1.a / 414.4's Burn
// Out belongs to the kernel), so neither the source nor the hand may change.
for (const [label, program, sourceTypes, sourceId, players] of [
  ["Garbage Grabber", garbageSlice, ["gear"], "grabber", { A: { energy: 4 }, B: {} }],
  ["Prodigal Explorer", explorerSlice, ["legend"], "ezreal", { A: {}, B: {} }]
]) {
  test(`${label} boundary · an empty Main Deck draws 0 and still exhausts the source [${program.canonicalCardId}]`, () => {
    const result = runCardScenario(program, {
      players,
      objects: [
        { id: sourceId, cardId: program.canonicalCardId, program, types: sourceTypes, zone: "board", location: { type: "base", player: "A" }, energy: program.canonicalCardId === GARBAGE_GRABBER ? 2 : null, power: null, might: null }
      ],
      operations: [
        { type: "activate", object: sourceId, player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { [sourceId]: { zone: "board", exhausted: true } },
        players: { A: { handSize: 0, deckSize: 0 } },
        events: { includes: [{ timingPoint: "object-exhausted" }] }
      }
    });
    const linkKey = program.canonicalCardId === GARBAGE_GRABBER ? "draw-1.drawn" : "prodigal-explorer.draw-1.drawn";
    assert.equal(result.links[linkKey], 0);
    assert.equal(result.events.some(event => event.timingPoint === "card-drawn"), false);
  });
}

// 417.3: the recycle cost needs three cards, so the real cost planner rejects an
// empty Trash without committing anything.
test("Garbage Grabber · the printed 3-card recycle cost cannot be completed from an empty Trash (417.3)", () => {
  const kernel = world().player("A", { energy: 4 }).build();
  assert.throws(
    () => buildCostPlan(kernel, { id: "cost:garbage-grabber", cost: garbageGrabber.abilities[0].cost }),
    error => error?.name === "CostPlanError" && /Cost choice cannot be completed from the current zone/.test(error.message)
  );
  assert.equal(kernel.zone("A", "trash").length, 0);
});

// Prodigal Explorer's first gap is measured, not asserted: HistoryQuery only
// counts committed GameActions, so the Finalize-emitted became-target timing
// point can never be counted (354.4/355.7 read "chosen" as targeting).
test("Prodigal Explorer · became-target is not queryable through HistoryQuery, so the 'twice this turn' gate has no read", () => {
  const kernel = world().unit("chosen", { owner: "B" }).build();
  kernel.setTargets("prodigal-explorer.unit", [kernel.ref("chosen")]);
  assert.equal(kernel.targets("prodigal-explorer.unit").length, 1);
  assert.equal(kernel.history({ timingPoint: "became-target" }), 0);
  assert.equal(kernel.history({ timingPoint: "became-target", player: "A" }), 0);
  // A real committed GameAction is counted, which is the only dimension the
  // query exposes today.
  kernel.perform({ type: "draw", player: "A", amount: 1 });
  assert.equal(kernel.history({ action: "draw" }), 1);
  assert.equal(kernel.history({ timingPoint: "became-target" }), 0);
});

// The scenario harness pays Energy but its reference kernel's `pay` action does
// not debit the Power pool, so Black Market's two-[A] requirement is evidenced
// here through the merged cost plan and payment receipt (135.2.e.5.a): the
// printed Power really is allocated and consumed across two differently
// domained runes.
test("Black Market · the two [A] rune cost finalizes and pays through the merged cost plan", () => {
  const kernel = world().player("A", { power: ["Fury", "Calm"] }).build();
  const cost = blackMarket.abilities[0].cost;
  const plan = buildCostPlan(kernel, { id: "cost:black-market", cost });
  assert.equal(plan.finalized, true);
  assert.deepEqual(plan.total.power, [
    { amount: 2, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
  const prepared = prepareCostPayment(kernel, plan);
  assert.deepEqual(prepared.power.power, [
    { requirementIndex: 0, from: "Fury", amount: 1 },
    { requirementIndex: 0, from: "Calm", amount: 1 }
  ]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.total.power, [
    { amount: 2, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);

  // A single-domain pool cannot cover two rainbow runes: the same planner that
  // accepts the row above refuses this one at payment time.
  const singleDomain = world().player("A", { power: ["Fury"] }).build();
  const singlePlan = buildCostPlan(singleDomain, { id: "cost:black-market", cost });
  assert.throws(
    () => payCostPlan(singleDomain, singlePlan),
    error => error?.name === "CostPlanError" && error.reason === "cannot-pay-cost" && /insufficient matching Power/.test(error.message)
  );
});
