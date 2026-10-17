// RIFT-668 / cards/README.md 4.1: one independently named row per printed card.
// These are partial paths and boundaries, not evidence that a whole card works.
// runCardScenario requires executable metadata, so the probe changes only that
// metadata and keeps the original abilities by reference. Published programs
// remain judge-required; every row also checks the real registry's status guard.
// Unsupported printed outcomes remain TODOs, never successful bug expectations.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { createProgramBinding, createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import rockfallPath from "../../../dist/cards/sfd/rockfall-path.js";
import ruinRunner from "../../../dist/cards/sfd/ruin-runner.js";
import voidDrone from "../../../dist/cards/sfd/void-drone.js";
import baronPit from "../../../dist/cards/unl/baron-pit.js";
import blackFlameAltar from "../../../dist/cards/unl/black-flame-altar.js";
import crimsonPigeons from "../../../dist/cards/unl/crimson-pigeons.js";
import determinedSentry from "../../../dist/cards/unl/determined-sentry.js";
import mageseekerInvestigator from "../../../dist/cards/unl/mageseeker-investigator.js";
import masterYi from "../../../dist/cards/unl/master-yi-unstoppable.js";
import petalPixie from "../../../dist/cards/unl/petal-pixie.js";
import preparedNeophyte from "../../../dist/cards/unl/prepared-neophyte.js";
import soulShepherd from "../../../dist/cards/unl/soul-shepherd.js";
import cloudDrake from "../../../dist/cards/ven/cloud-drake.js";
import hextechRay from "../../../dist/cards/ogn/hextech-ray.js";
import vengeance from "../../../dist/cards/ogn/vengeance.js";

const HERE = { type: "battlefield", id: "bf-668" };
const ELSEWHERE = { type: "battlefield", id: "bf-elsewhere" };
const BASE = { type: "base", player: "A" };
const resolvePlay = object => [
  { type: "play", object, player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];
const source = (id, program, extra = {}) => ({
  id, cardId: program.canonicalCardId, types: ["unit"], zone: "board",
  location: HERE, energy: null, power: null, ...extra,
});

function probe(program) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim());
  return { ...program, status: "executable", judgeReason: undefined };
}

// Inspect registration through the production binder when the scenario's
// public result does not expose its continuous-effect registry. No resolution
// or state mutation is supplied by the fixture or a custom callback.
function registration(program, result) {
  const host = result.state.objects.find(object => object.cardId === program.canonicalCardId);
  assert.ok(host);
  const { engine } = fixture({ cards: [] });
  const binder = createEngineStaticBinder(engine);
  const handles = program.abilities.map(ability => binder.bindStatic(ability, host));
  return { host, engine, close: () => handles.forEach(handle => handle.unbind()) };
}

const rows = [
  {
    name: "Rockfall Path: other battlefields remain valid play destinations",
    canonicalCardId: rockfallPath.canonicalCardId, program: rockfallPath,
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        // A Battlefield object has no Location; the harness currently assigns
        // a default on lifecycle entry, so this row proves only the other
        // destination boundary, never destination:self enforcement.
        source("path", rockfallPath, { types: ["battlefield"], location: null, might: null }),
        { id: "drake", program: cloudDrake, types: ["unit"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "draw", types: ["spell"], zone: "deck", energy: null, power: null },
      ],
      operations: [{ type: "play", object: "drake", player: "A", location: ELSEWHERE }, ...resolvePlay("drake").slice(1)],
      expect: {
        objects: { path: { energy: null, power: null }, drake: { zone: "board", location: ELSEWHERE }, draw: { zone: "hand" } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "drake" } }, { timingPoint: "card-drawn", object: { ref: "draw" } }] },
      },
    },
  },
  {
    name: "Ruin Runner: a friendly spell may still choose and damage me",
    canonicalCardId: ruinRunner.canonicalCardId, program: ruinRunner,
    todo: "The current restriction also rejects friendly targets; the chooser/source adapter is missing",
    scenario: {
      players: { A: { energy: 1, power: ["Fury"] } },
      objects: [
        source("runner", ruinRunner, { energy: 6, might: 5 }),
        { id: "ray", program: hextechRay, types: ["spell"], zone: "hand", energy: 1, power: ["Fury"] },
      ],
      answers: { "target:hextech-ray.unit-at-battlefield": ["runner"] },
      operations: resolvePlay("ray"),
      expect: {
        objects: { runner: { zone: "board", damage: 3, might: 5 }, ray: { zone: "trash" } },
        players: { A: { energy: 0, power: [] } },
        events: { includes: [{ timingPoint: "damage-dealt", action: { type: "damage", target: "runner", amount: 3 } }] },
      },
    },
  },
  {
    name: "Void Drone: playing from hand pays all three printed Energy",
    canonicalCardId: voidDrone.canonicalCardId, program: voidDrone,
    scenario: {
      players: { A: { energy: 5 } },
      objects: [source("drone", voidDrone, { zone: "hand", location: null, energy: 3, might: 3 })],
      // Unit play with no play trigger settles immediately in ChainEngine.
      operations: [{ type: "play", object: "drone", player: "A" }],
      expect: {
        objects: { drone: { zone: "board", location: BASE, energy: 3, power: null, might: 3 } },
        players: { A: { energy: 2 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "drone" } }] },
      },
    },
  },
  {
    name: "Baron Pit: register destination:self without granting unrestricted Ganking",
    canonicalCardId: baronPit.canonicalCardId, program: baronPit,
    scenario: {
      objects: [
        source("pit", baronPit, { types: ["battlefield"], location: null, might: null, isToken: true }),
        { id: "traveller", types: ["unit"], zone: "board", location: ELSEWHERE, might: 3 },
      ],
      operations: [],
      expect: { objects: { pit: { energy: null, power: null }, traveller: { location: ELSEWHERE, movement: { canGank: false } } }, events: { exact: [] } },
    },
    verify(result) {
      const bound = registration(baronPit, result);
      try {
        const traveller = result.state.objects.find(object => object.ref.id === "traveller");
        const view = movement(bound.engine.layers.registry, traveller.ref, traveller, "A");
        assert.deepEqual(view.permissions.map(permission => ({ routes: permission.routes, endpoints: permission.endpoints, source: permission.source })), [{
          routes: ["standard-move-to-here-from-anywhere"], endpoints: { source: "anywhere", destination: "self" }, source: bound.host.ref,
        }]);
        assert.equal(view.canGank, false);
      } finally { bound.close(); }
    },
  },
  {
    name: "Black Flame Altar: no Shield for a unit without Temporary or a distant unit",
    canonicalCardId: blackFlameAltar.canonicalCardId, program: blackFlameAltar,
    scenario: {
      objects: [
        source("altar", blackFlameAltar, { types: ["battlefield"], location: null, might: null }),
        { id: "vanilla", types: ["unit"], zone: "board", location: HERE, might: 3 },
        { id: "distant", types: ["unit"], zone: "board", location: ELSEWHERE, might: 2, keywords: [{ id: "Temporary" }] },
      ],
      operations: [],
      expect: { objects: { vanilla: { might: 3, keywords: [] }, distant: { might: 2, keywords: [{ id: "Temporary" }] } }, events: { exact: [] } },
    },
  },
  {
    name: "Crimson Pigeons: another nearby unit does not grant +2 outside combat",
    canonicalCardId: crimsonPigeons.canonicalCardId, program: crimsonPigeons,
    scenario: {
      objects: [source("pigeons", crimsonPigeons, { energy: 3, might: 3 }), { id: "ally", types: ["unit"], zone: "board", location: HERE, might: 2 }],
      operations: [],
      expect: { objects: { pigeons: { might: 3, combatRole: null }, ally: { might: 2 } }, events: { exact: [] } },
    },
  },
  {
    name: "Determined Sentry: the move-to-base restriction belongs to this host only",
    canonicalCardId: determinedSentry.canonicalCardId, program: determinedSentry,
    scenario: {
      objects: [source("sentry", determinedSentry, { energy: 1, might: 1 }), { id: "neighbour", types: ["unit"], zone: "board", location: HERE, might: 2 }],
      operations: [],
      expect: { objects: { sentry: { movement: { restrictions: ["move-to-base"], canGank: false } }, neighbour: { movement: { restrictions: [] } } }, events: { exact: [] } },
    },
  },
  {
    name: "Mageseeker Investigator: retain the opponent-only simultaneous-move cost declaration",
    canonicalCardId: mageseekerInvestigator.canonicalCardId, program: mageseekerInvestigator,
    scenario: {
      players: { A: { power: ["Order"] }, B: { power: ["Mind"] } },
      objects: [source("investigator", mageseekerInvestigator, { energy: 4, might: 4 })],
      operations: [],
      expect: { objects: { investigator: { zone: "board", might: 4 } }, players: { A: { power: ["Order"] }, B: { power: ["Mind"] } }, events: { exact: [] } },
    },
    verify(result) {
      const bound = registration(mageseekerInvestigator, result);
      try {
        const [entry] = bound.engine.layers.registry.list();
        assert.deepEqual(entry.effect.effect.actions, ["move"]);
        assert.equal(entry.effect.effect.payer, "moving-player");
        assert.equal(entry.effect.effect.payerScope, "opponent");
        assert.equal(entry.effect.effect.batch, "simultaneous");
        assert.deepEqual(entry.effect.effect.destination, { kind: "self-battlefield" });
        assert.deepEqual(entry.effect.effect.amount, { perBatch: "units-moved", minus: 1 });
        assert.equal(entry.effect.effect.domain, "any");
      } finally { bound.close(); }
    },
  },
  {
    name: "Master Yi, Unstoppable: below Level 3 pay twelve Energy and three Calm",
    canonicalCardId: masterYi.canonicalCardId, program: masterYi,
    todo: "Scenario TestWorld pay does not consume Power; the printed cost boundary cannot pass yet",
    scenario: {
      players: { A: { energy: 12, power: ["Calm", "Calm", "Calm"], xp: 2 } },
      objects: [source("yi", masterYi, { zone: "hand", location: null, energy: 12, power: ["Calm", "Calm", "Calm"], might: 12 })],
      operations: [{ type: "play", object: "yi", player: "A" }],
      expect: { objects: { yi: { zone: "board", might: 12 } }, players: { A: { energy: 0, power: [], xp: 2 } }, events: { includes: [{ timingPoint: "card-played", object: { ref: "yi" } }] } },
    },
  },
  {
    name: "Petal Pixie: no bonus without any friendly Temporary unit at my battlefield",
    canonicalCardId: petalPixie.canonicalCardId, program: petalPixie,
    scenario: {
      objects: [
        source("pixie", petalPixie, { energy: 2, might: 2 }),
        { id: "vanilla", types: ["unit"], zone: "board", location: HERE, might: 1 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 1, keywords: [{ id: "Temporary" }] },
        { id: "distant", types: ["unit"], zone: "board", location: ELSEWHERE, might: 1, keywords: [{ id: "Temporary" }] },
      ],
      operations: [],
      expect: { objects: { pixie: { might: 2 }, vanilla: { might: 1 }, enemy: { might: 1 }, distant: { might: 1 } }, events: { exact: [] } },
    },
  },
  {
    name: "Prepared Neophyte: no +4 when no Energy has been spent playing a spell",
    canonicalCardId: preparedNeophyte.canonicalCardId, program: preparedNeophyte,
    scenario: {
      players: { A: { energy: 0 } },
      objects: [source("neophyte", preparedNeophyte, { energy: 3, might: 1 }), { id: "unplayed-spell", owner: "B", types: ["spell"], zone: "trash", energy: 4 }],
      operations: [],
      expect: { objects: { neophyte: { might: 1 }, "unplayed-spell": { zone: "trash" } }, players: { A: { energy: 0 } }, events: { exact: [] } },
    },
  },
  {
    name: "Soul Shepherd: +1 for controlled token units, excluding token gear and enemy tokens",
    canonicalCardId: soulShepherd.canonicalCardId, program: soulShepherd,
    scenario: {
      objects: [
        source("shepherd", soulShepherd, { energy: 5, might: 3 }),
        { id: "token", types: ["unit"], zone: "board", location: HERE, isToken: true, might: 1 },
        { id: "controlled-token", owner: "B", controller: "A", types: ["unit"], zone: "board", location: ELSEWHERE, isToken: true, might: 2 },
        { id: "enemy-token", owner: "B", types: ["unit"], zone: "board", location: HERE, isToken: true, might: 3 },
        { id: "vanilla", types: ["unit"], zone: "board", location: HERE, might: 4 },
        { id: "token-gear", types: ["gear"], zone: "board", location: HERE, isToken: true, might: 0, energy: null, power: null },
        { id: "hand-token", types: ["unit"], zone: "hand", isToken: true, might: 5 },
      ],
      operations: [],
      expect: {
        objects: { shepherd: { might: 3 }, token: { might: 2 }, "controlled-token": { might: 3 }, "enemy-token": { might: 3 }, vanilla: { might: 4 }, "token-gear": { might: 0, energy: null, power: null }, "hand-token": { might: 5 } },
        events: { exact: [] },
      },
    },
  },
];

for (const row of rows) {
  const [execution] = defineTemplateSuite("RIFT-668 static|| partial/boundary", [{ ...row, program: probe(row.program) }]);
  test(execution.name, row.todo ? { todo: row.todo } : {}, () => {
    const binding = createProgramBinding({ cardPrograms: [row.program] });
    assert.throws(() => binding.registry.get(row.canonicalCardId), error => error.code === "judge-required");
    assert.throws(() => runCardScenario(row.program, row.scenario), /is judge-required/);
    const result = execution.run();
    row.verify?.(result);
  });
}

// Printed positive paths stay blocked. These TODOs do not count as execution
// passes and do not promote a card merely because a negative boundary passes.
test.todo("RIFT-668 Rockfall Path: reject play to this Battlefield while preserving Base/other destinations (CR 053.3/054.1/355.2.b; destination consumer)");
test.todo("RIFT-668 Ruin Runner: reject enemy spell/ability targets at Finalize and Resolve (CR 757.1/758.1; chooser/source-category adapter)");
test.todo("RIFT-668 Baron Pit: Standard Move consumes destination:self from any origin without granting other destinations (CR 187.9/449.1/449.2; scenario has no Standard Move operation)");
test.todo("RIFT-668 Black Flame Altar: grant Shield to Temporary units here and apply its defender bonus (CR 053.3/814.1/816.3; keyword/location filter and dynamic expansion)");
test.todo("RIFT-668 Crimson Pigeons: +2 with another attacking unit, excluding self/defenders/distant/enemy units (CR 364.3/466.2.c.3; combatRole producer, scenario field and relative condition query)");
test.todo("RIFT-668 Determined Sentry: Standard Move and effect.move both reject movement to Base (CR 054.1/144.4.b/451.1; movement consumers)");
test.todo("RIFT-668 Mageseeker Investigator: only opposing movers pay one any-domain Power per extra simultaneous unit (CR 204.4/355.10.b; Applied Cost normalization/consumer, payer relation, batch count and destination)");
test.todo("RIFT-668 Soul Shepherd: control changes and source departure update the token-unit aura immediately (CR 479.4; dynamic controller binding)");

// Runnable TODOs retain the printed expectation, rather than blessing the
// current incorrect state as a passing golden.
const blockedRows = [
  {
    name: "Void Drone: pay one Energy when played from banishment",
    canonicalCardId: voidDrone.canonicalCardId, program: probe(voidDrone),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [source("drone", voidDrone, { zone: "banishment", location: null, energy: 3, might: 3 })],
      operations: [{ type: "play", object: "drone", player: "A" }],
      expect: { objects: { drone: { zone: "board", energy: 3, power: null } }, players: { A: { energy: 2 } } },
    },
  },
  {
    name: "Master Yi, Unstoppable: Level 11 replaces earlier discounts with six Energy/three Calm",
    canonicalCardId: masterYi.canonicalCardId, program: probe(masterYi),
    scenario: {
      players: { A: { energy: 12, power: ["Calm", "Calm", "Calm"], xp: 11 } },
      objects: [source("yi", masterYi, { zone: "hand", location: null, energy: 12, power: ["Calm", "Calm", "Calm"], might: 12 })],
      operations: [{ type: "play", object: "yi", player: "A" }],
      expect: { objects: { yi: { zone: "board" } }, players: { A: { energy: 6, power: ["Calm", "Calm", "Calm"], xp: 11 } } },
    },
  },
  {
    name: "Petal Pixie: count exactly two friendly Temporary units at my battlefield",
    canonicalCardId: petalPixie.canonicalCardId, program: probe(petalPixie),
    scenario: {
      objects: [
        source("pixie", petalPixie, { energy: 2, might: 2 }),
        { id: "temporary-1", types: ["unit"], zone: "board", location: HERE, might: 1, keywords: [{ id: "Temporary" }] },
        { id: "temporary-2", types: ["unit"], zone: "board", location: HERE, might: 1, keywords: [{ id: "Temporary" }] },
        { id: "vanilla", types: ["unit"], zone: "board", location: HERE, might: 1 },
      ],
      operations: [],
      expect: { objects: { pixie: { might: 4 }, vanilla: { might: 1 } }, events: { exact: [] } },
    },
  },
  {
    name: "Prepared Neophyte: gain +4 after actually paying four Energy for one spell",
    canonicalCardId: preparedNeophyte.canonicalCardId, program: probe(preparedNeophyte),
    scenario: {
      players: { A: { energy: 4, power: ["Order", "Order"] } },
      objects: [
        source("neophyte", preparedNeophyte, { energy: 3, might: 1 }),
        // Vengeance's Play.cost supplies the printed Power amount (2); the
        // object's domains select Order for that numeric requirement.
        { id: "vengeance", program: vengeance, types: ["spell"], zone: "hand", energy: 4, power: ["Order"] },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: HERE, might: 3 },
      ],
      answers: { "target:chosen-unit": ["enemy"] },
      operations: resolvePlay("vengeance"),
      expect: { objects: { neophyte: { might: 5 }, enemy: { zone: "trash" }, vengeance: { zone: "trash" } }, players: { A: { energy: 0, power: [] } }, events: { includes: [{ timingPoint: "object-killed", object: { ref: "enemy" } }] } },
    },
  },
];
for (const execution of defineTemplateSuite("RIFT-668 static|| blocked printed outcome", blockedRows)) {
  test(execution.name, { todo: "Shared engine dependency remains; printed expectation must execute before promotion" }, execution.run);
}
