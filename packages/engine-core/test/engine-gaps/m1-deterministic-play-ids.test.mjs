import assert from 'node:assert/strict';
import test from 'node:test';

import { cardProgram, drawOne, fixture } from '../rules/keywords/support.mjs';

// RIFT-1037 (RIFT-990 seeds 046/058/060, RIFT-1030): a Play draft's Chain
// item id came from a process-wide counter, so it depended on how many drafts
// had been described before (bot probes, action-option projections). A journal
// replay then produced different item ids for the same game actions. The id now
// derives only from the played incarnation and its controller.
const SPELL = 'synthetic:rift-1037:spell';
const OTHER = 'synthetic:rift-1037:other';

function setup() {
  return fixture({
    programs: [cardProgram(SPELL, [drawOne('draw')]), cardProgram(OTHER, [drawOne('draw')])],
    energy: { A: 5 },
    setup: builder => builder
      .hand('spell', { cardId: SPELL, types: ['spell'], energy: 1, power: null })
      .hand('other', { cardId: OTHER, types: ['spell'], energy: 1, power: null }),
  });
}

const describe = (f, id, player = 'A') =>
  f.binding.describePlay({ type: 'play', player, object: f.ref(id) }, f.get(id));

test('RIFT-1037: a Play draft id does not depend on earlier described drafts', () => {
  const first = describe(setup(), 'spell').id;
  const probed = setup();
  for (let index = 0; index < 25; index++) describe(probed, 'other');
  describe(probed, 'spell');
  assert.equal(describe(probed, 'spell').id, first);
  assert.equal(first, `play:spell:${setup().get('spell').ref.zoneEntryId}:A`);
});

test('RIFT-1037: distinct incarnations and controllers still get distinct Play ids', () => {
  const f = setup();
  assert.notEqual(describe(f, 'spell').id, describe(f, 'other').id);
  assert.notEqual(describe(f, 'spell', 'A').id, describe(f, 'spell', 'B').id);
});

test('RIFT-1037: the resolved Chain item keeps the deterministic id', () => {
  const f = setup();
  const expected = describe(f, 'spell').id;
  for (let index = 0; index < 5; index++) describe(f, 'other');
  f.play('spell');
  while (f.engine.items.length && f.engine.priority !== null) f.engine.pass(f.engine.priority);
  const resolved = f.engine.trace.filter(entry => entry.step === 'resolved').map(entry => entry.item);
  assert.deepEqual(resolved, [expected]);
});
