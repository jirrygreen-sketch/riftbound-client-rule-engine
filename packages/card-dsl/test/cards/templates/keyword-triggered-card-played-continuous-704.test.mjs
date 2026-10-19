// RIFT-704: keyword + card-played || continuous.grant-keyword.
//
// The published programs remain judge-required because their other printed
// abilities still have unresolved consumers. The executable views below keep
// each card's canonical identity and supported card-played/grant body, while
// making no claim that the unresolved keyword, condition, or combat semantics
// are complete. Every row is run through the scenario harness, so admission,
// trigger dispatch, chain resolution, supported selection/target locking, and
// layer registration use the production path.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

import momentaryCompanion from "../../../dist/cards/rad/momentary-companion.js";
import chakramDancer from "../../../dist/cards/unl/chakram-dancer.js";
import lordBroadmane from "../../../dist/cards/unl/lord-broadmane.js";

const BATTLEFIELD = { type: "battlefield", id: "rift-704-battlefield" };
const publishedPrograms = new Map([
  [momentaryCompanion.canonicalCardId, momentaryCompanion],
  [chakramDancer.canonicalCardId, chakramDancer],
  [lordBroadmane.canonicalCardId, lordBroadmane],
]);

function executableView(program, abilities = program.abilities) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim(), `${program.canonicalCardId} needs a concrete judgeReason`);
  return { ...program, status: "executable", judgeReason: undefined, abilities };
}

function playAndResolve(location = BATTLEFIELD) {
  return [
    { type: "play", object: "source", player: "A", location },
    { type: "pass", player: "A" },
    { type: "pass", player: "B" },
  ];
}

function unit(program, overrides = {}) {
  return {
    id: "source",
    program,
    cardId: program.canonicalCardId,
    types: ["unit"],
    zone: "hand",
    energy: 0,
    power: null,
    might: 3,
    ...overrides,
  };
}

function publishedJudgeRequired(program) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim());
}

const momentaryView = executableView(momentaryCompanion);
const broadmaneView = executableView(lordBroadmane);

// Chakram Dancer's printed target filter deliberately stays in the source
// program. The production target translator currently rejects its
// sameLocationAs/exclude fields, so the supported-path view uses one concrete
// query target. This tests the actual continuous.grant-keyword instruction and
// layer registration without replacing the published IR.
function chakramGrantQueryView(filter) {
  const triggered = chakramDancer.abilities[1];
  const instruction = triggered.body[0];
  const { targets: _unsupportedTargets, ...withoutTargets } = instruction;
  return executableView(chakramDancer, [
    chakramDancer.abilities[0],
    {
      ...triggered,
      body: [{
        ...withoutTargets,
        args: {
          keyword: instruction.args.keyword,
          duration: instruction.args.duration,
          objects: { kind: "constant", value: { kind: "query", filter } },
        },
      }],
    },
  ]);
}

const chakramView = chakramGrantQueryView({ objectId: "ally-here", type: "unit", zone: "board" });
const chakramEmptyView = chakramGrantQueryView({ objectId: "missing-target", type: "unit", zone: "board" });

const rows = [
  {
    name: "Momentary Companion · card-played grants Temporary to itself",
    canonicalCardId: momentaryCompanion.canonicalCardId,
    program: momentaryView,
    scenario: {
      players: { A: { energy: 0 }, B: { energy: 0 } },
      objects: [unit(momentaryView, { energy: 0, might: 2 })],
      operations: playAndResolve(),
      expect: {
        objects: { source: { zone: "board", keywords: [{ id: "Temporary" }] } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "source" } }] },
      },
    },
    assertResult(result) {
      assert.equal(result.state.chain.length, 0);
      assert.equal(result.state.objects.find(object => object.ref.id === "source")?.keywords[0]?.id, "Temporary");
    },
  },
  {
    name: "Chakram Dancer · card-played grants Shield to the concrete ally query",
    canonicalCardId: chakramDancer.canonicalCardId,
    program: chakramView,
    scenario: {
      players: { A: { energy: 3 }, B: { energy: 0 } },
      objects: [
        unit(chakramView, { energy: 3, power: null, might: 3 }),
        { id: "ally-here", owner: "A", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 2 },
      ],
      operations: playAndResolve(),
      expect: {
        objects: { source: { zone: "board" }, "ally-here": { zone: "board", keywords: [{ id: "Shield" }] } },
        players: { A: { energy: 0 } },
        events: {
          includes: [
            { timingPoint: "card-played", object: { ref: "source" } },
            { timingPoint: "chain-item-resolve", object: { ref: "source" } },
          ],
        },
      },
    },
    assertResult(result) {
      assert.equal(result.state.chain.length, 0);
      assert.equal(result.events.some(event => event.timingPoint === "became-target"), false);
      assert.equal(result.links["chakram-dancer.grant-shield.granted.count"], 1);
    },
  },
  {
    name: "Lord Broadmane · card-played grants Assault to the other unit here",
    canonicalCardId: lordBroadmane.canonicalCardId,
    program: broadmaneView,
    scenario: {
      players: { A: { energy: 5, power: ["Fury"] }, B: { energy: 0 } },
      objects: [
        unit(broadmaneView, { energy: 5, power: ["Fury"], might: 5 }),
        { id: "ally-here", owner: "A", types: ["unit"], zone: "board", location: BATTLEFIELD, might: 2 },
        { id: "ally-elsewhere", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "elsewhere" }, might: 2 },
      ],
      operations: playAndResolve(),
      expect: {
        objects: {
          source: { zone: "board", keywords: [] },
          "ally-here": { zone: "board", keywords: [{ id: "assault" }] },
          "ally-elsewhere": { zone: "board", keywords: [] },
        },
        players: { A: { energy: 0, power: ["Fury"] } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "source" } }] },
      },
    },
    assertResult(result) {
      assert.equal(result.state.chain.length, 0);
      assert.equal(result.state.objects.find(object => object.ref.id === "ally-here")?.keywords[0]?.id, "assault");
      assert.deepEqual(result.state.objects.find(object => object.ref.id === "ally-elsewhere")?.keywords, []);
    },
  },
];

for (const [index, templateCase] of defineTemplateSuite("RIFT-704 keyword+card-played || continuous.grant-keyword", rows).entries()) {
  const row = rows[index];
  test(templateCase.name, () => {
    publishedJudgeRequired(publishedPrograms.get(row.canonicalCardId));
    const result = templateCase.run();
    row.assertResult(result);
  });
}

// Boundary: a legal but empty query is a real negated grant. The source
// program's printed target semantics remain pending; this probe checks the
// supported continuous-grant behavior when no object is available.
for (const templateCase of defineTemplateSuite("RIFT-704 continuous.grant-keyword boundary", [{
  name: "Chakram Dancer · no legal ally produces zero grants",
  canonicalCardId: chakramDancer.canonicalCardId,
  program: chakramEmptyView,
  scenario: {
    players: { A: { energy: 3 }, B: { energy: 0 } },
    objects: [unit(chakramEmptyView, { energy: 3, power: null, might: 3 })],
    operations: playAndResolve(),
    expect: {
      objects: { source: { zone: "board", keywords: [] } },
      players: { A: { energy: 0 } },
      events: { includes: [{ timingPoint: "card-played", object: { ref: "source" } }] },
    },
  },
}])) {
  test(templateCase.name, () => {
    publishedJudgeRequired(publishedPrograms.get(chakramDancer.canonicalCardId));
    const result = templateCase.run();
    assert.equal(result.links["chakram-dancer.grant-shield.granted.count"], 0);
    assert.equal(result.events.some(event => event.timingPoint === "became-target"), false);
    assert.equal(result.state.chain.length, 0);
  });
}
