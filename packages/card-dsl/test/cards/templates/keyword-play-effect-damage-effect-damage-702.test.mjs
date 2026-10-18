// RIFT-702 / cards/README.md 4.1: the three cards share the
// `keyword+play||effect.damage+effect.damage` declaration shape. Their source
// programs stay judge-required because each has a different unsupported
// consumer; these rows execute only the already-supported damage paths through
// the real scenario harness and keep the original abilities by identity where
// possible.
import assert from "node:assert/strict";
import test from "node:test";

import {
  defineTemplateSuite,
  runCardScenario
} from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import marchingOrders from "../../../dist/cards/sfd/marching-orders.js";
import crescentStrike from "../../../dist/cards/unl/crescent-strike.js";
import monsterHarpoon from "../../../dist/cards/unl/monster-harpoon.js";

const battlefield = { type: "battlefield", id: "battlefield-1" };
const resolveSpell = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" }
];

const executableView = (program, abilities) => ({
  ...program,
  status: "executable",
  judgeReason: undefined,
  abilities
});

// Repeat's additional-cost binding is still unsupported. The body and both
// target specs are retained, while the test-only view supplies the printed
// base-cost kind so ChainEngine can reach the already-supported damage body.
const marchingOrdersView = executableView(marchingOrders, [
  marchingOrders.abilities[0],
  { ...marchingOrders.abilities[1], cost: { kind: "cost.printed" } }
]);

// The printed "there" relation and the non-target "each other" set are still
// unsupported by Finalize/effect.damage. This view retains the chosen
// battlefield as a real target and executes only the authored Deal 4 target;
// the unsupported sameLocationAs relation is omitted from this test view.
const crescentStrikeView = executableView(crescentStrike, [
  crescentStrike.abilities[0],
  {
    ...crescentStrike.abilities[1],
    body: [{
      ...crescentStrike.abilities[1].body[0],
      targets: [
        crescentStrike.abilities[1].body[0].targets[0],
        {
          ...crescentStrike.abilities[1].body[0].targets[1],
          filter: {
            type: "unit",
            zone: "board",
            controller: "opponent"
          }
        }
      ]
    }]
  }
]);

// Facedown Zone querying is still unsupported. The test-only view removes the
// unresolved condition and keeps the authored Deal 2 branch, which is the
// branch whose primitive and battlefield target are already executable.
const monsterHarpoonDealTwoView = executableView(monsterHarpoon, [
  monsterHarpoon.abilities[0],
  {
    ...monsterHarpoon.abilities[1],
    body: (() => {
      const { condition: _condition, ...dealTwo } = monsterHarpoon.abilities[1].body[0];
      return [{
        ...dealTwo,
        // The production translator still rejects the generic battlefield
        // restriction; keep the supported unit damage path and place the
        // selected unit at a battlefield in this scenario.
        targets: dealTwo.targets.map(target => ({
          ...target,
          filter: { type: "unit", zone: "board" }
        }))
      }];
    })()
  }
]);

const publishedPrograms = new Map([
  [marchingOrders.canonicalCardId, marchingOrders],
  [crescentStrike.canonicalCardId, crescentStrike],
  [monsterHarpoon.canonicalCardId, monsterHarpoon]
]);

function assertPublishedJudgeRequired(canonicalCardId) {
  const published = publishedPrograms.get(canonicalCardId);
  assert.ok(published, `missing published program for ${canonicalCardId}`);
  assert.equal(published.status, "judge-required");
  assert.ok(published.judgeReason?.trim(), `${canonicalCardId} needs a concrete judgeReason`);
}

const rows = [
  {
    name: "Marching Orders · both chosen units deal their current Might",
    canonicalCardId: marchingOrders.canonicalCardId,
    program: marchingOrdersView,
    scenario: {
      players: { A: { energy: 3, power: [] }, B: { energy: 0 } },
      objects: [
        { id: "spell", cardId: marchingOrdersView.canonicalCardId, program: marchingOrdersView, owner: "A", types: ["spell"], zone: "hand", energy: 3, power: null },
        { id: "friendly", owner: "A", types: ["unit"], zone: "board", location: { type: "base", player: "A" }, might: 3 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: battlefield, might: 5 }
      ],
      answers: {
        "target:marching-orders.friendly-unit": ["friendly"],
        "target:marching-orders.enemy-unit": ["enemy"]
      },
      operations: resolveSpell,
      expect: {
        objects: {
          spell: { zone: "trash" },
          friendly: { damage: 5 },
          enemy: { damage: 3 }
        },
        players: { A: { energy: 0, power: [] } },
        events: { includes: [
          { timingPoint: "damage-dealt", action: { type: "damage", source: "friendly", target: "enemy", amount: 3 } },
          { timingPoint: "damage-dealt", action: { type: "damage", source: "enemy", target: "friendly", amount: 5 } }
        ] }
      }
    }
  },
  {
    name: "Crescent Strike · chosen battlefield and enemy unit receive the supported Deal 4",
    canonicalCardId: crescentStrike.canonicalCardId,
    program: crescentStrikeView,
    scenario: {
      players: { A: { energy: 3, power: ["Mind"] }, B: { energy: 0 } },
      objects: [
        { id: "spell", cardId: crescentStrikeView.canonicalCardId, program: crescentStrikeView, owner: "A", types: ["spell"], zone: "hand", energy: 3, power: ["Mind"] },
        { id: "chosen-battlefield", types: ["battlefield"], zone: "board", location: battlefield, energy: null, power: null, might: null },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: battlefield, might: 5 },
        { id: "other-enemy", owner: "B", types: ["unit"], zone: "board", location: battlefield, might: 5 },
        { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "battlefield-2" }, might: 5 }
      ],
      answers: {
        "target:crescent-strike.battlefield": ["chosen-battlefield"],
        "target:crescent-strike.enemy-unit": ["enemy"]
      },
      operations: resolveSpell,
      expect: {
        objects: {
          spell: { zone: "trash" },
          enemy: { damage: 4 },
          "other-enemy": { damage: 0 },
          "enemy-elsewhere": { damage: 0 }
        },
        // The current scenario payment path debits the printed Energy while
        // preserving the source's Mind domain; the source program remains
        // judge-required for the unsupported second Deal and "there" binding.
        players: { A: { energy: 0, power: ["Mind"] } },
        events: { includes: [
          { timingPoint: "became-target", target: { ref: "chosen-battlefield" } },
          { timingPoint: "became-target", target: { ref: "enemy" } },
          { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy", amount: 4 } }
        ] }
      }
    }
  },
  {
    name: "Monster Harpoon · supported Deal 2 branch damages a battlefield unit",
    canonicalCardId: monsterHarpoon.canonicalCardId,
    program: monsterHarpoonDealTwoView,
    scenario: {
      players: { A: { energy: 1, power: ["Fury"] }, B: { energy: 0 } },
      objects: [
        { id: "spell", cardId: monsterHarpoonDealTwoView.canonicalCardId, program: monsterHarpoonDealTwoView, owner: "A", types: ["spell"], zone: "hand", energy: 1, power: ["Fury"] },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: battlefield, might: 5 }
      ],
      answers: { "target:monster-harpoon.unit": ["enemy"] },
      operations: resolveSpell,
      expect: {
        objects: { spell: { zone: "trash" }, enemy: { damage: 2 } },
        players: { A: { energy: 0, power: ["Fury"] } },
        events: { includes: [
          { timingPoint: "became-target", target: { ref: "enemy" } },
          { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy", amount: 2 } }
        ] }
      }
    }
  }
];

for (const row of defineTemplateSuite("RIFT-702 keyword+play || effect.damage+effect.damage", rows)) {
  test(row.name, () => {
    assertPublishedJudgeRequired(row.canonicalCardId);
    row.run();
  });
}

// One no-legal-target boundary for each view proves that the shared target
// planner rejects an unavailable unit instead of inventing a target.
const boundaryRows = [
  {
    name: "Marching Orders · no enemy at a battlefield",
    program: marchingOrdersView,
    scenario: {
      players: { A: { energy: 3 }, B: { energy: 0 } },
      objects: [
        { id: "spell", cardId: marchingOrdersView.canonicalCardId, program: marchingOrdersView, owner: "A", types: ["spell"], zone: "hand", energy: 3, power: null },
        { id: "friendly", owner: "A", types: ["unit"], zone: "board", location: { type: "base", player: "A" }, might: 3 }
      ],
      answers: { "target:marching-orders.friendly-unit": ["friendly"] },
      operations: [{ type: "play", object: "spell", player: "A" }]
    }
  },
  {
    name: "Crescent Strike · no enemy unit to choose",
    program: crescentStrikeView,
    scenario: {
      players: { A: { energy: 3, power: ["Mind"] }, B: { energy: 0 } },
      objects: [
        { id: "spell", cardId: crescentStrikeView.canonicalCardId, program: crescentStrikeView, owner: "A", types: ["spell"], zone: "hand", energy: 3, power: ["Mind"] },
        { id: "chosen-battlefield", types: ["battlefield"], zone: "board", location: battlefield, energy: null, power: null, might: null }
      ],
      answers: { "target:crescent-strike.battlefield": ["chosen-battlefield"] },
      operations: [{ type: "play", object: "spell", player: "A" }]
    }
  },
  {
    name: "Monster Harpoon · no unit available for the supported target slice",
    program: monsterHarpoonDealTwoView,
    scenario: {
      players: { A: { energy: 1, power: ["Fury"] }, B: { energy: 0 } },
      objects: [
        { id: "spell", cardId: monsterHarpoonDealTwoView.canonicalCardId, program: monsterHarpoonDealTwoView, owner: "A", types: ["spell"], zone: "hand", energy: 1, power: ["Fury"] }
      ],
      operations: [{ type: "play", object: "spell", player: "A" }]
    }
  }
];

for (const row of boundaryRows) {
  test(`RIFT-702 boundary: ${row.name} [${row.program.canonicalCardId}]`, () => {
    assert.throws(() => runCardScenario(row.program, row.scenario), error => error?.code === "no-legal-targets");
  });
}
