// Scenario chain-phase-advances-when-no-actions (CR v1.5 305, 335).
//
// 305 and 335 describe the same advance rule: with no Outstanding Task and an
// empty Chain, the turn player declining to act ends the current phase and the
// next one begins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { turnFixture } from './support.mjs';

test('chain-phase-advances-when-no-actions: declaring the end advances the turn structure', () => {
  const f = turnFixture({ energy: { A: 0, B: 0 } });
  f.flow.start();
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.flow.chain.items.length, 0);
  assert.equal(f.flow.turnPlayer, 'A');
  const before = f.flow.chain.pipeline.events.length;

  f.flow.endTurn('A');

  const sequence = f.flow.chain.pipeline.events.slice(before).map(event => event.timingPoint);
  assert.deepEqual(
    sequence.filter(id => ['main-end', 'turn-end', 'turn-start', 'awaken-start', 'beginning-start', 'channel-start', 'draw-start', 'main-start'].includes(id)),
    ['main-end', 'turn-end', 'turn-start', 'awaken-start', 'beginning-start', 'channel-start', 'draw-start', 'main-start'],
  );
  assert.equal(f.flow.turnPlayer, 'B');
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.flow.turn, 2);
  assert.equal(f.flow.chain.items.length, 0, 'the next turn reaches Main with an empty Chain');
});
