// Golden test placeholder for the setup chapter 2v2 scenario
//   setup-battlefield-selection-2v2
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 491.5.a / 491.5.b: in Magma Chamber (2v2) the first-turn player's
// Battlefields are removed and the other three players each randomly select one,
// placed simultaneously, in teams. 491.6/491.7 govern the team scoring and the
// first-turn draw/channel adjustments.
//
// No team model exists anywhere in the merged layer: src/turn/flow.ts validates a
// flat two-seat `turnOrder`, src/game/lifecycle.ts seats exactly two decks, and the
// scoring leaf (src/scoring) tracks per-player points without teams. The scenario
// cannot be constructed, let alone executed.
import test from 'node:test';

test.todo('setup-battlefield-selection-2v2 (491.5.a / 491.5.b): the first-turn player removes their Battlefields and the other three select one each in teams — blocked: no team/2v2 mode model in src/turn, src/game or src/scoring; the driver is strictly two players with no teams');
