// Scenario: movement-is-instantaneous-no-chain-no-reaction (CR v1.5 448.3, 448.3.a-c)
// YAML timing aliases map onto the frozen enum: move.performed -> object-moved; the
// scene's "chain" length assertion is expressed on the real ChainEngine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, moveInstruction, pendingItems, settle, timings } from './support.mjs';

test('movement-is-instantaneous-no-chain-no-reaction: the Move resolves inside its ability with no reaction window', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 2 }).hand('rx', { owner: 'B', types: ['spell'] }),
  });
  f.flow.start();
  f.flow.execute(f.activated('move-ability', [moveInstruction('move', 'u1', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);

  assert.deepEqual(f.kernel.getObject('u1').location, { type: 'battlefield', id: 'bf1' });
  const events = timings(f.flow);
  const moved = events.indexOf('object-moved');
  const resolved = events.findIndex((timingPoint, index) => index > moved && timingPoint === 'chain-item-resolve');
  assert.ok(moved >= 0, 'the Move itself is observable');
  assert.ok(resolved > moved, 'the Move belongs to the resolving ability');
  assert.equal(
    events.slice(moved + 1, resolved).includes('chain-item-pending'), false,
    '448.3.c: no Chain item and no reaction window is inserted by the Move',
  );
  assert.deepEqual(pendingItems(f.flow), ['move-ability']);
  assert.equal(f.kernel.getObject('rx').zone, 'hand', 'the opponent never gets to react');
  assert.equal(f.flow.chain.items.length, 0);
});
