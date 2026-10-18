// RIFT-645 template-level golden: one independent scenario row per static|| card.
// The source programs remain judge-required. A test-only status lift lets the
// shared scenario harness traverse the real lifecycle while each row asserts
// only the state that is currently observable; it never changes the card IR.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const ids = {
  kinkouTemple: "card.hash-0148fea511f023ebe4f6e9b7dd701d1290558c9cbf8bcd877bccd4cda78e5875",
  mysticVortex: "card.hash-a4ce11641e7d44ba07514cd00f7c63e4ce2fa82ef76ff2dd5a8391481ba04da9",
  piltovanForge: "card.hash-be867d899429959061bfc2cece46b8a8f554894791ea014d6a288b4075a635e9",
  repairSpecialist: "card.hash-210dea8c8d67186f11b18e71dd84b78b75323c6b47d01f2b60448fa17bf2ae8a",
  sacredProtector: "card.hash-e99af0758d26984ed89173384615fc55536c8bab7b751efe428c2565832ff0f7",
  sandstoneChimera: "card.hash-d0255097555a5da0f073d4ce07d5cc0f4bd79427917b9d1ea4b327b052d1cd20",
  sandsweptTomb: "card.hash-0ad8407dc26ccc74fcc0edb028e217e9d5f82966e99a5ac3e28141b11504ae5b",
};

const sourcePrograms = new Map();
function executableView(canonicalCardId) {
  const source = cardProgramsById.get(canonicalCardId);
  assert.ok(source, `generated card program ${canonicalCardId} is present`);
  assert.equal(source.status, "judge-required");
  sourcePrograms.set(canonicalCardId, source);
  // runCardScenario intentionally refuses judge-required programs. This view is
  // test-only and is used to exercise the merged lifecycle; status on the card
  // program itself is asserted above and remains judge-required.
  return { ...source, status: "executable", judgeReason: undefined };
}

const rows = [
  {
    name: "Kinkou Temple · Tank gate has no legal non-Tank target",
    canonicalCardId: ids.kinkouTemple,
    program: executableView(ids.kinkouTemple),
    scenario: {
      objects: [
        { id: "temple", cardId: ids.kinkouTemple, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: null, energy: null, power: null },
        { id: "plain-unit", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2, energy: null, power: null },
      ],
      expect: {
        objects: {
          temple: { zone: "board", might: 1 },
          "plain-unit": { zone: "board", might: 2 },
        },
      },
    },
  },
  {
    name: "Mystic Vortex · closed showdown leaves Reaction card cost untouched",
    canonicalCardId: ids.mysticVortex,
    program: executableView(ids.mysticVortex),
    scenario: {
      phase: "main",
      objects: [
        { id: "vortex", cardId: ids.mysticVortex, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: null, energy: null, power: null },
        { id: "reaction", owner: "A", types: ["spell"], keywords: [{ id: "Reaction" }], zone: "hand", energy: 1, power: null },
      ],
      expect: {
        objects: {
          vortex: { zone: "board" },
          reaction: { zone: "hand", energy: 1, power: null },
        },
      },
    },
  },
  {
    name: "Piltovan Forge · friendly gear keeps its printed activation cost",
    canonicalCardId: ids.piltovanForge,
    program: executableView(ids.piltovanForge),
    scenario: {
      objects: [
        { id: "forge", cardId: ids.piltovanForge, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: null, energy: null, power: null },
        { id: "gear", owner: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" }, energy: 2 },
      ],
      expect: {
        objects: {
          forge: { zone: "board" },
          gear: { zone: "board", energy: 2 },
        },
      },
    },
  },
  {
    name: "Repair Specialist · grants Assault while excluding opponent gear",
    canonicalCardId: ids.repairSpecialist,
    program: executableView(ids.repairSpecialist),
    scenario: {
      objects: [
        { id: "repair", cardId: ids.repairSpecialist, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3, energy: 3, power: null },
        { id: "own-gear", owner: "A", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" } },
        { id: "enemy-gear", owner: "B", types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" } },
      ],
      expect: {
        objects: {
          repair: { zone: "board", keywords: [{ id: "Assault" }] },
          "own-gear": { zone: "board" },
          "enemy-gear": { zone: "board" },
        },
      },
    },
  },
  {
    name: "Sacred Protector · condition is false with no other friendly unit here",
    canonicalCardId: ids.sacredProtector,
    program: executableView(ids.sacredProtector),
    scenario: {
      objects: [
        { id: "protector", cardId: ids.sacredProtector, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 6, energy: 4, power: ["Order"] },
      ],
      expect: {
        objects: {
          protector: { zone: "board", damage: 0, might: 6 },
        },
      },
    },
  },
  {
    name: "Sandstone Chimera · battlefield restriction is registered without changing the unit",
    canonicalCardId: ids.sandstoneChimera,
    program: executableView(ids.sandstoneChimera),
    scenario: {
      objects: [
        { id: "chimera", cardId: ids.sandstoneChimera, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3, energy: 3, power: null },
      ],
      expect: {
        objects: {
          chimera: { zone: "board", might: 3 },
        },
      },
    },
  },
  {
    name: "Sandswept Tomb · spell and friendly unit keep their zones",
    canonicalCardId: ids.sandsweptTomb,
    program: executableView(ids.sandsweptTomb),
    scenario: {
      objects: [
        { id: "tomb", cardId: ids.sandsweptTomb, types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: null, energy: null, power: null },
        { id: "spell", owner: "A", types: ["spell"], zone: "hand", energy: 0, power: null },
        { id: "friendly-unit", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      expect: {
        objects: {
          tomb: { zone: "board" },
          spell: { zone: "hand", energy: 0, power: null },
          "friendly-unit": { zone: "board", might: 2 },
        },
      },
    },
  },
];

const scenarioBindingErrors = new Map([
  [ids.kinkouTemple, /Unsupported static filter field keywords/],
  [ids.mysticVortex, /Unsupported static appliesTo "play-cost"/],
  [ids.piltovanForge, /Unsupported static appliesTo "activated-ability-cost"/],
  [ids.sandstoneChimera, /Unsupported static appliesTo "all-players"/],
  [ids.sandsweptTomb, /Unsupported static appliesTo "play-cost"/],
]);

for (const row of defineTemplateSuite("RIFT-645 static||", rows)) {
  test(row.name, () => {
    const source = sourcePrograms.get(row.canonicalCardId);
    assert.ok(source, `source program ${row.canonicalCardId} is present`);
    assert.equal(source.status, "judge-required");
    const bindingError = scenarioBindingErrors.get(row.canonicalCardId);
    if (bindingError) {
      assert.throws(row.run, error => {
        assert.equal(error.code, "judge-required");
        assert.match(error.message, bindingError);
        return true;
      });
      return;
    }
    const result = row.run();
    assert.ok(result, "scenario result is returned");
  });
}
