// Golden test placeholders for the setup chapter Neeko scenarios (CR 103.1)
//   setup-neeko-deckbuilding-three-legends
//   setup-neeko-legends-must-differ-from-champion
//   setup-neeko-legends-must-differ-from-each-other
//   setup-neeko-shared-across-copies
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 103.1: cards in a player's deck (or Game Mode rules) may indicate
// additional choices to be made during deck building; the rule's own example is
// Neeko, Blending In choosing three differently-named legends in addition to the
// starting legend. The card program already declares that decision
// (packages/card-dsl/src/cards/rad/neeko-blending-in.ts: `kind:
// "choose-additional-legends"`, validated by card-dsl/src/ir/validation.ts), and
// the card is recorded as `judge-required` for its other gaps.
//
// engine-core has no consumer for a deckbuilding decision: src/deck/index.ts is
// still `export {}`, and nothing in src/game or src/deck turns the card program's
// `deckbuilding` list into a setup-time choice or a legality result. Without that
// consumer there is no deckbuilding state to assert (three chosen legends,
// shared-across-copies behaviour, or valid=false on a duplicate choice).
import test from 'node:test';

test.todo('setup-neeko-deckbuilding-three-legends (103.1): a deck containing Neeko records three additional differently-named legends and validates — blocked: no engine-core deckbuilding consumer (src/deck/index.ts is `export {}`); the decision only exists as CardProgram data validated in card-dsl');

test.todo('setup-neeko-legends-must-differ-from-champion (103.1): choosing the Champion Legend again is rejected — blocked: same missing deckbuilding consumer; card-dsl validates the decision shape but engine-core has no name-uniqueness check against the Champion Legend');

test.todo('setup-neeko-legends-must-differ-from-each-other (103.1): two identical additional legends are rejected — blocked: same missing deckbuilding consumer; name uniqueness across the three chosen legends has no engine-core implementation');

test.todo('setup-neeko-shared-across-copies (103.1): three Neeko copies still yield one shared choice of three legends — blocked: same missing deckbuilding consumer; nothing counts/merges the per-card decision across copies');
