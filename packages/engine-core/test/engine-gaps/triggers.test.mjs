import assert from 'node:assert/strict';
import test from 'node:test';

import { fixture, settle, timingsOnly, pendingItems, cardProgram } from '../rules/keywords/support.mjs';
import kennen from '../../../card-dsl/dist/cards/ven/kennen-keeper-of-balance.js';
import mistfall from '../../../card-dsl/dist/cards/ogn/mistfall.js';

const field = id => ({ type: 'battlefield', id });
const triggered = program => program.abilities.filter(ability => ability.kind === 'triggered');

const executable = program => {
  const { judgeReason: _dropped, ...rest } = program;
  return { ...rest, status: 'executable' };
};
const kennenProgram = ability => executable({ ...kennen, abilities: [ability] });
const mistfallProgram = () => executable(mistfall);

test('EG-TRIGGERS: leading optional cost is asked and paid at Finalize, not at trigger scan', () => {
  const ability = triggered(kennen)[0];
  const program = kennenProgram(ability);
  const f = fixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    answers: {
      'finalize:trigger:1:optional': true,
      'target:kennen.play.unit': ['victim']
    },
    setup(builder) {
      builder.hand('kennen', { cardId: program.canonicalCardId, energy: 3, power: null, might: 2 });
      builder.unit('victim', { owner: 'B', might: 2, location: field('one') });
    }
  });
  f.play('kennen');
  settle(f.engine);
  const askedIds = f.asked.map(request => request.id);
  assert.equal(askedIds.filter(id => id.startsWith('trigger:')).length, 0, `scan asked an optional trigger: ${askedIds}`);
  assert.ok(askedIds.includes('finalize:trigger:1:optional'), askedIds);
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.get('victim').stunned, true);
  assert.ok(f.engine.trace.some(entry => entry.step === 'finalized' && entry.item === 'trigger:1'));
});

test('EG-TRIGGERS: declining the leading may removes the trigger without cost or target', () => {
  const program = kennenProgram(triggered(kennen)[0]);
  const f = fixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    answers: { 'finalize:trigger:1:optional': false },
    setup(builder) {
      builder.hand('kennen', { cardId: program.canonicalCardId, energy: 3, power: null, might: 2 });
    }
  });
  f.play('kennen');
  settle(f.engine);
  const ids = f.asked.map(request => request.id);
  assert.ok(ids.includes('finalize:trigger:1:optional'), ids);
  assert.ok(!ids.some(id => id.startsWith('target:')), `declined trigger must not ask targets: ${ids}`);
  assert.ok(
    f.engine.trace.some(entry => entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'declined'),
    JSON.stringify(f.engine.trace)
  );
  assert.equal(f.kernel.player('A').energy, 2);
});

test('EG-TRIGGERS: cannot pay the finalize cost removes the trigger atomically after targets', () => {
  const program = kennenProgram(triggered(kennen)[0]);
  const f = fixture({
    programs: [program], energy: { A: 3 }, power: { A: [] },
    answers: { 'finalize:trigger:1:optional': true, 'target:kennen.play.unit': ['victim'] },
    setup(builder) {
      builder.hand('kennen', { cardId: program.canonicalCardId, energy: 3, power: null, might: 2 });
      builder.unit('victim', { owner: 'B', might: 2, location: field('one') });
    }
  });
  f.play('kennen');
  settle(f.engine);
  const ids = f.asked.map(request => request.id);
  assert.ok(ids.includes('target:kennen.play.unit'), ids);
  assert.ok(
    f.engine.trace.some(entry => entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'unperformable-trigger'),
    JSON.stringify(f.engine.trace)
  );
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.get('victim').stunned, false);
  assert.equal(f.errors.length, 0);
});
