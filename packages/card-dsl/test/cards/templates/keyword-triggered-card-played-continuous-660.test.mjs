// RIFT-660 template-level golden for the `keyword + triggered|card-played|
// continuous.might` group (Blastcone Fae, Teemo Scout, Thousand-Tailed Watcher,
// War Scout, Diana No Longer Human; see packages/card-dsl/src/cards/README.md
// 4.1).
//
// Every row names one card, its canonical identity, its own board, its own
// operations and its own expectation, and runs the real runCardScenario path:
// ProgramBinding -> ChainEngine (cost payment, target lock) -> card-played
// event -> production trigger registration -> continuous.might -> layers.
//
// The published programs stay judge-required: each one still has a keyword
// half whose production consumer is missing (Hidden cost/zone, Accelerate
// optional-additional payment, Ambush play permission). runCardScenario
// refuses judge-required programs by design, so each row drives a test-only
// slice that keeps the card's canonical identity and its printed triggered
// ability, and drops the blocked keyword half. This is execution evidence for
// the triggered continuous.might half only; it never claims the keyword half
// runs, never replaces a printed value, and never settles state by hand.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import blastconeFae from "../../../dist/cards/ogn/blastcone-fae.js";
import teemoScout from "../../../dist/cards/ogn/teemo-scout.js";
import thousandTailedWatcher from "../../../dist/cards/ogn/thousand-tailed-watcher.js";
import warScout from "../../../dist/cards/rad/war-scout.js";
import dianaNoLongerHuman from "../../../dist/cards/unl/diana-no-longer-human.js";
import premonition from "../../../dist/cards/sfd/premonition.js";

const BF1 = { type: "battlefield", id: "battlefield-1" };

/** The scenario harness refuses judge-required programs; this view keeps the printed trigger only. */
function triggerSlice(program) {
  return {
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities: program.abilities.filter(ability => ability.kind === "triggered"),
  };
}

const playAndResolve = (object, player = "A") => [
  { type: "play", object, player },
  { type: "pass", player },
  { type: "pass", player: player === "A" ? "B" : "A" },
];

// Diana's trigger adds a second chain item after the spell resolves, so the
// scenario needs one more round of passes to let it resolve too.
const playSpellAndResolveDianaTrigger = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

const rows = [
  {
    name: "Blastcone Fae · play trigger gives the chosen unit -2 Might this turn",
    canonicalCardId: blastconeFae.canonicalCardId,
    sourceProgram: blastconeFae,
    program: triggerSlice(blastconeFae),
    declared(program) {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /Hidden/);
      assert.match(program.judgeReason, /811/);
    },
    scenario: {
      players: { A: { energy: 5, power: ["Mind"] } },
      objects: [
        { id: "fae", cardId: blastconeFae.canonicalCardId, types: ["unit"], zone: "hand", energy: 2, power: ["Mind"], might: 2 },
        { id: "chosen", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 2 },
        { id: "other", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 4 },
      ],
      answers: { "target:blastcone-fae.unit": ["chosen"] },
      operations: playAndResolve("fae"),
      expect: {
        objects: {
          fae: { zone: "board", exhausted: true, might: 2, buffs: 0 },
          chosen: { zone: "board", might: 1, buffs: 0 },
          other: { zone: "board", might: 4 },
        },
        players: { A: { energy: 3 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "became-target" }] },
        links: {
          "blastcone-fae.give-minus-2.affected": { count: 1, objects: ["chosen"] },
          "blastcone-fae.give-minus-2.affected.count": 1,
          "blastcone-fae.give-minus-2.affected.objects": ["chosen"],
        },
      },
    },
  },
  {
    name: "Blastcone Fae · boundary: a 1-Might target stays at the printed floor of 1",
    canonicalCardId: blastconeFae.canonicalCardId,
    sourceProgram: blastconeFae,
    program: triggerSlice(blastconeFae),
    declared(program) {
      assert.equal(program.status, "judge-required");
    },
    scenario: {
      players: { A: { energy: 5, power: ["Mind"] } },
      objects: [
        { id: "fae", cardId: blastconeFae.canonicalCardId, types: ["unit"], zone: "hand", energy: 2, power: ["Mind"], might: 2 },
        { id: "weak", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 1 },
      ],
      answers: { "target:blastcone-fae.unit": ["weak"] },
      operations: playAndResolve("fae"),
      expect: {
        objects: {
          fae: { zone: "board", might: 2 },
          weak: { zone: "board", might: 1, buffs: 0 },
        },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "became-target" }] },
        links: { "blastcone-fae.give-minus-2.affected": { count: 1, objects: ["weak"] } },
      },
    },
  },
  {
    name: "Teemo, Scout · play trigger gives me +3 Might this turn",
    canonicalCardId: teemoScout.canonicalCardId,
    sourceProgram: teemoScout,
    program: triggerSlice(teemoScout),
    declared(program) {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /Hidden/);
      assert.match(program.judgeReason, /cost\.hidden/);
    },
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "teemo", cardId: teemoScout.canonicalCardId, types: ["unit"], zone: "hand", energy: 2, power: null, might: 1 },
        { id: "other", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 4 },
      ],
      operations: playAndResolve("teemo"),
      expect: {
        objects: {
          teemo: { zone: "board", exhausted: true, might: 4, buffs: 0 },
          other: { zone: "board", might: 4 },
        },
        players: { A: { energy: 3 } },
        events: { includes: [{ timingPoint: "card-played" }] },
        links: {
          "teemo-scout.grant-might.affected": { count: 1, objects: ["teemo"] },
          "teemo-scout.grant-might.affected.objects": ["teemo"],
        },
      },
    },
  },
  {
    name: "Thousand-Tailed Watcher · play trigger gives enemy units -3 Might this turn, floor 1",
    canonicalCardId: thousandTailedWatcher.canonicalCardId,
    sourceProgram: thousandTailedWatcher,
    program: triggerSlice(thousandTailedWatcher),
    declared(program) {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /Accelerate/);
      assert.match(program.judgeReason, /optionalAdditional/);
    },
    scenario: {
      players: { A: { energy: 10, power: ["Mind"] } },
      objects: [
        { id: "watcher", cardId: thousandTailedWatcher.canonicalCardId, types: ["unit"], zone: "hand", energy: 7, power: ["Mind"], might: 7 },
        { id: "enemy-3", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 3 },
        { id: "enemy-5", owner: "B", types: ["unit"], zone: "board", location: BF1, might: 5 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: BF1, might: 4 },
      ],
      operations: playAndResolve("watcher"),
      expect: {
        objects: {
          watcher: { zone: "board", might: 7 },
          // 478.1.c: 3 - 3 would fall below the printed floor of 1, so the
          // per-modification clamp snapshots -2 for enemy-3 and -3 for enemy-5.
          "enemy-3": { zone: "board", might: 1, buffs: 0 },
          "enemy-5": { zone: "board", might: 2, buffs: 0 },
          ally: { zone: "board", might: 4 },
        },
        players: { A: { energy: 3 } },
        events: { includes: [{ timingPoint: "card-played" }] },
        links: {
          "watcher.debuff-enemy-units.affected": { count: 2, objects: ["enemy-3", "enemy-5"] },
          "watcher.debuff-enemy-units.affected.objects": ["enemy-3", "enemy-5"],
        },
      },
    },
    verify(result) {
      // 355.10.d: the enemy set is selected by characteristics, not by target
      // selection, so the trigger must not emit became-target for it.
      assert.equal(result.events.some(event => event.timingPoint === "became-target"), false);
    },
  },
  {
    name: "Thousand-Tailed Watcher · boundary: no enemy unit is a negated skipped set",
    canonicalCardId: thousandTailedWatcher.canonicalCardId,
    sourceProgram: thousandTailedWatcher,
    program: triggerSlice(thousandTailedWatcher),
    declared(program) {
      assert.equal(program.status, "judge-required");
    },
    scenario: {
      players: { A: { energy: 10, power: ["Mind"] } },
      objects: [
        { id: "watcher", cardId: thousandTailedWatcher.canonicalCardId, types: ["unit"], zone: "hand", energy: 7, power: ["Mind"], might: 7 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: BF1, might: 4 },
      ],
      operations: playAndResolve("watcher"),
      expect: {
        objects: {
          watcher: { zone: "board", might: 7 },
          ally: { zone: "board", might: 4 },
        },
        events: { includes: [{ timingPoint: "card-played" }] },
        links: {
          "watcher.debuff-enemy-units.affected": { count: 0, objects: [] },
          "watcher.debuff-enemy-units.affected.count": 0,
        },
      },
    },
  },
  {
    name: "War Scout · play trigger gives the chosen unit +2 Might this turn",
    canonicalCardId: warScout.canonicalCardId,
    sourceProgram: warScout,
    program: triggerSlice(warScout),
    declared(program) {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /Accelerate/);
      assert.match(program.judgeReason, /optionalAdditional/);
    },
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "scout", cardId: warScout.canonicalCardId, types: ["unit"], zone: "hand", energy: 3, power: null, might: 2 },
        { id: "chosen", owner: "A", types: ["unit"], zone: "board", location: BF1, might: 3 },
      ],
      answers: { "target:war-scout.unit": ["chosen"] },
      operations: playAndResolve("scout"),
      expect: {
        objects: {
          scout: { zone: "board", exhausted: true, might: 2 },
          chosen: { zone: "board", might: 5, buffs: 0 },
        },
        players: { A: { energy: 2 } },
        events: { includes: [{ timingPoint: "card-played" }, { timingPoint: "became-target" }] },
        links: {
          "war-scout.give-plus-2-might.affected": { count: 1, objects: ["chosen"] },
          "war-scout.give-plus-2-might.affected.objects": ["chosen"],
        },
      },
    },
  },
  {
    name: "War Scout · boundary: a unit outside the Board is not a legal target",
    canonicalCardId: warScout.canonicalCardId,
    sourceProgram: warScout,
    program: triggerSlice(warScout),
    declared(program) {
      assert.equal(program.status, "judge-required");
    },
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "scout", cardId: warScout.canonicalCardId, types: ["unit"], zone: "hand", energy: 3, power: null, might: 2 },
        { id: "hand-unit", owner: "A", types: ["unit"], zone: "hand", might: 3 },
      ],
      // 355.9.a.1: "a unit" is a Board unit; the real Finalize target planner
      // must reject the hand card instead of silently applying the buff.
      answers: { "target:war-scout.unit": ["hand-unit"] },
      operations: playAndResolve("scout"),
    },
    expectedFailure: /illegal target/,
  },
  {
    name: "Diana, No Longer Human · playing a spell gives me +2 Might this turn",
    canonicalCardId: dianaNoLongerHuman.canonicalCardId,
    sourceProgram: dianaNoLongerHuman,
    program: triggerSlice(dianaNoLongerHuman),
    declared(program) {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /Ambush/);
      assert.match(program.judgeReason, /822/);
    },
    scenario: {
      players: { A: { energy: 10, power: ["Mind", "Mind", "Mind"] } },
      objects: [
        { id: "diana", cardId: dianaNoLongerHuman.canonicalCardId, types: ["unit"], zone: "board", location: BF1, might: 3 },
        { id: "spell", cardId: premonition.canonicalCardId, program: premonition, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: ["Mind"] },
        { id: "deck-1", owner: "A", types: ["unit"], zone: "deck" },
        { id: "deck-2", owner: "A", types: ["unit"], zone: "deck" },
        { id: "deck-3", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: playSpellAndResolveDianaTrigger,
      expect: {
        objects: {
          diana: { zone: "board", might: 5, buffs: 0 },
          spell: { zone: "trash" },
        },
        events: { includes: [{ timingPoint: "card-played" }] },
        links: {
          "diana-no-longer-human.grant-might.affected": { count: 1, objects: ["diana"] },
          "diana-no-longer-human.grant-might.affected.objects": ["diana"],
        },
      },
      verify(result) {
        // The trigger resolved because the real Premonition play emitted
        // card-played and the spell left the Chain for the Trash.
        assert.equal(result.events.filter(event => event.timingPoint === "card-played").length, 1);
      },
    },
  },
  {
    name: "Diana, No Longer Human · boundary: an opponent's spell does not satisfy 'you play a spell'",
    canonicalCardId: dianaNoLongerHuman.canonicalCardId,
    sourceProgram: dianaNoLongerHuman,
    program: triggerSlice(dianaNoLongerHuman),
    declared(program) {
      assert.equal(program.status, "judge-required");
      assert.match(program.judgeReason, /Ambush/);
    },
    scenario: {
      turnPlayer: "B",
      players: { A: { energy: 0 }, B: { energy: 10, power: ["Mind", "Mind", "Mind"] } },
      objects: [
        { id: "diana", cardId: dianaNoLongerHuman.canonicalCardId, types: ["unit"], zone: "board", location: BF1, might: 3 },
        { id: "spell", cardId: premonition.canonicalCardId, program: premonition, owner: "B", controller: "B", types: ["spell"], zone: "hand", energy: 2, power: ["Mind"] },
        { id: "deck-1", owner: "B", types: ["unit"], zone: "deck" },
      ],
      operations: playAndResolve("spell", "B"),
      expect: {
        objects: {
          diana: { zone: "board", might: 3, buffs: 0 },
          spell: { zone: "trash" },
        },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    verify(result) {
      assert.equal("diana-no-longer-human.grant-might.affected" in result.links, false);
      assert.equal(result.state.objects.find(object => object.ref.id === "diana").might, 3);
    },
  },
];

const templateCases = defineTemplateSuite(
  "RIFT-660 keyword + triggered card-played || continuous.might",
  rows,
);

for (const [index, templateCase] of templateCases.entries()) {
  const row = rows[index];
  test(templateCase.name, () => {
    // The published program and its blocked keyword half never change: each
    // row first pins the declared judge-required status, then runs the slice.
    row.declared(row.sourceProgram);
    if (row.expectedFailure) {
      assert.throws(templateCase.run, row.expectedFailure);
      return;
    }
    const result = templateCase.run();
    assert.deepEqual(result.state.chain, [], `${row.canonicalCardId} leaves nothing pending on the Chain`);
    row.verify?.(result);
  });
}

