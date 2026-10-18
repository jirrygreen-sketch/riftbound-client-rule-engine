import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, state } from './helpers.mjs';

test('RIFT-761: real setup, card programs, noncombat Conquer and seven Holds reach eight; command transcript replays identically', () => {
  const f = setup();
  assert.equal(f.kernel.player('A').score, 0);
  assert.equal(f.kernel.player('B').score, 0);
  const scout = f.play('A');
  f.activate(scout, 0);
  assert.equal(f.match.flow.chain.turnState, 'showdown-open');
  assert.equal(f.match.flow.battlefields[0].controller, null);
  assert.equal(f.kernel.player('A').score, 0);
  f.send('A', 'pass'); f.send('B', 'pass');
  assert.equal(f.match.flow.battlefields[0].controller, 'A');
  assert.equal(f.kernel.player('A').score, 1);
  assert.deepEqual(f.match.flow.scored('A'), [f.fields[0]]);
  f.nextTurn();
  f.play('B'); // Both players act through the same command layer.
  let budget = 0;
  while (!f.match.result().winner) {
    assert.ok(++budget < 20);
    f.nextTurn();
  }
  assert.equal(f.kernel.player('A').score, 8);
  assert.equal(f.kernel.player('B').score, 0);
  assert.deepEqual(f.match.result(), { winner: 'A', turnNumber: 15 });
  const events = f.match.events();
  assert.equal(events.filter(event => event.timingPoint === 'conquer').length, 1);
  assert.equal(events.filter(event => event.timingPoint === 'hold').length, 7);
  assert.equal(events.filter(event => event.timingPoint === 'score').length, 8);
  assert.equal(events.filter(event => event.timingPoint === 'combat-start').length, 0);
  assert.deepEqual(events.filter(event => ['showdown-open', 'showdown-close', 'control-established', 'points-gained', 'conquer', 'hold', 'score'].includes(event.timingPoint)).map(event => event.timingPoint), [
    'showdown-open', 'showdown-close', 'control-established', 'points-gained', 'conquer', 'score',
    ...Array.from({ length: 7 }, () => ['points-gained', 'hold', 'score']).flat(),
  ]);

  // A serialized v2 command transcript, not a replacement journal-v1 schema.
  const replay = setup();
  for (const { actor, command } of JSON.parse(JSON.stringify(f.transcript))) replay.submit(actor, command);
  assert.deepEqual(state(replay), state(f));
  assert.deepEqual(replay.transcript, f.transcript);
});
