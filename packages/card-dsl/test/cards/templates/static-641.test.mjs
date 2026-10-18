// RIFT-641: static|| is a structural grouping, not one executable effect.
// The harness accepts executable programs only. candidate() changes that gate
// for a test-local probe, preserving the original abilities and source text.
// Registration rejections and lifecycle-only cases are NOT whole-card evidence;
// all twelve published programs remain judge-required. Existing per-card
// primitive, cost-plan and Standard Move evidence is intentionally retained.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import bandleTree from "../../../dist/cards/ogn/bandle-tree.js";
import bilgewaterBully from "../../../dist/cards/ogn/bilgewater-bully.js";
import captainFarron from "../../../dist/cards/ogn/captain-farron.js";
import dravenShowboat from "../../../dist/cards/ogn/draven-showboat.js";
import heimerdingerInventor from "../../../dist/cards/ogn/heimerdinger-inventor.js";
import heraldOfScales from "../../../dist/cards/ogn/herald-of-scales.js";
import karthusEternal from "../../../dist/cards/ogn/karthus-eternal.js";
import noxusSaboteur from "../../../dist/cards/ogn/noxus-saboteur.js";
import rhasaTheSunderer from "../../../dist/cards/ogn/rhasa-the-sunderer.js";
import trifarianWarCamp from "../../../dist/cards/ogn/trifarian-war-camp.js";
import vilemawsLair from "../../../dist/cards/ogn/vilemaws-lair.js";
import voidGate from "../../../dist/cards/ogn/void-gate.js";
import blindMonk from "../../../dist/cards/ogn/blind-monk.js";
import flash from "../../../dist/cards/ogs/flash.js";

const here = { type: "battlefield", id: "static-641-here" };
const elsewhere = { type: "battlefield", id: "static-641-elsewhere" };
const source = (program, id, values) => ({
  id, cardId: program.canonicalCardId, zone: "board", owner: "A", controller: "A",
  location: here, ...values,
});
const battlefield = { types: ["battlefield"], energy: null, power: null, might: null };
const candidate = program => ({ ...program, status: "executable", judgeReason: undefined });

// One independently named row per assigned canonical card. bindingError means
// only fail-closed registration is tested, never that the printed effect ran.
const rows = [
  {
    name: "Bandle Tree — lifecycle only; no eligible Hidden card",
    canonicalCardId: "card.hash-5440d378426747276f389ce3e9731d1378a3a303a7309d785ef183114d2c326c",
    program: bandleTree,
    scenario: {
      objects: [
        source(bandleTree, "tree", battlefield),
        { id: "ordinary-card", types: ["unit"], zone: "hand", energy: 2, power: null },
      ],
      operations: [],
      expect: {
        objects: {
          tree: { zone: "board", ref: { zoneEntryId: 3 }, energy: null, power: null },
          "ordinary-card": { zone: "hand", faceDown: false, power: null },
        },
        players: { A: { handCount: 1 } },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Bilgewater Bully — buffed host gains the keyword; movement expansion pending",
    canonicalCardId: "card.hash-bfada85ea0485d763baf4f6d82594347175927b1b09ec1e1d976fce15710013e",
    program: bilgewaterBully,
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        source(bilgewaterBully, "bully", { types: ["unit"], energy: 6, power: null, might: 6, buffs: 0 }),
        { id: "buffed-ally", types: ["unit"], zone: "board", location: here, buffs: 1 },
        { id: "buffed-enemy", owner: "B", types: ["unit"], zone: "board", location: here, buffs: 1 },
        { id: "monk", program: blindMonk, types: ["legend"], zone: "board", location: { type: "base", player: "A" }, energy: null, power: null, might: null },
      ],
      answers: { "target:friendly-unit": ["bully"] },
      operations: [
        { type: "activate", object: "monk", player: "A" },
        { type: "pass", player: "A" }, { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          bully: { ref: { zoneEntryId: 3 }, buffs: 1, power: null, keywords: [{ id: "Ganking" }] },
          "buffed-ally": { keywords: [] },
          "buffed-enemy": { keywords: [] },
          monk: { zone: "board", exhausted: true },
        },
        players: { A: { energy: 0 } },
        events: { sequence: [
          { action: { type: "exhaust", object: "monk" } },
          { action: { type: "buff", object: "bully" } },
        ] },
        links: { "blind-monk.buff-friendly-unit.buffedCount": 1 },
      },
    },
  },
  {
    name: "Captain Farron — other-unit filter registration blocked",
    canonicalCardId: "card.hash-89422400a305aba2968956c639368704e17bca94d650b959b1c78453e5095fe2",
    program: captainFarron,
    bindingError: /^Static other anchor needs a dynamic relative filter$/,
    scenario: {
      objects: [
        source(captainFarron, "farron", { types: ["unit"], energy: 4, power: ["Fury"], might: 5 }),
        { id: "friendly-here", types: ["unit"], zone: "board", location: here },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: here },
        { id: "friendly-elsewhere", types: ["unit"], zone: "board", location: elsewhere },
      ],
      operations: [],
    },
    pendingExpect: { objects: {
      farron: { keywords: [] },
      "friendly-here": { keywords: [{ id: "Assault" }] },
      "enemy-here": { keywords: [] },
      "friendly-elsewhere": { keywords: [] },
    } },
  },
  {
    name: "Draven, Showboat — zero-point boundary only; dynamic amount pending",
    canonicalCardId: "card.hash-2fce7f4e1db0ed6a111d74a7702d3846593794a9cddf1a1722959543f53ec58e",
    program: dravenShowboat,
    scenario: {
      players: { A: { score: 0 }, B: { score: 4 } },
      objects: [source(dravenShowboat, "draven", { types: ["unit"], energy: 5, power: ["Fury"], might: 3 })],
      operations: [],
      expect: {
        objects: { draven: { ref: { zoneEntryId: 3 }, might: 3 } },
        players: { A: { score: 0 }, B: { score: 4 } },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Heimerdinger, Inventor — exhaust-ability grant registration blocked",
    canonicalCardId: "card.hash-b7190a8e16c22b4109edaa4eb5b9e4966b3c5224711d5cc7760f15b5a996bef4",
    program: heimerdingerInventor,
    bindingError: /^Static ability kind continuous\.grant-abilities has no layer mapping$/,
    scenario: {
      objects: [source(heimerdingerInventor, "heimer", { types: ["unit"], energy: 3, power: ["Mind"], might: 3 })],
      operations: [],
    },
  },
  {
    name: "Herald of Scales — Dragon cost-modification registration blocked",
    canonicalCardId: "card.hash-8f0ac98c17845f49a654e9543fdfa1946ec646cc7efc52fbd3395790fb4be660",
    program: heraldOfScales,
    bindingError: /^Static ability kind continuous\.cost-modification has no layer mapping$/,
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        source(heraldOfScales, "herald", { types: ["unit"], energy: 4, power: null, might: 3 }),
        { id: "dragon", types: ["unit"], tags: ["Dragon"], zone: "hand", energy: 6, power: null },
      ],
      operations: [],
    },
  },
  {
    name: "Karthus, Eternal — Deathknell trigger-set registration blocked",
    canonicalCardId: "card.hash-f3293211dd6f878acb245cc2cf0f2d2f2b066eed84ddbc009999e2176265a0ae",
    program: karthusEternal,
    bindingError: /^Unsupported static appliesTo \{"keyword":"Deathknell","controller":"controller","zone":"board"\}$/,
    scenario: {
      objects: [source(karthusEternal, "karthus", { types: ["unit"], energy: 3, power: ["Order"], might: 3 })],
      operations: [],
    },
  },
  {
    name: "Noxus Saboteur — Hidden characteristic registration blocked",
    canonicalCardId: "card.hash-e5d5e81a865437ba16c7a9dd066d67dc5f437867e4ec858ae5245045cc548caf",
    program: noxusSaboteur,
    bindingError: /^Unsupported static appliesTo \{"keyword":"Hidden","controller":"opponent","zone":"board","sameLocationAs":"self","characteristics":\{"faceDown":false\}\}$/,
    scenario: {
      objects: [
        source(noxusSaboteur, "saboteur", { types: ["unit"], energy: 3, power: null, might: 3 }),
        { id: "hidden-card", owner: "B", types: ["unit"], keywords: [{ id: "Hidden" }], zone: "board", location: here },
        { id: "facedown-card", owner: "B", types: ["unit"], faceDown: true, zone: "board", location: here },
      ],
      operations: [],
    },
  },
  {
    name: "Rhasa the Sunderer — trash-discount registration blocked",
    canonicalCardId: "card.hash-026fc6f43de0b92460fc9a27186ea0fb19fcaa6b9a6bfbb64fb1901c9425c852",
    program: rhasaTheSunderer,
    bindingError: /^Static ability kind continuous\.cost-modification has no layer mapping$/,
    scenario: {
      objects: [
        source(rhasaTheSunderer, "rhasa", { types: ["unit"], energy: 10, power: ["Chaos"], might: 6 }),
        { id: "own-trash", owner: "A", types: ["unit"], zone: "trash" },
        { id: "enemy-trash", owner: "B", types: ["unit"], zone: "trash" },
      ],
      operations: [],
    },
  },
  {
    name: "Trifarian War Camp — no units here boundary; local aura pending",
    canonicalCardId: "card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f",
    program: trifarianWarCamp,
    scenario: {
      objects: [
        source(trifarianWarCamp, "camp", battlefield),
        { id: "unit-elsewhere", types: ["unit"], zone: "board", location: elsewhere, might: 2 },
        { id: "enemy-at-base", owner: "B", types: ["unit"], zone: "board", location: { type: "base", player: "B" }, might: 5 },
      ],
      operations: [],
      expect: { objects: {
        camp: { ref: { zoneEntryId: 3 }, energy: null, power: null },
        "unit-elsewhere": { might: 2 },
        "enemy-at-base": { might: 5 },
      }, events: { exact: [] } },
    },
  },
  {
    name: "Vilemaw's Lair — no units here boundary; effect Move consumption pending",
    canonicalCardId: "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77",
    program: vilemawsLair,
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        source(vilemawsLair, "lair", battlefield),
        { id: "distant-unit", types: ["unit"], zone: "board", location: elsewhere },
        { id: "flash", program: flash, types: ["spell"], zone: "hand", energy: 2, power: null },
      ],
      answers: { "target:flash.friendly-units": ["distant-unit"] },
      operations: [
        { type: "play", object: "flash", player: "A" },
        { type: "pass", player: "A" }, { type: "pass", player: "B" },
      ],
      expect: { objects: {
        lair: { ref: { zoneEntryId: 3 }, energy: null, power: null },
        "distant-unit": { location: { type: "base", player: "A" }, movement: { restrictions: [] } },
        flash: { zone: "trash", power: null },
      }, players: { A: { energy: 0 } }, events: { includes: [{ action: { type: "move-location", object: "distant-unit" } }] } },
    },
  },
  {
    name: "Void Gate — Deal-action bonus grant registration blocked",
    canonicalCardId: "card.hash-914c78ed19d1829c8172e4fcce5b399b51f05e15d1a02fb7eaaaf64e7132bc08",
    program: voidGate,
    bindingError: /^Unsupported static appliesTo "deal-actions"$/,
    scenario: {
      objects: [
        source(voidGate, "gate", battlefield),
        { id: "victim", owner: "B", types: ["unit"], zone: "board", location: here, might: 5 },
      ],
      operations: [],
    },
  },
];

const rowFor = program => rows.find(row => row.canonicalCardId === program.canonicalCardId);
const probes = rows.map(row => ({ ...row, program: candidate(row.program) }));
for (const [index, golden] of defineTemplateSuite("RIFT-641 static probes", probes).entries()) {
  const row = rows[index];
  test(golden.name, () => {
    // The production gate stays closed, even for the passing partial probes.
    assert.equal(row.program.status, "judge-required");
    assert.ok(row.program.judgeReason?.trim());
    assert.equal(probes[index].program.abilities, row.program.abilities);
    assert.throws(() => runCardScenario(row.program, row.scenario), {
      message: `Scenario program ${row.canonicalCardId} is judge-required`,
    });
    if (row.bindingError) {
      assert.throws(golden.run, error => {
        assert.ok(error instanceof ProgramBindingError);
        assert.equal(error.code, "judge-required");
        assert.match(error.message, row.bindingError);
        return true;
      });
    } else {
      const result = golden.run();
      assert.deepEqual(result.state.chain, []);
    }
  });
}

// A second independent row covers the conditional passive's false branch.
for (const golden of defineTemplateSuite("RIFT-641 static condition boundary", [{
  name: "Bilgewater Bully — an unbuffed host gains no Ganking even beside a buffed unit",
  canonicalCardId: bilgewaterBully.canonicalCardId,
  program: candidate(bilgewaterBully),
  scenario: {
    objects: [
      source(bilgewaterBully, "unbuffed-bully", { types: ["unit"], energy: 6, power: null, might: 6, buffs: 0 }),
      { id: "buffed-neighbour", types: ["unit"], zone: "board", location: here, buffs: 1 },
    ],
    operations: [],
    expect: { objects: {
      "unbuffed-bully": { buffs: 0, keywords: [], power: null },
      "buffed-neighbour": { buffs: 1, keywords: [] },
    }, events: { exact: [] } },
  },
}])) test(golden.name, golden.run);

// Pending positive goldens assert the printed result, never the current wrong
// value. A TODO is not execution evidence and cannot justify status promotion.
for (const golden of defineTemplateSuite("RIFT-641 pending positive static goldens", [
  {
    name: "Draven, Showboat — controller's three points add three Might",
    canonicalCardId: dravenShowboat.canonicalCardId,
    program: candidate(dravenShowboat),
    scenario: {
      players: { A: { score: 3 }, B: { score: 7 } },
      objects: [source(dravenShowboat, "draven", { types: ["unit"], energy: 5, power: ["Fury"], might: 3 })],
      operations: [],
      expect: { objects: { draven: { might: 6 } } },
    },
  },
  {
    name: "Trifarian War Camp — both controllers' units here gain one Might",
    canonicalCardId: trifarianWarCamp.canonicalCardId,
    program: candidate(trifarianWarCamp),
    scenario: {
      objects: [
        source(trifarianWarCamp, "camp", battlefield),
        { id: "friendly-here", types: ["unit"], zone: "board", location: { ...here }, might: 2 },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: { ...here }, might: 5 },
        { id: "elsewhere", types: ["unit"], zone: "board", location: elsewhere, might: 4 },
      ],
      operations: [],
      expect: { objects: {
        "friendly-here": { might: 3 }, "enemy-here": { might: 6 }, elsewhere: { might: 4 },
      } },
    },
  },
  {
    name: "Captain Farron — grant registered Assault only to other friendly units here",
    canonicalCardId: captainFarron.canonicalCardId,
    program: candidate(captainFarron),
    scenario: {
      ...rowFor(captainFarron).scenario,
      expect: rowFor(captainFarron).pendingExpect,
    },
  },
  {
    name: "Vilemaw's Lair — Flash cannot move a unit from here to base",
    canonicalCardId: vilemawsLair.canonicalCardId,
    program: candidate(vilemawsLair),
    scenario: {
      ...rowFor(vilemawsLair).scenario,
      objects: rowFor(vilemawsLair).scenario.objects.map(object => object.id === "distant-unit" ? { ...object, location: { ...here } } : object),
      expect: {
        objects: { "distant-unit": { location: here }, flash: { zone: "trash", power: null } },
        players: { A: { energy: 0 } },
      },
    },
  },
])) test(golden.name, { todo: rows.find(row => row.canonicalCardId === golden.canonicalCardId).program.judgeReason }, golden.run);

// Keep the printed null expectation as a pending harness regression rather than
// accepting TestWorld.defaultObject's current null -> 1 Might coercion.
for (const golden of defineTemplateSuite("RIFT-641 pending null Might preservation", [
  { name: "Bandle Tree", canonicalCardId: bandleTree.canonicalCardId, program: candidate(bandleTree), scenario: {
    objects: [source(bandleTree, "tree", battlefield)], operations: [],
    expect: { objects: { tree: { energy: null, power: null, might: null } } },
  } },
  { name: "Trifarian War Camp", canonicalCardId: trifarianWarCamp.canonicalCardId, program: candidate(trifarianWarCamp), scenario: {
    objects: [source(trifarianWarCamp, "camp", battlefield)], operations: [],
    expect: { objects: { camp: { energy: null, power: null, might: null } } },
  } },
])) test(golden.name, { todo: "engine-core testing/test-kernel.ts defaultObject must preserve printed null Might" }, golden.run);
