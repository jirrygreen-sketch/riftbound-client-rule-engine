// RIFT-685 template-level golden for the `play||effect.damage` group
// (packages/card-dsl/src/cards/README.md 4.1).
//
// One row per assigned card: canonicalCardId, the card's program, its own
// board, its own operations and its own expectation. defineTemplateSuite
// registers every row as an independent test, and every run goes through the
// real runCardScenario path (ProgramBinding -> ChainEngine -> EventPipeline ->
// target planning / primitive execution).
//
// All four published programs stay judge-required. Their rows assert the
// card's current real behavior or the exact real-path rejection of the
// remaining printed clause; printed outcomes the merged engine cannot reach
// yet stay under TODO and are never written as expected behavior.
//
// `executableView` flips validation metadata ONLY because the scenario harness
// refuses judge-required programs. Abilities, printed costs, targets,
// sourceText and the generated registry are untouched, so no row here is
// promotion evidence. The single-card files under test/cards/<set>/ keep the
// validation/identity and structure assertions and point at this file for the
// execution evidence.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import {
  finalizeTargetPlan,
  queryTargetCandidates,
  resolveTargetPlan,
  TargetSelectionError,
} from "../../../../engine-core/dist/target/target-plan.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import firestorm from "../../../dist/cards/ogs/firestorm.js";
import avalanche from "../../../dist/cards/rad/avalanche.js";
import convergence from "../../../dist/cards/rad/parallel-convergence.js";
import grenade from "../../../dist/cards/unl/dancing-grenade.js";
import retreat from "../../../dist/cards/ogn/retreat.js";

/** Metadata-only view: the harness refuses judge-required programs by design. */
const executableView = program => ({ ...program, status: "executable", judgeReason: undefined });

const battlefield1 = { type: "battlefield", id: "bf-1" };
const battlefield2 = { type: "battlefield", id: "bf-2" };
const baseA = { type: "base", player: "A" };
const baseB = { type: "base", player: "B" };

const playOnly = [{ type: "play", object: "spell", player: "A" }];
const playAndResolve = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

const noLegalTarget = error => error instanceof TargetSelectionError && error.code === "no-legal-targets";
const nonTargetSetRejected = error =>
  error instanceof Error && /effect\.damage args\.target must be a TargetSpec id string/.test(error.message);
const unboundAdditionalCost = error =>
  error?.code === "judge-required" && /Additional costs are not bound for play:/.test(error.message);

/** Every row proves the published registry entry is still judge-required. */
function assertPublishedIdentity(row) {
  assert.equal(cardRegistryById.get(row.canonicalCardId), row.sourceProgram, `${row.canonicalCardId} is the generated registry program`);
  assert.equal(row.sourceProgram.status, "judge-required");
  assert.ok(row.sourceProgram.judgeReason?.trim(), `${row.canonicalCardId} keeps an explicit judge reason`);
  // The test view differs from the published program in validation metadata only.
  assert.equal(row.program.status, "executable");
  assert.equal(row.program.canonicalCardId, row.sourceProgram.canonicalCardId);
  assert.equal(row.program.sourceText, row.sourceProgram.sourceText);
  assert.deepEqual(row.program.abilities, row.sourceProgram.abilities);
}

/** CR 355.10.d: only the chosen battlefield is a target, never the unit set. */
function assertFinalizedBattlefieldLock(result, selected) {
  assert.equal(result.state.chain.length, 1);
  const [item] = result.state.chain;
  assert.equal(item.status, "finalized");
  assert.deepEqual(
    item.targetPlans.map(plan => [plan.requirement.id, plan.selected.map(ref => ref.id)]),
    [["firestorm.battlefield", selected]]
  );
  const targetEvents = result.events.filter(event => event.timingPoint === "became-target");
  assert.deepEqual(targetEvents.map(event => event.target.ref.id), selected);
}

/** A characteristic-selected set (avalanche) must not become a target at all. */
function assertFinalizedWithoutTargets(result) {
  assert.equal(result.state.chain.length, 1);
  assert.equal(result.state.chain[0].status, "finalized");
  assert.deepEqual(result.state.chain[0].targetPlans, []);
  assert.equal(result.events.some(event => event.timingPoint === "became-target"), false);
}

const firestormBoard = [
  { id: "spell", cardId: firestorm.canonicalCardId, types: ["spell"], zone: "hand", energy: 6, power: ["Fury"], might: null },
  { id: "battlefield-1", types: ["battlefield"], zone: "board", location: battlefield1, energy: null, power: null, might: null },
  { id: "battlefield-2", types: ["battlefield"], zone: "board", location: battlefield2, energy: null, power: null, might: null },
  { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 7 },
  { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: battlefield2, might: 6 },
  { id: "ally-here", types: ["unit"], zone: "board", location: battlefield1, might: 5 },
  { id: "base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 5 },
];

const avalancheBoard = [
  { id: "spell", cardId: avalanche.canonicalCardId, types: ["spell"], zone: "hand", energy: 5, power: ["Body"], might: null },
  { id: "friendly-base-unit", types: ["unit"], zone: "board", location: baseA, might: 5 },
  { id: "enemy-base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 6 },
  { id: "battlefield-unit", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 7 },
];

const convergenceBoard = [
  { id: "spell", cardId: convergence.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Mind"], might: null },
  { id: "returned-unit", owner: "B", controller: "A", types: ["unit"], zone: "board", location: baseA, might: 3 },
  { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 8 },
  { id: "enemy-base", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 8 },
];

const grenadeBoard = [
  { id: "spell", cardId: grenade.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Fury"], might: null },
  { id: "chosen", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 5 },
  { id: "other", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 6 },
  { id: "base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 7 },
];

const firestormLockScenario = {
  players: { A: { energy: 6, power: ["Fury"] } },
  objects: firestormBoard,
  answers: { "target:firestorm.battlefield": ["battlefield-1"] },
  operations: playOnly,
  expect: {
    objects: {
      spell: { zone: "chain" },
      "enemy-here": { zone: "board", damage: 0 },
      "enemy-elsewhere": { zone: "board", damage: 0 },
      "ally-here": { zone: "board", damage: 0 },
      "base-unit": { zone: "board", damage: 0 },
    },
    players: { A: { energy: 0 } },
    events: { includes: [{ timingPoint: "became-target", target: { ref: "battlefield-1" } }] },
  },
};

const avalancheLockScenario = {
  players: { A: { energy: 5, power: ["Body", "Body"] } },
  objects: avalancheBoard,
  operations: playOnly,
  expect: {
    objects: {
      spell: { zone: "chain" },
      "friendly-base-unit": { zone: "board", damage: 0 },
      "enemy-base-unit": { zone: "board", damage: 0 },
      "battlefield-unit": { zone: "board", damage: 0 },
    },
    players: { A: { energy: 0 } },
    events: { includes: [{ timingPoint: "chain-item-finalize" }] },
  },
};

const convergenceScenario = {
  players: { A: { energy: 2, power: ["Mind"] } },
  objects: convergenceBoard,
  answers: { "target:unit-at-battlefield": ["enemy"] },
  operations: playOnly,
};

const grenadeScenario = {
  players: { A: { energy: 2, power: ["Fury"] } },
  objects: grenadeBoard,
  answers: { "target:dancing-grenade.unit": ["chosen"] },
  operations: playAndResolve,
  expect: {
    objects: {
      spell: { zone: "trash" },
      chosen: { zone: "board", damage: 2 },
      other: { zone: "board", damage: 0 },
      "base-unit": { zone: "board", damage: 0 },
    },
    players: { A: { energy: 0 } },
    events: {
      sequence: [
        { timingPoint: "became-target", target: { ref: "chosen" } },
        { timingPoint: "damage-dealt", action: { type: "damage", target: "chosen", amount: 2 } },
        { timingPoint: "card-played", object: { ref: "spell" } },
      ],
    },
    links: { "dancing-grenade.deal-2.dealt": 2, "dancing-grenade.deal-2.dealtCount": 1 },
  },
};

// ---------------------------------------------------------------------------
// One row per assigned card: canonical identity, that card's own board, its
// own operations and its own expectation.
// ---------------------------------------------------------------------------
const rows = [
  {
    name: "Firestorm · the printed cost pays and the battlefield locks; the non-target enemy set is rejected (355.10.d)",
    canonicalCardId: firestorm.canonicalCardId,
    sourceProgram: firestorm,
    program: executableView(firestorm),
    scenario: firestormLockScenario,
    verify(result) {
      assertFinalizedBattlefieldLock(result, ["battlefield-1"]);
      // The units set has no merged consumer; resolving the original body is
      // rejected by effect.damage's args schema instead of becoming targets.
      assert.throws(
        () => runCardScenario(executableView(firestorm), { ...firestormLockScenario, operations: playAndResolve }),
        nonTargetSetRejected
      );
    },
  },
  {
    name: "Avalanche · the printed cost pays with no target locked; the 'all units in bases' set is rejected (355.10.d)",
    canonicalCardId: avalanche.canonicalCardId,
    sourceProgram: avalanche,
    program: executableView(avalanche),
    scenario: avalancheLockScenario,
    verify(result) {
      assertFinalizedWithoutTargets(result);
      assert.throws(
        () => runCardScenario(executableView(avalanche), { ...avalancheLockScenario, operations: playAndResolve }),
        nonTargetSetRejected
      );
    },
  },
  {
    name: "Parallel Convergence · the mandatory return-to-hand cost is rejected before Finalize; the Deal 5 body itself executes",
    canonicalCardId: convergence.canonicalCardId,
    sourceProgram: convergence,
    program: executableView(convergence),
    scenario: convergenceScenario,
    expectFailure: unboundAdditionalCost,
    verify() {
      // Executable half: the original damage instruction through the real
      // target planner and chain interpreter (CR 418.1 / 355.10.b).
      const kernel = world()
        .hand("spell", { types: ["spell"], cardId: convergence.canonicalCardId, energy: 2, power: ["Mind"] })
        .unit("battlefield-unit", { owner: "B", location: battlefield1, might: 8 })
        .base("base-unit", { owner: "B", location: baseB, might: 8 })
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
      // Boundary: with no unit at a battlefield the real planner has no legal target.
      const emptyKernel = world()
        .hand("spell", { types: ["spell"], cardId: convergence.canonicalCardId, energy: 2, power: ["Mind"] })
        .base("base-unit", { owner: "B", location: baseB, might: 8 })
        .build();
      const emptyContext = emptyKernel.clone({ sourceSnapshot: emptyKernel.getObject("spell"), controller: "A" });
      assert.deepEqual(queryTargetCandidates(emptyContext, spec), []);
    },
  },
  {
    name: "Dancing Grenade · the supported first Deal 2 executes through the full chain; replay and history bonus stay absent",
    canonicalCardId: grenade.canonicalCardId,
    sourceProgram: grenade,
    program: executableView(grenade),
    scenario: grenadeScenario,
    verify(result) {
      assert.deepEqual(result.state.chain, []);
      // The published IR must keep only the merged printed instruction: no
      // fabricated repeat and no invented Bonus Damage count.
      const [play] = grenade.abilities.filter(ability => ability.kind === "play");
      assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
        ["dancing-grenade.deal-2", "effect.damage"],
      ]);
      assert.equal(Object.hasOwn(play.body[0].args, "bonus"), false);
    },
  },
];

// ---------------------------------------------------------------------------
// Boundary group: boards where the real target planner has no legal target,
// plus the empty-affected-set case that keeps the set non-targeted.
// ---------------------------------------------------------------------------
const boundaryRows = [
  {
    name: "boundary (no legal target) · Dancing Grenade with no Board unit",
    canonicalCardId: grenade.canonicalCardId,
    sourceProgram: grenade,
    program: executableView(grenade),
    scenario: {
      players: { A: { energy: 2, power: ["Fury"] } },
      objects: [
        grenadeBoard[0],
        { id: "gear", types: ["gear"], zone: "board", location: battlefield1, energy: null, power: null, might: null },
      ],
      operations: playAndResolve,
    },
    expectFailure: noLegalTarget,
  },
  {
    name: "boundary (no legal target) · Firestorm with no battlefield on the Board",
    canonicalCardId: firestorm.canonicalCardId,
    sourceProgram: firestorm,
    program: executableView(firestorm),
    scenario: {
      players: { A: { energy: 6, power: ["Fury"] } },
      objects: [
        firestormBoard[0],
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 5 },
      ],
      operations: playAndResolve,
    },
    expectFailure: noLegalTarget,
  },
  {
    name: "boundary (empty affected set) · Firestorm choosing a battlefield with no enemy units still locks only that battlefield",
    canonicalCardId: firestorm.canonicalCardId,
    sourceProgram: firestorm,
    program: executableView(firestorm),
    scenario: {
      players: { A: { energy: 6, power: ["Fury"] } },
      objects: [
        ...firestormBoard.slice(0, 2),
        { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: battlefield2, might: 6 },
        { id: "ally-here", types: ["unit"], zone: "board", location: battlefield1, might: 5 },
      ],
      answers: { "target:firestorm.battlefield": ["battlefield-1"] },
      operations: playOnly,
      expect: {
        objects: {
          spell: { zone: "chain" },
          "enemy-elsewhere": { zone: "board", damage: 0 },
          "ally-here": { zone: "board", damage: 0 },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "became-target", target: { ref: "battlefield-1" } }] },
      },
    },
    verify(result) {
      assertFinalizedBattlefieldLock(result, ["battlefield-1"]);
    },
  },
  {
    // 359.3.e / 418.1: the locked reference stays bound to its zone entry, so a
    // unit that left the Board before resolution is ignored, never redirected
    // onto the remaining unit. Retreat is a real Reaction played from hand, not
    // a fixture "return": it pays 1 energy, returns the unit to hand and then
    // channels from an empty Rune Deck (a legal 431.3 shortfall).
    name: "boundary (ignored stale lock) · Dancing Grenade's locked unit is returned by a real Reaction and takes no damage",
    canonicalCardId: grenade.canonicalCardId,
    sourceProgram: grenade,
    program: executableView(grenade),
    scenario: {
      players: { A: { energy: 2, power: ["Fury"] }, B: { energy: 1 } },
      objects: [
        grenadeBoard[0],
        { id: "retreat", program: retreat, owner: "B", types: ["spell"], zone: "hand", energy: 1, power: null, might: null },
        grenadeBoard[1],
        grenadeBoard[2],
      ],
      answers: { "target:dancing-grenade.unit": ["chosen"], "target:friendly-unit": ["chosen"] },
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "play", object: "retreat", player: "B" },
        { type: "pass", player: "B" },
        { type: "pass", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          spell: { zone: "trash" },
          retreat: { zone: "trash", power: null },
          chosen: { zone: "hand", damage: 0 },
          other: { zone: "board", damage: 0 },
        },
        players: { A: { energy: 0 }, B: { energy: 0, handSize: 1, runeDeckSize: 0 } },
        events: {
          sequence: [
            { timingPoint: "became-target", target: { ref: "chosen" }, source: { ref: "spell" } },
            { timingPoint: "object-enters-hand", object: { ref: "chosen" } },
            { timingPoint: "card-played", object: { ref: "retreat" } },
            { timingPoint: "card-played", object: { ref: "spell" } },
          ],
        },
      },
    },
    verify(result) {
      assert.deepEqual(result.state.chain, []);
      assert.equal(result.events.some(event => event.timingPoint === "damage-dealt"), false);
    },
  },
];

// ---------------------------------------------------------------------------
// Printed expectations the merged engine does not reach yet. Every row asserts
// what the card text actually prints, so the gap stays explicit; a TODO is not
// execution evidence and never counts as a pass.
// ---------------------------------------------------------------------------
const pendingRows = [
  {
    todo: "RIFT-685 / RIFT-9: effect.damage still has no non-target set form, so the printed damage cannot resolve (355.10.d)",
    name: "pending printed · Firestorm deals 3 to every enemy unit at the chosen battlefield and targets only the battlefield",
    canonicalCardId: firestorm.canonicalCardId,
    sourceProgram: firestorm,
    program: executableView(firestorm),
    scenario: {
      ...firestormLockScenario,
      operations: playAndResolve,
      expect: {
        objects: {
          spell: { zone: "trash" },
          "enemy-here": { zone: "board", damage: 3 },
          "enemy-elsewhere": { zone: "board", damage: 0 },
          "ally-here": { zone: "board", damage: 0 },
          "base-unit": { zone: "board", damage: 0 },
        },
        players: { A: { energy: 0 } },
        events: {
          includes: [
            { timingPoint: "became-target", target: { ref: "battlefield-1" } },
            { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy-here", amount: 3 } },
          ],
        },
      },
    },
  },
  {
    todo: "RIFT-685: effect.damage still has no characteristic-selected batch set, so 'all units in bases' cannot resolve (355.10.d)",
    name: "pending printed · Avalanche deals 3 to every unit in both Bases and targets nothing",
    canonicalCardId: avalanche.canonicalCardId,
    sourceProgram: avalanche,
    program: executableView(avalanche),
    scenario: {
      ...avalancheLockScenario,
      operations: playAndResolve,
      expect: {
        objects: {
          spell: { zone: "trash" },
          "friendly-base-unit": { zone: "board", damage: 3 },
          "enemy-base-unit": { zone: "board", damage: 3 },
          "battlefield-unit": { zone: "board", damage: 0 },
        },
        players: { A: { energy: 0 } },
        events: {
          includes: [
            { timingPoint: "damage-dealt", action: { target: "friendly-base-unit", amount: 3 } },
            { timingPoint: "damage-dealt", action: { target: "enemy-base-unit", amount: 3 } },
          ],
        },
      },
    },
  },
  {
    todo: "RIFT-685: the mandatory additional cost 'return a friendly unit to its owner's hand' is not bound, so the printed play cannot resolve (356.2.a.1)",
    name: "pending printed · Parallel Convergence returns a friendly unit, then deals 5 to a battlefield unit",
    canonicalCardId: convergence.canonicalCardId,
    sourceProgram: convergence,
    program: executableView(convergence),
    scenario: {
      players: { A: { energy: 2, power: ["Mind"] } },
      objects: convergenceBoard,
      answers: { "target:unit-at-battlefield": ["enemy"] },
      operations: playAndResolve,
      expect: {
        objects: {
          spell: { zone: "trash" },
          "returned-unit": { zone: "hand", owner: "B" },
          enemy: { zone: "board", damage: 5 },
          "enemy-base": { zone: "board", damage: 0 },
        },
        players: { A: { energy: 0 }, B: { handSize: 1 } },
        events: {
          sequence: [
            { timingPoint: "object-enters-hand", object: { ref: "returned-unit" } },
            { timingPoint: "damage-dealt", action: { target: "enemy", amount: 5 } },
          ],
        },
      },
    },
  },
];

function register(template, suiteRows) {
  const cases = defineTemplateSuite(template, suiteRows);
  for (const [index, entry] of cases.entries()) {
    const row = suiteRows[index];
    test(entry.name, row.todo === undefined ? {} : { todo: row.todo }, () => {
      assertPublishedIdentity(row);
      if (row.expectFailure) {
        assert.throws(entry.run, row.expectFailure);
        row.verify?.();
        return;
      }
      const result = entry.run();
      row.verify?.(result);
    });
  }
}

register("play||effect.damage / RIFT-685", rows);
register("play||effect.damage / RIFT-685 boundary", boundaryRows);
register("play||effect.damage / RIFT-685 pending printed", pendingRows);

// The replay and the per-card damage history have no merged producer at all, so
// they cannot even be expressed as a scenario without inventing semantics.
test.todo(
  "RIFT-685 Dancing Grenade: 'Its controller may play this spell again for :rb_rune_rainbow:' and the per-card " +
    "damage-history Bonus Damage remain unimplemented (CR 158.3 / 420.3 / 712-715)"
);
