// RIFT-656 template-level golden: triggered | card-played | effect.draw.
//
// Five programs share one skeleton — a card-played Triggered Ability whose body
// is a single effect.draw: Kadregrin the Infernal, Lady of Luminosity (Starter),
// Titanic Shrine, Yordle Explorer and Kinkou Initiate. Every row below drives
// one card's own IR through the generic scenario harness
// (effects/testing/scenario): the real ProgramBinding, ChainEngine and
// EventPipeline. Rows hand the harness a status-only executable view of the
// same program because ProgramRegistry refuses judge-required programs; no
// ability, filter, value, body or source text is rewritten for a row except
// where a comment names the test-only placement.
//
// None of the five can be promoted yet. Each row uses a world where the card's
// documented missing semantics cannot change the asserted outcome, and every
// gap is pinned by its own TODO below:
//   * Kadregrin: the set query still silently ignores mightGte; the row keeps
//     every friendly Board unit Mighty so the ignored threshold agrees with the
//     printed count.
//   * Lady of Luminosity: effects/contract.ts has no Legend Zone, so the row
//     places the Legend on the Board as test-only scaffolding (same approach as
//     the card's existing golden); the printed-cost gate, "you play" gate and
//     Draw 1 body are the card's real IR.
//   * Titanic Shrine: "exhaust me" as a trigger cost and the "Might greater
//     than each other unit on the board" comparison are still inexpressible;
//     the rows execute the real unit-play filter, a world where that printed
//     comparison is unobservable (the played unit is the only unit), and the
//     spell-play boundary. The readiness cost is never faked or asserted.
//   * Yordle Explorer: the printed-Power gate is real; a played card with no
//     printed Power section (power: null, CR 131.3.b) still throws
//     MissingInformation in numericPrinted instead of evaluating false.
//   * Kinkou Initiate: count still stands in for total Effective Might; the
//     rows use five Might-1 units (four for the boundary) so count and sum
//     agree, and a single 5-Might ally would expose the placeholder.
//
// Every boundary row carries expectsNoDraw: the hand/deck sizes already prove
// no card moved, and a follow-up test re-runs the same row to assert the draw
// link is absent (an empty expect.links object would assert nothing).
// Per-card validation, identity and structure assertions stay in
// test/cards/<set>/<slug>.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import kadregrinTheInfernal from "../../../dist/cards/ogn/kadregrin-the-infernal.js";
import ladyOfLuminosityStarter from "../../../dist/cards/ogs/lady-of-luminosity-starter.js";
import titanicShrine from "../../../dist/cards/rad/titanic-shrine.js";
import yordleExplorer from "../../../dist/cards/sfd/yordle-explorer.js";
import kinkouInitiate from "../../../dist/cards/unl/kinkou-initiate.js";

/** ProgramRegistry only accepts executable programs; the IR itself is untouched. */
const executableView = program => ({ ...program, status: "executable", judgeReason: undefined });

/** A synthetic, effect-free spell/unit so the played card is not one of the five. */
const vehicle = name => ({
  canonicalCardId: `card.test.rift656.${name}`,
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: `RIFT-656 synthetic play vehicle: ${name}`,
  abilities: [{ kind: "play", body: [] }]
});

const deckCards = count => Array.from({ length: count }, (_, index) => ({
  id: `deck-${index}`,
  owner: "A",
  types: ["unit"],
  zone: "deck"
}));

const cardPlayed = { timingPoint: "card-played" };
const cardDrawn = { timingPoint: "card-drawn" };

const spell5 = vehicle("spell-5");
const spell4 = vehicle("spell-4");
const spell2 = vehicle("spell-2");
const power2 = vehicle("power-2");
const power1 = vehicle("power-1");
const unit2 = vehicle("unit-2");

const rows = [
  {
    // CR 707/708: every friendly Board unit in this world is Mighty, so the
    // still-unconsumed mightGte key cannot change the count. The printed text
    // counts Kadregrin itself once it is on the Board.
    name: "Kadregrin the Infernal draws for each friendly Mighty unit in this world",
    canonicalCardId: kadregrinTheInfernal.canonicalCardId,
    program: executableView(kadregrinTheInfernal),
    scenario: {
      players: { A: { energy: 20, power: ["Fury", "Fury"] } },
      objects: [
        {
          id: "kadregrin",
          cardId: kadregrinTheInfernal.canonicalCardId,
          program: executableView(kadregrinTheInfernal),
          types: ["unit"],
          zone: "hand",
          energy: 9,
          power: ["Fury", "Fury"],
          might: 9
        },
        { id: "ally-mighty", owner: "A", types: ["unit"], zone: "board", might: 5 },
        { id: "enemy-mighty", owner: "B", types: ["unit"], zone: "board", might: 9 },
        // Three cards in the deck: the printed count is 2 (Kadregrin + the
        // friendly ally). If the opponent's Mighty unit were counted too, the
        // draw would still empty a two-card deck, so the third card is what
        // makes the "your units" half observable.
        ...deckCards(3)
      ],
      operations: [
        { type: "play", object: "kadregrin", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          kadregrin: { zone: "board", might: 9 },
          "ally-mighty": { zone: "board", might: 5 },
          "enemy-mighty": { zone: "board", might: 9 }
        },
        // Only Energy is asserted for the payment: the scenario test kernel's
        // pay action does not consume Power domains, so the printed Power cost
        // cannot be pinned here (see the card's own golden for Power handling).
        players: { A: { handSize: 2, deckSize: 1, energy: 11 } },
        links: { "kadregrin.draw-per-mighty.drawn": 2 },
        events: { includes: [cardPlayed, cardDrawn] }
      }
    }
  },
  {
    // "When you play a spell that costs 5 or more, draw 1." The played spell is
    // a synthetic effect-free vehicle, but the trigger filter, the event-printed
    // Energy condition and the Draw 1 body are the card's real IR. The Legend
    // sits on the Board only because the Legend Zone is not a frozen ZoneId.
    name: "Lady of Luminosity draws 1 for your 5-Energy spell (Legend Zone scaffolded on Board)",
    canonicalCardId: ladyOfLuminosityStarter.canonicalCardId,
    program: executableView(ladyOfLuminosityStarter),
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        {
          id: "lady",
          cardId: ladyOfLuminosityStarter.canonicalCardId,
          program: executableView(ladyOfLuminosityStarter),
          types: ["legend"],
          zone: "board"
        },
        {
          id: "spell",
          cardId: spell5.canonicalCardId,
          program: spell5,
          types: ["spell"],
          zone: "hand",
          energy: 5,
          power: []
        },
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { lady: { zone: "board" }, spell: { zone: "trash" } },
        players: { A: { handSize: 1, deckSize: 1 } },
        links: { "lady-of-luminosity.draw-1.drawn": 1 },
        events: { includes: [cardPlayed, cardDrawn] }
      }
    }
  },
  {
    name: "Lady of Luminosity boundary: a 4-Energy spell leaves the printed cost gate closed",
    canonicalCardId: ladyOfLuminosityStarter.canonicalCardId,
    program: executableView(ladyOfLuminosityStarter),
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        {
          id: "lady",
          cardId: ladyOfLuminosityStarter.canonicalCardId,
          program: executableView(ladyOfLuminosityStarter),
          types: ["legend"],
          zone: "board"
        },
        {
          id: "spell",
          cardId: spell4.canonicalCardId,
          program: spell4,
          types: ["spell"],
          zone: "hand",
          energy: 4,
          power: []
        },
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { spell: { zone: "trash" } },
        players: { A: { handSize: 0, deckSize: 2 } },
        events: { includes: [cardPlayed] }
      }
    },
    expectsNoDraw: true
  },
  {
    name: "Lady of Luminosity boundary: an opponent's 5-Energy spell is not a play by you",
    canonicalCardId: ladyOfLuminosityStarter.canonicalCardId,
    program: executableView(ladyOfLuminosityStarter),
    scenario: {
      turnPlayer: "B",
      players: { A: { energy: 20 }, B: { energy: 20 } },
      objects: [
        {
          id: "lady",
          cardId: ladyOfLuminosityStarter.canonicalCardId,
          program: executableView(ladyOfLuminosityStarter),
          types: ["legend"],
          zone: "board"
        },
        {
          id: "spell",
          cardId: spell5.canonicalCardId,
          program: spell5,
          types: ["spell"],
          zone: "hand",
          owner: "B",
          energy: 5,
          power: []
        },
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "spell", player: "B" },
        { type: "pass", player: "B" },
        { type: "pass", player: "A" }
      ],
      expect: {
        objects: { spell: { zone: "trash" } },
        players: { A: { handSize: 0, deckSize: 2 } },
        events: { includes: [cardPlayed] }
      }
    },
    expectsNoDraw: true
  },
  {
    // The played unit is the only unit on the board, so the printed condition
    // "Might greater than each other unit on the board" is true with no other
    // unit to compare against. The card-played subscription, the real unit
    // filter and the Draw 1 body all execute; the printed "exhaust me" cost
    // cannot be expressed by the frozen TriggeredAbility IR at all, so the
    // Shrine's readiness is deliberately left unasserted here -- the missing
    // cost is pinned by the TODO below, never encoded as an expectation.
    name: "Titanic Shrine: the unit-play trigger draws 1 (only-unit world; exhaust cost still blocked)",
    canonicalCardId: titanicShrine.canonicalCardId,
    program: executableView(titanicShrine),
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        {
          id: "shrine",
          cardId: titanicShrine.canonicalCardId,
          program: executableView(titanicShrine),
          types: ["gear"],
          zone: "board",
          energy: 3,
          power: null
        },
        {
          id: "unit",
          cardId: unit2.canonicalCardId,
          program: unit2,
          types: ["unit"],
          zone: "hand",
          energy: 2,
          power: [],
          might: 2
        },
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "unit", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { shrine: { zone: "board" }, unit: { zone: "board", might: 2 } },
        players: { A: { handSize: 1, deckSize: 1 } },
        links: { "titanic-shrine.draw-1.drawn": 1 },
        events: { includes: [cardPlayed, cardDrawn] }
      }
    }
  },
  {
    // The printed ability wants "you play a unit with Might greater than each
    // other unit on the board, exhaust me to draw 1". A spell satisfies neither
    // the unit filter nor the printed trigger, so no state change is correct and
    // the real filter is exercised. The unit-play half needs the two TODOs below.
    name: "Titanic Shrine boundary: a spell play cannot close the unit-play trigger",
    canonicalCardId: titanicShrine.canonicalCardId,
    program: executableView(titanicShrine),
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        {
          id: "shrine",
          cardId: titanicShrine.canonicalCardId,
          program: executableView(titanicShrine),
          types: ["gear"],
          zone: "board",
          energy: 3,
          power: null
        },
        {
          id: "spell",
          cardId: spell2.canonicalCardId,
          program: spell2,
          types: ["spell"],
          zone: "hand",
          energy: 2,
          power: []
        },
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        // A spell is not a unit play, so the printed ability must not fire; the
        // Shrine stays ready because no ability was performed at all.
        objects: { shrine: { zone: "board", exhausted: false }, spell: { zone: "trash" } },
        players: { A: { handSize: 0, deckSize: 2 } },
        events: { includes: [cardPlayed] }
      }
    },
    expectsNoDraw: true
  },
  {
    // "When you play a card with Power cost 2 or more, draw 1." The printed-Power
    // snapshot, the >=2 condition and the Draw 1 body are the card's real IR.
    name: "Yordle Explorer draws 1 when you play a 2-Power card",
    canonicalCardId: yordleExplorer.canonicalCardId,
    program: executableView(yordleExplorer),
    scenario: {
      players: { A: { energy: 20, power: ["Body", "Body"] } },
      objects: [
        {
          id: "yordle",
          cardId: yordleExplorer.canonicalCardId,
          program: executableView(yordleExplorer),
          types: ["unit"],
          zone: "board",
          energy: 4,
          power: null,
          might: 4
        },
        {
          id: "spell",
          cardId: power2.canonicalCardId,
          program: power2,
          types: ["spell"],
          zone: "hand",
          energy: 0,
          power: ["Body", "Body"]
        },
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { yordle: { zone: "board", might: 4 }, spell: { zone: "trash" } },
        players: { A: { handSize: 1, deckSize: 1 } },
        links: { "yordle-explorer.draw-1.drawn": 1 },
        events: { includes: [cardPlayed, cardDrawn] }
      }
    }
  },
  {
    name: "Yordle Explorer boundary: a 1-Power play leaves the printed-Power gate closed",
    canonicalCardId: yordleExplorer.canonicalCardId,
    program: executableView(yordleExplorer),
    scenario: {
      players: { A: { energy: 20, power: ["Body"] } },
      objects: [
        {
          id: "yordle",
          cardId: yordleExplorer.canonicalCardId,
          program: executableView(yordleExplorer),
          types: ["unit"],
          zone: "board",
          energy: 4,
          power: null,
          might: 4
        },
        {
          id: "spell",
          cardId: power1.canonicalCardId,
          program: power1,
          types: ["spell"],
          zone: "hand",
          energy: 0,
          power: ["Body"]
        },
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { spell: { zone: "trash" } },
        players: { A: { handSize: 0, deckSize: 2 } },
        events: { includes: [cardPlayed] }
      }
    },
    expectsNoDraw: true
  },
  {
    // CR 143.2.a.1: "other units have total Might 5 or more". Five Might-1
    // allies make the retained count placeholder and the printed sum agree.
    name: "Kinkou Initiate draws 1 when your other units have total Might 5 in this world",
    canonicalCardId: kinkouInitiate.canonicalCardId,
    program: executableView(kinkouInitiate),
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        {
          id: "kinkou",
          cardId: kinkouInitiate.canonicalCardId,
          program: executableView(kinkouInitiate),
          types: ["unit"],
          zone: "hand",
          energy: 3,
          power: null,
          might: 3
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `ally-${index}`,
          owner: "A",
          types: ["unit"],
          zone: "board",
          might: 1
        })),
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "kinkou", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { kinkou: { zone: "board" } },
        players: { A: { handSize: 1, deckSize: 1, energy: 17 } },
        links: { "kinkou-initiate.draw.drawn": 1 },
        events: { includes: [cardPlayed, cardDrawn] }
      }
    }
  },
  {
    name: "Kinkou Initiate boundary: total Might 4 leaves the gate closed",
    canonicalCardId: kinkouInitiate.canonicalCardId,
    program: executableView(kinkouInitiate),
    scenario: {
      players: { A: { energy: 20 } },
      objects: [
        {
          id: "kinkou",
          cardId: kinkouInitiate.canonicalCardId,
          program: executableView(kinkouInitiate),
          types: ["unit"],
          zone: "hand",
          energy: 3,
          power: null,
          might: 3
        },
        ...Array.from({ length: 4 }, (_, index) => ({
          id: `ally-${index}`,
          owner: "A",
          types: ["unit"],
          zone: "board",
          might: 1
        })),
        ...deckCards(2)
      ],
      operations: [
        { type: "play", object: "kinkou", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { kinkou: { zone: "board" } },
        players: { A: { handSize: 0, deckSize: 2 } },
        events: { includes: [cardPlayed] }
      }
    },
    expectsNoDraw: true
  }
];

for (const templateCase of defineTemplateSuite("triggered | card-played | effect.draw (RIFT-656)", rows)) {
  test(templateCase.name, templateCase.run);
}

for (const row of rows.filter(candidate => candidate.expectsNoDraw)) {
  test(`${row.name} [${row.canonicalCardId}]: the draw link is really absent`, () => {
    const result = runCardScenario(row.program, row.scenario);
    const drawLinks = Object.keys(result.links).filter(key => key.endsWith(".drawn"));
    assert.deepEqual(drawLinks, [], `Unexpected draw links: ${JSON.stringify(result.links)}`);
  });
}

test("RIFT-656: the five shipped programs stay judge-required until their gaps land", () => {
  const shipped = [
    ["Kadregrin the Infernal", kadregrinTheInfernal],
    ["Lady of Luminosity, Starter", ladyOfLuminosityStarter],
    ["Titanic Shrine", titanicShrine],
    ["Yordle Explorer", yordleExplorer],
    ["Kinkou Initiate", kinkouInitiate]
  ];
  for (const [name, program] of shipped) {
    assert.equal(program.status, "judge-required", name);
    assert.equal(typeof program.judgeReason, "string", name);
    assert.ok(program.judgeReason.length > 0, name);
  }
});

test.todo(
  "RIFT-656 Kadregrin: consume mightGte in the set query using each candidate's current layered Might (CR 707/708/710) before effect.draw; " +
    "the row above is only valid because every friendly Board unit in that world is Mighty, and a 4-Might friendly unit would expose the gap"
);
test.todo(
  "RIFT-656 Lady of Luminosity, Starter: register the card-played ability while the Legend is in the Legend Zone (CR 107.4.c / 174.2.b); " +
    "effects/contract.ts ZoneId has no legend zone and programs/triggers.ts defaults permanent card-played registrations to ['board']"
);
test.todo(
  "RIFT-656 Titanic Shrine: express \"exhaust me\" as a TriggeredAbility cost (CR 204.1.c / 204.3 / 355.10.c.1) and bind the played unit from the " +
    "card-played payload for the \"Might greater than each other unit on the board\" comparison; the shipped IR carries neither and must not approximate them"
);
test.todo(
  "RIFT-656 Yordle Explorer: evaluate a played card with no printed Power section (deck-catalog power: null, CR 131.3.b) as failing the >=2 gate instead of " +
    "throwing MissingInformation from effects/interpreter/predicates/helpers.ts numericPrinted; the card data must stay null"
);
test.todo(
  "RIFT-656 Kinkou Initiate: replace the count placeholder with a sum-over-set Effective Might expression (CR 143.2.a.1); the count and the printed total " +
    "diverge once a single other unit has Might 5 or more"
);

