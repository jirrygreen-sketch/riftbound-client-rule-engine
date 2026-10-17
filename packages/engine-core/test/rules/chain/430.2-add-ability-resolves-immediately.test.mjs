// Scenario chain-add-ability-resolves-immediately (CR v1.5 337.2, 401.2, 430.2).
//
// An ability that Adds resources Finalizes and Resolves in one step (401.2,
// 430.2) and passes neither Priority nor Focus (430.2.a). The scenario also
// exercises the 445.2.c / 430.3 payment interruption: a Reaction Add may be
// activated while the parent card is still paying its costs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chainFixture, addEnergyInstruction, damageInstruction, c, stages } from './support.mjs';

test('chain-add-ability-resolves-immediately: an Add ability Finalizes and Resolves in one step', () => {
  const f = chainFixture({ energy: { A: 0 } });
  f.engine.execute(f.activated('catalyst-add', [addEnergyInstruction('add', 'A', 2)], { kind: 'add', speed: 'reaction' }));

  assert.equal(f.kernel.player('A').energy, 2);
  assert.equal(f.engine.items.length, 0, 'the Add ability left the Chain immediately');
  assert.deepEqual(stages(f.engine), [
    'pending:catalyst-add', 'finalized:catalyst-add',
    'resolved:catalyst-add', 'removed:catalyst-add(resolved)',
  ]);
  const trace = f.engine.trace;
  const start = trace.findIndex(event => event.item === 'catalyst-add');
  const end = trace.findIndex(event => event.step === 'resolved' && event.item === 'catalyst-add');
  assert.equal(
    trace.slice(start, end + 1).some(event => event.step === 'priority-granted'),
    false,
    '430.2.a: no Priority is passed while an Add ability is finalized or resolved',
  );
});

test('chain-add-ability-resolves-immediately: a Reaction Add pays into an in-progress Finalize (430.3 / 445.2.c)', () => {
  let fixture;
  const choose = request => {
    if (request.id.endsWith(':base')) {
      fixture.engine.activateAddDuringPayment(fixture.activated('catalyst-add', [addEnergyInstruction('add', 'A', 2)], { kind: 'add', speed: 'reaction' }));
      return 'normal';
    }
    return undefined;
  };
  fixture = chainFixture({
    energy: { A: 1 },
    choose,
    board: builder => builder.unit('u1', { owner: 'B', might: 3, types: ['unit'], location: { type: 'battlefield', id: 'bf1' } }),
  });
  const cost = c(3);
  fixture.engine.execute(fixture.activated('parent', [damageInstruction('hit', 3, 'u1')], {
    kind: 'activated', speed: 'normal',
    cost: { id: 'parent', cost: { energy: cost, power: c([]) }, baseChoices: [{ id: 'normal', cost: { energy: cost, power: c([]) } }] },
  }));

  // The Add resolved during the parent's payment step and banked a point of Energy.
  assert.equal(fixture.kernel.player('A').energy, 0, 'the parent cost consumed the added resource too');
  assert.deepEqual(
    stages(fixture.engine).filter(stage => stage.startsWith('resolved')),
    ['resolved:catalyst-add'],
  );
  assert.deepEqual(
    fixture.engine.trace.filter(event => ['pending', 'finalized'].includes(event.step)).map(event => event.item),
    ['parent', 'catalyst-add', 'catalyst-add', 'parent'],
    'the parent Pending item stays on the Chain while the Add interrupts its Finalize',
  );
});
