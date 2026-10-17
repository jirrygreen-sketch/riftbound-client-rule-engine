// RIFT-682: keyword + play || effect.kill.
// Full-card rows retain every printed restriction and remain TODO until the
// corresponding source program is executable. Passing partial rows below use
// the original abilities unchanged; none proves per-player/all-set kills, Flow
// or complete Power payment. Existing single-card primitive evidence is kept.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import acceptableLosses from "../../../dist/cards/ogn/acceptable-losses.js";
import thermoBeam from "../../../dist/cards/ogn/thermo-beam.js";
import brittleSteel from "../../../dist/cards/ven/brittle-steel.js";
import publicExecution from "../../../dist/cards/ven/public-execution.js";
import retreat from "../../../dist/cards/ogn/retreat.js";

const resolveSpell = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];
const battlefield = { type: "battlefield", id: "bf-682" };

// One complete, card-specific row per canonical identity, including the Flow
// replay where printed. These are desired outcomes, never current-bug goldens.
const fullRows = [
  {
    name: "Acceptable Losses · each player chooses and kills their own gear",
    canonicalCardId: "card.hash-b3827545fbd7637410bd870c5f9e3d7996c213e335b7df3d7fe6460e05c58891",
    program: acceptableLosses,
    blocked: "RIFT-682: per-player Resolve choice and kill responsibility (CR 355.10.e / 412.1)",
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: acceptableLosses.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: null, might: null },
        { id: "a-gear", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "b-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "unit", owner: "B", zone: "board", might: 4 },
      ],
      operations: resolveSpell,
    },
    expect: {
      objects: { spell: { zone: "trash", power: null }, "a-gear": { zone: "trash", owner: "A" }, "b-gear": { zone: "trash", owner: "B" }, unit: { zone: "board" } },
      players: { A: { energy: 0 } },
      events: { includes: [
        { timingPoint: "object-killed", object: { ref: "a-gear" }, player: "A" },
        { timingPoint: "object-killed", object: { ref: "b-gear" }, player: "B" },
      ] },
    },
  },
  {
    name: "Thermo Beam · untargeted kill includes both players and unit/gear objects",
    canonicalCardId: "card.hash-6a20eaa5d0de7ffae215ad7179d8429ac1a7b0cf0e32667d6cdaf0a546cc7edf",
    program: thermoBeam,
    blocked: "RIFT-682: untargeted characteristic-query kill (CR 355.5 / 355.10.d / 429.6)",
    scenario: {
      players: { A: { energy: 5, power: ["Fury", "Fury"] } },
      objects: [
        { id: "spell", cardId: thermoBeam.canonicalCardId, types: ["spell"], zone: "hand", energy: 5, power: ["Fury"], might: null },
        { id: "a-gear", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "b-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "gear-unit", owner: "B", types: ["unit", "gear"], zone: "board", might: 3 },
        { id: "unit", zone: "board", might: 4 },
        { id: "hand-gear", types: ["gear"], zone: "hand", energy: null, power: null, might: null },
        { id: "trash-gear", owner: "B", types: ["gear"], zone: "trash", energy: null, power: null, might: null },
      ],
      operations: resolveSpell,
    },
    expect: {
      objects: { spell: { zone: "trash" }, "a-gear": { zone: "trash" }, "b-gear": { zone: "trash" }, "gear-unit": { zone: "trash" }, unit: { zone: "board" }, "hand-gear": { zone: "hand", energy: null, power: null }, "trash-gear": { zone: "trash" } },
      players: { A: { energy: 0, power: [] } },
      events: { includes: [
        { timingPoint: "object-killed", object: { ref: "a-gear" } },
        { timingPoint: "object-killed", object: { ref: "b-gear" } },
        { timingPoint: "object-killed", object: { ref: "gear-unit" } },
      ] },
    },
  },
  {
    name: "Brittle Steel · hand play then Flow for 4 Energy and 1 Fury Power",
    canonicalCardId: "card.hash-045b07d4199255ec6dcfd300272520972fba1ee89dc4e3cfe4e63f1f6b6c95e3",
    program: brittleSteel,
    blocked: "RIFT-682: printed Flow cost forwarding, alternate-cost selection and delayed banish; test-world Power debit (CR 829.1)",
    scenario: {
      players: { A: { energy: 6, power: ["Fury", "Fury"] } },
      objects: [
        { id: "spell", cardId: brittleSteel.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Fury"], might: null },
        { id: "first-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "second-gear", types: ["gear"], zone: "board", energy: null, power: null, might: null },
      ],
      answers: { "target:brittle-steel.gear": ["first-gear"] },
      // Only one Flow instance is printed. No fabricated alternate-cost answer
      // or manual zone/resource mutation supplies the missing keyword binding.
      operations: [
        ...resolveSpell,
        { type: "choose", id: "target:brittle-steel.gear", value: ["second-gear"] },
        ...resolveSpell,
      ],
    },
    expect: {
      objects: { spell: { zone: "banishment" }, "first-gear": { zone: "trash", owner: "B" }, "second-gear": { zone: "trash", owner: "A" } },
      players: { A: { energy: 0, power: [] } },
      events: { sequence: [
        { timingPoint: "object-killed", object: { ref: "first-gear" } },
        { timingPoint: "object-enters-trash", object: { ref: "spell" } },
        { timingPoint: "object-killed", object: { ref: "second-gear" } },
        { timingPoint: "object-enters-banishment", object: { ref: "spell" } },
      ] },
    },
  },
  {
    name: "Public Execution · weaker enemies only, then Flow for 5 Energy and 2 any-domain Power",
    canonicalCardId: "card.hash-c0e71d5f247d83c5854d4a20f7ece28e38086a6726e768eae11da9b47b22991b",
    program: publicExecution,
    blocked: "RIFT-682: relative-Might Finalize predicate plus Flow cost/lifecycle (CR 355.9.b / 143.2.a / 829.1)",
    scenario: {
      players: { A: { energy: 7, power: ["Body", "Fury", "Calm"] } },
      objects: [
        { id: "spell", cardId: publicExecution.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Body"], might: null },
        { id: "friendly", zone: "board", might: 5 },
        { id: "weak-enemy", owner: "B", zone: "board", might: 4 },
        { id: "weaker-enemy", owner: "B", zone: "board", might: 2 },
        { id: "equal-enemy", owner: "B", zone: "board", might: 5 },
      ],
      answers: { "target:public-execution.friendly-unit": ["friendly"], "target:public-execution.enemy-unit": ["weak-enemy"] },
      operations: [
        ...resolveSpell,
        { type: "choose", id: "target:public-execution.enemy-unit", value: ["weaker-enemy"] },
        ...resolveSpell,
      ],
    },
    expect: {
      objects: { spell: { zone: "banishment" }, friendly: { zone: "board", might: 5 }, "weak-enemy": { zone: "trash" }, "weaker-enemy": { zone: "trash" }, "equal-enemy": { zone: "board", might: 5 } },
      players: { A: { energy: 0, power: [] } },
      events: { sequence: [
        { timingPoint: "became-target", target: { ref: "friendly" } },
        { timingPoint: "became-target", target: { ref: "weak-enemy" } },
        { timingPoint: "object-killed", object: { ref: "weak-enemy" } },
        { timingPoint: "object-killed", object: { ref: "weaker-enemy" } },
        { timingPoint: "object-enters-banishment", object: { ref: "spell" } },
      ] },
    },
  },
];

for (const [index, row] of defineTemplateSuite("keyword/play/effect.kill RIFT-682 · full card", fullRows).entries()) {
  if (fullRows[index].program.status === "executable") {
    test(row.name, () => {
      const result = row.run();
      if (index < 2) assert.equal(result.events.filter(event => event.timingPoint === "became-target").length, 0);
      assert.equal(result.state.chain.length, 0);
    });
  } else test.todo(`${row.name} — ${fullRows[index].blocked}`);
}

// The scenario status guard excludes judge-required programs. This local view
// changes metadata only to exercise explicitly bounded partial paths. Keep the
// entire original ability list, including Flow, costs, picks and restrictions.
function partialCandidate(program) {
  const { judgeReason: _blocked, ...declaration } = program;
  return { ...declaration, status: "executable" };
}

const partialRows = [
  {
    name: "Acceptable Losses · main-phase Action admission only, before per-player resolution",
    canonicalCardId: acceptableLosses.canonicalCardId,
    program: partialCandidate(acceptableLosses),
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: acceptableLosses.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: null, might: null },
        { id: "gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
      ],
      operations: [{ type: "play", object: "spell", player: "A" }],
    },
    expect: {
      objects: { spell: { zone: "chain", energy: 1, power: null }, gear: { zone: "board", energy: null, power: null } },
      players: { A: { energy: 0 } },
      events: { sequence: [{ timingPoint: "object-enters-chain", object: { ref: "spell" } }, { timingPoint: "chain-item-finalize" }] },
    },
  },
  {
    name: "Thermo Beam · main-phase Action admission and 5 Energy/2 Fury plan only",
    canonicalCardId: thermoBeam.canonicalCardId,
    program: partialCandidate(thermoBeam),
    scenario: {
      players: { A: { energy: 5, power: ["Fury", "Fury"] } },
      objects: [
        { id: "spell", cardId: thermoBeam.canonicalCardId, types: ["spell"], zone: "hand", energy: 5, power: ["Fury"], might: null },
        { id: "gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
      ],
      operations: [{ type: "play", object: "spell", player: "A" }],
    },
    expect: {
      objects: { spell: { zone: "chain", energy: 5 }, gear: { zone: "board" } },
      players: { A: { energy: 0 } },
      events: { sequence: [{ timingPoint: "object-enters-chain", object: { ref: "spell" } }, { timingPoint: "chain-item-finalize" }] },
    },
  },
  {
    name: "Brittle Steel · original hand-play body locks and kills an enemy gear",
    canonicalCardId: brittleSteel.canonicalCardId,
    program: partialCandidate(brittleSteel),
    scenario: {
      players: { A: { energy: 2, power: ["Fury"] } },
      objects: [
        { id: "spell", cardId: brittleSteel.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Fury"], might: null },
        { id: "enemy-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "friendly-gear", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "enemy-unit", owner: "B", zone: "board", might: 4 },
      ],
      answers: { "target:brittle-steel.gear": ["enemy-gear"] },
      operations: resolveSpell,
    },
    expect: {
      objects: { spell: { zone: "trash" }, "enemy-gear": { zone: "trash", owner: "B", energy: null, power: null }, "friendly-gear": { zone: "board" }, "enemy-unit": { zone: "board" } },
      players: { A: { energy: 0 } },
      events: { sequence: [
        { timingPoint: "became-target", target: { ref: "enemy-gear" } },
        { timingPoint: "chain-item-finalize" },
        { timingPoint: "object-killed", object: { ref: "enemy-gear" }, action: { type: "kill", object: "enemy-gear" } },
        { timingPoint: "card-played", object: { ref: "spell" } },
      ] },
      links: { "brittle-steel.kill-gear.killed": [{ id: "enemy-gear", zoneEntryId: 1 }] },
    },
  },
];

for (const [index, row] of defineTemplateSuite("keyword/play/effect.kill RIFT-682 · partial evidence", partialRows).entries()) {
  test(row.name, () => {
    assert.equal(partialRows[index].program.abilities, fullRows[index].program.abilities);
    const result = row.run();
    if (index < 2) {
      assert.equal(result.state.chain.length, 1);
      const [item] = result.state.chain;
      assert.equal(item.status, "finalized");
      assert.equal(item.speed, "action");
      assert.equal(item.payment.paid, true);
      assert.equal(item.costPlan.total.energy, index === 0 ? 1 : 5);
      assert.deepEqual(item.costPlan.total.power, index === 0 ? [] : [{ amount: 2, allowedDomains: ["Fury"] }]);
      assert.equal(result.events.filter(event => ["became-target", "object-killed", "chain-item-resolve"].includes(event.timingPoint)).length, 0);
    } else {
      assert.equal(result.state.chain.length, 0);
      assert.equal(result.events.filter(event => event.timingPoint === "became-target").length, 1);
      assert.equal(result.events.filter(event => event.timingPoint === "object-killed").length, 1);
    }
  });
}

const boundaryRows = [
  {
    name: "Brittle Steel · ignored stale target after a real Retreat Reaction",
    canonicalCardId: brittleSteel.canonicalCardId,
    program: partialCandidate(brittleSteel),
    scenario: {
      players: { A: { energy: 2, power: ["Fury"] }, B: { energy: 1 } },
      objects: [
        { id: "spell", cardId: brittleSteel.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Fury"], might: null },
        { id: "retreat", program: retreat, owner: "B", types: ["spell"], zone: "hand", energy: 1, power: null, might: null },
        { id: "gear-unit", owner: "B", types: ["unit", "gear"], zone: "board", location: battlefield, energy: null, power: null, might: 3 },
        { id: "other-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
      ],
      answers: { "target:brittle-steel.gear": ["gear-unit"], "target:friendly-unit": ["gear-unit"] },
      // B's empty Rune Deck is a legal Channel shortfall (CR 431.3). Retreat
      // executes its whole original body; no fixture returns or kills a card.
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "play", object: "retreat", player: "B" },
        { type: "pass", player: "B" },
        { type: "pass", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
    },
    expect: {
      objects: { spell: { zone: "trash" }, retreat: { zone: "trash", power: null }, "gear-unit": { zone: "hand", owner: "B", energy: null, power: null }, "other-gear": { zone: "board" } },
      players: { A: { energy: 0 }, B: { energy: 0, handSize: 1, runeDeckSize: 0 } },
      events: { sequence: [
        { timingPoint: "became-target", target: { ref: "gear-unit" }, source: { ref: "spell" } },
        { timingPoint: "object-enters-hand", object: { ref: "gear-unit" } },
        { timingPoint: "card-played", object: { ref: "retreat" } },
        { timingPoint: "card-played", object: { ref: "spell" } },
      ] },
    },
  },
];

for (const row of defineTemplateSuite("keyword/play/effect.kill RIFT-682 · boundary", boundaryRows)) {
  test(row.name, () => {
    const result = row.run();
    assert.equal(result.state.chain.length, 0);
    assert.equal(result.events.filter(event => event.timingPoint === "object-killed").length, 0);
    assert.equal(Object.hasOwn(result.links, "brittle-steel.kill-gear.killed"), false);
  });
}

// Preserve the desired null-Might assertion separately: TestWorld's initial
// object construction currently uses might ?? 1, even for a spell. This shared
// harness defect is outside this task's write scope; do not pin 1 as correct.
for (const row of defineTemplateSuite("keyword/play/effect.kill RIFT-682 · pending harness regression", [
  {
    ...partialRows[0],
    name: "Acceptable Losses · spell keeps its absent printed Might after admission",
    expect: {
      ...partialRows[0].expect,
      objects: { ...partialRows[0].expect.objects, spell: { ...partialRows[0].expect.objects.spell, might: null } },
    },
  },
])) test(row.name, { todo: "RIFT-682 upstream: TestWorld initial object construction coerces null Might to 1" }, row.run);
