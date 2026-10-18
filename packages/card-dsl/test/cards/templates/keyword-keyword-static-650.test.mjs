// RIFT-650 template golden: keyword + keyword + static (no trigger timing, no body).
//
// Execution evidence for Taric, Protector; Needlessly Large Yordle; Ornn, Forge
// God; and Rengar, Pouncing. Every row plays the real program through the merged
// scenario harness (RIFT-592), so the chain, cost payment, keyword expansion,
// production static binding and layer engine run for real. The four program
// files stay judge-required because each has one blocked static clause; the
// per-row `declared` check pins the declared status and judge reason, and the
// scenario assertions cover the executable part plus the boundary rows below.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const TARIC = "card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f";
const YORDLE = "card.hash-fd21f689bd36e48ea3071e7d21c1fa68fd1527e85ca97ffd9052664f6aaba7de";
const ORNN = "card.hash-d608aa993147100b60121de9bd89000a5f21f0b389c96138c079609d8ffa4004";
const RENGAR = "card.hash-11c2deae61a7e5098515aef9a7b5595b0b6430fc0efebc22147404611ccebbc9";

/** The harness only runs executable programs; the declared status is asserted below. */
function executableProbe(canonicalCardId) {
  const program = cardProgramsById.get(canonicalCardId);
  assert.ok(program, `generated card program ${canonicalCardId} is present`);
  return { ...program, status: "executable", judgeReason: undefined };
}

const definitions = [
  {
    name: "Taric, Protector — play, payment and the blocked Shield aura",
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
      assert.match(program.judgeReason, /continuous\.keyword/);
      assert.match(program.judgeReason, /exclude/);
      assert.match(program.judgeReason, /designation/);
      assert.match(program.judgeReason, /Tank/);
    },
    bindingError: /Static exclude anchor needs a dynamic relative filter/,
  },
  {
    name: "Needlessly Large Yordle — printed cost paid with no holding points",
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
    bindingError: /Static ability kind continuous\.cost-modification has no layer mapping/,
  },
  {
    name: "Ornn, Forge God — two friendly gear do not raise Might (count not evaluated)",
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
    bindingError: /Static ability kind target\.tax has no layer mapping/,
  },
  {
    name: "Rengar, Pouncing — Reaction play lands at base without the Assault bonus",
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
    bindingError: /Static ability kind play-location-permission has no layer mapping/,
  },
  {
    name: "Taric, Protector — boundary: a 4-energy / 1-Calm cost is not payable with 2 energy (negated)",
    canonicalCardId: TARIC,
    program: executableProbe(TARIC),
    scenario: {
      players: { A: { energy: 2, power: ["Calm"] }, B: {} },
      objects: [
        { id: "taric", cardId: TARIC, types: ["unit"], zone: "hand", energy: 4, power: ["Calm"], might: 4 },
        { id: "ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      operations: [{ type: "play", object: "taric", player: "A", location: { type: "battlefield", id: "bf-1" } }],
    },
    expectedFailure: /insufficient Energy/,
    declared: program => {
      assert.equal(program.status, "judge-required");
    },
  },
  {
    name: "Needlessly Large Yordle — boundary: 9 energy cannot pay the printed 10 (no discount wiring)",
    canonicalCardId: YORDLE,
    program: executableProbe(YORDLE),
    scenario: {
      players: { A: { energy: 9, power: ["Calm", "Calm", "Calm"] }, B: {} },
      objects: [{ id: "yordle", cardId: YORDLE, types: ["unit"], zone: "hand", energy: 10, power: ["Calm", "Calm", "Calm"], might: 5 }],
      operations: [{ type: "play", object: "yordle", player: "A" }],
    },
    expectedFailure: /insufficient Energy/,
    declared: program => {
      assert.equal(program.status, "judge-required");
    },
  },
  {
    name: "Ornn, Forge God — boundary: an accepted Equipment is still not attached (fail-closed cost.modify)",
    canonicalCardId: ORNN,
    program: executableProbe(ORNN),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [
        { id: "ornn", cardId: ORNN, types: ["unit"], zone: "hand", energy: 6, power: [], might: 4 },
        { id: "equipment", owner: "A", controller: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" }, tags: ["Equipment"] },
      ],
      operations: [
        { type: "play", object: "ornn", player: "A" },
        { type: "choose", id: "target:weaponmaster-equipment", value: ["equipment"] },
      ],
      expect: {
        objects: {
          ornn: { zone: "board", location: { type: "base", player: "A" } },
          equipment: { zone: "board", attachedTo: null },
        },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
    },
    bindingError: /Static ability kind target\.tax has no layer mapping/,
  },
  {
    name: "Rengar, Pouncing — boundary: no Fury Power means the printed cost cannot be paid",
    canonicalCardId: RENGAR,
    program: executableProbe(RENGAR),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [{ id: "rengar", cardId: RENGAR, types: ["unit"], zone: "hand", energy: 3, power: ["Fury"], might: 3 }],
      operations: [{ type: "play", object: "rengar", player: "A" }],
    },
    expectedFailure: /insufficient matching Power/,
    declared: program => {
      assert.equal(program.status, "judge-required");
    },
  },
  {
    name: "Ornn, Forge God — boundary: no friendly Equipment means the Weaponmaster target has no legal option",
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
          enemy: { zone: "board", attachedTo: null, damage: 0 },
        },
        players: { A: { energy: 4 } },
        events: {
          includes: [{ timingPoint: "card-played" }],
        },
      },
    },
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /Weaponmaster/);
    },
    bindingError: /Static ability kind target\.tax has no layer mapping/,
  },
];

const templateCases = defineTemplateSuite(
  "RIFT-650 keyword+keyword+static",
  definitions.map(definition => ({
    name: definition.name,
    canonicalCardId: definition.canonicalCardId,
    program: definition.program,
    scenario: definition.scenario,
    bindingError: definition.bindingError,
  })),
);

for (const [index, templateCase] of templateCases.entries()) {
  test(templateCase.name, () => {
    const declared = cardProgramsById.get(templateCase.canonicalCardId);
    assert.ok(declared, `generated program ${templateCase.canonicalCardId} is present`);
    definitions[index].declared(declared);
    if (definitions[index].expectedFailure) {
      assert.throws(templateCase.run, definitions[index].expectedFailure);
      return;
    }
    if (definitions[index].bindingError) {
      assert.throws(templateCase.run, error => {
        assert.equal(error.code, "judge-required");
        assert.match(error.message, definitions[index].bindingError);
        return true;
      });
      return;
    }
    templateCase.run();
  });
}
