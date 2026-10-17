// README 4.1 / RIFT-678: one independent row per printed card.
// Only the test copy's status metadata changes to enter the executable-only
// harness. Abilities, conditions, sourceText and canonical identity stay intact.
// These partial entry scenarios do not certify Ganking, Tank, Level or Assault.
// Unsupported boundaries run with printed expectations under TODO; incorrect
// ready entry is never accepted as the expected behavior.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import masterYi from "../../../dist/cards/ogs/master-yi-honed.js";
import xinZhao from "../../../dist/cards/sfd/xin-zhao-vigilant.js";
import bandleSoldier from "../../../dist/cards/unl/bandle-soldier.js";
import toweringPairofant from "../../../dist/cards/unl/towering-pairofant.js";
import cloudDrake from "../../../dist/cards/ven/cloud-drake.js";
import hextechRay from "../../../dist/cards/ogn/hextech-ray.js";

const baseA = { type: "base", player: "A" };
const battlefield = { type: "battlefield", id: "bf-678" };

function candidate(program) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim());
  return { ...program, status: "executable", judgeReason: undefined };
}

const rows = [
  {
    name: "Master Yi, Honed: 7 energy entry is ready without a ready event (CR 369.3)",
    canonicalCardId: "card.hash-65cd9565fff10c8779998a9b1ca3843ab54b34a3cc338af891157cfbf9ec1761",
    program: masterYi,
    scenario: {
      players: { A: { energy: 7, power: ["Body"] } },
      objects: [
        { id: "yi", cardId: masterYi.canonicalCardId, types: ["unit"], tags: ["Master Yi", "Ionia", "Champion"], zone: "hand", energy: 7, power: ["Body"], might: 6 },
        { id: "exhausted-ally", types: ["unit"], zone: "board", location: baseA, might: 2, exhausted: true },
      ],
      operations: [{ type: "play", object: "yi", player: "A" }],
      expect: {
        objects: {
          yi: { zone: "board", location: baseA, exhausted: false, might: 6, damage: 0 },
          "exhausted-ally": { zone: "board", exhausted: true, might: 2 },
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
    name: "Xin Zhao, Vigilant: two other friendly base units permit ready entry (CR 364.3/369.3)",
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
    name: "Bandle Soldier: 3 XP ready entry is partial evidence, Level binding remains blocked (CR 824.1)",
    canonicalCardId: "card.hash-121fc6b958b52f3a54986facd825169683558bc6c00ae71fbb3323be8b3a1f7c",
    program: bandleSoldier,
    scenario: {
      players: { A: { energy: 4, power: ["Order"], xp: 3 } },
      objects: [{ id: "soldier", cardId: bandleSoldier.canonicalCardId, types: ["unit"], tags: ["Yordle", "Bandle City"], zone: "hand", energy: 4, power: ["Order"], might: 5 }],
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
    name: "Towering Pairofant: a real Hextech Ray kill precedes ready entry; printed power stays null",
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

function register(template, definitions) {
  const cases = defineTemplateSuite(template, definitions.map(row => ({ ...row, program: candidate(row.program) })));
  for (const [index, entry] of cases.entries()) {
    test(entry.name, definitions[index].blocked ? { todo: definitions[index].blocked } : {}, () => {
      const result = entry.run();
      assert.deepEqual(result.state.chain, []);
      // CR 369.3: entry orientation is rewritten before Board entry.
      assert.equal(result.events.some(event => event.timingPoint === "object-readied"), false);
    });
  }
}

register("keyword+replacement||effect.ready / supported entry", rows);

// The published registry must still reject every partially supported card.
for (const row of rows) {
  test(`RIFT-678 ${row.name} [${row.canonicalCardId}]: published status guard`, () => {
    const binding = createProgramBinding({ cardPrograms: [row.program] });
    assert.throws(() => binding.registry.get(row.canonicalCardId), {
      code: "judge-required",
      message: row.program.judgeReason,
    });
    const [entry] = defineTemplateSuite("RIFT-678 published harness guard", [row]);
    assert.throws(entry.run, /is judge-required$/);
    assert.equal(row.program.status, "judge-required");
  });
}

const [yiRow, xinRow, soldierRow, pairofantRow] = rows;

register("keyword+replacement||effect.ready / boundaries", [
  {
    ...yiRow,
    name: "Master Yi, Honed: another entering unit stays exhausted (self-only replacement)",
    scenario: {
      players: { A: { energy: 13, power: ["Body"] } },
      objects: [
        yiRow.scenario.objects[0],
        { id: "drake", program: cloudDrake, types: ["unit"], tags: ["Dragon", "Demacia"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "top", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "yi", player: "A" },
        { type: "play", object: "drake", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          yi: { zone: "board", exhausted: false },
          drake: { zone: "board", exhausted: true, might: 5, power: null },
          top: { zone: "hand" },
        },
        players: { A: { energy: 0, handSize: 1 } },
        events: { sequence: [
          { timingPoint: "object-enters-board", object: { ref: "yi", exhausted: false } },
          { timingPoint: "object-enters-board", object: { ref: "drake", exhausted: true } },
          { timingPoint: "card-drawn", object: { ref: "top" } },
        ] },
      },
    },
  },
  ...[
    { name: "no other units", others: [] },
    { name: "one other base unit cannot count the entering incarnation", others: [xinRow.scenario.objects[1]] },
    {
      name: "friendly battlefield units and enemy base units do not count",
      others: [
        { id: "field-ally", types: ["unit"], zone: "board", location: battlefield, might: 2 },
        xinRow.scenario.objects[3],
        { id: "base-gear", types: ["gear"], zone: "board", location: baseA },
        { id: "hand-unit", types: ["unit"], zone: "hand", might: 2 },
      ],
    },
  ].map(({ name, others }) => ({
    ...xinRow,
    name: `Xin Zhao, Vigilant: ${name} means exhausted entry`,
    blocked: "RIFT-260 follow-up: evaluate the replacement condition using the entering incarnation (CR 364.3/369.3)",
    scenario: {
      ...xinRow.scenario,
      objects: [xinRow.scenario.objects[0], ...others],
      expect: {
        objects: { xin: { zone: "board", location: baseA, exhausted: true, might: 4 } },
        players: { A: { energy: 0 } },
      },
    },
  })),
  ...[0, 2].map(xp => ({
    ...soldierRow,
    name: `Bandle Soldier: ${xp} XP leaves the dependent entry ability inactive`,
    blocked: "RIFT-268/258/259 and RIFT-260 follow-ups: live controller XP and conditional entry are absent (CR 824.1.d)",
    scenario: {
      ...soldierRow.scenario,
      players: { A: { energy: 4, power: ["Order"], xp } },
      expect: {
        objects: { soldier: { zone: "board", exhausted: true, might: 5 } },
        players: { A: { energy: 0, xp } },
      },
    },
  })),
  {
    ...soldierRow,
    name: "Bandle Soldier: player B's 2 XP cannot use player A's 3 XP",
    blocked: "RIFT-268/258/259 and RIFT-260 follow-ups: Level must read the current controller (CR 824.1.c.1)",
    scenario: {
      turnPlayer: "B",
      players: { A: { xp: 3 }, B: { energy: 4, power: ["Order"], xp: 2 } },
      objects: [{ ...soldierRow.scenario.objects[0], owner: "B", controller: "B" }],
      operations: [{ type: "play", object: "soldier", player: "B" }],
      expect: {
        objects: { soldier: { zone: "board", owner: "B", controller: "B", location: { type: "base", player: "B" }, exhausted: true } },
        players: { A: { xp: 3 }, B: { energy: 0, xp: 2 } },
      },
    },
  },
  {
    ...pairofantRow,
    name: "Towering Pairofant: living units without a death cannot enable ready entry",
    blocked: "RIFT-260 follow-up: entry conditions need a turn-scoped unit-death history predicate (CR 364.3/369.3)",
    scenario: {
      players: { A: { energy: 6 } },
      objects: [pairofantRow.scenario.objects[0], pairofantRow.scenario.objects[2]],
      operations: [{ type: "play", object: "pairofant", player: "A" }],
      expect: {
        objects: {
          pairofant: { zone: "board", exhausted: true, might: 6, power: null },
          victim: { zone: "board", damage: 0, might: 3 },
        },
        players: { A: { energy: 0 } },
      },
    },
  },
]);
