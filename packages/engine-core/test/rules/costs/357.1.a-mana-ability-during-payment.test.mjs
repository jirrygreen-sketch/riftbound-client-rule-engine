// CR v1.5 357.1.a / 430.3 / 204.4.b.1 — scenario costs-mana-ability-during-payment.
// The ChainEngine's Finalize owns the payment window; a Reaction Add activated
// there Finalizes and Resolves immediately without passing Priority, and the
// parent Finalize resumes with the newly added resource.
import assert from 'node:assert/strict';
import test from 'node:test';
import { world, makeEngine, spellDraft, printedCost, constant } from './harness.mjs';

test('costs-mana-ability-during-payment: an Add Reaction can pay the remaining Energy', () => {
  const kernel = world()
    .player('A', { energy: 1 })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 2, power: [] })
    .rune('fury-rune')
    .build();
  kernel.perform({ type: 'channel-rune', player: 'A', amount: 1 });
  const runeRef = kernel.ref('fury-rune');
  let fixture;
  fixture = makeEngine(kernel, {
    choose: request => {
      if (request.id === 'cost:spell:base') {
        fixture.engine.activateAddDuringPayment({
          id: 'rune-add',
          controller: 'A',
          kind: 'add',
          speed: 'reaction',
          source: kernel.getObject('fury-rune'),
          cost: { id: 'cost:rune', cost: { payments: [{ kind: 'exhaust', object: runeRef }] } },
          body: [{ id: 'add-energy', op: 'effect.resources', args: { energy: constant(1) } }]
        });
        return 'normal';
      }
      return undefined;
    }
  });

  fixture.engine.execute(spellDraft(kernel, 'spell', {
    cost: {
      ...printedCost('cost:spell'),
      baseChoices: [{ id: 'normal', cost: { kind: 'printed' } }]
    }
  }));

  assert.equal(kernel.player('A').energy, 0);
  assert.equal(kernel.getObject('fury-rune').exhausted, true);
  const item = fixture.engine.items[0];
  assert.equal(item.status, 'finalized');
  const lifecycle = fixture.engine.trace
    .filter(event => ['pending', 'finalized', 'resolved'].includes(event.step))
    .map(event => `${event.step}:${event.item}`);
  assert.deepEqual(lifecycle, ['pending:spell', 'pending:rune-add', 'finalized:rune-add', 'resolved:rune-add', 'finalized:spell']);
});
