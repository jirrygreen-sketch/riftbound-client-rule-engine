// README 4.1 / RIFT-700: one independent scenario row per card.
// The four programs share keyword + board-entry replacement + effect.ready IR.
// Candidate metadata is used only to exercise the supported entry path; the
// published programs remain judge-required until their other abilities and
// conditional replacement gates have real consumers.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import masterYi from "../../../dist/cards/ogs/master-yi-honed.js";
import xinZhao from "../../../dist/cards/sfd/xin-zhao-vigilant.js";
import bandleSoldier from "../../../dist/cards/unl/bandle-soldier.js";
import toweringPairofant from "../../../dist/cards/unl/towering-pairofant.js";
import cloudDrake from "../../../dist/cards/ven/cloud-drake.js";
import hextechRay from "../../../dist/cards/ogn/hextech-ray.js";

const baseA = { type: "base", player: "A" };
const battlefield = { type: "battlefield", id: "bf-700" };

function candidate(program) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim());
  return { ...program, status: "executable", judgeReason: undefined };
}

const rows = [
  {
    name: "Master Yi, Honed: paid entry replaces exhausted with ready",
    canonicalCardId: "card.hash-65cd9565fff10c8779998a9b1ca3843ab54b34a3cc338af891157cfbf9ec1761",
    program: masterYi,
    scenario: {
      players: { A: { energy: 7, power: ["Body"] } },
      objects: [
        { id: "yi", cardId: masterYi.canonicalCardId, types: ["unit"], tags: ["Master Yi", "Ionia", "Champion"], zone: "hand", energy: 7, power: ["Body"], might: 6 },
        { id: "ally", types: ["unit"], zone: "board", location: baseA, might: 2, exhausted: true },
      ],
      operations: [{ type: "play", object: "yi", player: "A" }],
      expect: {
        objects: {
          yi: { zone: "board", location: baseA, exhausted: false, might: 6, damage: 0 },
          ally: { zone: "board", exhausted: true, might: 2 },
        },
        players: { A: { energy: 0, handSize: 0 } },
        events: { sequence: [
          { timingPoint: "object-enters-chain", object: { ref: "yi" } },
          { timingPoint: "object-enters-board", object: { ref: "yi", exhausted: false } },
          { timingPoint: "card-played", object: { ref: "yi" } },
        ] },
      },
    },
  },
  {
    name: "Xin Zhao, Vigilant: two other friendly base units reach the ready-entry path",
    canonicalCardId: "card.hash-74a101bf90abcf30478ceacbdf6a254627d4b912349d7ed3b6a76591368936a8",
    program: xinZhao,
    scenario: {
      players: { A: { energy: 3, power: ["Order"] } },
      objects: [
        { id: "xin", cardId: xinZhao.canonicalCardId, types: ["unit"], tags: ["Demacia", "Xin Zhao", "Champion"], zone: "hand", energy: 3, power: ["Order"], might: 4 },
        { id: "base-ally-1", types: ["unit"], zone: "board", location: baseA, might: 2, exhausted: true },
        { id: "base-ally-2", types: ["unit"], zone: "board", location: baseA, might: 3 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: { type: "base", player: "B" }, might: 3 },
      ],
      operations: [{ type: "play", object: "xin", player: "A" }],
      expect: {
        objects: {
          xin: { zone: "board", location: baseA, exhausted: false, might: 4 },
          "base-ally-1": { zone: "board", exhausted: true, might: 2 },
          "base-ally-2": { zone: "board", exhausted: false, might: 3 },
          enemy: { controller: "B", might: 3 },
        },
        players: { A: { energy: 0, handSize: 0 } },
        events: { sequence: [
          { timingPoint: "object-enters-chain", object: { ref: "xin" } },
          { timingPoint: "object-enters-board", object: { ref: "xin", exhausted: false } },
          { timingPoint: "card-played", object: { ref: "xin" } },
        ] },
      },
    },
  },
  {
    name: "Bandle Soldier: the ready-entry body executes on the 3-XP path",
    canonicalCardId: "card.hash-121fc6b958b52f3a54986facd825169683558bc6c00ae71fbb3323be8b3a1f7c",
    program: bandleSoldier,
    scenario: {
      players: { A: { energy: 4, power: ["Order"], xp: 3 } },
      objects: [
        { id: "soldier", cardId: bandleSoldier.canonicalCardId, types: ["unit"], tags: ["Yordle", "Bandle City"], zone: "hand", energy: 4, power: ["Order"], might: 5 },
      ],
      operations: [{ type: "play", object: "soldier", player: "A" }],
      expect: {
        objects: { soldier: { zone: "board", location: baseA, exhausted: false, might: 5 } },
        players: { A: { energy: 0, xp: 3, handSize: 0 } },
        events: { sequence: [
          { timingPoint: "object-enters-chain", object: { ref: "soldier" } },
          { timingPoint: "object-enters-board", object: { ref: "soldier", exhausted: false } },
          { timingPoint: "card-played", object: { ref: "soldier" } },
        ] },
      },
    },
  },
  {
    name: "Towering Pairofant: a real kill event enables ready entry and keeps power null",
    canonicalCardId: "card.hash-236b348b03423e44bd4951c615315452d5da4f0e0be98b47ebafeddb51fe1f8a",
    program: toweringPairofant,
    scenario: {
      players: { A: { energy: 7, power: ["Fury"] } },
      objects: [
        { id: "pairofant", cardId: toweringPairofant.canonicalCardId, types: ["unit"], tags: ["Shurima"], zone: "hand", energy: 6, power: null, might: 6 },
        { id: "ray", program: hextechRay, types: ["spell"], zone: "hand", energy: 1, power: ["Fury"], might: null },
        { id: "victim", owner: "B", types: ["unit"], zone: "board", location: battlefield, might: 3 },
      ],
      answers: { "target:hextech-ray.unit-at-battlefield": ["victim"] },
      operations: [
        { type: "play", object: "ray", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
        { type: "play", object: "pairofant", player: "A" },
      ],
      expect: {
        objects: {
          pairofant: { zone: "board", location: baseA, exhausted: false, energy: 6, power: null, might: 6 },
          ray: { zone: "trash" },
          victim: { zone: "trash", controller: "B" },
        },
        players: { A: { energy: 0, handSize: 0 } },
        events: { sequence: [
          { timingPoint: "damage-dealt", object: { ref: "victim" }, action: { type: "damage", target: "victim", amount: 3 } },
          { timingPoint: "object-killed", object: { ref: "victim" }, action: { type: "kill", object: "victim" } },
          { timingPoint: "object-enters-chain", object: { ref: "pairofant" } },
          { timingPoint: "object-enters-board", object: { ref: "pairofant", exhausted: false } },
          { timingPoint: "card-played", object: { ref: "pairofant" } },
        ] },
      },
    },
  },
];

for (const row of defineTemplateSuite("RIFT-700 keyword+replacement||effect.ready", rows.map(row => ({ ...row, program: candidate(row.program) })))) {
  test(row.name, () => {
    const result = row.run();
    assert.deepEqual(result.state.chain, []);
    // CR 369.3 / 805.6.a: the entry state is replaced before Board entry.
    assert.equal(result.events.some(event => event.timingPoint === "object-readied"), false);
  });
}

const [yiRow, xinRow, soldierRow, pairofantRow] = rows;

const boundaryRows = [
  {
    ...yiRow,
    name: "Master Yi, Honed boundary: another unit does not inherit the self replacement",
    scenario: {
      players: { A: { energy: 13, power: ["Body"] } },
      objects: [
        yiRow.scenario.objects[0],
        { id: "other", program: cloudDrake, types: ["unit"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "top", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "yi", player: "A" },
        { type: "play", object: "other", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          yi: { zone: "board", exhausted: false },
          other: { zone: "board", exhausted: true },
          top: { zone: "hand" },
        },
      },
    },
  },
  {
    ...xinRow,
    name: "Xin Zhao, Vigilant boundary: fewer than two other base units must stay exhausted",
    blocked: "RIFT-260: replacement/bind.ts still skips ability.condition and keeps the registration-time host reference",
    scenario: {
      players: { A: { energy: 3, power: ["Order"] } },
      objects: [xinRow.scenario.objects[0]],
      operations: [{ type: "play", object: "xin", player: "A" }],
      expect: { objects: { xin: { zone: "board", location: baseA, exhausted: true, might: 4 } }, players: { A: { energy: 0 } } },
    },
  },
  {
    ...soldierRow,
    name: "Bandle Soldier boundary: 0 XP must leave the dependent entry inactive",
    blocked: "RIFT-268/258/259 and RIFT-260: controller XP and dependent replacement conditions are not evaluated",
    scenario: {
      players: { A: { energy: 4, power: ["Order"], xp: 0 } },
      objects: [soldierRow.scenario.objects[0]],
      operations: [{ type: "play", object: "soldier", player: "A" }],
      expect: { objects: { soldier: { zone: "board", location: baseA, exhausted: true, might: 5 } }, players: { A: { energy: 0, xp: 0 } } },
    },
  },
  {
    ...pairofantRow,
    name: "Towering Pairofant boundary: without a unit death the entry stays exhausted",
    blocked: "RIFT-260: replacement conditions need a turn-scoped unit-death history predicate",
    scenario: {
      players: { A: { energy: 6 } },
      objects: [pairofantRow.scenario.objects[0]],
      operations: [{ type: "play", object: "pairofant", player: "A" }],
      expect: { objects: { pairofant: { zone: "board", location: baseA, exhausted: true, power: null, might: 6 } }, players: { A: { energy: 0 } } },
    },
  },
];

for (const [index, row] of defineTemplateSuite(
  "RIFT-700 keyword+replacement||effect.ready boundaries",
  boundaryRows.map(row => ({ ...row, program: candidate(row.program) }))
).entries()) {
  const source = boundaryRows[index];
  test(row.name, source.blocked ? { todo: source.blocked } : {}, row.run);
}

for (const row of rows) {
  test(`RIFT-700 published status remains judge-required: ${row.name} [${row.canonicalCardId}]`, () => {
    assert.equal(row.program.status, "judge-required");
    assert.ok(row.program.judgeReason?.trim());
  });
}
