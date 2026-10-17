// RIFT-666: template-level golden for the twelve OGN cards whose IR signature
// is `static||` (ability kind | trigger point | instruction sequence).
//
// Each card has its own row and expectation. The test-only executable view
// keeps the published status guard intact: a row is execution evidence only
// for the supported portion, and an exact production binder rejection keeps
// the card judge-required when a static consumer is still missing.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

import bandleTree from "../../../dist/cards/ogn/bandle-tree.js";
import bilgewaterBully from "../../../dist/cards/ogn/bilgewater-bully.js";
import captainFarron from "../../../dist/cards/ogn/captain-farron.js";
import dravenShowboat from "../../../dist/cards/ogn/draven-showboat.js";
import eagerApprentice from "../../../dist/cards/ogn/eager-apprentice.js";
import fioraVictorious from "../../../dist/cards/ogn/fiora-victorious.js";
import heimerdingerInventor from "../../../dist/cards/ogn/heimerdinger-inventor.js";
import heraldOfScales from "../../../dist/cards/ogn/herald-of-scales.js";
import karthusEternal from "../../../dist/cards/ogn/karthus-eternal.js";
import noxusSaboteur from "../../../dist/cards/ogn/noxus-saboteur.js";
import rhasaTheSunderer from "../../../dist/cards/ogn/rhasa-the-sunderer.js";
import sneakyDeckhand from "../../../dist/cards/ogn/sneaky-deckhand.js";

const HERE = { type: "battlefield", id: "rift-666-here" };
const OTHER = { type: "battlefield", id: "rift-666-other" };

const sourcePrograms = new Map();
const executableView = program => {
  sourcePrograms.set(program.canonicalCardId, program);
  return { ...program, status: "executable", judgeReason: undefined };
};
const boardObject = (program, id, values = {}) => ({
  id,
  cardId: program.canonicalCardId,
  owner: "A",
  controller: "A",
  zone: "board",
  location: HERE,
  ...values,
});

function assertPublishedGuard(row) {
  const published = sourcePrograms.get(row.canonicalCardId);
  assert.equal(published.canonicalCardId, row.canonicalCardId);
  assert.equal(published.status, "judge-required");
  assert.ok(published.judgeReason?.trim(), `${row.canonicalCardId} needs a concrete judgeReason`);
}

function assertBindingError(result, row) {
  const host = result.state.objects.find(object => object.cardId === row.canonicalCardId);
  assert.ok(host, "the source object must reach the scenario state");
  const engine = fixture({ cards: [] }).engine;
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(sourcePrograms.get(row.canonicalCardId).abilities[0], host),
    error => {
      assert.ok(error instanceof ProgramBindingError);
      assert.equal(error.code, "judge-required");
      assert.match(error.message, row.bindingError);
      return true;
    },
  );
  assert.deepEqual(engine.layers.registry.list(), []);
}

const rows = [
  {
    name: "Bandle Tree — ordinary hand card leaves the extra facedown slot unused",
    canonicalCardId: bandleTree.canonicalCardId,
    program: executableView(bandleTree),
    scenario: {
      objects: [
        boardObject(bandleTree, "tree", { types: ["battlefield"], energy: null, power: null, might: null }),
        { id: "ordinary-card", owner: "A", types: ["unit"], zone: "hand", energy: 2, power: null },
      ],
      operations: [],
      expect: {
        objects: {
          tree: { zone: "board", energy: null, power: null },
          "ordinary-card": { zone: "hand", faceDown: false, power: null },
        },
        players: { A: { handCount: 1 } },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Bilgewater Bully — a buffed host gains Ganking through the static layer",
    canonicalCardId: bilgewaterBully.canonicalCardId,
    program: executableView(bilgewaterBully),
    scenario: {
      objects: [boardObject(bilgewaterBully, "bully", { types: ["unit"], energy: 6, power: null, might: 6, buffs: 1 })],
      operations: [],
      expect: { objects: { bully: { zone: "board", buffs: 1, keywords: [{ id: "Ganking" }] } }, events: { exact: [] } },
    },
  },
  {
    name: "Captain Farron — dynamic other-friendly filter is rejected fail-closed",
    canonicalCardId: captainFarron.canonicalCardId,
    program: executableView(captainFarron),
    bindingError: /^Static other anchor needs a dynamic relative filter$/,
    scenario: {
      objects: [
        boardObject(captainFarron, "farron", { types: ["unit"], energy: 4, power: ["Fury"], might: 5 }),
        { id: "friendly-here", owner: "A", types: ["unit"], zone: "board", location: HERE },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: HERE },
        { id: "friendly-other", owner: "A", types: ["unit"], zone: "board", location: OTHER },
      ],
      operations: [],
      expect: {
        objects: {
          farron: { zone: "board", keywords: [] },
          "friendly-here": { keywords: [] },
          "enemy-here": { keywords: [] },
          "friendly-other": { keywords: [] },
        },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Draven, Showboat — zero points preserve printed Might while the dynamic amount is unavailable",
    canonicalCardId: dravenShowboat.canonicalCardId,
    program: executableView(dravenShowboat),
    scenario: {
      players: { A: { score: 0 } },
      objects: [boardObject(dravenShowboat, "draven", { types: ["unit"], energy: 5, power: ["Fury"], might: 3 })],
      operations: [],
      expect: { objects: { draven: { zone: "board", might: 3 } }, players: { A: { score: 0 } }, events: { exact: [] } },
    },
  },
  {
    name: "Eager Apprentice — spell discount cannot enter Finalize from the static binder",
    canonicalCardId: eagerApprentice.canonicalCardId,
    program: executableView(eagerApprentice),
    bindingError: /^Unsupported static appliesTo \{"type":"spell","controller":"controller"\}$/,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        boardObject(eagerApprentice, "apprentice", { types: ["unit"], energy: 3, power: null, might: 3 }),
        { id: "spell", owner: "A", types: ["spell"], zone: "hand", energy: 2, power: null },
      ],
      operations: [],
      expect: { objects: { apprentice: { zone: "board" }, spell: { zone: "hand", power: null } }, players: { A: { energy: 3 } }, events: { exact: [] } },
    },
  },
  {
    name: "Fiora, Victorious — Mighty host receives the three declared keywords",
    canonicalCardId: fioraVictorious.canonicalCardId,
    program: executableView(fioraVictorious),
    scenario: {
      objects: [boardObject(fioraVictorious, "fiora", { types: ["unit"], energy: 4, power: null, might: 5 })],
      operations: [],
      expect: {
        objects: {
          fiora: {
            zone: "board",
            might: 5,
            keywords: [{ id: "Deflect", value: 1 }, { id: "Ganking" }, { id: "Shield", value: 1 }],
          },
        },
        events: { exact: [] },
      },
    },
  },
  {
    name: "Heimerdinger, Inventor — copied exhaust abilities have no layer consumer",
    canonicalCardId: heimerdingerInventor.canonicalCardId,
    program: executableView(heimerdingerInventor),
    bindingError: /^Static ability kind continuous\.grant-abilities has no layer mapping$/,
    scenario: {
      objects: [
        boardObject(heimerdingerInventor, "heimer", { types: ["unit"], energy: 3, power: ["Mind"], might: 3 }),
        { id: "legend", owner: "A", types: ["legend"], zone: "board", location: HERE },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: HERE },
        { id: "gear", owner: "A", types: ["gear"], zone: "board", location: HERE },
      ],
      operations: [],
      expect: { objects: { heimer: { zone: "board" }, legend: { zone: "board" }, ally: { zone: "board" }, gear: { zone: "board" } }, events: { exact: [] } },
    },
  },
  {
    name: "Herald of Scales — Dragon discount remains outside the static layer",
    canonicalCardId: heraldOfScales.canonicalCardId,
    program: executableView(heraldOfScales),
    bindingError: /^Static ability kind continuous\.cost-modification has no layer mapping$/,
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        boardObject(heraldOfScales, "herald", { types: ["unit"], energy: 4, power: null, might: 3 }),
        { id: "dragon", owner: "A", types: ["unit"], tags: ["Dragon"], zone: "hand", energy: 6, power: null },
      ],
      operations: [],
      expect: { objects: { herald: { zone: "board" }, dragon: { zone: "hand", power: null } }, players: { A: { energy: 6 } }, events: { exact: [] } },
    },
  },
  {
    name: "Karthus, Eternal — Deathknell multiplicity has no target-set layer consumer",
    canonicalCardId: karthusEternal.canonicalCardId,
    program: executableView(karthusEternal),
    bindingError: /^Unsupported static appliesTo \{"keyword":"Deathknell","controller":"controller","zone":"board"\}$/,
    scenario: {
      objects: [
        boardObject(karthusEternal, "karthus", { types: ["unit"], energy: 3, power: ["Order"], might: 3 }),
        { id: "deathknell", owner: "A", types: ["unit"], zone: "board", location: HERE },
      ],
      operations: [],
      expect: { objects: { karthus: { zone: "board" }, deathknell: { zone: "board" } }, events: { exact: [] } },
    },
  },
  {
    name: "Noxus Saboteur — opponent Hidden reveal prohibition is rejected fail-closed",
    canonicalCardId: noxusSaboteur.canonicalCardId,
    program: executableView(noxusSaboteur),
    bindingError: /^Unsupported static appliesTo \{"keyword":"Hidden","controller":"opponent","zone":"board","sameLocationAs":"self","characteristics":\{"faceDown":false\}\}$/,
    scenario: {
      objects: [
        boardObject(noxusSaboteur, "saboteur", { types: ["unit"], energy: 3, power: null, might: 3 }),
        { id: "hidden", owner: "B", types: ["unit"], zone: "board", location: HERE, keywords: [{ id: "Hidden" }] },
        { id: "facedown", owner: "B", types: ["unit"], zone: "board", location: HERE, faceDown: true },
      ],
      operations: [],
      expect: { objects: { saboteur: { zone: "board" }, hidden: { keywords: [{ id: "Hidden" }] }, facedown: { faceDown: true } }, events: { exact: [] } },
    },
  },
  {
    name: "Rhasa the Sunderer — trash count is retained in IR but not collected into Finalize",
    canonicalCardId: rhasaTheSunderer.canonicalCardId,
    program: executableView(rhasaTheSunderer),
    bindingError: /^Static ability kind continuous\.cost-modification has no layer mapping$/,
    scenario: {
      objects: [
        boardObject(rhasaTheSunderer, "rhasa", { types: ["unit"], energy: 10, power: ["Chaos"], might: 6 }),
        { id: "own-trash", owner: "A", types: ["unit"], zone: "trash" },
        { id: "enemy-trash", owner: "B", types: ["unit"], zone: "trash" },
      ],
      operations: [],
      expect: { objects: { rhasa: { zone: "board" }, "own-trash": { zone: "trash" }, "enemy-trash": { zone: "trash" } }, events: { exact: [] } },
    },
  },
  {
    name: "Sneaky Deckhand — open-battlefield permission has no static location mapping",
    canonicalCardId: sneakyDeckhand.canonicalCardId,
    program: executableView(sneakyDeckhand),
    bindingError: /^Static ability kind play-location-permission has no layer mapping$/,
    scenario: {
      objects: [
        { id: "deckhand", cardId: sneakyDeckhand.canonicalCardId, owner: "A", controller: "A", types: ["unit"], zone: "hand", energy: 3, power: null, might: 2 },
        { id: "open-battlefield", owner: "A", types: ["battlefield"], zone: "board", location: OTHER, energy: null, power: null, might: null },
      ],
      operations: [],
      expect: { objects: { deckhand: { zone: "hand", power: null }, "open-battlefield": { zone: "board", energy: null, power: null } }, events: { exact: [] } },
    },
  },
];

for (const golden of defineTemplateSuite("RIFT-666 static||", rows)) {
  test(golden.name, () => {
    const row = rows.find(candidate => candidate.canonicalCardId === golden.canonicalCardId);
    assert.ok(row);
    assertPublishedGuard(row);
    const result = golden.run();
    if (row.bindingError) assertBindingError(result, row);
  });
}

for (const golden of defineTemplateSuite("RIFT-666 static|| condition boundary", [
  {
    name: "Bilgewater Bully — an unbuffed host gains no Ganking",
    canonicalCardId: bilgewaterBully.canonicalCardId,
    program: executableView(bilgewaterBully),
    scenario: {
      objects: [
        boardObject(bilgewaterBully, "unbuffed-bully", { types: ["unit"], energy: 6, power: null, might: 6, buffs: 0 }),
        { id: "buffed-neighbour", owner: "A", types: ["unit"], zone: "board", location: HERE, buffs: 1 },
      ],
      operations: [],
      expect: { objects: { "unbuffed-bully": { buffs: 0, keywords: [] }, "buffed-neighbour": { buffs: 1, keywords: [] } }, events: { exact: [] } },
    },
  },
  {
    name: "Fiora, Victorious — a four-Might host is not Mighty",
    canonicalCardId: fioraVictorious.canonicalCardId,
    program: executableView(fioraVictorious),
    scenario: {
      objects: [boardObject(fioraVictorious, "not-mighty", { types: ["unit"], energy: 4, power: null, might: 4 })],
      operations: [],
      expect: { objects: { "not-mighty": { might: 4, keywords: [] } }, events: { exact: [] } },
    },
  },
])) test(golden.name, () => {
  const row = golden.canonicalCardId === bilgewaterBully.canonicalCardId
    ? { program: bilgewaterBully }
    : { program: fioraVictorious };
  assert.equal(row.program.status, "judge-required");
  golden.run();
});
