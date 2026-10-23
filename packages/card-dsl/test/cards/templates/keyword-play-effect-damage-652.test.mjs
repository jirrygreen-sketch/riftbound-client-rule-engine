// RIFT-652 template-level golden for the keyword+play||effect.damage group.
//
// All four source programs stay judge-required: each judgeReason names a real
// merged-engine gap, and a passing partial probe is not whole-card evidence.
// runCardScenario refuses judge-required programs, so every row below passes a
// metadata-only view (status/judgeReason lifted; abilities, printed cost,
// targets, sourceText and canonicalCardId untouched). Where a row stops before
// the full card resolves, the exact production blocker is asserted separately
// in this file so the partial path can never be read as an execution claim.
//
// The one field-level slice is Bellows Breath's unsupported [Repeat] cost
// declaration (the field its judgeReason names as unconnected); that row keeps
// the card's own [Action] keyword, body, targets, min/max/selection/kind and
// identity so the merged damage half runs through the real chain, target,
// interpreter and damage paths.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import repeat from "../../../../engine-core/dist/effects/keywords/Repeat.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

import cannonBarrage from "../../../dist/cards/ogn/cannon-barrage.js";
import flurryOfBlades from "../../../dist/cards/ogn/flurry-of-blades.js";
import scorchedEarth from "../../../dist/cards/rad/scorched-earth.js";
import bellowsBreath from "../../../dist/cards/sfd/bellows-breath.js";
import retreat from "../../../dist/cards/ogn/retreat.js";

const battlefieldOne = { type: "battlefield", id: "bf-1" };
const battlefieldTwo = { type: "battlefield", id: "bf-2" };
const baseB = { type: "base", player: "B" };
const playAndFinalize = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
];
const playAndResolve = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

/** Lift only the metadata gate; the original abilities, cost and text stay. */
function scenarioView(program) {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason?.trim());
  const { judgeReason, ...data } = program;
  return { ...data, status: "executable" };
}

// The [Repeat] additional cost is the single field programs/play.ts
// translateCost rejects ("Unsupported play cost field optional"), which is the
// wiring gap named in the card's judgeReason. Everything else is the card.
const { cost: _unsupportedRepeatCost, ...bellowsDamageHalfPlay } = bellowsBreath.abilities[1];
const bellowsDamageHalf = {
  ...scenarioView(bellowsBreath),
  abilities: [bellowsBreath.abilities[0], bellowsDamageHalfPlay],
};

const rows = [
  {
    name: "Cannon Barrage · [Reaction] is admitted and the non-target enemy set is finalized without became-target (355.10.d)",
    canonicalCardId: cannonBarrage.canonicalCardId,
    source: cannonBarrage,
    program: scenarioView(cannonBarrage),
    scenario: {
      players: { A: { energy: 2, power: ["Body"] } },
      objects: [
        { id: "spell", cardId: cannonBarrage.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Body"] },
        { id: "enemy-attacker", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 4, combatRole: "attacker" },
        { id: "enemy-defender", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 4, combatRole: "defender" },
        { id: "enemy-idle", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 4 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 3 },
      ],
      operations: playAndFinalize,
      expect: {
        objects: {
          spell: { zone: "chain" },
          "enemy-attacker": { damage: 0 },
          "enemy-defender": { damage: 0 },
          "enemy-idle": { damage: 0 },
          ally: { damage: 0 },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "chain-item-finalize" }] },
      },
    },
    check: (result, row) => {
      const [item] = result.state.chain;
      assert.equal(item.status, "finalized");
      assert.equal(item.kind, "spell");
      assert.equal(item.speed, "reaction");
      assert.deepEqual(item.body.map(instruction => [instruction.id, instruction.op]), [
        ["deal-2-in-combat", "effect.damage"],
      ]);
      // The authored amount and the 355.10.d set descriptor survive Finalize.
      assert.deepEqual(item.body[0].args, row.source.abilities[1].body[0].args);
      assert.equal(item.body[0].targets, undefined);
      // A programmatically selected set never becomes a target (355.7, 754).
      assert.deepEqual(result.events.filter(event => event.timingPoint === "became-target"), []);
    },
  },
  {
    name: "Flurry of Blades · [Reaction] is admitted and the battlefield set is finalized without became-target (355.10.d)",
    canonicalCardId: flurryOfBlades.canonicalCardId,
    source: flurryOfBlades,
    program: scenarioView(flurryOfBlades),
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: flurryOfBlades.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: null },
        { id: "bf-ally", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 3 },
        { id: "bf-enemy", owner: "B", types: ["unit"], zone: "board", location: battlefieldTwo, might: 3 },
        { id: "base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 3 },
      ],
      operations: playAndFinalize,
      expect: {
        objects: { spell: { zone: "chain" }, "bf-ally": { damage: 0 }, "bf-enemy": { damage: 0 }, "base-unit": { damage: 0 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "chain-item-finalize" }] },
      },
    },
    check: (result, row) => {
      const [item] = result.state.chain;
      assert.equal(item.status, "finalized");
      assert.equal(item.speed, "reaction");
      assert.deepEqual(item.body.map(instruction => [instruction.id, instruction.op]), [
        ["flurry-of-blades.deal-1-to-units-at-battlefields", "effect.damage"],
      ]);
      assert.deepEqual(item.body[0].args, row.source.abilities[1].body[0].args);
      assert.equal(item.body[0].targets, undefined);
      assert.deepEqual(result.events.filter(event => event.timingPoint === "became-target"), []);
      // The authored filter really selects Board units at battlefields only.
      const filter = row.source.abilities[1].body[0].args.objects.value.filter;
      const layered = object => ({
        ...object,
        printed: object,
        actionTimings: [],
        availableTimings: [],
        movement: { allowed: true, canMove: true, canGank: false, restrictions: [] },
        text: null,
        effectText: null,
      });
      assert.equal(matchesObjectFilter(filter, layered({ ref: { id: "bf-unit", zoneEntryId: 1 }, controller: "B", owner: "B", zone: "board", location: battlefieldOne, types: ["unit"], tags: [], keywords: [] })), true);
      assert.equal(matchesObjectFilter(filter, layered({ ref: { id: "base-unit", zoneEntryId: 1 }, controller: "B", owner: "B", zone: "board", location: baseB, types: ["unit"], tags: [], keywords: [] })), false);
    },
  },
  {
    name: "Scorched Earth · [Action] locks each split-damage unit as a target at Finalize (355.14.a/b/c)",
    canonicalCardId: scorchedEarth.canonicalCardId,
    source: scorchedEarth,
    program: scenarioView(scorchedEarth),
    scenario: {
      players: { A: { energy: 4, power: ["Fury"] } },
      objects: [
        { id: "spell", cardId: scorchedEarth.canonicalCardId, types: ["spell"], zone: "hand", energy: 4, power: ["Fury"] },
        { id: "enemy-one", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 4 },
        { id: "enemy-two", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 4 },
        { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: battlefieldTwo, might: 4 },
        { id: "base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 4 },
      ],
      answers: { "target:scorched-earth.units": ["enemy-one", "enemy-two"] },
      operations: playAndFinalize,
      expect: {
        objects: { spell: { zone: "chain" }, "enemy-one": { damage: 0 }, "enemy-two": { damage: 0 }, "enemy-elsewhere": { damage: 0 }, "base-unit": { damage: 0 } },
        players: { A: { energy: 0 } },
        events: {
          includes: [
            { timingPoint: "became-target", target: { ref: "enemy-one" }, source: { ref: "spell" } },
            { timingPoint: "became-target", target: { ref: "enemy-two" }, source: { ref: "spell" } },
            { timingPoint: "chain-item-finalize" },
          ],
        },
      },
    },
    check: result => {
      const [item] = result.state.chain;
      assert.equal(item.status, "finalized");
      assert.equal(item.targetPlans.length, 1);
      const [plan] = item.targetPlans;
      assert.equal(plan.requirement.id, "scorched-earth.units");
      assert.equal(plan.requirement.max, 5); // 355.14.c: at most the printed 5
      assert.equal(plan.requirement.group, true); // "at a single battlefield" marker
      assert.deepEqual(plan.selected.map(ref => ref.id), ["enemy-one", "enemy-two"]);
      // The division itself is asked at resolution (355.14.e), not at Finalize.
      assert.deepEqual(result.events.filter(event => event.timingPoint === "damage-dealt"), []);
    },
  },
  {
    name: "Bellows Breath · the printed Deal 1 hits each of up to three chosen units (355.13)",
    canonicalCardId: bellowsBreath.canonicalCardId,
    source: bellowsBreath,
    program: bellowsDamageHalf,
    scenario: {
      players: { A: { energy: 1, power: ["Mind"] } },
      objects: [
        { id: "spell", cardId: bellowsBreath.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: ["Mind"] },
        { id: "unit-one", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
        { id: "unit-two", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
        { id: "unit-three", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
        { id: "unlocked", owner: "A", types: ["unit"], zone: "board", location: battlefieldTwo, might: 2 },
      ],
      answers: { "target:bellows-breath.units": ["unit-one", "unit-two", "unit-three"] },
      operations: playAndResolve,
      expect: {
        objects: {
          spell: { zone: "trash" },
          "unit-one": { damage: 1 },
          "unit-two": { damage: 1 },
          "unit-three": { damage: 1 },
          unlocked: { damage: 0 },
        },
        players: { A: { energy: 0 } },
        links: {
          "bellows-breath.deal-1.dealt": 3,
          "bellows-breath.deal-1.dealtCount": 3,
          "bellows-breath.deal-1.dealtTo": [
            { target: { id: "unit-one" }, amount: 1 },
            { target: { id: "unit-two" }, amount: 1 },
            { target: { id: "unit-three" }, amount: 1 },
          ],
        },
        events: { includes: [
          { timingPoint: "damage-dealt", action: { type: "damage", target: "unit-one", amount: 1 } },
          { timingPoint: "damage-dealt", action: { type: "damage", target: "unit-two", amount: 1 } },
          { timingPoint: "damage-dealt", action: { type: "damage", target: "unit-three", amount: 1 } },
        ] },
      },
    },
    check: result => {
      assert.deepEqual(result.state.chain, []);
      assert.equal(result.events.filter(event => event.timingPoint === "damage-dealt").length, 3);
    },
  },
];

for (const [index, entry] of defineTemplateSuite("keyword+play || effect.damage / RIFT-652", rows).entries()) {
  const row = rows[index];
  test(entry.name, () => {
    // The production gate stays closed; the row's window into it never mutates
    // the source program's abilities, cost or identity.
    assert.equal(row.source.status, "judge-required");
    const result = entry.run();
    row.check(result, row);
  });
}

// ---------------------------------------------------------------------------
// Boundaries: each card's own printed amount through the merged damage
// primitive, plus the fail-closed production blockers.
// ---------------------------------------------------------------------------

test(`Cannon Barrage [${cannonBarrage.canonicalCardId}]: the printed 2 applies per locked in-combat unit; an empty lock is ignored`, () => {
  const amount = cannonBarrage.abilities[1].body[0].args.amount;
  const kernel = world()
    .unit("enemy-attacker", { owner: "B", location: battlefieldOne, might: 4, combatRole: "attacker" })
    .unit("enemy-defender", { owner: "B", location: battlefieldOne, might: 4, combatRole: "defender" })
    .unit("enemy-idle", { owner: "B", location: battlefieldOne, might: 4 })
    .unit("ally", { owner: "A", location: battlefieldOne, might: 3, combatRole: "defender" })
    .build();
  const locked = runInstruction(damage, { amount, target: "cannon-barrage.in-combat" }, {
    world: kernel,
    targets: { "cannon-barrage.in-combat": [kernel.ref("enemy-attacker"), kernel.ref("enemy-defender")] },
  });
  assert.equal(locked.result.status, "executed");
  assert.equal(locked.linked.dealt, 4);
  assert.equal(locked.linked.dealtCount, 2);
  assert.equal(kernel.getObject("enemy-attacker").damage, 2);
  assert.equal(kernel.getObject("enemy-defender").damage, 2);
  // 740.2.c excludes units without a combat designation, and 355.10.d keeps
  // friendly units out of the opponent set.
  assert.equal(kernel.getObject("enemy-idle").damage, 0);
  assert.equal(kernel.getObject("ally").damage, 0);

  const empty = runInstruction(damage, { amount, target: "cannon-barrage.in-combat" }, {
    world: world().unit("enemy-idle", { owner: "B", location: battlefieldOne, might: 4 }).build(),
    targets: { "cannon-barrage.in-combat": [] },
  });
  assert.deepEqual(empty.result, { status: "ignored", reason: "mistargeted" });
});

test(`Cannon Barrage [${cannonBarrage.canonicalCardId}]: the authored non-target set deals 2 in production without targeting`, () => {
  const result = runCardScenario(scenarioView(cannonBarrage), {
    players: { A: { energy: 2, power: ["Body"] } },
    objects: [
      { id: "spell", cardId: cannonBarrage.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: ["Body"] },
      { id: "enemy-attacker", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 4, combatRole: "attacker" },
      { id: "ally", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 3 },
    ],
    operations: playAndResolve,
    expect: {
      objects: { spell: { zone: "trash" }, "enemy-attacker": { damage: 2 }, ally: { damage: 0 } },
      players: { A: { energy: 0 } },
    },
  });
  result.asserts();
  assert.deepEqual(result.events.filter(event => event.timingPoint === "became-target"), []);
  assert.equal(result.events.filter(event => event.timingPoint === "damage-dealt").length, 1);
});

test(`Flurry of Blades [${flurryOfBlades.canonicalCardId}]: the printed 1 hits each locked battlefield unit; an empty lock is ignored`, () => {
  const amount = flurryOfBlades.abilities[1].body[0].args.amount;
  const kernel = world()
    .unit("bf-ally", { owner: "A", location: battlefieldOne, might: 3 })
    .unit("bf-enemy", { owner: "B", location: battlefieldTwo, might: 3 })
    .unit("base-unit", { owner: "B", location: baseB, might: 3 })
    .build();
  const locked = runInstruction(damage, { amount, target: "flurry-of-blades.units-at-battlefields" }, {
    world: kernel,
    targets: { "flurry-of-blades.units-at-battlefields": [kernel.ref("bf-ally"), kernel.ref("bf-enemy")] },
  });
  assert.equal(locked.result.status, "executed");
  assert.equal(locked.linked.dealt, 2);
  assert.equal(locked.linked.dealtCount, 2);
  assert.equal(kernel.getObject("bf-ally").damage, 1);
  assert.equal(kernel.getObject("bf-enemy").damage, 1);
  assert.equal(kernel.getObject("base-unit").damage, 0);

  const empty = runInstruction(damage, { amount, target: "flurry-of-blades.units-at-battlefields" }, {
    world: world().base("base-unit", { owner: "B", location: baseB, might: 3 }).build(),
    targets: { "flurry-of-blades.units-at-battlefields": [] },
  });
  assert.deepEqual(empty.result, { status: "ignored", reason: "mistargeted" });
});

test(`Flurry of Blades [${flurryOfBlades.canonicalCardId}]: the authored non-target set hits battlefield units in production`, () => {
  const result = runCardScenario(scenarioView(flurryOfBlades), {
    players: { A: { energy: 1 } },
    objects: [
      { id: "spell", cardId: flurryOfBlades.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: null },
      { id: "bf-unit", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 3 },
      { id: "base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 3 },
    ],
    operations: playAndResolve,
    expect: {
      objects: { spell: { zone: "trash" }, "bf-unit": { damage: 1 }, "base-unit": { damage: 0 } },
      players: { A: { energy: 0 } },
    },
  });
  result.asserts();
  assert.deepEqual(result.events.filter(event => event.timingPoint === "became-target"), []);
  assert.equal(result.events.filter(event => event.timingPoint === "damage-dealt").length, 1);
});

test(`Scorched Earth [${scorchedEarth.canonicalCardId}]: no unit at a battlefield is rejected at Finalize`, () => {
  assert.throws(
    () => runCardScenario(scenarioView(scorchedEarth), {
      players: { A: { energy: 4, power: ["Fury"] } },
      objects: [
        { id: "spell", cardId: scorchedEarth.canonicalCardId, types: ["spell"], zone: "hand", energy: 4, power: ["Fury"] },
        { id: "base-unit", owner: "B", types: ["unit"], zone: "board", location: baseB, might: 4 },
      ],
      operations: [{ type: "play", object: "spell", player: "A" }],
    }),
    error => error?.code === "no-legal-targets",
  );
});

test(`Scorched Earth [${scorchedEarth.canonicalCardId}]: the printed 5 splits 3/2 and an illegal answer negates without damage`, () => {
  const amount = scorchedEarth.abilities[1].body[0].args.amount;
  const legalKernel = world()
    .unit("enemy-one", { owner: "B", location: battlefieldOne, might: 4 })
    .unit("enemy-two", { owner: "B", location: battlefieldOne, might: 4 })
    .unit("base-unit", { owner: "B", location: baseB, might: 4 })
    .build();
  const legal = runInstruction(damage, { amount, target: "scorched-earth.units", divide: true }, {
    world: legalKernel,
    targets: { "scorched-earth.units": [legalKernel.ref("enemy-one"), legalKernel.ref("enemy-two")] },
    answers: { "effect.damage:divide:0": 3, "effect.damage:divide:1": 2 },
  });
  assert.equal(legal.result.status, "executed");
  assert.equal(legal.linked.dealt, 5); // 355.14.f/.g: positive integers summing to 5
  assert.equal(legal.linked.dealtCount, 2);
  assert.equal(legalKernel.getObject("enemy-one").damage, 3);
  assert.equal(legalKernel.getObject("enemy-two").damage, 2);
  assert.equal(legalKernel.getObject("base-unit").damage, 0);
  assert.deepEqual(legal.events.map(event => event.action), ["damage", "damage"]);

  const illegalKernel = world()
    .unit("enemy-one", { owner: "B", location: battlefieldOne, might: 4 })
    .unit("enemy-two", { owner: "B", location: battlefieldOne, might: 4 })
    .build();
  const illegal = runInstruction(damage, { amount, target: "scorched-earth.units", divide: true }, {
    world: illegalKernel,
    targets: { "scorched-earth.units": [illegalKernel.ref("enemy-one"), illegalKernel.ref("enemy-two")] },
    answers: { "effect.damage:divide:0": 5, "effect.damage:divide:1": 0 },
  });
  assert.deepEqual(illegal.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(illegalKernel.getObject("enemy-one").damage, 0);
  assert.equal(illegalKernel.getObject("enemy-two").damage, 0);
});

test(`Scorched Earth [${scorchedEarth.canonicalCardId}]: the authored divide flag is rejected by the production chain adapter`, () => {
  // chain/interpreter-adapter.ts decodes only target/combat for effect.damage,
  // so the card's Expr-shaped divide flag never reaches the primitive's
  // `divide === true` check (355.14.e).
  assert.throws(
    () => runCardScenario(scenarioView(scorchedEarth), {
      players: { A: { energy: 4, power: ["Fury"] } },
      objects: [
        { id: "spell", cardId: scorchedEarth.canonicalCardId, types: ["spell"], zone: "hand", energy: 4, power: ["Fury"] },
        { id: "enemy-one", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 4 },
        { id: "enemy-two", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 4 },
      ],
      answers: { "target:scorched-earth.units": ["enemy-one", "enemy-two"], "effect.damage:divide:0": 3, "effect.damage:divide:1": 2 },
      operations: playAndResolve,
    }),
    { message: "effect.damage args.divide must be true when present" },
  );
});

test(`Scorched Earth [${scorchedEarth.canonicalCardId}]: the split asks the controller for the division at resolution (355.14.e/f)`, () => {
  const amount = scorchedEarth.abilities[1].body[0].args.amount;
  const kernel = world()
    .unit("enemy-one", { owner: "B", location: battlefieldOne, might: 4 })
    .build();
  const asked = runInstruction(damage, { amount, target: "scorched-earth.units", divide: true }, {
    world: kernel,
    targets: { "scorched-earth.units": [kernel.ref("enemy-one")] },
  });
  assert.equal(asked.result, null);
  assert.equal(asked.asked.request.min, 1); // 355.14.f/.g: a positive integer per target
  // Only one locked target: the whole 5 must go to it.
  assert.equal(asked.asked.request.max, 5);
  assert.equal(asked.asked.request.chooser, "A");
  assert.equal(kernel.getObject("enemy-one").damage, 0);
});

test(`Scorched Earth [${scorchedEarth.canonicalCardId}]: a stale locked target ignores the instruction (359.3.e.7)`, () => {
  const amount = scorchedEarth.abilities[1].body[0].args.amount;
  const kernel = world()
    .unit("enemy-one", { owner: "B", location: battlefieldOne, might: 4 })
    .build();
  const stale = kernel.ref("enemy-one");
  kernel.perform({ type: "kill", object: stale });
  const outcome = runInstruction(damage, { amount, target: "scorched-earth.units", divide: true }, {
    world: kernel,
    targets: { "scorched-earth.units": [stale] },
  });
  assert.deepEqual(outcome.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.linked.dealt, undefined);
});

test(`Bellows Breath [${bellowsBreath.canonicalCardId}]: choosing zero units deals no damage (355.13)`, () => {
  const result = runCardScenario(bellowsDamageHalf, {
    players: { A: { energy: 1, power: ["Mind"] } },
    objects: [
      { id: "spell", cardId: bellowsBreath.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: ["Mind"] },
      { id: "unit-one", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
    ],
    answers: { "target:bellows-breath.units": [] },
    operations: playAndResolve,
    expect: { objects: { spell: { zone: "trash" }, "unit-one": { damage: 0 } } },
  });
  result.asserts();
  assert.deepEqual(result.events.filter(event => event.timingPoint === "damage-dealt"), []);
});

test(`Bellows Breath [${bellowsBreath.canonicalCardId}]: choosing fewer than three units damages only them (355.13)`, () => {
  const result = runCardScenario(bellowsDamageHalf, {
    players: { A: { energy: 1, power: ["Mind"] } },
    objects: [
      { id: "spell", cardId: bellowsBreath.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: ["Mind"] },
      { id: "unit-one", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
      { id: "unit-two", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
    ],
    answers: { "target:bellows-breath.units": ["unit-two"] },
    operations: playAndResolve,
    expect: {
      objects: { spell: { zone: "trash" }, "unit-one": { damage: 0 }, "unit-two": { damage: 1 } },
      links: {
        "bellows-breath.deal-1.dealt": 1,
        "bellows-breath.deal-1.dealtCount": 1,
      },
    },
  });
  result.asserts();
  assert.deepEqual(result.links["bellows-breath.deal-1.dealtTo"], [
    { target: { id: "unit-two", zoneEntryId: 1 }, amount: 1 },
  ]);
});

test(`Bellows Breath [${bellowsBreath.canonicalCardId}]: only the still-legal member of a stale set takes damage (359.3.e.8)`, () => {
  const result = runCardScenario(bellowsDamageHalf, {
    players: { A: { energy: 1, power: ["Mind"] }, B: { energy: 1 } },
    objects: [
      { id: "spell", cardId: bellowsBreath.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: ["Mind"] },
      { id: "retreat", program: retreat, owner: "B", types: ["spell"], zone: "hand", energy: 1, power: null },
      { id: "enemy-returned", owner: "B", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
      { id: "ally", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
      { id: "rune-1", owner: "B", types: ["rune"], zone: "rune-deck" },
    ],
    answers: { "target:bellows-breath.units": ["enemy-returned", "ally"], "target:friendly-unit": ["enemy-returned"] },
    operations: [
      { type: "play", object: "spell", player: "A" },
      { type: "pass", player: "A" },
      { type: "play", object: "retreat", player: "B" },
      { type: "pass", player: "B" },
      { type: "pass", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" },
    ],
    expect: {
      objects: { spell: { zone: "trash" }, "enemy-returned": { zone: "hand", damage: 0 }, ally: { damage: 1 } },
      events: { sequence: [
        { timingPoint: "object-enters-hand", object: { ref: "enemy-returned" } },
        { timingPoint: "damage-dealt", action: { target: "ally", amount: 1 } },
      ] },
    },
  });
  result.asserts();
  assert.equal(result.links["bellows-breath.deal-1.dealtCount"], 1);
  assert.deepEqual(result.links["bellows-breath.deal-1.dealtTo"], [
    { target: { id: "ally", zoneEntryId: 1 }, amount: 1 },
  ]);
});

test(`Bellows Breath [${bellowsBreath.canonicalCardId}]: the [Repeat] additional cost has no production Finalize consumer`, () => {
  assert.throws(
    () => runCardScenario(scenarioView(bellowsBreath), {
      players: { A: { energy: 1, power: ["Mind"] } },
      objects: [
        { id: "spell", cardId: bellowsBreath.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: ["Mind"] },
        { id: "unit-one", owner: "A", types: ["unit"], zone: "board", location: battlefieldOne, might: 2 },
      ],
      answers: { "target:bellows-breath.units": ["unit-one"], "bellows-breath.repeat-payment": "decline" },
      operations: [{ type: "play", object: "spell", player: "A" }],
    }),
    error => error?.code === "judge-required" && /Unsupported play cost field optional/.test(error.message),
  );
});

test(`Bellows Breath [${bellowsBreath.canonicalCardId}]: the merged Repeat keyword and repeat node execute the card's own damage body once (820.2)`, () => {
  // The keyword itself expands the printed 1 energy + 1 Mind power shape; a
  // 820.1.c.1 additional cost is paid once for one extra execution, and the
  // paid-instance count has no producer for the card (see judgeReason), so the
  // count here is supplied by the test as the Finalize wiring would.
  const repeatAbilities = repeat.expand({
    host: { canonicalCardId: bellowsBreath.canonicalCardId },
    cost: { energy: 1, power: [{ amount: 1, allowedDomains: ["Mind"] }] },
  });
  assert.equal(repeatAbilities.length, 1);
  assert.equal(repeatAbilities[0].effect.kind, "repeat.cost");
  assert.deepEqual(repeatAbilities[0].effect.cost, {
    energy: 1,
    power: [{ amount: 1, allowedDomains: ["Mind"] }],
  });

  const kernel = world().unit("unit-one", { owner: "A", location: battlefieldOne, might: 2 }).unit("unit-two", { owner: "B", location: battlefieldOne, might: 2 }).build();
  const repeated = [{
    id: "bellows-breath.repeat",
    op: "repeat",
    args: {
      count: { kind: "constant", value: 1 },
      body: { kind: "constant", value: bellowsBreath.abilities[1].body },
    },
  }];
  kernel.setAnswers({
    "bellows-breath.repeat/0/bellows-breath.deal-1/target%3Abellows-breath.units": [kernel.ref("unit-one")],
  });
  const outcome = resolveChainBody(repeated, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results.at(-1).id, "bellows-breath.repeat");
  assert.equal(outcome.results.at(-1).result.linkedValues.count, 1);
  assert.equal(kernel.getObject("unit-one").damage, 1);
  assert.equal(kernel.getObject("unit-two").damage, 0);
});

test(`Scorched Earth [${scorchedEarth.canonicalCardId}]: an undersized split fails closed instead of dropping targets (355.14.h)`, () => {
  // 355.14.h would let the controller drop targets so the remaining damage can
  // be split; with that path missing the primitive must not deal partial
  // damage, so this asserts the fail-closed result rather than the rule.
  const kernel = world()
    .unit("enemy-one", { owner: "B", location: battlefieldOne, might: 4 })
    .unit("enemy-two", { owner: "B", location: battlefieldOne, might: 4 })
    .build();
  const outcome = runInstruction(
    damage,
    { amount: { kind: "constant", value: 1 }, target: "scorched-earth.units", divide: true },
    {
      world: kernel,
      targets: { "scorched-earth.units": [kernel.ref("enemy-one"), kernel.ref("enemy-two")] },
      answers: { "effect.damage:divide:0": 1, "effect.damage:divide:1": 0 },
    },
  );
  assert.deepEqual(outcome.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("enemy-one").damage, 0);
  assert.equal(kernel.getObject("enemy-two").damage, 0);
});

// The printed "at a single battlefield" / "at the same location" group
// coherence and the 355.14.h target reduction are still unavailable, so the
// printed expectation stays a TODO instead of the current cross-battlefield
// acceptance being written as correct.
test.todo(
  "RIFT-652 group boundary: Scorched Earth's chosen units must share one battlefield and Bellows Breath's must share one location " +
    "(355.11.a/b, 355.14.a); TargetRequirement.group is a marker with no evaluating consumer.",
);

test.todo(
  "RIFT-652 target-reduction boundary: 355.14.h lets the damage controller drop targets when the available damage is smaller than the target count; " +
    "effect.damage currently negates (impossible) instead of re-choosing the target set.",
);

test.todo(
  "RIFT-652 combat-designation boundary: ObjectSnapshot.combatRole is only populated by the test kernel; CombatFlow has no producer " +
    "(combat/flow.ts throws combat-start-transaction), so Cannon Barrage's 740.2.c in-combat set cannot be evaluated from live state.",
);
