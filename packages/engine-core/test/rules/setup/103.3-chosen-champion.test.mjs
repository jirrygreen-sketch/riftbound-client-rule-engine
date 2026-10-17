// Golden test placeholders for the setup chapter Chosen Champion scenarios
//   setup-chosen-champion-tag-must-match
//   setup-chosen-champion-must-be-champion-unit
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 103.3.a.1: the Chosen Champion is placed in the Champion Zone at the
// start of the game. 103.3.a.2: it must be a champion unit whose champion tag
// matches the tag on the Champion Legend. 103.3.d.3: Signature cards are not
// Champion units and cannot be placed in the Champion Zone, even when the tag
// matches (the rule's Tibbers/Annie example).
//
// Both scenarios are deck building legality checks of the same kind as 103.2:
// the champion family resolution and the Signature/Champion distinction live in
// apps/game-server/src/constructed-policy.ts and depend on catalog metadata. The
// generic card-data `validateDeck` has no such stage, and engine-core owns no
// deck legality module (src/deck/index.ts is `export {}`), so there is nothing in
// this package to execute them against.
import test from 'node:test';

test.todo('setup-chosen-champion-tag-must-match (103.3.a.2): the Chosen Champion\'s champion tag must match the Champion Legend\'s tag — blocked: the champion-family resolution lives in apps/game-server/src/constructed-policy.ts (CR 133.8.b) and needs catalog metadata unavailable to engine-core');

test.todo('setup-chosen-champion-must-be-champion-unit (103.3.a.2 / 103.3.d.3): a Signature unit cannot be the Chosen Champion — blocked: same owner split; the Signature/Champion distinction is implemented in the game-server constructed policy');
