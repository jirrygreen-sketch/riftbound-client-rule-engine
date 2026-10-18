// Golden test placeholder for the setup chapter Rune Deck scenario
//   setup-rune-deck-domain-and-size
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 103.4: the Rune Deck holds 12 Rune Cards. 103.4.a.1: cards in the Rune
// Deck must be of the Domain Identity of the Champion Legend. 103.4.b: it must be
// shuffled and kept separate from the Main Deck — that half is executed by
// test/game/lifecycle.test.mjs ("setup-main-and-rune-decks-shuffled-separately")
// and by the createMatch rune-deck shuffle assertions.
//
// The scenario is the 12-card / same-Domain legality check, which has no
// engine-core implementation: the Rune Deck legality check lives in
// apps/game-server/src/constructed-policy.ts over the catalog, and engine-core
// owns no deck legality module (src/deck/index.ts is `export {}`).
import test from 'node:test';

test.todo('setup-rune-deck-domain-and-size (103.4.a / 103.4.a.1): the Rune Deck must hold 12 cards of the Champion Legend\'s Domain identity — blocked: no engine-core Rune Deck legality stage; the check lives in apps/game-server/src/constructed-policy.ts over catalog metadata');
