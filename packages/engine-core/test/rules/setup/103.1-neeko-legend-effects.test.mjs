// Golden test placeholders for the setup chapter Neeko in-play scenarios (CR 103.1)
//   setup-neeko-play-adds-legend-ready
//   setup-neeko-legend-ceases-when-neeko-leaves
//   setup-neeko-cannot-duplicate-legend-on-board
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 103.1 (with 107.4.d.1 and 440.2.b.4): playing Neeko, Blending In makes
// the player choose one of the three legends chosen at deck building and add it
// to their Legend Zone, readied and non-token, while Neeko is on the board
// (107.4.d.2 for non-Champion legends and their removal when the source leaves).
//
// The card program's trigger is merged and binds (see the card-dsl golden test),
// but executing the body throws `Unregistered instruction opcode:
// effect.create-legend` — there is no registered op that Creates a legend into
// the Legend Zone, and the contract's ZoneId/ZoneDestination have no legend-zone
// member either. The first scenario additionally needs the deckbuilding choice to
// be readable at run time (see 103.1-neeko-deckbuilding.test.mjs), and the middle
// scenario needs the source-leaves removal of the added legend. These are the
// same three gaps the card program records in its judgeReason, so the setup
// chapter cannot execute them yet.
import test from 'node:test';

test.todo('setup-neeko-play-adds-legend-ready (103.1 / 174.2.b): resolving the play trigger adds the chosen legend to the Legend Zone readied — blocked: no registered "effect.create-legend" op (42-entry registry has none) and no legend-zone ZoneId/ZoneDestination; the deckbuilding legend list is also unreadable at run time (src/deck/index.ts `export {}`)');

test.todo('setup-neeko-legend-ceases-when-neeko-leaves (103.1 / 107.4.d.2): killing Neeko removes the legend it added, without that legend entering any zone — blocked: same missing create-legend primitive; there is also no duration consumer that removes a legend when its source leaves the board');

test.todo('setup-neeko-cannot-duplicate-legend-on-board (103.1 / 107.4.d.1): with all three candidate legends already in the Legend Zone the add fails and the Unit still enters — blocked: same missing create-legend primitive plus the rule-055 partial-resolution path for a failed Create action');
