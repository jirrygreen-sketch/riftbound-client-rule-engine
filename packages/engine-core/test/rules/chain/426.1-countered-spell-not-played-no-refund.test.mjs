// Scenario chain-countered-spell-not-played-no-refund (CR v1.5 426.1.a, 426.1.b, 426.1.c).
//
// A countered card is removed from the Chain into its owner's Trash without any
// of its instructions resolving (426.1.a), is not considered played (426.1.b),
// and its costs are not refunded (426.1.c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, counterInstruction, damageInstruction, registerTrigger, addEnergyInstruction, stages, resolveAll, timings } from './support.mjs';

test('chain-countered-spell-not-played-no-refund: the countered card never resolved and nothing was refunded', () => {
  const f = chainFixture({
    energy: { A: 4, B: 1 },
    cards: [
      { id: 's1', owner: 'A', types: ['spell'], energy: 3, power: [] },
      { id: 's2', owner: 'B', types: ['spell'], energy: 1, power: [] },
    ],
    board: builder => builder.unit('u1', { owner: 'B', might: 4, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  // "When you play a spell, add [1]" - 426.1.b means it never Triggers for s1.
  registerTrigger(f.engine, f.kernel, {
    id: 'play-watch', spec: { at: 'card-played', filter: {} }, body: [addEnergyInstruction('watch', 'A', 1)],
  });

  f.engine.execute(f.spell('s1', [damageInstruction('hit', 3, 'u1')]));
  const spellRef = f.engine.items[0].object;
  assert.equal(f.kernel.player('A').energy, 1, '426.1.c: the cost was paid');
  f.engine.pass('A');
  f.engine.execute(f.spell('s2', [counterInstruction('cnt', spellRef.id)], { controller: 'B', speed: 'reaction' }));
  resolveAll(f.engine);

  assert.ok(stages(f.engine).includes('removed:s1(countered)'), '426.1.a: the countered item leaves the Chain');
  assert.deepEqual(f.kernel.objectsInZone('A', 'trash').map(ref => ref.id), ['s1']);
  assert.equal(f.kernel.getObject('u1').damage, 0, '426.1.a: none of the countered card instructions resolved');
  assert.equal(f.kernel.player('A').energy, 2, '426.1.c: the 3 Energy was not refunded and the s1 play trigger never added resources');
  assert.equal(
    timings(f.engine).filter(id => id === 'card-played').length,
    1,
    '426.1.b: only the resolving s2 counts as played',
  );
});
