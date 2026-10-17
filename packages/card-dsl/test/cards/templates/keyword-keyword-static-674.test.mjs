// RIFT-674 template golden: keyword + keyword + static.
//
// Each card keeps its own scenario row and assertion. The scenario harness is
// run with an executable probe so that the merged play/payment/keyword/static
// path is exercised even while the card's unsupported clause remains explicitly
// judge-required in the card program. The declared program and its judge reason
// are checked independently for every row.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const TARIC = "card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f";
const YORDLE = "card.hash-fd21f689bd36e48ea3071e7d21c1fa68fd1527e85ca97ffd9052664f6aaba7de";
const ORNN = "card.hash-d608aa993147100b60121de9bd89000a5f21f0b389c96138c079609d8ffa4004";
const REKSAI = "card.hash-6eb6345b70c561ae3d2ed335eb50fdd0958d942af912aaceba44ad0038813815";
const RENGAR = "card.hash-11c2deae61a7e5098515aef9a7b5595b0b6430fc0efebc22147404611ccebbc9";

function executableProbe(canonicalCardId) {
  const program = cardProgramsById.get(canonicalCardId);
  assert.ok(program, `generated card program ${canonicalCardId} is present`);
  return { ...program, status: "executable", judgeReason: undefined };
}

const definitions = [
  {
    name: "Taric, Protector — play at a battlefield and leave the blocked Shield aura fail-closed",
    canonicalCardId: TARIC,
    program: executableProbe(TARIC),
    scenario: {
      players: { A: { energy: 10, power: ["Calm"] }, B: {} },
      objects: [
        { id: "taric", cardId: TARIC, types: ["unit"], zone: "hand", energy: 4, power: ["Calm"], might: 4 },
        { id: "ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
        { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      operations: [{ type: "play", object: "taric", player: "A", location: { type: "battlefield", id: "bf-1" } }],
      expect: {
        objects: {
          taric: { zone: "board", location: { type: "battlefield", id: "bf-1" }, exhausted: true, damage: 0 },
          ally: { might: 2 },
          enemy: { might: 2 },
        },
        players: { A: { energy: 6 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-battlefield" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /Tank/);
      assert.match(program.judgeReason, /designation/);
      assert.match(program.judgeReason, /exclude/);
    },
  },
  {
    name: "Needlessly Large Yordle — pay the printed cost when no holding discount exists",
    canonicalCardId: YORDLE,
    program: executableProbe(YORDLE),
    scenario: {
      players: { A: { energy: 10, power: ["Calm", "Calm", "Calm"] }, B: {} },
      objects: [
        { id: "yordle", cardId: YORDLE, types: ["unit"], zone: "hand", energy: 10, power: ["Calm", "Calm", "Calm"], might: 5 },
      ],
      operations: [{ type: "play", object: "yordle", player: "A" }],
      expect: {
        objects: { yordle: { zone: "board", location: { type: "base", player: "A" }, exhausted: true, might: 5 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-base" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /continuous\.cost-modification/);
      assert.match(program.judgeReason, /designation/);
      assert.match(program.judgeReason, /continuous\.combat/);
    },
  },
  {
    name: "Ornn, Forge God — play with friendly gear while the count and Weaponmaster attachment stay blocked",
    canonicalCardId: ORNN,
    program: executableProbe(ORNN),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [
        { id: "ornn", cardId: ORNN, types: ["unit"], zone: "hand", energy: 6, power: [], might: 4 },
        { id: "gear-a", owner: "A", controller: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" } },
        { id: "gear-b", owner: "A", controller: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" } },
      ],
      operations: [{ type: "play", object: "ornn", player: "A" }],
      expect: {
        objects: {
          ornn: { zone: "board", location: { type: "base", player: "A" }, exhausted: true, might: 4, buffs: 0 },
          "gear-a": { zone: "board" },
          "gear-b": { zone: "board" },
        },
        players: { A: { energy: 4 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "chain-item-resolve" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /target\.tax/);
      assert.match(program.judgeReason, /Weaponmaster/);
      assert.match(program.judgeReason, /count 表达式/);
    },
  },
  {
    name: "Rek'Sai, Breacher — pay the base cost and enter the base with printed Might",
    canonicalCardId: REKSAI,
    program: executableProbe(REKSAI),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [
        { id: "reksai", cardId: REKSAI, types: ["unit"], zone: "hand", energy: 3, power: [], might: 3 },
      ],
      operations: [{ type: "play", object: "reksai", player: "A" }],
      expect: {
        objects: { reksai: { zone: "board", location: { type: "base", player: "A" }, might: 3 } },
        players: { A: { energy: 7 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-base" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /playedFromZoneNot/);
      assert.match(program.judgeReason, /accelerate\.cost/);
      assert.match(program.judgeReason, /designation/);
    },
  },
  {
    name: "Rengar, Pouncing — Reaction play pays Fury and lands at base without Assault bonus",
    canonicalCardId: RENGAR,
    program: executableProbe(RENGAR),
    scenario: {
      players: { A: { energy: 10, power: ["Fury"] }, B: {} },
      objects: [
        { id: "rengar", cardId: RENGAR, types: ["unit"], zone: "hand", energy: 3, power: ["Fury"], might: 3 },
      ],
      operations: [{ type: "play", object: "rengar", player: "A" }],
      expect: {
        objects: { rengar: { zone: "board", location: { type: "base", player: "A" }, exhausted: true, might: 3, damage: 0 } },
        players: { A: { energy: 7 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-base" }] },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /play-location-permission/);
      assert.match(program.judgeReason, /designation/);
    },
  },
  {
    name: "Taric, Protector — boundary: insufficient Energy negates the play",
    canonicalCardId: TARIC,
    program: executableProbe(TARIC),
    scenario: {
      players: { A: { energy: 2, power: ["Calm"] }, B: {} },
      objects: [{ id: "taric", cardId: TARIC, types: ["unit"], zone: "hand", energy: 4, power: ["Calm"], might: 4 }],
      operations: [{ type: "play", object: "taric", player: "A", location: { type: "battlefield", id: "bf-1" } }],
    },
    expectedFailure: /insufficient Energy/,
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    name: "Needlessly Large Yordle — boundary: no holding discount can cover a one-energy shortfall",
    canonicalCardId: YORDLE,
    program: executableProbe(YORDLE),
    scenario: {
      players: { A: { energy: 9, power: ["Calm", "Calm", "Calm"] }, B: {} },
      objects: [{ id: "yordle", cardId: YORDLE, types: ["unit"], zone: "hand", energy: 10, power: ["Calm", "Calm", "Calm"], might: 5 }],
      operations: [{ type: "play", object: "yordle", player: "A" }],
    },
    expectedFailure: /insufficient Energy/,
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    name: "Ornn, Forge God — boundary: no friendly Equipment leaves Weaponmaster without a legal target",
    canonicalCardId: ORNN,
    program: executableProbe(ORNN),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [
        { id: "ornn", cardId: ORNN, types: ["unit"], zone: "hand", energy: 6, power: [], might: 4 },
        { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      operations: [{ type: "play", object: "ornn", player: "A" }],
      expect: {
        objects: {
          ornn: { zone: "board", location: { type: "base", player: "A" } },
          enemy: { zone: "board", damage: 0 },
        },
        players: { A: { energy: 4 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    name: "Rek'Sai, Breacher — boundary: insufficient Energy negates the base play before Accelerate can be chosen",
    canonicalCardId: REKSAI,
    program: executableProbe(REKSAI),
    scenario: {
      players: { A: { energy: 2 }, B: {} },
      objects: [{ id: "reksai", cardId: REKSAI, types: ["unit"], zone: "hand", energy: 3, power: [], might: 3 }],
      operations: [{ type: "play", object: "reksai", player: "A" }],
    },
    expectedFailure: /insufficient Energy/,
    declared: program => assert.equal(program.status, "judge-required"),
  },
  {
    name: "Rengar, Pouncing — boundary: no Fury Power makes the printed cost unpayable",
    canonicalCardId: RENGAR,
    program: executableProbe(RENGAR),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [{ id: "rengar", cardId: RENGAR, types: ["unit"], zone: "hand", energy: 3, power: ["Fury"], might: 3 }],
      operations: [{ type: "play", object: "rengar", player: "A" }],
    },
    expectedFailure: /insufficient matching Power/,
    declared: program => assert.equal(program.status, "judge-required"),
  },
];

const templateCases = defineTemplateSuite(
  "RIFT-674 keyword+keyword+static",
  definitions.map(definition => ({
    name: definition.name,
    canonicalCardId: definition.canonicalCardId,
    program: definition.program,
    scenario: definition.scenario,
  })),
);

for (const [index, templateCase] of templateCases.entries()) {
  test(templateCase.name, () => {
    const definition = definitions[index];
    const declared = cardProgramsById.get(templateCase.canonicalCardId);
    assert.ok(declared, `generated program ${templateCase.canonicalCardId} is present`);
    definition.declared(declared);
    if (definition.expectedFailure) {
      assert.throws(templateCase.run, definition.expectedFailure);
      return;
    }
    templateCase.run();
  });
}
