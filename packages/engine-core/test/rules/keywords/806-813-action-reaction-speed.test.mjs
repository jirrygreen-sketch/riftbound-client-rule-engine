// docs/rules/scenarios/keywords.yaml — Action (CR 806.1.b, 806.3) and Reaction (813.1.c.1).
//
// The printed Action/Reaction keywords are merged: `programs/keywords.ts`
// `abilitySpeed()` maps them onto the ChainDraft speed, and src/layers/rules/query.ts
// `canAct()` owns the Neutral/Showdown × Open/Closed truth table. The tests below
// drive the real ChainEngine with production-bound drafts in each state;
// `describePlay` is the only way a Play enters the chain.
import assert from 'node:assert/strict';
import test from 'node:test';
import { damage, fixture, pendingItems, settle, timingsOnly } from './support.mjs';

const REACTION = 'test:reaction-spell';
const ACTION = 'test:action-spell';
const PLAIN = 'test:plain-spell';

const spell = (canonicalCardId, amount) => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [damage(`${canonicalCardId}:damage`, amount)] }]
});

/** A’s Reaction spell plus B holding a plain spell on the chain. */
const position = () => ({
  programs: [spell(REACTION, 1), spell(ACTION, 2), spell(PLAIN, 3)],
  energy: { A: 4, B: 4 },
  turnPlayer: 'B',
  setup: w => w
    .hand('reaction', { cardId: REACTION, types: ['spell'], energy: 1, power: null, keywords: [{ id: 'Reaction' }] })
    .hand('action', { cardId: ACTION, types: ['spell'], energy: 2, power: null, keywords: [{ id: 'Action' }] })
    .hand('plain', { cardId: PLAIN, types: ['spell'], energy: 2, power: null })
    .base('u1', { might: 6 })
});

const speedOf = (f, id) => f.binding.describePlay({ type: 'play', player: 'A', object: f.ref(id) }, f.get(id)).speed;

test('keywords-reaction-play-on-opponent-turn-closed-state: a Reaction spell is playable in the opponent’s Closed State (CR 813.1.c.1)', () => {
  const f = fixture(position());

  // 813.1.c: the printed Reaction keyword gives the card reaction speed.
  assert.equal(speedOf(f, 'reaction'), 'reaction');
  assert.equal(speedOf(f, 'action'), 'action');

  // B plays the plain spell; the chain is now in a Closed State with A holding Priority.
  f.play('plain', { player: 'B' });
  assert.equal(f.engine.turnState, 'neutral-closed');
  f.engine.pass('B');
  assert.equal(f.engine.priority, 'A');

  // 813.1.c.1 lets A play the Reaction spell, and last-in resolves first.
  f.play('reaction', { player: 'A' });
  const pending = pendingItems(f.engine);
  assert.equal(pending.length, 2, 'both spells are waiting on the chain');
  assert.match(pending[0], /^play:plain:/);
  assert.match(pending[1], /^play:reaction:/);
  settle(f.engine);

  assert.equal(f.get('u1').damage, 4, 'the Reaction spell resolved before the plain spell it answered');
  const order = f.engine.trace.filter(entry => entry.step === 'resolved').map(entry => entry.item);
  assert.equal(order.length, 2);
  assert.match(order[0], /^play:reaction:/, 'Resolve order is newest-finalized-first');
  assert.match(order[1], /^play:plain:/);
});

test('keywords-action-not-playable-in-closed-state: Action speed alone never unlocks a Closed State (CR 806.1.b, 813.1)', () => {
  const f = fixture(position());
  f.play('plain', { player: 'B' });
  f.engine.pass('B');
  assert.equal(f.engine.turnState, 'neutral-closed');

  // 806.1.b: Action grants the Showdown timing only; 813.1 reserves Closed State
  // plays for Reaction, so the engine refuses the command outright.
  assert.throws(() => f.play('action', { player: 'A' }), /not legally timed/);
  assert.equal(f.get('u1').damage, 0);
  assert.equal(f.kernel.player('A').energy, 4, 'the rejected Play paid nothing');
});

test('keywords-action-not-playable-in-closed-state: an Action spell is legal once its own turn opens the Main Phase', () => {
  const f = fixture({ ...position(), turnPlayer: 'A' });
  assert.equal(f.engine.canAct('A', 'action', f.ref('action')), true);

  f.play('action', { player: 'A' });
  settle(f.engine);
  assert.equal(f.get('u1').damage, 2);
  assert.ok(timingsOnly(f.engine).includes('damage-dealt'));
});

test.todo('keywords-action-unit-still-restricted-to-base-or-own-battlefield (CR 806.3): the YAML expects the Play to be rejected with `unit-play-location-restricted` when an Action unit is sent to an enemy-controlled Battlefield — blocked: the merged host validates the default Base destination for units, but no merged layer enforces the 355.2 “own Base or controlled Battlefield” rule for a non-default destination (src/chain/engine.ts `playDestinationIsLegal` only consumes explicit continuous.location permissions/restrictions, and src/zones/movement.ts has no unit-play destination check)');
