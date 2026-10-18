// RIFT-701 / cards/README.md section 4.1: the four canonical identities whose
// IR signature is `keyword + play || effect.kill`.
//
// Every row carries one canonical identity, the shipped program's abilities and
// a card-specific scenario with that card's own numbers, zones, links and
// events; the rows run through the real scenario harness (ProgramBinding,
// ChainEngine, Finalize target locking, payment and the effect.kill primitive).
//
// The published programs stay judge-required, so the harness is fed an
// executable test-only view (metadata only, or — for Public Execution — the
// single unsupported filter key removed) exactly like the sibling RIFT-684 and
// RIFT-688 templates. No row is evidence that a printed clause is implemented:
// - Acceptable Losses: per-player resolution-time chooser (355.10.e / 412.1).
// - Thermo Beam: effect.kill cannot consume an untargeted characteristic set
//   (355.5 / 355.10.d).
// - Brittle Steel: Flow cost channel, Trash play permission and the delayed
//   banish replacement (829.1.b / 829.1.c).
// - Public Execution: the relative-Might Finalize predicate (355.9.b /
//   143.2.a) plus the same Flow wiring (829.1.b / 829.1.c).
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

import acceptableLosses from "../../../dist/cards/ogn/acceptable-losses.js";
import thermoBeam from "../../../dist/cards/ogn/thermo-beam.js";
import brittleSteel from "../../../dist/cards/ven/brittle-steel.js";
import publicExecution from "../../../dist/cards/ven/public-execution.js";

const published = new Map([
  [acceptableLosses.canonicalCardId, acceptableLosses],
  [thermoBeam.canonicalCardId, thermoBeam],
  [brittleSteel.canonicalCardId, brittleSteel],
  [publicExecution.canonicalCardId, publicExecution],
]);

// Metadata-only view: the whole printed ability list is kept untouched.
function executableView(program) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim(), `${program.canonicalCardId} needs a concrete judgeReason`);
  const { judgeReason: _judgeReason, ...rest } = program;
  return { ...rest, status: "executable" };
}

const acceptableLossesView = executableView(acceptableLosses);
const thermoBeamView = executableView(thermoBeam);
const brittleSteelView = executableView(brittleSteel);
const publicExecutionView = executableView(publicExecution);

// Public Execution's printed "an enemy unit with less Might than it" is a
// Finalize targeting restriction that the merged filter vocabulary cannot
// express: binding the published key throws
// `Unsupported filter field mightLessThanTarget` before the spell can even be
// put on the chain (re-verified 2026-10-17; the shipped program keeps the key).
// This view removes exactly that predicate so the merged target-locking and
// kill/compare slice can be exercised; the resolve-time compare condition and
// both TargetSpecs are unchanged.
const publicExecutionKillView = (() => {
  const view = publicExecutionView;
  return {
    ...view,
    abilities: view.abilities.map(ability => ability.kind !== "play" ? ability : {
      ...ability,
      body: ability.body.map(instruction => ({
        ...instruction,
        targets: instruction.targets.map(spec => spec.id !== "public-execution.enemy-unit" ? spec : {
          ...spec,
          filter: { type: "unit", zone: "board", controller: "opponent" }
        })
      }))
    })
  };
})();

// One cast: play from hand, then both players pass into resolution.
const resolveSpell = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

const rows = [
  {
    name: "Acceptable Losses · Action admission pays 1 Energy and locks no target",
    canonicalCardId: acceptableLosses.canonicalCardId,
    program: acceptableLossesView,
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: acceptableLossesView.canonicalCardId, program: acceptableLossesView, types: ["spell"], zone: "hand", energy: 1, power: null, might: null },
        { id: "a-gear", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "b-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "b-unit", owner: "B", types: ["unit"], zone: "board", might: 4 },
      ],
      // Only the admission slice is asserted: resolving "Each player kills one
      // of their gear" needs the per-player chooser, so no pick is invented and
      // no outcome is asserted for the unresolved choice.
      operations: [{ type: "play", object: "spell", player: "A" }],
      expect: {
        objects: {
          spell: { zone: "chain", energy: 1, power: null },
          "a-gear": { zone: "board", energy: null, power: null },
          "b-gear": { zone: "board", energy: null, power: null },
          "b-unit": { zone: "board", might: 4 },
        },
        players: { A: { energy: 0 } },
        events: { sequence: [{ timingPoint: "object-enters-chain", object: { ref: "spell" } }, { timingPoint: "chain-item-finalize" }] },
      },
    },
  },
  {
    name: "Thermo Beam · Action admission finalizes the printed 5 Energy + 2 Fury Power cost",
    canonicalCardId: thermoBeam.canonicalCardId,
    program: thermoBeamView,
    scenario: {
      players: { A: { energy: 5, power: ["Fury", "Fury"] } },
      objects: [
        { id: "spell", cardId: thermoBeamView.canonicalCardId, program: thermoBeamView, types: ["spell"], zone: "hand", energy: 5, power: ["Fury"], might: null },
        { id: "a-gear", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "b-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "gear-unit", owner: "B", types: ["unit", "gear"], zone: "board", might: 3 },
        { id: "plain-unit", owner: "B", types: ["unit"], zone: "board", might: 4 },
        { id: "hand-gear", types: ["gear"], zone: "hand", energy: null, power: null, might: null },
        { id: "trash-gear", owner: "B", types: ["gear"], zone: "trash", energy: null, power: null, might: null },
      ],
      // "Kill all gear" cannot resolve yet (see the TODO and the gap-evidence
      // test below), so only the admission/payment slice is asserted; every
      // gear is still on the board. The harness's pay action debits Energy and
      // XP only, so the planned Power is checked through the cost plan and the
      // payment receipt instead of a Power pool assertion.
      operations: [{ type: "play", object: "spell", player: "A" }],
      expect: {
        objects: {
          spell: { zone: "chain", energy: 5 },
          "a-gear": { zone: "board" },
          "b-gear": { zone: "board" },
          "gear-unit": { zone: "board" },
          "plain-unit": { zone: "board" },
          "hand-gear": { zone: "hand", energy: null, power: null },
          "trash-gear": { zone: "trash" },
        },
        players: { A: { energy: 0 } },
        events: { sequence: [{ timingPoint: "object-enters-chain", object: { ref: "spell" } }, { timingPoint: "chain-item-finalize" }] },
      },
    },
  },
  {
    name: "Brittle Steel · 'Kill a gear' locks one enemy gear through Finalize and kills it",
    canonicalCardId: brittleSteel.canonicalCardId,
    program: brittleSteelView,
    scenario: {
      players: { A: { energy: 2, power: ["Fury"] } },
      objects: [
        { id: "spell", cardId: brittleSteelView.canonicalCardId, program: brittleSteelView, types: ["spell"], zone: "hand", energy: 2, power: ["Fury"], might: null },
        { id: "enemy-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "friendly-gear", types: ["gear"], zone: "board", energy: null, power: null, might: null },
        { id: "enemy-unit", owner: "B", types: ["unit"], zone: "board", might: 4 },
      ],
      answers: { "target:brittle-steel.gear": ["enemy-gear"] },
      operations: resolveSpell,
      expect: {
        objects: {
          spell: { zone: "trash", power: ["Fury"] },
          "enemy-gear": { zone: "trash", owner: "B", energy: null, power: null },
          "friendly-gear": { zone: "board" },
          "enemy-unit": { zone: "board" },
        },
        players: { A: { energy: 0 } },
        events: { sequence: [
          { timingPoint: "became-target", target: { ref: "enemy-gear" }, source: { ref: "spell" } },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "object-killed", object: { ref: "enemy-gear" }, action: { type: "kill", object: "enemy-gear" } },
          { timingPoint: "card-played", object: { ref: "spell" } },
        ] },
        links: { "brittle-steel.kill-gear.killed": [{ id: "enemy-gear", zoneEntryId: 1 }] },
      },
    },
  },
  {
    name: "Public Execution · the chosen weaker enemy is killed through the real kill path",
    canonicalCardId: publicExecution.canonicalCardId,
    program: publicExecutionKillView,
    scenario: {
      players: { A: { energy: 2, power: ["Body"] } },
      objects: [
        { id: "spell", cardId: publicExecutionKillView.canonicalCardId, program: publicExecutionKillView, types: ["spell"], zone: "hand", energy: 2, power: ["Body"], might: null },
        { id: "friendly", types: ["unit"], zone: "board", might: 5 },
        { id: "weak-enemy", owner: "B", types: ["unit"], zone: "board", might: 4 },
        { id: "strong-enemy", owner: "B", types: ["unit"], zone: "board", might: 6 },
        { id: "equal-enemy", owner: "B", types: ["unit"], zone: "board", might: 5 },
      ],
      answers: {
        "target:public-execution.friendly-unit": ["friendly"],
        "target:public-execution.enemy-unit": ["weak-enemy"],
      },
      operations: resolveSpell,
      expect: {
        objects: {
          spell: { zone: "trash", power: ["Body"] },
          friendly: { zone: "board", might: 5 },
          "weak-enemy": { zone: "trash", owner: "B" },
          "strong-enemy": { zone: "board", might: 6 },
          "equal-enemy": { zone: "board", might: 5 },
        },
        players: { A: { energy: 0 } },
        events: { sequence: [
          { timingPoint: "became-target", target: { ref: "friendly" } },
          { timingPoint: "became-target", target: { ref: "weak-enemy" } },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "object-killed", object: { ref: "weak-enemy" } },
          { timingPoint: "card-played", object: { ref: "spell" } },
        ] },
        links: { "public-execution.kill-lesser-enemy.killed": [{ id: "weak-enemy", zoneEntryId: 1 }] },
      },
    },
  },
];

// Card-specific checks on the results the rows above produce. Each identity
// asserts its own cost plan, target/event shape and links; none of them is
// shared between rows.
const rowChecks = new Map([
  [acceptableLosses.canonicalCardId, result => {
    const [item] = result.state.chain;
    assert.equal(item.status, "finalized");
    assert.equal(item.speed, "action");
    assert.equal(item.payment.paid, true);
    assert.equal(item.costPlan.total.energy, 1);
    assert.deepEqual(item.costPlan.total.power, []);
    // 355.10.e: "Each player kills one of their gear" never targets, so the
    // finalized spell emits no became-target event for either player's gear.
    assert.equal(result.events.filter(event => event.timingPoint === "became-target").length, 0);
    assert.equal(result.events.filter(event => event.timingPoint === "object-killed").length, 0);
  }],
  [thermoBeam.canonicalCardId, result => {
    const [item] = result.state.chain;
    assert.equal(item.status, "finalized");
    assert.equal(item.speed, "action");
    assert.equal(item.payment.paid, true);
    assert.equal(item.costPlan.total.energy, 5);
    assert.deepEqual(item.costPlan.total.power, [{ amount: 2, allowedDomains: ["Fury"] }]);
    assert.deepEqual(item.payment.actions[0].action.plan.power, ["Fury", "Fury"]);
    assert.equal(result.events.filter(event => event.timingPoint === "became-target").length, 0);
  }],
  [brittleSteel.canonicalCardId, result => {
    assert.equal(result.state.chain.length, 0);
    assert.equal(result.events.filter(event => event.timingPoint === "became-target").length, 1);
    assert.equal(result.events.filter(event => event.timingPoint === "object-killed").length, 1);
    assert.deepEqual(result.links["brittle-steel.kill-gear.killed"], [{ id: "enemy-gear", zoneEntryId: 1 }]);
  }],
  [publicExecution.canonicalCardId, result => {
    assert.equal(result.state.chain.length, 0);
    // 355.5/355.8/355.12: both "Choose a friendly unit" and the enemy unit are
    // chosen as the spell is finalized, in that order.
    assert.deepEqual(
      result.events.filter(event => event.timingPoint === "became-target").map(event => event.target.ref.id),
      ["friendly", "weak-enemy"]
    );
    assert.equal(result.events.filter(event => event.timingPoint === "object-killed").length, 1);
    assert.deepEqual(result.links["public-execution.kill-lesser-enemy.killed"], [{ id: "weak-enemy", zoneEntryId: 1 }]);
  }],
]);

for (const row of defineTemplateSuite("RIFT-701 keyword+play || effect.kill", rows)) {
  if (row.canonicalCardId === brittleSteel.canonicalCardId || row.canonicalCardId === publicExecution.canonicalCardId) {
    test.todo(`${row.name} — Unsupported replacement opcode: effect.banish; missing Flow leave-chain banish replacement consumer`);
    continue;
  }
  test(row.name, () => {
    // The declared program is the shipped one; a partial execution view never
    // promotes a card in the registry.
    assert.equal(published.get(row.canonicalCardId)?.status, "judge-required");
    const result = row.run();
    rowChecks.get(row.canonicalCardId)(result);
  });
}

// Boundary coverage for the same group. Each row keeps one card's printed
// restriction and exercises the merged path's fail-closed handling.
const boundaryRows = [
  {
    name: "Public Execution boundary · equal Might is not 'less Might', so the kill is negated",
    canonicalCardId: publicExecution.canonicalCardId,
    program: publicExecutionKillView,
    scenario: {
      players: { A: { energy: 2, power: ["Body"] } },
      objects: [
        { id: "spell", cardId: publicExecutionKillView.canonicalCardId, program: publicExecutionKillView, types: ["spell"], zone: "hand", energy: 2, power: ["Body"], might: null },
        { id: "friendly", types: ["unit"], zone: "board", might: 5 },
        { id: "equal-enemy", owner: "B", types: ["unit"], zone: "board", might: 5 },
      ],
      answers: {
        "target:public-execution.friendly-unit": ["friendly"],
        "target:public-execution.enemy-unit": ["equal-enemy"],
      },
      operations: resolveSpell,
      expect: {
        objects: { spell: { zone: "trash" }, friendly: { zone: "board" }, "equal-enemy": { zone: "board", might: 5 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "spell" } }] },
      },
    },
  },
  {
    name: "Public Execution boundary · an enemy without less Might is never killed",
    canonicalCardId: publicExecution.canonicalCardId,
    program: publicExecutionKillView,
    scenario: {
      players: { A: { energy: 2, power: ["Body"] } },
      objects: [
        { id: "spell", cardId: publicExecutionKillView.canonicalCardId, program: publicExecutionKillView, types: ["spell"], zone: "hand", energy: 2, power: ["Body"], might: null },
        { id: "friendly", types: ["unit"], zone: "board", might: 2 },
        { id: "strong-enemy", owner: "B", types: ["unit"], zone: "board", might: 6 },
      ],
      answers: {
        "target:public-execution.friendly-unit": ["friendly"],
        "target:public-execution.enemy-unit": ["strong-enemy"],
      },
      operations: resolveSpell,
      expect: {
        objects: { spell: { zone: "trash" }, friendly: { zone: "board", might: 2 }, "strong-enemy": { zone: "board", might: 6 } },
        players: { A: { energy: 0 } },
      },
    },
  },
];

const boundaryChecks = new Map([
  [publicExecution.canonicalCardId, result => {
    // 359.3.e.2: a target that no longer meets the restriction makes the
    // instruction negated; no kill action and no kill link are produced.
    assert.equal(result.events.filter(event => event.timingPoint === "object-killed").length, 0);
    assert.equal(Object.hasOwn(result.links, "public-execution.kill-lesser-enemy.killed"), false);
  }],
]);

for (const row of defineTemplateSuite("RIFT-701 keyword+play || effect.kill boundary", boundaryRows)) {
  test.todo(`${row.name} — Unsupported replacement opcode: effect.banish; missing Flow leave-chain banish replacement consumer`);
}

test.todo("RIFT-701 boundary: Brittle Steel with no gear on the board has no legal target — Unsupported replacement opcode: effect.banish; missing Flow leave-chain banish replacement consumer");
test.todo("RIFT-701 boundary: Public Execution with no legal enemy unit has no legal target — Unsupported replacement opcode: effect.banish; missing Flow leave-chain banish replacement consumer");

test("RIFT-701 boundary: Thermo Beam cannot be played without its printed resources", () => {
  const scenario = resources => ({
    players: { A: resources },
    objects: [
      { id: "spell", cardId: thermoBeamView.canonicalCardId, program: thermoBeamView, types: ["spell"], zone: "hand", energy: 5, power: ["Fury"], might: null },
      { id: "b-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
    ],
    operations: [{ type: "play", object: "spell", player: "A" }],
  });
  // 5 Energy + 2 Fury Power are printed: neither half may be waived.
  assert.throws(() => runCardScenario(thermoBeamView, scenario({ energy: 4, power: ["Fury", "Fury"] })),
    error => error?.reason === "cannot-pay-cost");
  assert.throws(() => runCardScenario(thermoBeamView, scenario({ energy: 5, power: ["Fury"] })),
    error => error?.reason === "cannot-pay-cost");
  assert.throws(() => runCardScenario(thermoBeamView, scenario({ energy: 5, power: ["Calm", "Calm"] })),
    error => error?.reason === "cannot-pay-cost");
});

// The printed clauses that keep each card judge-required are unchanged by this
// template. They are recorded here so a future promotion must delete exactly
// this evidence: Acceptable Losses' per-player chooser, Thermo Beam's
// untargeted set, and the Flow wiring both Flow cards still need.
test("RIFT-701 gap evidence: Thermo Beam's untargeted query kill cannot resolve through the merged primitive", () => {
  // 355.5/355.10.d: "Kill all gear" is a programmatic set with no choice step,
  // but effect.kill only consumes target/picks/self; its schema rejects the
  // printed characteristic query as soon as the spell resolves (re-verified
  // 2026-10-17). Reaching resolution with the merged primitive therefore fails
  // loudly instead of killing an invented target set.
  assert.throws(() => runCardScenario(thermoBeamView, {
    players: { A: { energy: 5, power: ["Fury", "Fury"] } },
    objects: [
      { id: "spell", cardId: thermoBeamView.canonicalCardId, program: thermoBeamView, types: ["spell"], zone: "hand", energy: 5, power: ["Fury"], might: null },
      { id: "b-gear", owner: "B", types: ["gear"], zone: "board", energy: null, power: null, might: null },
    ],
    operations: resolveSpell,
  }), /effect\.kill requires args\.target, args\.picks, or args\.self: true/);
});

test("RIFT-701 gap evidence: Public Execution's printed relative-Might filter cannot even be bound", () => {
  // 355.9.b / 143.2.a: the Finalize restriction is part of the printed text.
  // programs/filters.ts rejects the unknown key while binding the play ability
  // (re-verified 2026-10-17), so the shipped program never reaches Finalize.
  assert.throws(() => runCardScenario(publicExecutionView, {
    players: { A: { energy: 2, power: ["Body"] } },
    objects: [
      { id: "spell", cardId: publicExecution.canonicalCardId, program: publicExecutionView, types: ["spell"], zone: "hand", energy: 2, power: ["Body"], might: null },
      { id: "friendly", types: ["unit"], zone: "board", might: 5 },
      { id: "weak-enemy", owner: "B", types: ["unit"], zone: "board", might: 2 },
    ],
    answers: {
      "target:public-execution.friendly-unit": ["friendly"],
      "target:public-execution.enemy-unit": ["weak-enemy"],
    },
    operations: [{ type: "play", object: "spell", player: "A" }],
  }), /Unsupported filter field mightLessThanTarget/);
});

test("RIFT-701: the shipped programs still document the unsupported printed clauses", () => {
  assert.match(acceptableLosses.judgeReason, /355\.10\.e/);
  assert.match(acceptableLosses.judgeReason, /412\.1/);
  assert.match(acceptableLosses.judgeReason, /chooser\/controller/);
  assert.match(thermoBeam.judgeReason, /355\.10\.d/);
  assert.match(thermoBeam.judgeReason, /355\.5/);
  assert.match(thermoBeam.judgeReason, /each\/all/);
  assert.match(brittleSteel.judgeReason, /829\.1\.c/);
  assert.match(brittleSteel.judgeReason, /no layer mapping/);
  assert.match(brittleSteel.judgeReason, /Unsupported replacement opcode/);
  assert.match(publicExecution.judgeReason, /mightLessThanTarget/);
  assert.match(publicExecution.judgeReason, /143\.2\.a/);
  assert.match(publicExecution.judgeReason, /params\.cost/);
});

test.todo("RIFT-701: Acceptable Losses still needs the per-player resolution-time chooser and kill responsibility (CR 355.10.e / 412.1)");
test.todo("RIFT-701: Thermo Beam still needs an untargeted each/all characteristic set consumed by effect.kill (CR 355.5 / 355.10.d)");
test.todo("RIFT-701: Brittle Steel still needs the printed Flow cost channel, Trash play permission and the delayed banish replacement (CR 829.1)");
test.todo("RIFT-701: Public Execution still needs the relative-Might Finalize predicate and the same Flow wiring (CR 355.9.b / 143.2.a / 829.1)");
