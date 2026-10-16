// CR v1.5 203.2 / 357.2.a — scenario costs-replaced-cost-action-still-paid.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, spellDraft, printedCost } from './harness.mjs';

test('costs-replaced-cost-action-still-paid: a replaced kill still counts as paid', () => {
  const kernel = world()
    .player('A', { energy: 3 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 3, power: [] })
    .unit('t1', { might: 1 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  kernel.addReplacement((action, transaction) => {
    if (action.type !== 'kill') return null;
    transaction.perform({ type: 'return-to-hand', object: action.object });
    return 'replaced';
  });
  const { engine } = makeEngine(kernel);

  engine.execute(spellDraft(kernel, 'spell', {
    cost: {
      ...printedCost('cost:spell'),
      mandatoryAdditional: [{ id: 'sacrifice', cost: { payments: [{ kind: 'kill', object: kernel.ref('t1') }] } }]
    }
  }));

  const item = engine.items[0];
  assert.equal(item.status, 'finalized');
  assert.equal(item.payment.paid, true);
  assert.deepEqual(item.payment.actions.map(entry => [entry.action.type, entry.status]), [['pay', 'done'], ['kill', 'replaced']]);
  assert.equal(kernel.getObject('t1').zone, 'hand');
  assert.equal(kernel.player('A').energy, 0);
});
