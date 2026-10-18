// Scenario chain-cleanup-after-transitions-and-chain-events (CR v1.5 319.1, 319.3, 319.4, 319.5).
//
// A Cleanup becomes an Outstanding Task after each of these Chain transitions:
// adding a Pending item (319.3), a Pending item becoming Finalized (319.4), an
// item leaving the Chain (319.5), and the resulting Open/Closed transition
// (319.1). Every one of them must leave the game at a cleaned-up fixed point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, drawInstruction, resolveAll, timings } from './support.mjs';

test('chain-cleanup-after-transitions-and-chain-events: each Chain transition requests a Cleanup', () => {
  const f = chainFixture({
    energy: { A: 1 },
    cards: [{ id: 'spell', owner: 'A', types: ['spell'], energy: 1, power: [] }],
  });
  f.engine.execute(f.spell('spell', [drawInstruction('d')]));
  resolveAll(f.engine);

  // 319.3 / 319.4 / 319.5: each structural Chain transition asks for a Cleanup.
  const reasons = f.engine.trace.filter(event => event.step === 'cleanup-requested').map(event => event.reason);
  assert.ok(reasons.includes('item-pending'), '319.3: a Pending item was added');
  assert.ok(reasons.includes('item-finalized'), '319.4: the item became Finalized');
  assert.ok(reasons.includes('item-removed'), '319.5: the item left the Chain');

  // Every request was honoured: the timing stream always pairs start with end.
  const order = timings(f.engine);
  let depth = 0;
  for (const timing of order) {
    if (timing === 'cleanup-start') depth++;
    if (timing === 'cleanup-end') depth--;
    assert.ok(depth >= 0, 'no Cleanup end without its start');
  }
  assert.equal(depth, 0, 'every Cleanup completed');
  assert.ok(order.filter(id => id === 'cleanup-start').length >= 3, 'at least the three Chain transitions cleaned up');

  // 319.1: the state is Closed while the Chain existed and Open again afterwards.
  assert.equal(f.engine.turnState, 'neutral-open');
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.getObject('spell').zone, 'trash');
});
