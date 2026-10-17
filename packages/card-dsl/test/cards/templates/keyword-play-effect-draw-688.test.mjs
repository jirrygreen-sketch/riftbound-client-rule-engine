// RIFT-688 template-level golden for the three cards whose IR signature is
// `keyword+play||effect.draw`.
//
// The published programs remain judge-required because each has an independent
// unsupported keyword/query consumer. The rows below use test-only executable
// views to run the already merged draw body through the real scenario harness;
// they never change the source programs or promote their status.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

import showOfStrength from "../../../dist/cards/sfd/show-of-strength.js";
import downstageDramatics from "../../../dist/cards/unl/downstage-dramatics.js";
import dredgeUp from "../../../dist/cards/ven/dredge-up.js";

const publishedPrograms = new Map([
  [showOfStrength.canonicalCardId, showOfStrength],
  [downstageDramatics.canonicalCardId, downstageDramatics],
  [dredgeUp.canonicalCardId, dredgeUp],
]);

function executableView(program, abilities) {
  return {
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities,
  };
}

// Show of Strength's printed Mighty threshold is still missing a query
// consumer. Bind only the already supported count/draw path to this scenario's
// concrete controller and Board; the source IR keeps its symbolic mightGte
// predicate and remains judge-required.
const showDrawView = executableView(showOfStrength, [
  showOfStrength.abilities[0],
  {
    ...showOfStrength.abilities[1],
    body: [
      {
        ...showOfStrength.abilities[1].body[0],
        args: {
          ...showOfStrength.abilities[1].body[0].args,
          amount: {
            ...showOfStrength.abilities[1].body[0].args.amount,
            filter: { type: "unit", controller: "A", zone: "board" },
          },
        },
      },
    ],
  },
]);

// Repeat's additional-cost declaration is not bound by Finalize yet. The
// partial view keeps Reaction and the authored Draw 1 body, and supplies the
// printed base Energy cost so the scenario can reach resolution.
const downstageDrawView = executableView(downstageDramatics, [
  downstageDramatics.abilities[0],
  {
    ...downstageDramatics.abilities[1],
    cost: { kind: "cost.printed", energy: { kind: "constant", value: 2 } },
  },
]);

// Flow's trash permission, alternate-cost selection and delayed banishment are
// still pending. The partial view therefore retains only the printed play
// ability and its Draw 1 body.
const dredgeDrawView = executableView(dredgeUp, [dredgeUp.abilities[1]]);

function assertPublishedJudgeRequired(canonicalCardId) {
  const published = publishedPrograms.get(canonicalCardId);
  assert.ok(published, `missing published program for ${canonicalCardId}`);
  assert.equal(published.status, "judge-required");
  assert.ok(published.judgeReason?.trim(), `${canonicalCardId} needs a concrete judgeReason`);
}

const rows = [
  {
    name: "Show of Strength · two controller units produce Draw 2",
    canonicalCardId: showOfStrength.canonicalCardId,
    program: showDrawView,
    scenario: {
      players: {
        A: { energy: 5, power: ["Body"] },
        B: { energy: 1 },
      },
      objects: [
        { id: "show", cardId: showDrawView.canonicalCardId, program: showDrawView, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: ["Body"] },
        { id: "mighty-one", owner: "A", types: ["unit"], zone: "board", might: 6 },
        { id: "mighty-two", owner: "A", types: ["unit"], zone: "board", might: 5 },
        { id: "enemy-unit", owner: "B", types: ["unit"], zone: "board", might: 8 },
        { id: "show-deck-one", owner: "A", types: ["unit"], zone: "deck" },
        { id: "show-deck-two", owner: "A", types: ["unit"], zone: "deck" },
        { id: "show-deck-three", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "show", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { show: { zone: "trash" }, "mighty-one": { zone: "board" }, "mighty-two": { zone: "board" }, "enemy-unit": { zone: "board" } },
        players: { A: { energy: 3, handSize: 2, deckSize: 1 } },
        events: { includes: [{ timingPoint: "card-drawn", action: { type: "draw", player: "A", amount: 2 } }] },
        links: { "draw-per-mighty.drawn": 2, "draw-per-mighty.drawnTo": "A" },
      },
    },
  },
  {
    name: "Downstage Dramatics · the supported Draw 1 body resolves once",
    canonicalCardId: downstageDramatics.canonicalCardId,
    program: downstageDrawView,
    scenario: {
      players: { A: { energy: 5 }, B: { energy: 1 } },
      objects: [
        { id: "downstage", cardId: downstageDrawView.canonicalCardId, program: downstageDrawView, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: null },
        { id: "downstage-deck-one", owner: "A", types: ["unit"], zone: "deck" },
        { id: "downstage-deck-two", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "downstage", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { downstage: { zone: "trash" } },
        players: { A: { energy: 3, handSize: 1, deckSize: 1 } },
        events: { includes: [{ timingPoint: "card-drawn", action: { type: "draw", player: "A", amount: 1 } }] },
        links: { "downstage-dramatics.draw-one.drawn": 1, "downstage-dramatics.draw-one.drawnTo": "A" },
      },
    },
  },
  {
    name: "Dredge Up · the supported Draw 1 body resolves from a normal play",
    canonicalCardId: dredgeUp.canonicalCardId,
    program: dredgeDrawView,
    scenario: {
      players: { A: { energy: 5 }, B: { energy: 1 } },
      objects: [
        { id: "dredge", cardId: dredgeDrawView.canonicalCardId, program: dredgeDrawView, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: null },
        { id: "dredge-deck-one", owner: "A", types: ["unit"], zone: "deck" },
        { id: "dredge-deck-two", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "dredge", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { dredge: { zone: "trash" } },
        players: { A: { energy: 3, handSize: 1, deckSize: 1 } },
        events: { includes: [{ timingPoint: "card-drawn", action: { type: "draw", player: "A", amount: 1 } }] },
        links: { "dredge-up.draw.drawn": 1, "dredge-up.draw.drawnTo": "A" },
      },
    },
  },
];

for (const row of defineTemplateSuite("RIFT-688 keyword+play || effect.draw", rows)) {
  test(row.name, () => {
    assertPublishedJudgeRequired(row.canonicalCardId);
    row.run();
  });
}

// Boundary coverage: an empty qualifying set or an empty Main Deck produces
// zero actual draws through the same ChainEngine/EventPipeline path.
const boundaryRows = [
  {
    name: "Show of Strength · no qualifying controller unit draws zero",
    canonicalCardId: showOfStrength.canonicalCardId,
    program: showDrawView,
    scenario: {
      players: { A: { energy: 5, power: ["Body"] } },
      objects: [
        { id: "show-empty", cardId: showDrawView.canonicalCardId, program: showDrawView, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: ["Body"] },
        { id: "show-empty-deck", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "show-empty", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { "show-empty": { zone: "trash" } },
        players: { A: { energy: 3, handSize: 0, deckSize: 1 } },
        links: { "draw-per-mighty.drawn": 0, "draw-per-mighty.drawnTo": "A" },
      },
    },
  },
  {
    name: "Downstage Dramatics · empty Main Deck draws as many as possible",
    canonicalCardId: downstageDramatics.canonicalCardId,
    program: downstageDrawView,
    scenario: {
      players: { A: { energy: 5 } },
      objects: [{ id: "downstage-empty", cardId: downstageDrawView.canonicalCardId, program: downstageDrawView, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: null }],
      operations: [
        { type: "play", object: "downstage-empty", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { "downstage-empty": { zone: "trash" } },
        players: { A: { energy: 3, handSize: 0, deckSize: 0 } },
        links: { "downstage-dramatics.draw-one.drawn": 0, "downstage-dramatics.draw-one.drawnTo": "A" },
      },
    },
  },
  {
    name: "Dredge Up · empty Main Deck draws as many as possible",
    canonicalCardId: dredgeUp.canonicalCardId,
    program: dredgeDrawView,
    scenario: {
      players: { A: { energy: 5 } },
      objects: [{ id: "dredge-empty", cardId: dredgeDrawView.canonicalCardId, program: dredgeDrawView, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: null }],
      operations: [
        { type: "play", object: "dredge-empty", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { "dredge-empty": { zone: "trash" } },
        players: { A: { energy: 3, handSize: 0, deckSize: 0 } },
        links: { "dredge-up.draw.drawn": 0, "dredge-up.draw.drawnTo": "A" },
      },
    },
  },
];

for (const row of defineTemplateSuite("RIFT-688 effect.draw boundary", boundaryRows)) {
  test(row.name, () => {
    assertPublishedJudgeRequired(row.canonicalCardId);
    const result = row.run();
    assert.equal(result.events.some(event => event.timingPoint === "card-drawn"), false);
  });
}
