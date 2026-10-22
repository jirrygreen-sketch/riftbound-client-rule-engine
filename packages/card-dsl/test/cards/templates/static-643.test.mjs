// RIFT-643: the twelve cards in this file share the static|| IR signature.
//
// A row is kept for every card.  Rows whose whole static ability is supported
// by the scenario harness run as independent tests.  The remaining rows stay
// explicit TODOs because their shipped programs are still judge-required and
// the missing consumer cannot be represented honestly as a scenario success.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const IDS = {
  forgottenMonument: "card.hash-b6280b20779b152b78ff7c32ddd405d6d7c490bb00b2e8939b821030dffcab90",
  ireliaGraceful: "card.hash-4226ae419dd851644c384f3f4d645badcec767b55055e62cb45fcc436ec55e03",
  legionQuartermaster: "card.hash-a010c6a3b5692bc45e1c1a552db574267b69092695de19dc7869f7089ece7cb2",
  maraiSpire: "card.hash-e00a3fe8d0f18d062b1743d6d5d1eb534e884d83303af037d7c1d05c3a6a21bd",
  minotaurReckoner: "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe",
  ornnsForge: "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad",
  purifier: "card.hash-d6988e3c4bfaf3cd84e8451ade514abc99df9e47acaa479d8e17bd78b14d1db5",
  rockfallPath: "card.hash-0bf84d1f197b32b1d70c409fd2d0f0fe59c23923e72f6f7eeb77cb1e4376db7d",
  ruinRunner: "card.hash-4c33c3a92166927cee28b4acd0740603992c27aa8567488dee47edd7288ae1a1",
  voidDrone: "card.hash-512a6baf401c344f2932b0402985380ea003a2798bef0dec74998bf39db0f00c",
  baronPit: "card.hash-9a277d1f603718992521dc7464de01bdb5cc00d5d35d10081db5b0c9cfc4c3db",
  blackFlameAltar: "card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56",
};

const EXECUTABLE_IDS = new Set([IDS.minotaurReckoner, IDS.purifier]);

function program(id) {
  const value = cardProgramsById.get(id);
  assert.ok(value, `generated card program ${id} is present`);
  assert.equal(value.status, "judge-required");
  if (!EXECUTABLE_IDS.has(id)) return value;
  // runCardScenario intentionally accepts only executable programs.  This is
  // an in-memory lift for the two rows whose complete static declaration is
  // observable through the real lifecycle; the shipped card status remains
  // judge-required until its unresolved consumer is merged.
  const { judgeReason: _judgeReason, ...rest } = value;
  return { ...rest, status: "executable" };
}

const rows = [
  {
    name: "Forgotten Monument · score restriction registration is pending the scoring consumer",
    canonicalCardId: IDS.forgottenMonument,
    program: program(IDS.forgottenMonument),
    scenario: {
      objects: [{ id: "monument", cardId: IDS.forgottenMonument, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      operations: [],
      expect: {},
    },
    blocked: "scoring restriction consumer and the per-player third-turn window slot",
  },
  {
    name: "Irelia, Graceful · spell-target cost discount is pending cost-plan binding",
    canonicalCardId: IDS.ireliaGraceful,
    program: program(IDS.ireliaGraceful),
    scenario: {
      objects: [{ id: "irelia", cardId: IDS.ireliaGraceful, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      operations: [],
      expect: {},
    },
    blocked: "target-conditioned Energy/Universal-Power discount consumer",
  },
  {
    name: "Legion Quartermaster · mandatory return-to-hand cost is pending Finalize",
    canonicalCardId: IDS.legionQuartermaster,
    program: program(IDS.legionQuartermaster),
    scenario: {
      objects: [{ id: "quartermaster", cardId: IDS.legionQuartermaster, types: ["unit"], zone: "hand" }],
      operations: [],
      expect: {},
    },
    blocked: "mandatory additional-cost collection and return-to-hand payment",
  },
  {
    name: "Marai Spire · Repeat additional-cost discount is pending Finalize",
    canonicalCardId: IDS.maraiSpire,
    program: program(IDS.maraiSpire),
    scenario: {
      objects: [{ id: "spire", cardId: IDS.maraiSpire, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      operations: [],
      expect: {},
    },
    blocked: "Repeat keyword filter, cost consumer, and paid-instance resolution",
  },
  {
    name: "Minotaur Reckoner · units lose the move-to-base option",
    canonicalCardId: IDS.minotaurReckoner,
    program: program(IDS.minotaurReckoner),
    scenario: {
      objects: [
        { id: "minotaur", cardId: IDS.minotaurReckoner, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 5 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-2" }, might: 2 },
        { id: "gear", owner: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 0 },
      ],
      operations: [],
      expect: {
        objects: {
          minotaur: { movement: { restrictions: ["move-to-base"] } },
          ally: { movement: { restrictions: ["move-to-base"] } },
          enemy: { movement: { restrictions: ["move-to-base"] } },
          gear: { movement: { restrictions: [] } },
        },
      },
    },
  },
  {
    name: "Ornn's Forge · first non-token gear discount is pending cost binding",
    canonicalCardId: IDS.ornnsForge,
    program: program(IDS.ornnsForge),
    scenario: {
      objects: [{ id: "forge", cardId: IDS.ornnsForge, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      operations: [],
      expect: {},
    },
    blocked: "first qualifying play window and static cost-plan consumer",
  },
  {
    name: "Purifier · your Equipment gains Assault",
    canonicalCardId: IDS.purifier,
    program: program(IDS.purifier),
    scenario: {
      objects: [
        { id: "purifier", cardId: IDS.purifier, types: ["legend"], zone: "legend", location: null },
        { id: "friendly-equipment", owner: "A", types: ["gear"], tags: ["Equipment"], zone: "board", location: { type: "battlefield", id: "bf-1" } },
        { id: "enemy-equipment", owner: "B", types: ["gear"], tags: ["Equipment"], zone: "board", location: { type: "battlefield", id: "bf-1" } },
        // Boundary: a friendly Gear without the Equipment tag is not in the
        // static set and must remain unchanged.
        { id: "friendly-gear", owner: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" } },
      ],
      operations: [],
      expect: {
        objects: {
          "friendly-equipment": { keywords: [{ id: "Assault" }] },
          "enemy-equipment": { keywords: [] },
          "friendly-gear": { keywords: [] },
        },
      },
    },
  },
  {
    name: "Rockfall Path · unit play prohibition is pending destination-aware Finalize",
    canonicalCardId: IDS.rockfallPath,
    program: program(IDS.rockfallPath),
    scenario: {
      objects: [{ id: "path", cardId: IDS.rockfallPath, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      operations: [],
      expect: {},
    },
    blocked: "destination-specific play restriction consumer",
  },
  {
    name: "Ruin Runner · enemy-only untargetability is pending target adapter",
    canonicalCardId: IDS.ruinRunner,
    program: program(IDS.ruinRunner),
    scenario: {
      objects: [{ id: "runner", cardId: IDS.ruinRunner, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      operations: [],
      expect: {},
    },
    blocked: "relative chooser and spell/ability source-category target checks",
  },
  {
    name: "Void Drone · non-hand play discount is pending source-zone cost binding",
    canonicalCardId: IDS.voidDrone,
    program: program(IDS.voidDrone),
    scenario: {
      objects: [{ id: "drone", cardId: IDS.voidDrone, types: ["unit"], zone: "banishment" }],
      operations: [],
      expect: {},
    },
    blocked: "pre-play origin capture and Finalize cost consumer",
  },
  {
    name: "Baron Pit · destination:self movement permission is pending Standard Move consumption",
    canonicalCardId: IDS.baronPit,
    program: program(IDS.baronPit),
    scenario: {
      objects: [{ id: "pit", cardId: IDS.baronPit, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      operations: [],
      expect: {},
    },
    blocked: "destination endpoint and source:anywhere Standard Move legality",
  },
  {
    name: "Black Flame Altar · Temporary-gated Shield grant is pending filter and keyword expansion",
    canonicalCardId: IDS.blackFlameAltar,
    program: program(IDS.blackFlameAltar),
    scenario: {
      objects: [{ id: "altar", cardId: IDS.blackFlameAltar, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      operations: [],
      expect: {},
    },
    blocked: "Temporary filter, value-based here matching, and granted Shield defender expansion",
  },
];

for (const row of defineTemplateSuite("RIFT-643 static||", rows)) {
  if (EXECUTABLE_IDS.has(row.canonicalCardId)) test(row.name, row.run);
  else test.todo(`${row.name} — blocked: ${rows.find(entry => entry.canonicalCardId === row.canonicalCardId)?.blocked}`);
}
