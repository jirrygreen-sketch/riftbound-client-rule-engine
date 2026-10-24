// RIFT-653: original programs, one whole-card scenario and one supported-body
// golden per identity. Executable cards run the full scenario; judge-required
// cards retain the explicit production guard. No printed cost, keyword, or
// target restriction is replaced for testing.
import assert from "node:assert/strict";
import test from "node:test";

import callToGlory from "../../../dist/cards/ogn/call-to-glory.js";
import dangerZone from "../../../dist/cards/sfd/danger-zone.js";
import feralStrength from "../../../dist/cards/sfd/feral-strength.js";
import decreeOfFocus from "../../../dist/cards/ven/decree-of-focus.js";
import onslaught from "../../../dist/cards/ven/onslaught.js";
import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";

const playAndResolve = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

const rows = [
  {
    name: "Call to Glory: +3 to one Board unit; optional buff cost unresolved",
    canonicalCardId: "card.hash-9eef9a0508648141992bbe70aa56b64551bbd00d06fd8be401c85dda6f542339",
    program: callToGlory,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        { id: "spell", cardId: callToGlory.canonicalCardId, types: ["spell"], zone: "hand", energy: 3, power: null },
        { id: "chosen", types: ["unit"], zone: "board", might: 2, buffs: 1 },
        { id: "other", owner: "B", types: ["unit"], zone: "board", might: 4 },
        { id: "hand-unit", types: ["unit"], zone: "hand", might: 7 },
      ],
      answers: { "target:call-to-glory.unit": ["chosen"], "call-to-glory.spend-buff-payment": "decline" },
      operations: playAndResolve,
      expect: {
        objects: { spell: { zone: "trash", power: null }, chosen: { might: 5, buffs: 1 }, other: { might: 4 }, "hand-unit": { zone: "hand", might: 7 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    supported: {
      makeWorld: () => world()
        .unit("chosen", { might: 2, buffs: 1 })
        .unit("other", { owner: "B", might: 4 })
        .card("hand-unit", { types: ["unit"], zone: "hand", might: 7 })
        .build(),
      targets: { "call-to-glory.unit": ["chosen"] },
      affected: ["chosen"],
      objects: { chosen: { might: 5, buffs: 1 }, other: { might: 4, buffs: 0 }, "hand-unit": { might: 7, buffs: 0 } },
      expired: { chosen: 2, other: 4, "hand-unit": 7 },
    },
  },
  {
    name: "Danger Zone: +1 to each friendly Mech; Repeat declined",
    canonicalCardId: "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e",
    program: dangerZone,
    scenario: {
      players: { A: { energy: 1, power: ["Fury"] } },
      objects: [
        { id: "spell", cardId: dangerZone.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: ["Fury"] },
        { id: "mech-a", types: ["unit"], tags: ["Mech"], zone: "board", might: 2 },
        { id: "mech-b", types: ["unit"], tags: ["Mech"], zone: "board", might: 4 },
        { id: "enemy-mech", owner: "B", types: ["unit"], tags: ["Mech"], zone: "board", might: 5 },
        { id: "grunt", types: ["unit"], zone: "board", might: 3 },
        { id: "hand-mech", types: ["unit"], tags: ["Mech"], zone: "hand", might: 6 },
      ],
      answers: { optional: false },
      operations: playAndResolve,
      expect: {
        objects: { spell: { zone: "trash" }, "mech-a": { might: 3, buffs: 0 }, "mech-b": { might: 5, buffs: 0 }, "enemy-mech": { might: 5 }, grunt: { might: 3 }, "hand-mech": { zone: "hand", might: 6 } },
        players: { A: { energy: 0, power: [] } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    supported: {
      makeWorld: () => world()
        .unit("mech-a", { tags: ["Mech"], might: 2 })
        .unit("mech-b", { tags: ["Mech"], might: 4 })
        .unit("enemy-mech", { owner: "B", tags: ["Mech"], might: 5 })
        .unit("grunt", { might: 3 })
        .card("hand-mech", { types: ["unit"], tags: ["Mech"], zone: "hand", might: 6 })
        .build(),
      affected: ["mech-a", "mech-b"],
      objects: { "mech-a": { might: 3, buffs: 0 }, "mech-b": { might: 5, buffs: 0 }, "enemy-mech": { might: 5, buffs: 0 }, grunt: { might: 3, buffs: 0 }, "hand-mech": { might: 6, buffs: 0 } },
      expired: { "mech-a": 2, "mech-b": 4, "enemy-mech": 5, grunt: 3, "hand-mech": 6 },
    },
  },
  {
    name: "Feral Strength: +2 to an enemy unit; Repeat unresolved",
    canonicalCardId: "card.hash-21fa1dc89f8491be1ad8d778109c30c1266a2ee3c7b7b49e5da837edba0103ee",
    program: feralStrength,
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        { id: "spell", cardId: feralStrength.canonicalCardId, types: ["spell"], zone: "hand", energy: 2, power: null },
        { id: "chosen", owner: "B", types: ["unit"], zone: "board", might: 3 },
        { id: "other", types: ["unit"], zone: "board", might: 4 },
      ],
      answers: { "target:feral-strength.unit": ["chosen"], "feral-strength.repeat-payment": "decline" },
      operations: playAndResolve,
      expect: {
        objects: { spell: { zone: "trash", power: null }, chosen: { might: 5, buffs: 0 }, other: { might: 4 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    supported: {
      makeWorld: () => world().unit("chosen", { owner: "B", might: 3 }).unit("other", { might: 4 }).build(),
      targets: { "feral-strength.unit": ["chosen"] },
      affected: ["chosen"],
      objects: { chosen: { might: 5, buffs: 0 }, other: { might: 4, buffs: 0 } },
      expired: { chosen: 3, other: 4 },
    },
  },
  {
    name: "Decree of Focus: +4 body only; compound Fury target unresolved",
    canonicalCardId: "card.hash-e5eafd33bb50e62c31da83b13c1e44904a8cd4d53760a85e48bbb1fb82d587eb",
    program: decreeOfFocus,
    // No playable whole-card scenario can currently express the combat/Fury
    // relation or pending enemy spell target plan. This records the attempted
    // play and its guard; it makes no claim that this unit is a legal target.
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: decreeOfFocus.canonicalCardId, types: ["spell"], zone: "hand", energy: 1, power: null },
        { id: "chosen", types: ["unit"], zone: "board", might: 3 },
        { id: "other", owner: "B", types: ["unit"], zone: "board", might: 8 },
      ],
      answers: { "target:decree-of-focus.friendly-unit": ["chosen"] },
      operations: playAndResolve,
    },
    supported: {
      // As in its existing single-card golden, only the arithmetic instruction
      // runs with a supplied target binding, without evaluating target legality.
      makeWorld: () => world().unit("chosen", { might: 3 }).unit("other", { owner: "B", might: 8 }).build(),
      targets: { "decree-of-focus.friendly-unit": ["chosen"] },
      affected: ["chosen"],
      objects: { chosen: { might: 7, buffs: 0 }, other: { might: 8, buffs: 0 } },
      expired: { chosen: 3, other: 8 },
    },
  },
  {
    name: "Onslaught: +6 to an enemy unit; Flow unresolved",
    canonicalCardId: "card.hash-3d956150539f05acad046c9b3b303490605a2e9f9546aa9bc58fb0b8256412a9",
    program: onslaught,
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "spell", cardId: onslaught.canonicalCardId, types: ["spell"], zone: "hand", energy: 4, power: null },
        { id: "chosen", owner: "B", types: ["unit"], zone: "board", might: 4 },
        { id: "other", types: ["unit"], zone: "board", might: 3 },
      ],
      answers: { "target:onslaught.unit": ["chosen"] },
      operations: playAndResolve,
      expect: {
        objects: { spell: { zone: "trash", power: null }, chosen: { might: 10, buffs: 0 }, other: { might: 3 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    supported: {
      makeWorld: () => world().unit("chosen", { owner: "B", might: 4 }).unit("other", { might: 3 }).build(),
      targets: { "onslaught.unit": ["chosen"] },
      affected: ["chosen"],
      objects: { chosen: { might: 10, buffs: 0 }, other: { might: 3, buffs: 0 } },
      expired: { chosen: 4, other: 3 },
    },
  },
];

const cases = defineTemplateSuite("keyword+play || continuous.might / RIFT-653", rows);
for (const [index, templateCase] of cases.entries()) {
  const row = rows[index];
  test(`${templateCase.name}: whole-card scenario follows the published status`, () => {
    assert.equal(row.program.status, row.canonicalCardId === dangerZone.canonicalCardId ? "executable" : "judge-required");
    if (row.program.status === "executable") {
      templateCase.run();
      assert.equal(row.program.judgeReason, undefined);
      return;
    }
    assert.throws(templateCase.run, { message: `Scenario program ${row.canonicalCardId} is judge-required` });
    const registry = new ProgramRegistry([row.program]);
    assert.throws(() => registry.get(row.canonicalCardId), error =>
      error.code === "judge-required" && error.message === row.program.judgeReason
    );
  });

  test(`${templateCase.name}: supported original body only`, () => {
    const kernel = row.supported.makeWorld();
    const play = row.program.abilities.find(ability => ability.kind === "play");
    for (const [id, selected] of Object.entries(row.supported.targets ?? {})) {
      kernel.setTargets(id, selected.map(object => kernel.ref(object)));
    }
    const outcome = resolveChainBody(play.body, bodyContext(kernel));
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.events, []);
    const refs = row.supported.affected.map(id => kernel.ref(id));
    assert.deepEqual(outcome.linkedValues[`${play.body[0].id}.affected.objects`], refs);
    assert.equal(outcome.linkedValues[`${play.body[0].id}.affected.count`], refs.length);
    assert.equal(kernel.continuousEffects.length, refs.length);
    for (const registration of kernel.continuousEffects) {
      assert.deepEqual(registration.duration, { type: "end-of-turn" });
    }
    const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
    for (const [id, expected] of Object.entries(row.supported.objects)) {
      const object = layers.evaluate(kernel.ref(id));
      assert.equal(object.might, expected.might, `${id}: Might`);
      assert.equal(object.buffs, expected.buffs, `${id}: Buff counters`);
    }
    assert.deepEqual(layers.advance({ id: "combat-end" }), []);
    for (const [id, expected] of Object.entries(row.supported.objects)) {
      assert.equal(layers.evaluate(kernel.ref(id)).might, expected.might, `${id}: persists past combat`);
    }
    assert.equal(layers.advance({ id: "turn-end" }).length, refs.length);
    for (const [id, expected] of Object.entries(row.supported.expired)) {
      assert.equal(layers.evaluate(kernel.ref(id)).might, expected, `${id}: turn-end expiry`);
    }
  });
}

// The primitive-test kernel compares controller literally. Scope only the
// original body's programmatic query, matching ChainEngine's relative-player
// convention, as the pre-existing Danger Zone body golden does. This is not a
// substitute for ProgramBinding, Finalize, keyword expansion, or target checks.
function bodyContext(kernel) {
  return bindResolveContext(kernel, {
    query: filter => kernel.query({
      ...filter,
      ...(filter.controller === "self" ? { controller: kernel.controller } : {}),
    }),
  });
}

test(`RIFT-653 Danger Zone [${dangerZone.canonicalCardId}]: empty friendly Mech set negates the original body`, () => {
  const kernel = world()
    .unit("grunt", { might: 2 })
    .unit("enemy-mech", { owner: "B", tags: ["Mech"], might: 5 })
    .card("hand-mech", { types: ["unit"], tags: ["Mech"], zone: "hand", might: 6 })
    .build();
  const play = dangerZone.abilities.find(ability => ability.kind === "play");
  const outcome = resolveChainBody(play.body, bodyContext(kernel));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.deepEqual(outcome.linkedValues["buff-mechs.affected"], { count: 0, objects: [] });
  assert.deepEqual(kernel.continuousEffects, []);
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("grunt").might, 2);
  assert.equal(kernel.getObject("enemy-mech").might, 5);
  assert.equal(kernel.getObject("hand-mech").might, 6);
});
