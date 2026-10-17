// Scenario chain-trigger-no-legal-options-removed (CR v1.5 403.4, 403.4.a).
//
// A Triggered Ability whose condition was met goes on the Chain even when no
// legal choice exists; it is then removed during finalization and never becomes
// a Finalized item. That removal is not a counter (403.4.a).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, damageInstruction, drawInstruction, registerTrigger, stages, resolveAll } from './support.mjs';

test('chain-trigger-no-legal-options-removed: a targetless trigger is removed, not countered', () => {
  const f = chainFixture({
    energy: { A: 1 },
    cards: [{ id: 'spell', owner: 'A', types: ['spell'], energy: 1, power: [] }],
    board: builder => builder.unit('a1', { owner: 'A', might: 4, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  // The condition is "you play a spell"; nothing on the Board can be its target.
  registerTrigger(f.engine, f.kernel, {
    id: 'a1-trigger',
    source: 'a1',
    controller: 'A',
    spec: { at: 'card-played', filter: {} },
    body: [damageInstruction('hit', 1, 'no-such-object')],
  });

  f.engine.execute(f.spell('spell', [drawInstruction('d')]));
  resolveAll(f.engine);

  assert.deepEqual(stages(f.engine), [
    'pending:spell', 'finalized:spell',
    'pending:trigger:1',
    'resolved:spell', 'removed:spell(resolved)',
    'removed:trigger:1(unperformable-trigger)',
  ]);
  assert.equal(f.engine.trace.some(event => event.reason === 'countered'), false, '403.4.a: not a counter');
  assert.equal(f.kernel.player('A').handSize, 1, 'the spell still resolved in full (403.4.a)');
  assert.equal(f.engine.items.length, 0);
});
