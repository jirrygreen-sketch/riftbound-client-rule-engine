// RIFT-698 / README 4.1: keyword + keyword + static (|| signature).
//
// The five rows below each carry one canonical identity, its shipped program,
// an independent real scenario, and card-specific expectations. The harness is
// fed an executable probe so it can exercise the supported play/payment and
// keyword paths while the production programs remain judge-required for their
// documented unsupported clauses. The declared program is checked separately,
// so a partial execution probe never promotes a card in the registry.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const IDS = {
  taric: "card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f",
  yordle: "card.hash-fd21f689bd36e48ea3071e7d21c1fa68fd1527e85ca97ffd9052664f6aaba7de",
  ornn: "card.hash-d608aa993147100b60121de9bd89000a5f21f0b389c96138c079609d8ffa4004",
  reksai: "card.hash-6eb6345b70c561ae3d2ed335eb50fdd0958d942af912aaceba44ad0038813815",
  rengar: "card.hash-11c2deae61a7e5098515aef9a7b5595b0b6430fc0efebc22147404611ccebbc9"
};

function shipped(canonicalCardId) {
  const program = cardProgramsById.get(canonicalCardId);
  assert.ok(program, `generated card program ${canonicalCardId} is present`);
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason, `${canonicalCardId} must document its unsupported clause`);
  const { judgeReason: _judgeReason, ...rest } = program;
  return { ...rest, status: "executable" };
}

const definitions = [
  {
    name: "Taric, Protector — battlefield play pays 4 Energy and leaves the relative Shield aura fail-closed",
    canonicalCardId: IDS.taric,
    program: shipped(IDS.taric),
    scenario: {
      players: { A: { energy: 10, power: ["Calm"] }, B: {} },
      objects: [
        { id: "taric", cardId: IDS.taric, owner: "A", controller: "A", types: ["unit"], zone: "hand", energy: 4, power: ["Calm"], might: 4 },
        { id: "ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
        { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 }
      ],
      operations: [{ type: "play", object: "taric", player: "A", location: { type: "battlefield", id: "bf-1" } }],
      expect: {
        objects: {
          taric: { zone: "board", location: { type: "battlefield", id: "bf-1" }, exhausted: true, might: 4, damage: 0 },
          ally: { might: 2 },
          enemy: { might: 2 }
        },
        players: { A: { energy: 6 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-battlefield" }] }
      }
    },
    declared: program => {
      assert.match(program.judgeReason, /Tank/);
      assert.match(program.judgeReason, /designation/);
      assert.match(program.judgeReason, /exclude/);
    }
  },
  {
    name: "Needlessly Large Yordle — no Hold points means the printed 10 Energy cost is paid",
    canonicalCardId: IDS.yordle,
    program: shipped(IDS.yordle),
    scenario: {
      players: { A: { energy: 10, power: ["Calm", "Calm", "Calm"] }, B: {} },
      objects: [
        { id: "yordle", cardId: IDS.yordle, owner: "A", controller: "A", types: ["unit"], zone: "hand", energy: 10, power: ["Calm", "Calm", "Calm"], might: 5 }
      ],
      operations: [{ type: "play", object: "yordle", player: "A" }],
      expect: {
        objects: { yordle: { zone: "board", location: { type: "base", player: "A" }, exhausted: true, might: 5, damage: 0 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-base" }] }
      }
    },
    declared: program => {
      assert.match(program.judgeReason, /continuous\.cost-modification/);
      assert.match(program.judgeReason, /designation/);
      assert.match(program.judgeReason, /continuous\.combat/);
    }
  },
  {
    name: "Ornn, Forge God — no printed Power is preserved while the two-gear count stays unevaluated",
    canonicalCardId: IDS.ornn,
    program: shipped(IDS.ornn),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [
        { id: "ornn", cardId: IDS.ornn, owner: "A", controller: "A", types: ["unit"], zone: "hand", energy: 6, power: null, might: 4 },
        { id: "gear-a", owner: "A", controller: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" }, energy: null, power: null },
        { id: "gear-b", owner: "A", controller: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" }, energy: null, power: null }
      ],
      operations: [{ type: "play", object: "ornn", player: "A" }],
      expect: {
        objects: {
          ornn: { zone: "board", location: { type: "base", player: "A" }, exhausted: true, energy: 6, power: null, might: 4, buffs: 0 },
          "gear-a": { zone: "board", energy: null, power: null },
          "gear-b": { zone: "board", energy: null, power: null }
        },
        players: { A: { energy: 4 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "chain-item-resolve" }] }
      }
    },
    declared: program => {
      assert.match(program.judgeReason, /target\.tax/);
      assert.match(program.judgeReason, /Weaponmaster/);
      assert.match(program.judgeReason, /count/);
    }
  },
  {
    name: "Rek'Sai, Breacher — no printed Power is preserved while the base play pays 3 Energy",
    canonicalCardId: IDS.reksai,
    program: shipped(IDS.reksai),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [
        { id: "reksai", cardId: IDS.reksai, owner: "A", controller: "A", types: ["unit"], zone: "hand", energy: 3, power: null, might: 3 }
      ],
      operations: [{ type: "play", object: "reksai", player: "A" }],
      expect: {
        objects: { reksai: { zone: "board", location: { type: "base", player: "A" }, energy: 3, power: null, might: 3, damage: 0 } },
        players: { A: { energy: 7 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-base" }] }
      }
    },
    declared: program => {
      assert.match(program.judgeReason, /playedFromZoneNot/);
      assert.match(program.judgeReason, /accelerate\.cost/);
      assert.match(program.judgeReason, /designation/);
    }
  },
  {
    name: "Rengar, Pouncing — Reaction play pays Fury and enters the controller's Base without Assault bonus",
    canonicalCardId: IDS.rengar,
    program: shipped(IDS.rengar),
    scenario: {
      players: { A: { energy: 10, power: ["Fury"] }, B: {} },
      objects: [
        { id: "rengar", cardId: IDS.rengar, owner: "A", controller: "A", types: ["unit"], zone: "hand", energy: 3, power: ["Fury"], might: 3 }
      ],
      operations: [{ type: "play", object: "rengar", player: "A" }],
      expect: {
        objects: { rengar: { zone: "board", location: { type: "base", player: "A" }, exhausted: true, energy: 3, power: ["Fury"], might: 3, damage: 0 } },
        players: { A: { energy: 7 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "object-enters-base" }] }
      }
    },
    declared: program => {
      assert.match(program.judgeReason, /play-location-permission/);
      assert.match(program.judgeReason, /designation/);
    }
  }
];

const boundaries = [
  {
    name: "Taric, Protector — negated boundary: insufficient Energy leaves the card in hand",
    canonicalCardId: IDS.taric,
    program: shipped(IDS.taric),
    scenario: {
      players: { A: { energy: 2, power: ["Calm"] }, B: {} },
      objects: [{ id: "taric", cardId: IDS.taric, types: ["unit"], zone: "hand", energy: 4, power: ["Calm"], might: 4 }],
      operations: [{ type: "play", object: "taric", player: "A", location: { type: "battlefield", id: "bf-1" } }]
    },
    expectedFailure: /insufficient Energy/
  },
  {
    name: "Needlessly Large Yordle — negated boundary: one Energy shortfall cannot use the unavailable Hold discount",
    canonicalCardId: IDS.yordle,
    program: shipped(IDS.yordle),
    scenario: {
      players: { A: { energy: 9, power: ["Calm", "Calm", "Calm"] }, B: {} },
      objects: [{ id: "yordle", cardId: IDS.yordle, types: ["unit"], zone: "hand", energy: 10, power: ["Calm", "Calm", "Calm"], might: 5 }],
      operations: [{ type: "play", object: "yordle", player: "A" }]
    },
    expectedFailure: /insufficient Energy/
  },
  {
    name: "Ornn, Forge God — no-legal-target boundary: an opposing unit is not a Weaponmaster Equipment choice",
    canonicalCardId: IDS.ornn,
    program: shipped(IDS.ornn),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [
        { id: "ornn", cardId: IDS.ornn, types: ["unit"], zone: "hand", energy: 6, power: null, might: 4 },
        { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 }
      ],
      operations: [{ type: "play", object: "ornn", player: "A" }],
      expect: {
        objects: {
          ornn: { zone: "board", location: { type: "base", player: "A" }, exhausted: true, power: null, might: 4 },
          enemy: { zone: "board", attachedTo: null, damage: 0 }
        },
        players: { A: { energy: 4 } },
        events: { includes: [{ timingPoint: "card-played" }] }
      }
    }
  },
  {
    name: "Rek'Sai, Breacher — negated boundary: insufficient Energy prevents the base play before Accelerate",
    canonicalCardId: IDS.reksai,
    program: shipped(IDS.reksai),
    scenario: {
      players: { A: { energy: 2 }, B: {} },
      objects: [{ id: "reksai", cardId: IDS.reksai, types: ["unit"], zone: "hand", energy: 3, power: null, might: 3 }],
      operations: [{ type: "play", object: "reksai", player: "A" }]
    },
    expectedFailure: /insufficient Energy/
  },
  {
    name: "Rengar, Pouncing — negated boundary: no Fury Power makes the printed cost unpayable",
    canonicalCardId: IDS.rengar,
    program: shipped(IDS.rengar),
    scenario: {
      players: { A: { energy: 10 }, B: {} },
      objects: [{ id: "rengar", cardId: IDS.rengar, types: ["unit"], zone: "hand", energy: 3, power: ["Fury"], might: 3 }],
      operations: [{ type: "play", object: "rengar", player: "A" }]
    },
    expectedFailure: /insufficient matching Power/
  }
];

function register(rows, templateName) {
  const cases = defineTemplateSuite(templateName, rows.map(row => ({
    name: row.name,
    canonicalCardId: row.canonicalCardId,
    program: row.program,
    scenario: row.scenario
  })));
  for (const [index, templateCase] of cases.entries()) {
    test(templateCase.name, () => {
      const row = rows[index];
      const declared = cardProgramsById.get(row.canonicalCardId);
      assert.ok(declared, `generated program ${row.canonicalCardId} is present`);
      assert.equal(declared.status, "judge-required");
      assert.ok(declared.judgeReason);
      row.declared?.(declared);
      if (row.expectedFailure) {
        assert.throws(templateCase.run, row.expectedFailure);
        return;
      }
      templateCase.run();
    });
  }
}

register(definitions, "RIFT-698 keyword+keyword+static");
register(boundaries, "RIFT-698 keyword+keyword+static boundary");
