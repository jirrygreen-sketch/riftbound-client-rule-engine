// RIFT-654: template-level golden for the five judge-required cards whose IR
// signature is activated+activated||effect.resources (ability kind | timing |
// instruction sequence).
//
// Each row runs through the generic card-scenario harness, which binds the
// program with createProgramBinding, executes the printed ability on the real
// ChainEngine and reports pipeline events, player/object snapshots and links.
// The harness refuses judge-required programs, so every row passes a test-only
// execution view that promotes the status and removes exactly the declaration
// the merged binder cannot translate yet: the resource-use restriction on
// Daughter of the Void, Iron Revenant and Fire Below the Mountain, Hand of
// Noxus's pre-cost [Legion] gate (its keyword declaration and expansion are
// kept), and Iron Revenant's banish payment kind. The source IR is never
// changed here, and removing those declarations is why these rows are
// partial-path evidence while the cards stay judge-required (see each
// program's judgeReason). Nothing printed is invented: keyword, cost, timing,
// body and printed nulls are carried verbatim.
//
// The [A] Universal Power body (CR 135.2.e.5 / 163.2.b) has no value in the
// closed six-domain Domain union, so no row asserts that an unsupported Add
// succeeds; only the printed Exhaust/Reaction cost slice and Hand of Noxus's
// translatable [Add] 1 Energy are executed as the cards print them.
import assert from "node:assert/strict";
import test from "node:test";

import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

import daughterOfTheVoid from "../../../dist/cards/ogn/daughter-of-the-void.js";
import handOfNoxus from "../../../dist/cards/ogn/hand-of-noxus.js";
import ironRevenant from "../../../dist/cards/rad/iron-revenant.js";
import fireBelowTheMountain from "../../../dist/cards/sfd/fire-below-the-mountain.js";
import gold from "../../../dist/cards/sfd/gold.js";

/**
 * Test-only view. `runCardScenario` rejects judge-required programs, so the
 * status is promoted for the row while the printed identity, text, ability,
 * cost, timing and body stay untouched. `dropRestriction` / `dropBanishPayment`
 * remove only the declarations named as gaps in the matching judgeReason.
 */
function executionView(program, { dropRestriction = false, dropBanishPayment = false } = {}) {
  return {
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities: program.abilities.map((ability) => {
      const next = dropRestriction && ability.restriction !== undefined
        ? (({ restriction: _restriction, ...rest }) => rest)(ability)
        : { ...ability };
      if (dropBanishPayment && next.cost?.payments !== undefined) {
        return {
          ...next,
          cost: {
            ...next.cost,
            payments: next.cost.payments.filter((payment) => payment.kind !== "banish")
          }
        };
      }
      return next;
    })
  };
}

const daughterSupported = executionView(daughterOfTheVoid, { dropRestriction: true });
const handSupported = executionView(handOfNoxus, { dropRestriction: true });
const ironSupported = executionView(ironRevenant, { dropRestriction: true, dropBanishPayment: true });
const fireSupported = executionView(fireBelowTheMountain, { dropRestriction: true });
const goldExecutable = executionView(gold);

/**
 * CR 107.4.c: the Champion Legend is a Legend, and the catalog prints no
 * Energy / Power / Might, so null is never rewritten to 0. The scenario harness
 * only knows the closed ZoneId union (no legend-zone), so the row places the
 * legend on the Board as the closest representable zone; the missing production
 * Legend Zone stays in the matching judgeReason and is NOT claimed as executed.
 */
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
  ...extra
});

/** 430.2.a: an activated Add finalizes and resolves with two passes on the empty chain. */
const activate = (id) => [
  { type: "activate", object: id, player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" }
];

// One independently named row per canonical card, each with its own scenario
// and its own expectation. The expectation covers the printed, currently
// executable slice only; the judged gaps stay in judgeReason and in the
// matching per-card goldens.
const rows = [
  {
    name: "Daughter of the Void — [Reaction] + printed Exhaust cost pays through the real chain",
    canonicalCardId: daughterOfTheVoid.canonicalCardId,
    program: daughterSupported,
    scenario: {
      players: { A: { energy: 3, power: ["Fury"] } },
      objects: [legendSource(daughterSupported, "daughter")],
      operations: activate("daughter"),
      expect: {
        objects: { daughter: { zone: "board", exhausted: true, energy: null, power: null } },
        events: { sequence: [
          { action: { type: "exhaust", object: { id: "daughter" } } },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "chain-item-resolve" }
        ] }
      }
    }
  },
  {
    name: "Hand of Noxus — [Add] 1 Energy executes on the printed Exhaust cost",
    canonicalCardId: handOfNoxus.canonicalCardId,
    program: handSupported,
    scenario: {
      players: { A: { energy: 0 } },
      objects: [legendSource(handSupported, "noxus")],
      operations: activate("noxus"),
      expect: {
        objects: { noxus: { zone: "board", exhausted: true, energy: null, power: null } },
        players: { A: { energy: 1 } },
        links: { "hand-of-noxus.add-energy.resources": { player: "A", energy: 1, power: [] } },
        events: { sequence: [
          { action: { type: "exhaust", object: { id: "noxus" } } },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "chain-item-resolve" }
        ] }
      }
    }
  },
  {
    name: "Iron Revenant — printed Exhaust cost pays; the Banish payment and [A] Add stay judged",
    canonicalCardId: ironRevenant.canonicalCardId,
    program: ironSupported,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [legendSource(ironSupported, "revenant")],
      operations: activate("revenant"),
      expect: {
        objects: { revenant: { zone: "board", exhausted: true, energy: null, power: null } },
        events: { sequence: [
          { action: { type: "exhaust", object: { id: "revenant" } } },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "chain-item-resolve" }
        ] }
      }
    }
  },
  {
    name: "Fire Below the Mountain — [Reaction] + printed Exhaust cost pays through the real chain",
    canonicalCardId: fireBelowTheMountain.canonicalCardId,
    program: fireSupported,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [legendSource(fireSupported, "fire")],
      operations: activate("fire"),
      expect: {
        objects: { fire: { zone: "board", exhausted: true, energy: null, power: null } },
        events: { sequence: [
          { action: { type: "exhaust", object: { id: "fire" } } },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "chain-item-resolve" }
        ] }
      }
    }
  },
  {
    name: "Gold — 'Kill this, Exhaust this' pays and the token reaches the Trash",
    canonicalCardId: gold.canonicalCardId,
    program: goldExecutable,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [{
        id: "gold-token",
        cardId: gold.canonicalCardId,
        program: goldExecutable,
        isToken: true,
        types: ["gear"],
        tags: ["Token"],
        zone: "board",
        location: { type: "base", player: "A" },
        // sfd-t03 prints no Energy / Power / Might; null is never rewritten to 0.
        energy: null,
        power: null,
        might: null
      }],
      operations: activate("gold-token"),
      expect: {
        objects: { "gold-token": { zone: "trash", exhausted: true, energy: null, power: null } },
        events: { sequence: [
          { action: { type: "exhaust", object: { id: "gold-token" } } },
          { action: { type: "kill", object: { id: "gold-token" } } },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "chain-item-resolve" }
        ] }
      }
    }
  }
];

const programByCanonicalId = new Map([
  [daughterOfTheVoid.canonicalCardId, daughterOfTheVoid],
  [handOfNoxus.canonicalCardId, handOfNoxus],
  [ironRevenant.canonicalCardId, ironRevenant],
  [fireBelowTheMountain.canonicalCardId, fireBelowTheMountain],
  [gold.canonicalCardId, gold]
]);

test("RIFT-654: the execution-view rows keep every source program judge-required", () => {
  assert.deepEqual(rows.map((row) => row.canonicalCardId), [
    daughterOfTheVoid.canonicalCardId,
    handOfNoxus.canonicalCardId,
    ironRevenant.canonicalCardId,
    fireBelowTheMountain.canonicalCardId,
    gold.canonicalCardId
  ]);
  for (const program of programByCanonicalId.values()) {
    assert.equal(program.status, "judge-required");
    assert.ok(program.judgeReason?.trim());
  }
});

for (const row of defineTemplateSuite("RIFT-654 activated+activated|| effect.resources", rows)) {
  test(row.name, () => {
    const source = programByCanonicalId.get(row.canonicalCardId);
    assert.equal(source?.status, "judge-required");
    const result = row.run();
    assert.ok(result, "scenario result is returned");
  });
}

// Boundary group 1, one row per card (415.1.b / 415.4): an already exhausted
// source cannot pay the printed Exhaust cost, so the real Finalize cost plan
// refuses the activation instead of resolving it. The scenario runner surfaces
// that refusal as a CostPlanError.
const exhaustedSourceRows = [
  {
    name: "Daughter of the Void — an exhausted legend cannot pay Exhaust again",
    canonicalCardId: daughterOfTheVoid.canonicalCardId,
    program: daughterSupported,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [legendSource(daughterSupported, "daughter", { exhausted: true })],
      operations: activate("daughter")
    }
  },
  {
    name: "Hand of Noxus — an exhausted legend cannot pay Exhaust again",
    canonicalCardId: handOfNoxus.canonicalCardId,
    program: handSupported,
    scenario: {
      players: { A: { energy: 0 } },
      objects: [legendSource(handSupported, "noxus", { exhausted: true })],
      operations: activate("noxus")
    }
  },
  {
    name: "Iron Revenant — an exhausted legend cannot pay Exhaust again",
    canonicalCardId: ironRevenant.canonicalCardId,
    program: ironSupported,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [legendSource(ironSupported, "revenant", { exhausted: true })],
      operations: activate("revenant")
    }
  },
  {
    name: "Fire Below the Mountain — an exhausted legend cannot pay Exhaust again",
    canonicalCardId: fireBelowTheMountain.canonicalCardId,
    program: fireSupported,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [legendSource(fireSupported, "fire", { exhausted: true })],
      operations: activate("fire")
    }
  },
  {
    name: "Gold — an exhausted token cannot pay Exhaust again",
    canonicalCardId: gold.canonicalCardId,
    program: goldExecutable,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [{
        id: "gold-token",
        cardId: gold.canonicalCardId,
        program: goldExecutable,
        isToken: true,
        types: ["gear"],
        tags: ["Token"],
        zone: "board",
        location: { type: "base", player: "A" },
        energy: null,
        power: null,
        might: null,
        exhausted: true
      }],
      operations: activate("gold-token")
    }
  }
];

for (const [index, golden] of defineTemplateSuite("RIFT-654 boundary: exhausted source", exhaustedSourceRows).entries()) {
  const row = exhaustedSourceRows[index];
  test(golden.name, () => {
    assert.throws(() => golden.run(), (error) => {
      assert.ok(error instanceof CostPlanError, `${row.canonicalCardId} should fail in the real cost plan, got ${error?.name}`);
      assert.equal(error.reason, "cannot-pay-cost");
      return true;
    });
  });
}

// Boundary group 2: the same printed cost is unpayable once the source has
// already left the Board, which is the other permanent rule boundary of this
// template (415.1.b / 415.4 / 429.2.a) and needs no missing dependency to hold.
const spentSourceRows = [
  {
    name: "Gold — a token already in the Trash cannot pay 'Kill this, Exhaust this' again",
    canonicalCardId: gold.canonicalCardId,
    program: goldExecutable,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [{
        id: "gold-token",
        cardId: gold.canonicalCardId,
        program: goldExecutable,
        isToken: true,
        types: ["gear"],
        tags: ["Token"],
        zone: "trash",
        location: null,
        energy: null,
        power: null,
        might: null
      }],
      operations: activate("gold-token")
    },
    expectedMessage: /ready controlled object on the Board/
  }
];

for (const [index, golden] of defineTemplateSuite("RIFT-654 boundary: spent source", spentSourceRows).entries()) {
  const row = spentSourceRows[index];
  test(golden.name, () => {
    assert.throws(() => golden.run(), (error) => {
      assert.ok(error instanceof CostPlanError, `${row.canonicalCardId} should fail in the real cost plan, got ${error?.name}`);
      assert.equal(error.reason, "cannot-pay-cost");
      assert.match(error.message, row.expectedMessage);
      return true;
    });
  });
}

// Boundary group 3 (negated). [A] Universal Power (CR 135.2.e.5.b / 163.2.b) is
// not representable today, so the printed [Add] fails closed instead of gaining
// a chosen Domain. The assertion does not lock today's refusal in as the
// expected result (RIFT-189 already had to remove those): it checks the part
// that must hold whether or not the contract lands, i.e. the added Power is
// never one of the six Domains, while the printed Exhaust cost is really paid.
const SIX_DOMAINS = ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"];

for (const { name, program, sourceId, canonicalCardId } of [
  {
    name: "Daughter of the Void — [A] power never becomes a chosen Domain",
    program: daughterSupported,
    sourceId: "daughter",
    canonicalCardId: daughterOfTheVoid.canonicalCardId
  },
  {
    name: "Fire Below the Mountain — [A] power never becomes a chosen Domain",
    program: fireSupported,
    sourceId: "fire",
    canonicalCardId: fireBelowTheMountain.canonicalCardId
  }
]) {
  test(`RIFT-654 boundary negated: ${name} [${canonicalCardId}]`, () => {
    const result = runCardScenario(program, {
      players: { A: { energy: 3, power: [] } },
      objects: [legendSource(program, sourceId)],
      operations: activate(sourceId)
    });
    // The printed :rb_exhaust: cost (415.4/415.5) is actually paid...
    assert.equal(result.state.objects.find(object => object.ref.id === sourceId).exhausted, true);
    // ...and the [A] addition never lands as one of the six Domains, with or
    // without the Universal Power contract.
    for (const power of result.state.players.A.power) {
      assert.equal(SIX_DOMAINS.includes(power), false, `${power} would be an invented Domain for [A]`);
    }
  });
}

// The condition-not-satisfied boundary of this template cannot be executed yet,
// so it stays an explicit TODO rather than an assertion that would lock today's
// gap in as expected behavior: Hand of Noxus's printed [Legion] gate (CR
// 812.1.b.1 / 812.1.c) must refuse activation before the Exhaust cost is paid
// when no other card was finalized this turn. The merged expansion publishes the
// history predicate, but the pre-cost activation binder and the ActivatedAbility
// condition slot are still missing (see its judgeReason).
test.todo(
  "RIFT-654 boundary condition-not-satisfied: Hand of Noxus — with no other card finalized this turn the " +
    "[Legion] gate must refuse activation before the Exhaust cost is paid (CR 812.1.b.1 / 812.1.c); the " +
    "pre-cost history binder and the ActivatedAbility condition slot are still missing"
);
