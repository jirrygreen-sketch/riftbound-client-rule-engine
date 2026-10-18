// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-mulligan-set-aside-not-revealed (CR v1.5 117.1-117.3, 108.7.c, 108.4.e)
//
// Subject: the real createMatch mulligan path (src/game/lifecycle.js) plus
// src/projection/v2. The set-aside cards are moved and recycled by the engine;
// the test only reads the resulting zones and views.
import assert from "node:assert/strict";
import test from "node:test";
import { projectFor, projectionState, matchDeck, matchFixture } from "./harness.mjs";
import { createMatch } from "../../../dist/game/lifecycle.js";

test("privacy-mulligan-set-aside-not-revealed: set-aside cards never become visible and the deck returns to Secret", () => {
  // The opening hand depends on the deterministic seed; a first bare match
  // discovers which card ids are really in hand, and the mulligan then names
  // one of those ids (never a fixture invented by the test).
  const bare = matchFixture();
  const scouted = createMatch({ decks: [matchDeck("a"), matchDeck("b")], seed: "rift-628-mulligan", host: bare.host, firstPlayer: 0, battlefieldChoice: [0, 0] });
  const setAsideCardId = scouted.setup.hands.A[0];
  assert.match(setAsideCardId, /^card:a-m\d+$/);

  const { kernel, host } = matchFixture();
  const match = createMatch({
    decks: [matchDeck("a"), matchDeck("b")],
    seed: "rift-628-mulligan",
    host,
    firstPlayer: 0,
    battlefieldChoice: [0, 0],
    mulligans: [[setAsideCardId], []]
  });

  // The mulligan really resolved: A set aside one card, drew the replacement,
  // and recycled the set-aside card back into the deck (CR 117.1-117.3).
  assert.deepEqual(match.setup.mulligans.A, [setAsideCardId]);
  assert.equal(match.setup.hands.A.length, 5);
  assert.equal(kernel.player("A").handCount, 5);
  assert.equal(match.events().filter(event => event.timingPoint === "card-revealed").length, 0, "no Reveal happened");
  const setAside = kernel.objects.find(object => object.cardId === setAsideCardId);
  assert.equal(setAside.zone, "deck", "the set-aside card was recycled into the deck");

  const state = projectionState(kernel);
  const A = projectFor(state, "A");
  const B = projectFor(state, "B");
  const spectator = projectFor(state, null);
  assert.equal(A.players.A.hand.count, 5, "A sees their own hand count");
  assert.equal(A.players.A.hand.cards.every(card => card.visibility === "identity"), true, "A reads their own new hand");
  assert.equal(B.players.A.hand.count, 5, "B learns only the count");
  assert.equal(B.players.A.hand.cards.every(card => card.visibility === "face-down"), true);
  assert.equal(spectator.players.A.hand.count, 5);
  assert.equal(spectator.players.A.hand.cards.every(card => card.visibility === "face-down"), true);
  for (const projection of [A, B, spectator]) {
    assert.equal(projection.players.A.mainDeck.cards.length, 0, "108.4.e: the shuffled deck is Secret again");
  }
  // Neither the set-aside card nor any drawn replacement leaks to the opponent.
  assert.equal(JSON.stringify(B).includes(setAsideCardId), false);
  assert.equal(JSON.stringify(spectator).includes(setAsideCardId), false);
});
