// RIFT-706 template-level golden for the shared
// `triggered|attack-declared|effect.damage` shape.
//
// The three published programs remain judge-required.  The scenario harness
// can execute the common trigger and damage body, but production binding still
// lacks the relative `sameLocationAs` target anchor and the combat flow does
// not yet emit attack-declared from attacker designation.  Each row therefore
// uses a test-local executable view that keeps the card's own trigger, amount,
// and target identity while replacing only the unsupported target binding.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

import anivia from "../../../dist/cards/ogn/anivia-primal.js";
import crackshotCorsair from "../../../dist/cards/ogn/crackshot-corsair.js";
import yasuo from "../../../dist/cards/ogn/yasuo-remorseful.js";

const published = new Map([
  [anivia.canonicalCardId, anivia],
  [crackshotCorsair.canonicalCardId, crackshotCorsair],
  [yasuo.canonicalCardId, yasuo],
]);

function executableView(program, kind) {
  const [ability] = program.abilities;
  const [instruction] = ability.body;

  const targetId = kind === "anivia"
    ? "anivia.enemy-units-here"
    : instruction.targets[0].id;
  const target = kind === "anivia"
    ? {
        id: targetId,
        filter: { type: "unit", zone: "board", controller: "opponent" },
        min: 0,
        selection: "all",
      }
    : {
        ...instruction.targets[0],
        // The scenario view keeps one concrete enemy on the Board.  The
        // source IR's sameLocationAs anchor remains in the published program
        // and is asserted by the per-card goldens.
        filter: { type: "unit", zone: "board", controller: "opponent" },
      };

  const bodyInstruction = {
    ...instruction,
    args: {
      ...instruction.args,
      // The published Anivia descriptor is a non-target set placeholder.  A
      // constant TargetSpec id is the only shape consumed by effect.damage;
      // this view is explicitly test-only and does not change printed IR.
      target: { kind: "constant", value: targetId },
    },
    targets: [target],
  };

  const trigger = kind === "yasuo"
    ? { ...ability.trigger, filter: { event: "attack-declared", filter: { source: "self" } } }
    : ability.trigger;

  return {
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities: [{ ...ability, trigger, body: [bodyInstruction] }],
  };
}

const aniviaView = executableView(anivia, "anivia");
const crackshotView = executableView(crackshotCorsair, "crackshot");
const yasuoView = executableView(yasuo, "yasuo");

function unit(id, owner, location, extra = {}) {
  return {
    id,
    owner,
    types: ["unit"],
    zone: "board",
    location: { type: "battlefield", id: location },
    might: 10,
    ...extra,
  };
}

const rows = [
  {
    name: "Anivia, Primal · attack trigger deals 3 to both enemy units in the supported set view",
    canonicalCardId: anivia.canonicalCardId,
    program: aniviaView,
    scenario: {
      players: { A: { energy: 10 }, B: { energy: 10 } },
      objects: [
        { id: "anivia", cardId: aniviaView.canonicalCardId, program: aniviaView, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 8 },
        unit("enemy-one", "B", "bf-1"),
        unit("enemy-two", "B", "bf-1"),
      ],
      operations: [
        { type: "trigger", timingPoint: "attack-declared", object: "anivia", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          anivia: { zone: "board", damage: 0 },
          "enemy-one": { zone: "board", damage: 3 },
          "enemy-two": { zone: "board", damage: 3 },
        },
        events: {
          includes: [
            { timingPoint: "attack-declared", object: { ref: "anivia" } },
            { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy-one", amount: 3 } },
            { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy-two", amount: 3 } },
          ],
        },
        links: {
          "anivia.damage-enemy-units-here.dealt": 6,
          "anivia.damage-enemy-units-here.dealtCount": 2,
        },
      },
    },
  },
  {
    name: "Crackshot Corsair · attack trigger deals its printed 1 to one enemy unit",
    canonicalCardId: crackshotCorsair.canonicalCardId,
    program: crackshotView,
    scenario: {
      players: { A: { energy: 10 }, B: { energy: 10 } },
      objects: [
        { id: "corsair", cardId: crackshotView.canonicalCardId, program: crackshotView, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3 },
        unit("enemy", "B", "bf-1"),
      ],
      operations: [
        { type: "trigger", timingPoint: "attack-declared", object: "corsair", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { corsair: { zone: "board", damage: 0 }, enemy: { zone: "board", damage: 1 } },
        events: {
          includes: [
            { timingPoint: "attack-declared", object: { ref: "corsair" } },
            { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy", amount: 1 } },
          ],
        },
        links: { "crackshot.damage.dealt": 1, "crackshot.damage.dealtCount": 1 },
      },
    },
  },
  {
    name: "Yasuo, Remorseful · attack trigger reads current Might and deals 7",
    canonicalCardId: yasuo.canonicalCardId,
    program: yasuoView,
    scenario: {
      players: { A: { energy: 10 }, B: { energy: 10 } },
      objects: [
        { id: "yasuo", cardId: yasuoView.canonicalCardId, program: yasuoView, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 7 },
        unit("enemy", "B", "bf-1"),
      ],
      operations: [
        { type: "trigger", timingPoint: "attack-declared", object: "yasuo", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { yasuo: { zone: "board", damage: 0 }, enemy: { zone: "board", damage: 7 } },
        events: {
          includes: [
            { timingPoint: "attack-declared", object: { ref: "yasuo" } },
            { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy", amount: 7 } },
          ],
        },
        links: { "deal-might.dealt": 7, "deal-might.dealtCount": 1 },
      },
    },
  },
];

for (const row of defineTemplateSuite("RIFT-706 triggered|attack-declared|effect.damage", rows)) {
  test(row.name, () => {
    const publishedProgram = published.get(row.canonicalCardId);
    assert.ok(publishedProgram, `missing published program ${row.canonicalCardId}`);
    assert.equal(publishedProgram.status, "judge-required");
    assert.ok(publishedProgram.judgeReason?.trim());
    return row.run();
  });
}

test("RIFT-706 boundary · Anivia with no legal enemy unit set resolves without damage", () => {
  const result = runCardScenario(aniviaView, {
    players: { A: { energy: 10 }, B: { energy: 10 } },
    objects: [
      { id: "anivia", cardId: aniviaView.canonicalCardId, program: aniviaView, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 8 },
    ],
    operations: [
      { type: "trigger", timingPoint: "attack-declared", object: "anivia", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" },
    ],
  });
  assert.equal(result.events.some(event => event.action?.type === "damage"), false);
  assert.deepEqual(result.links, {});
  assert.equal(result.state.chain.length, 0);
});

test("RIFT-706 boundary · an attack declared for another unit does not satisfy the self trigger", () => {
  const result = runCardScenario(crackshotView, {
    players: { A: { energy: 10 }, B: { energy: 10 } },
    objects: [
      { id: "corsair", cardId: crackshotView.canonicalCardId, program: crackshotView, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3 },
      unit("ally", "A", "bf-1"),
      unit("enemy", "B", "bf-1"),
    ],
    operations: [{ type: "trigger", timingPoint: "attack-declared", object: "ally", player: "A" }],
  });
  assert.deepEqual(result.state.chain, []);
  assert.equal(result.state.objects.find(object => object.ref.id === "enemy")?.damage, 0);
  assert.equal(result.events.some(event => event.action?.type === "damage"), false);
});
