// RIFT-681 — README 4.1 template-level golden for the four `keyword + play ||
// continuous.grant-keyword` cards: Cleave (ogn-004-298), For Demacia!
// (rad-117-167), Blood Rush (sfd-003-221) and Square Up (unl-017-219).
//
// Every row carries its own canonical identity, the original program, its own
// scenario (printed cost, target/choose, board) and its own expectations
// (events, object state, links), and runs through the real generic card
// scenario harness (RIFT-592: ProgramBinding + ChainEngine + EventPipeline) so
// payment, target locking, resolution and the ability-layer keyword
// registration all use production paths.
//
// All four published programs keep `judge-required`: the registered keyword is
// never sent through its KeywordDef.expand, and the layers snapshot exposes
// `combatRole` but no `designation` accessor or combat designation producer, so
// the granted Assault/Shield functional text (+X Might while attacking or
// defending) cannot be honoured. Blood Rush's declared play cost is the printed
// [Repeat] additional cost, which programs/play.ts translateCost rejects; its
// execution row therefore replaces ONLY the cost field with the catalog's
// printed base cost (1 Energy, power null), and a separate row pins the real
// declaration failing closed. No ability, target, value, duration or sourceText
// is changed anywhere.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import cleave from "../../../dist/cards/ogn/cleave.js";
import forDemacia from "../../../dist/cards/rad/for-demacia.js";
import bloodRush from "../../../dist/cards/sfd/blood-rush.js";
import squareUp from "../../../dist/cards/unl/square-up.js";
import retreat from "../../../dist/cards/ogn/retreat.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CLEAVE = "card.hash-e946abd159c3e001431a6266172cc524d41158117457180e81e85ef7690a4354";
const FOR_DEMACIA = "card.hash-88b2b6a8fd884959d1de40824d4d5035cc609570087e598ecc6e808b8b3cc790";
const BLOOD_RUSH = "card.hash-01042b9eeb52d036e7ddeb7a52f785ab5acaf5fc08d6923554a753376d2b7529";
const SQUARE_UP = "card.hash-e4dc01dd2f105796f021b575a0dcf055c0b996025247706f3605affedf193ce6";

const PLAY_AND_RESOLVE = [
  { type: "play", object: "spell", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" },
];

/**
 * The harness refuses `judge-required` programs. This view changes validation
 * metadata only and proves the generated registry entry is the same object; it
 * never mutates abilities, costs, targets or sourceText.
 */
function executableView(canonicalCardId) {
  const program = cardProgramsById.get(canonicalCardId);
  assert.ok(program, `generated card program ${canonicalCardId} is present`);
  assert.equal(program.status, "judge-required", "RIFT-681 does not promote these programs");
  assert.ok(program.judgeReason?.trim(), "judge-required programs keep a concrete reason");
  return { ...program, status: "executable", judgeReason: undefined };
}

/** Blood Rush: keep every ability and replace only the untranslatable cost field. */
function bloodRushPrintedCostView() {
  const program = executableView(BLOOD_RUSH);
  return {
    ...program,
    abilities: program.abilities.map(ability => ability.kind === "play"
      ? { ...ability, cost: { kind: "cost.printed", energy: { kind: "constant", value: 1 } } }
      : ability),
  };
}

const rows = [
  {
    // 806 [Action] + "Give a unit [Assault 3] this turn": one Board unit target,
    // end-of-turn ability-layer registration with the printed value 3.
    name: "Cleave · [Assault 3] this turn lands on the chosen unit for 1 Energy",
    canonicalCardId: CLEAVE,
    program: executableView(CLEAVE),
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: CLEAVE, types: ["spell"], zone: "hand", energy: 1, power: null },
        { id: "chosen", owner: "A", controller: "A", types: ["unit"], zone: "board", might: 2 },
        { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", might: 4 },
      ],
      answers: { "target:cleave.unit": ["chosen"] },
      operations: PLAY_AND_RESOLVE,
      expect: {
        players: { A: { energy: 0 } },
        objects: {
          spell: { zone: "trash", energy: 1, power: null },
          chosen: { zone: "board", might: 2, keywords: [{ id: "Assault", value: 3 }] },
          enemy: { zone: "board", might: 4, keywords: [] },
        },
        links: { "cleave.grant-assault-3.granted": { count: 1, objects: [{ id: "chosen" }] } },
        events: {
          includes: [
            { timingPoint: "became-target", object: { ref: "chosen" }, target: { ref: "chosen" } },
            { timingPoint: "card-played", object: { ref: "spell" }, player: "A" },
            { timingPoint: "chain-item-resolve", object: { ref: "spell" } },
          ],
        },
      },
    },
  },
  {
    // 813 [Reaction] + "Choose a battlefield. Give friendly units there
    // [Shield 2] this turn": the battlefield is the target, the affected units
    // are a criteria-based set and only the chosen battlefield's friendly units
    // receive the keyword (355.10.d / sameLocationAs anchor).
    name: "For Demacia! · only friendly units at the chosen battlefield gain [Shield 2]",
    canonicalCardId: FOR_DEMACIA,
    program: executableView(FOR_DEMACIA),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        { id: "spell", cardId: FOR_DEMACIA, types: ["spell"], zone: "hand", energy: 3, power: null },
        { id: "bf1", types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf1" }, energy: null, power: null, might: null },
        { id: "bf2", types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf2" }, energy: null, power: null, might: null },
        { id: "allyHere", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf2" }, might: 2 },
        { id: "allyElsewhere", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf1" }, might: 3 },
        { id: "foeHere", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf2" }, might: 5 },
      ],
      answers: { "target:for-demacia.battlefield": ["bf2"] },
      operations: PLAY_AND_RESOLVE,
      expect: {
        players: { A: { energy: 0 } },
        objects: {
          spell: { zone: "trash", energy: 3, power: null },
          allyHere: { zone: "board", might: 2, keywords: [{ id: "Shield", value: 2 }] },
          allyElsewhere: { zone: "board", might: 3, keywords: [] },
          foeHere: { zone: "board", might: 5, keywords: [] },
        },
        links: { "for-demacia.grant-shield.granted": { count: 1, objects: [{ id: "allyHere" }] } },
        events: {
          includes: [
            { timingPoint: "became-target", object: { ref: "bf2" } },
            { timingPoint: "card-played", object: { ref: "spell" } },
            { timingPoint: "chain-item-resolve", object: { ref: "spell" } },
          ],
        },
      },
    },
  },
  {
    // 806 [Action] + "Give a unit [Assault 2]" with no printed duration
    // (801.3.a.3 keeps it for the Board existence) plus the printed
    // [Repeat] :rb_energy_1: declared on the play cost (see the fail-closed row).
    name: "Blood Rush · the printed-cost slice grants [Assault 2] permanently",
    canonicalCardId: BLOOD_RUSH,
    program: bloodRushPrintedCostView(),
    scenario: {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: BLOOD_RUSH, types: ["spell"], zone: "hand", energy: 1, power: null },
        { id: "chosen", owner: "B", controller: "B", types: ["unit"], zone: "board", might: 3 },
        { id: "bystander", owner: "A", controller: "A", types: ["unit"], zone: "board", might: 6 },
      ],
      answers: { "target:blood-rush.unit": ["chosen"] },
      operations: PLAY_AND_RESOLVE,
      expect: {
        players: { A: { energy: 0 } },
        objects: {
          spell: { zone: "trash", energy: 1, power: null },
          chosen: { zone: "board", might: 3, keywords: [{ id: "Assault", value: 2 }] },
          bystander: { zone: "board", might: 6, keywords: [] },
        },
        links: { "blood-rush.grant-assault-2.granted": { count: 1, objects: [{ id: "chosen" }] } },
        events: {
          includes: [
            { timingPoint: "became-target", object: { ref: "chosen" } },
            { timingPoint: "card-played", object: { ref: "spell" } },
            { timingPoint: "chain-item-resolve", object: { ref: "spell" } },
          ],
        },
      },
    },
  },
  {
    // "[Repeat] — Discard 1" (820.1.a/820.1.c) + "Give a unit [Assault 4] this
    // turn". The play half, its printed 4 Energy and the end-of-turn grant are
    // fully real; the Repeat half has no IR slot for its printed discard cost.
    name: "Square Up · 4 Energy registers [Assault 4] this turn on the chosen unit",
    canonicalCardId: SQUARE_UP,
    program: executableView(SQUARE_UP),
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "spell", cardId: SQUARE_UP, types: ["spell"], zone: "hand", energy: 4, power: null },
        { id: "chosen", owner: "B", controller: "B", types: ["unit"], zone: "board", might: 3 },
        { id: "bystander", owner: "A", controller: "A", types: ["unit"], zone: "board", might: 6 },
      ],
      answers: { "target:square-up.unit": ["chosen"] },
      operations: PLAY_AND_RESOLVE,
      expect: {
        players: { A: { energy: 0 } },
        objects: {
          spell: { zone: "trash", energy: 4, power: null },
          chosen: { zone: "board", might: 3, keywords: [{ id: "Assault", value: 4 }] },
          bystander: { zone: "board", might: 6, keywords: [] },
        },
        links: { "square-up.grant-assault-4.granted": { count: 1, objects: [{ id: "chosen" }] } },
        events: {
          includes: [
            { timingPoint: "became-target", object: { ref: "chosen" } },
            { timingPoint: "card-played", object: { ref: "spell" } },
            { timingPoint: "chain-item-resolve", object: { ref: "spell" } },
          ],
        },
      },
    },
  },
  {
    // Card-specific boundary of the same template: an existing valued Assault
    // must sum with the granted 4 (807.2) instead of overwriting it.
    name: "Square Up boundary · a printed [Assault 1] host reads [Assault 5] after the grant",
    canonicalCardId: SQUARE_UP,
    program: executableView(SQUARE_UP),
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "spell", cardId: SQUARE_UP, types: ["spell"], zone: "hand", energy: 4, power: null },
        { id: "veteran", owner: "B", controller: "B", types: ["unit"], zone: "board", might: 3, keywords: [{ id: "Assault", value: 1 }] },
      ],
      answers: { "target:square-up.unit": ["veteran"] },
      operations: PLAY_AND_RESOLVE,
      expect: {
        objects: { veteran: { zone: "board", might: 3, keywords: [{ id: "Assault", value: 5 }] } },
      },
    },
  },
];

for (const row of defineTemplateSuite("keyword+play || continuous.grant-keyword / RIFT-681", rows)) {
  test(row.name, row.run);
}

// Boundary 1 (no legal target): the real target planner rejects the play before
// Finalize, so no spell effect is invented for an empty Board.
test(`RIFT-681 boundary: Cleave [${CLEAVE}] is rejected with no legal unit target`, () => {
  assert.throws(
    () => runCardScenario(executableView(CLEAVE), {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: CLEAVE, types: ["spell"], zone: "hand", energy: 1, power: null },
      ],
      operations: PLAY_AND_RESOLVE,
    }),
    error => error?.code === "no-legal-targets"
  );
});

// Boundary 2 (negated / skipped): the chosen battlefield is legal, but the
// criteria-based friendly set is empty, so the grant resolves to zero objects
// and registers nothing (359.3.e.9 shape without a target failure).
test(`RIFT-681 boundary: For Demacia! [${FOR_DEMACIA}] grants nothing when no friendly unit is there`, () => {
  const result = runCardScenario(executableView(FOR_DEMACIA), {
    players: { A: { energy: 3 } },
    objects: [
      { id: "spell", cardId: FOR_DEMACIA, types: ["spell"], zone: "hand", energy: 3, power: null },
      { id: "bf1", types: ["battlefield"], zone: "board", location: { type: "battlefield", id: "bf1" }, energy: null, power: null, might: null },
      { id: "foeHere", owner: "B", controller: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf1" }, might: 5 },
    ],
    answers: { "target:for-demacia.battlefield": ["bf1"] },
    operations: PLAY_AND_RESOLVE,
    expect: {
      players: { A: { energy: 0 } },
      objects: {
        spell: { zone: "trash" },
        foeHere: { zone: "board", might: 5, keywords: [] },
      },
      links: { "for-demacia.grant-shield.granted": { count: 0, objects: [] } },
      events: { includes: [{ timingPoint: "card-played", object: { ref: "spell" } }] },
    },
  });
  result.asserts();
  // Nothing was registered: the empty set never reaches the ability layer.
  assert.deepEqual(
    result.state.objects.find(object => object.ref.id === "foeHere").keywords,
    []
  );
});

// Boundary 3 (still blocked): the declared Blood Rush cost is the printed
// [Repeat] additional cost, which the production play path cannot translate.
// The row asserts the real fail-closed behaviour instead of a scenario pass.
test(`RIFT-681 boundary: Blood Rush [${BLOOD_RUSH}] cannot pay its declared Repeat cost through Finalize`, () => {
  const declared = executableView(BLOOD_RUSH);
  assert.throws(
    () => runCardScenario(declared, {
      players: { A: { energy: 1 } },
      objects: [
        { id: "spell", cardId: BLOOD_RUSH, types: ["spell"], zone: "hand", energy: 1, power: null },
        { id: "chosen", owner: "B", controller: "B", types: ["unit"], zone: "board", might: 3 },
      ],
      answers: { "target:blood-rush.unit": ["chosen"] },
      operations: PLAY_AND_RESOLVE,
    }),
    error => error?.code === "judge-required" && /Additional costs are not bound/.test(error.message)
  );
});

// Boundary 4 (negated / mistargeted): an opponent Reaction returns the locked
// Cleave target to hand before resolution, so the grant resolves on a stale
// reference and must register nothing (359.3.e.6/e.7). Retreat is a real
// merged program, so the return is performed by its own printed body.
test(`RIFT-681 boundary: Cleave [${CLEAVE}] registers nothing when the target leaves the Board`, () => {
  const result = runCardScenario(executableView(CLEAVE), {
    players: { A: { energy: 1 }, B: { energy: 1 } },
    objects: [
      { id: "spell", cardId: CLEAVE, types: ["spell"], zone: "hand", energy: 1, power: null },
      { id: "retreat", cardId: retreat.canonicalCardId, program: retreat, owner: "B", controller: "B", types: ["spell"], zone: "hand", energy: 1, power: null },
      { id: "enemy", owner: "B", controller: "B", types: ["unit"], zone: "board", might: 4 },
      { id: "rune-top", owner: "B", types: ["rune"], zone: "rune-deck" },
    ],
    answers: { "target:cleave.unit": ["enemy"], "target:friendly-unit": ["enemy"] },
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
      objects: {
        spell: { zone: "trash" },
        retreat: { zone: "trash", power: null },
        enemy: { zone: "hand", keywords: [] },
      },
      players: { B: { runeDeckSize: 0 } },
      events: {
        includes: [
          { timingPoint: "became-target", object: { ref: "enemy" } },
          { timingPoint: "card-played", object: { ref: "retreat" } },
          { timingPoint: "card-played", object: { ref: "spell" } },
        ],
      },
    },
  });
  result.asserts();
  // The instruction was ignored, so it wrote no grant link and no keyword.
  assert.equal(Object.hasOwn(result.links, "cleave.grant-assault-3.granted"), false);
  assert.deepEqual(result.state.objects.find(object => object.ref.id === "enemy").keywords, []);
});
