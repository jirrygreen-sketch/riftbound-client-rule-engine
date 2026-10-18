// RIFT-684 template-level golden for the four play || effect.kill cards.
// Every published program remains judge-required: the scenario rows use an
// in-memory executable view only to run the merged kill/lifecycle slice. Each
// view removes exactly the unsupported selection predicate or selection source;
// none of these rows is evidence that the printed card is fully executable.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import cullTheWeak from "../../../dist/cards/ogn/cull-the-weak.js";
import soulHarvest from "../../../dist/cards/unl/soul-harvest.js";
import theRuination from "../../../dist/cards/unl/the-ruination.js";
import decreeOfUnity from "../../../dist/cards/ven/decree-of-unity.js";

const BATTLEFIELD = { type: "battlefield", id: "bf-1" };
const published = new Map([
  [cullTheWeak.canonicalCardId, cullTheWeak],
  [soulHarvest.canonicalCardId, soulHarvest],
  [theRuination.canonicalCardId, theRuination],
  [decreeOfUnity.canonicalCardId, decreeOfUnity],
]);

function executableView(program, rewrite) {
  const view = rewrite(program);
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim(), `${program.canonicalCardId} needs a concrete judgeReason`);
  return { ...view, status: "executable", judgeReason: undefined };
}

function playBodyView(program, rewriteInstruction) {
  return {
    ...program,
    abilities: program.abilities.map(ability => ability.kind === "play"
      ? { ...ability, body: ability.body.map(rewriteInstruction) }
      : ability)
  };
}

function targetSetView(program, id, filter) {
  return executableView(program, source => playBodyView(source, instruction => {
    const { picks: _picks, ...withoutPicks } = instruction;
    return {
      ...withoutPicks,
      args: { target: { kind: "constant", value: id } },
      targets: [{ id, filter, min: 0, max: null, selection: "all" }],
    };
  }));
}

const cullView = targetSetView(cullTheWeak, "cull-the-weak.units", { type: "unit", zone: "board" });
const soulView = executableView(soulHarvest, source => playBodyView(source, instruction => ({
  ...instruction,
  targets: instruction.targets?.map(target => ({
    ...target,
    // The real missing part is the effective-Might predicate. Keep the
    // battlefield/unit restriction while the scenario runs the kill path.
    filter: { type: "unit", zone: "board", location: "battlefield" },
  })),
})));
const ruinationView = targetSetView(theRuination, "the-ruination.units", { type: "unit", zone: "board" });
const decreeView = executableView(decreeOfUnity, source => playBodyView(source, instruction => ({
  ...instruction,
  targets: instruction.targets?.map(target => ({
    ...target,
    // Chaos is the unresolved domain predicate; retain enemy unit/gear.
    filter: { type: ["unit", "gear"], zone: "board", controller: "opponent" },
  })),
})));

function spell(id, program, energy, power) {
  return { id, cardId: program.canonicalCardId, program, types: ["spell"], zone: "hand", energy, power };
}

const rows = [
  {
    name: "Cull the Weak · resolved unit set reaches effect.kill",
    canonicalCardId: cullTheWeak.canonicalCardId,
    program: cullView,
    scenario: {
      players: { A: { energy: 2, power: ["Order"] }, B: { energy: 0, power: [] } },
      objects: [
        spell("cull", cullView, 2, ["Order"]),
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 3 },
        { id: "gear", owner: "B", types: ["gear"], zone: "board", location: BATTLEFIELD, energy: null, power: null, might: null },
      ],
      operations: [
        { type: "play", object: "cull", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { cull: { zone: "trash" }, ally: { zone: "trash" }, enemy: { zone: "trash" }, gear: { zone: "board" } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "object-killed" }, { timingPoint: "card-played" }] },
      },
    },
  },
  {
    name: "Soul Harvest · battlefield target kill",
    canonicalCardId: soulHarvest.canonicalCardId,
    program: soulView,
    scenario: {
      players: { A: { energy: 2, power: ["Order"] }, B: { energy: 0, power: [] } },
      objects: [
        spell("harvest", soulView, 2, ["Order"]),
        { id: "weak-battlefield-unit", owner: "B", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 2 },
        { id: "base-unit", owner: "B", types: ["unit"], zone: "board", location: { type: "base", player: "B" }, might: 2 },
      ],
      answers: { "target:soul-harvest.battlefield-unit": ["weak-battlefield-unit"] },
      operations: [
        { type: "play", object: "harvest", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { harvest: { zone: "trash" }, "weak-battlefield-unit": { zone: "trash" }, "base-unit": { zone: "board" } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "became-target" }, { timingPoint: "object-killed" }] },
      },
    },
  },
  {
    name: "The Ruination · resolved unit set reaches effect.kill",
    canonicalCardId: theRuination.canonicalCardId,
    program: ruinationView,
    scenario: {
      players: { A: { energy: 9, power: ["Order", "Order", "Order"] }, B: { energy: 0, power: [] } },
      objects: [
        spell("ruination", ruinationView, 9, ["Order"]),
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 4 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 4 },
        { id: "gear", owner: "B", types: ["gear"], zone: "board", location: BATTLEFIELD, energy: null, power: null, might: null },
      ],
      operations: [
        { type: "play", object: "ruination", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { ruination: { zone: "trash" }, ally: { zone: "trash" }, enemy: { zone: "trash" }, gear: { zone: "board" } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "object-killed" }, { timingPoint: "card-played" }] },
      },
    },
  },
  {
    name: "Decree of Unity · enemy unit-or-gear target kill",
    canonicalCardId: decreeOfUnity.canonicalCardId,
    program: decreeView,
    scenario: {
      players: { A: { energy: 2, power: ["Order"] }, B: { energy: 0, power: [] } },
      objects: [
        spell("decree", decreeView, 2, ["Order"]),
        { id: "enemy-chaos-gear", owner: "B", types: ["gear"], zone: "board", location: BATTLEFIELD, energy: null, power: ["Chaos"], might: null },
        { id: "friendly-unit", owner: "A", types: ["unit"], zone: "board", location: BATTLEFIELD, power: [], might: 2 },
      ],
      answers: { "target:decree-of-unity.enemy-chaos-object": ["enemy-chaos-gear"] },
      operations: [
        { type: "play", object: "decree", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { decree: { zone: "trash" }, "enemy-chaos-gear": { zone: "trash" }, "friendly-unit": { zone: "board" } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "became-target" }, { timingPoint: "object-killed" }] },
      },
    },
  },
];

for (const row of defineTemplateSuite("RIFT-684 play || effect.kill", rows)) {
  test(row.name, () => {
    assert.equal(published.get(row.canonicalCardId)?.status, "judge-required");
    row.run();
  });
}

test("RIFT-684 boundary: Soul Harvest has no legal battlefield target", () => {
  assert.throws(() => runCardScenario(soulView, {
    players: { A: { energy: 2, power: ["Order"] }, B: { energy: 0, power: [] } },
    objects: [
      spell("harvest-boundary", soulView, 2, ["Order"]),
      { id: "base-only", owner: "B", types: ["unit"], zone: "board", location: { type: "base", player: "B" }, might: 2 },
    ],
    operations: [{ type: "play", object: "harvest-boundary", player: "A" }],
  }), error => error?.code === "no-legal-targets");
});
