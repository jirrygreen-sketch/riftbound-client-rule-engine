// Scenario chain-accelerate-paid-enters-ready (CR v1.5 805.2.b, 805.6, 359.2.c).
//
// Paying Accelerate generates a delayed Replacement Effect (805.2.b), so the Unit
// Finalizes and enters Ready instead of the default exhausted entry (359.2.c).
// 805.6: it does not become exhausted first, so "becomes ready" abilities do not
// Trigger for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, c, stages, timings } from './support.mjs';

test('chain-accelerate-paid-enters-ready: a paid Accelerate unit boards Ready', () => {
  const f = chainFixture({
    energy: { A: 3 },
    cards: [{ id: 'u1', owner: 'A', types: ['unit'], energy: 2, power: [], might: 2 }],
  });
  const unit = f.unit('u1', [], {
    cost: {
      id: 'cost:u1', cost: { energy: c(2), power: c([]) },
      optionalAdditional: [{ id: 'accelerate', kind: 'accelerate', cost: { energy: c(1) }, selected: true }],
    },
  });
  f.engine.execute(unit);

  assert.equal(f.kernel.getObject('u1').zone, 'board');
  assert.equal(f.kernel.getObject('u1').exhausted, false, '805.2.b: the delayed replacement enters it Ready');
  assert.equal(f.kernel.player('A').energy, 0, 'the printed 2 plus the Accelerate 1 were paid');
  assert.deepEqual(stages(f.engine), ['pending:u1', 'finalized:u1', 'resolved:u1', 'removed:u1(resolved)']);
  // 805.6: no becomes-ready timing is produced by the entry itself.
  assert.equal(
    timings(f.engine).includes('object-readied'),
    false,
    '805.6: the Unit never was exhausted, so nothing became ready',
  );
});
