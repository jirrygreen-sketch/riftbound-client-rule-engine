// RIFT-643: the twelve cards in this file share the static|| IR signature.
// Published executable cards and the isolated Purifier lifecycle view run the
// original scenario. The remaining rows stay explicit TODOs because their
// shipped programs still have unclosed consumers.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import orbOfRegret from "../../../dist/cards/ogn/orb-of-regret.js";

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

const RUNNABLE_JUDGE_REQUIRED_IDS = new Set([
  IDS.purifier,
]);
const TESTABLE_IDS = new Set([
  ...RUNNABLE_JUDGE_REQUIRED_IDS,
  IDS.ornnsForge,
]);

function program(id) {
  const value = cardProgramsById.get(id);
  assert.ok(value, `generated card program ${id} is present`);
  if (value.status === "executable") return value;
  assert.equal(value.status, "judge-required");
  if (!RUNNABLE_JUDGE_REQUIRED_IDS.has(id)) return value;
  // runCardScenario accepts only executable programs. Purifier still asserts
  // the shipped judge-required status and uses a test-only status lift to
  // exercise the complete static declaration that is already observable here.
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
    name: "Minotaur Reckoner · the production binding reaches the move-to-base rule query",
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
      expect: {},
    },
  },
  {
    name: "Ornn's Forge · the first non-token Gear costs 1 Energy less",
    canonicalCardId: IDS.ornnsForge,
    program: program(IDS.ornnsForge),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        { id: "forge", cardId: IDS.ornnsForge, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" }, controller: "A" },
        { id: "gear-1", program: orbOfRegret, cardId: orbOfRegret.canonicalCardId, types: ["gear"], zone: "hand", energy: 1, power: null },
        { id: "gear-2", program: orbOfRegret, cardId: orbOfRegret.canonicalCardId, types: ["gear"], zone: "hand", energy: 1, power: null },
      ],
      operations: [
        { type: "play", object: "gear-1", player: "A" },
        { type: "play", object: "gear-2", player: "A" },
      ],
      expect: {
        objects: {
          forge: { zone: "board" },
          "gear-1": { zone: "board" },
          "gear-2": { zone: "board" },
        },
        players: { A: { energy: 2 } },
      },
    },
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
  const source = rows.find(entry => entry.canonicalCardId === row.canonicalCardId);
  if (row.canonicalCardId === IDS.minotaurReckoner) {
    test(row.name, assertMinotaurRuleQuery);
  } else if (TESTABLE_IDS.has(row.canonicalCardId)) {
    test(row.name, row.run);
  } else {
    assert.equal(source?.program.status, "judge-required");
    test.todo(`${row.name} — blocked: ${source?.blocked}`);
  }
}

function assertMinotaurRuleQuery() {
  const sourceProgram = cardProgramsById.get(IDS.minotaurReckoner);
  assert.equal(sourceProgram.status, "judge-required");
  assert.match(sourceProgram.judgeReason, /DuelMovementRuleContext/);
  const kernel = world()
    .unit("minotaur", {
      cardId: sourceProgram.canonicalCardId,
      location: { type: "battlefield", id: "bf-1" },
    })
    .unit("ally", { location: { type: "battlefield", id: "bf-1" } })
    .unit("gear", { types: ["gear"], location: { type: "battlefield", id: "bf-1" } })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: state => kernel.restore(state),
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint,
    }),
  });
  const engine = new ChainEngine({
    host,
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    cleanup: () => false,
  });
  const binding = createProgramBinding({
    cardPrograms: [sourceProgram],
    staticBinder: createEngineStaticBinder(engine),
  });
  const source = kernel.getObject("minotaur");
  const handle = binding.bindStatic(
    sourceProgram.abilities[0],
    source
  );
  const ally = kernel.getObject("ally");
  const gear = kernel.getObject("gear");
  engine.layers.setObjects(kernel.objects);
  const allyView = movement(engine.layers.registry, ally.ref, ally, "A");
  assert.deepEqual(allyView.restrictions, ["move-to-base"]);
  assert.equal(allyView.canMove, true);
  assert.deepEqual(movement(engine.layers.registry, gear.ref, gear, "A").restrictions, []);
  handle.unbind();
  assert.deepEqual(movement(engine.layers.registry, ally.ref, ally, "A").restrictions, []);
}
