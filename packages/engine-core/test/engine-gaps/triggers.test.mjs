import assert from 'node:assert/strict';
import test from 'node:test';

import { fixture, settle, pendingItems, cardProgram, c } from '../rules/keywords/support.mjs';
import { AwaitChoice } from '../../dist/effects/contract.js';
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
  assert.ok(
    askedIds.indexOf('finalize:trigger:1:optional') < askedIds.indexOf('target:kennen.play.unit'),
    `Finalize may question must precede target selection: ${askedIds}`
  );
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

test('EG-TRIGGERS: no legal finalize target removes the trigger before any question', () => {
  const cardPlayed = triggered(kennen)[0];
  const [choice] = cardPlayed.body;
  const body = choice.args.body.value.map(instruction =>
    instruction.op === 'effect.stun'
      ? {
          ...instruction,
          targets: instruction.targets.map(spec => ({
            ...spec,
            filter: { type: 'unit', controller: 'opponent', zone: 'board' }
          }))
        }
      : instruction
  );
  const program = kennenProgram({
    ...cardPlayed,
    body: [{ ...choice, args: { ...choice.args, body: { ...choice.args.body, value: body } } }]
  });
  const f = fixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    answers: { 'finalize:trigger:1:optional': true },
    setup(builder) {
      builder.hand('kennen', { cardId: program.canonicalCardId, energy: 3, power: null, might: 2 });
    }
  });
  f.play('kennen');
  settle(f.engine);
  const ids = f.asked.map(request => request.id);
  assert.ok(ids.includes('finalize:trigger:1:optional'), ids);
  assert.ok(!ids.some(id => id.startsWith('target:')), `no target question when none exist: ${ids}`);
  assert.ok(
    f.engine.trace.some(entry => entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'unperformable-trigger'),
    JSON.stringify(f.engine.trace)
  );
  assert.equal(f.kernel.player('A').energy, 2);
});

test('EG-TRIGGERS: event-bound trigger fires from the bound event snapshot at turn-end', () => {
  const attackAbility = triggered(kennen)[1];
  assert.equal(attackAbility.trigger.at, 'attack-declared');
  const ability = {
    ...attackAbility,
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } }
  };
  const program = kennenProgram(ability);
  const f = fixture({
    programs: [program], energy: { A: 4 }, power: { A: [] },
    answers: {
      'finalize:trigger:1:optional': true,
      'target:kennen.attack.unit': ['victim']
    },
    setup(builder) {
      builder.unit('kennen', { cardId: program.canonicalCardId, energy: 3, power: null, might: 2, location: field('one') });
      builder.unit('victim', { owner: 'B', might: 2, location: field('one') });
    }
  });
  const registrations = f.binding.registerProgramTriggers(f.engine, f.get('kennen'));
  assert.equal(registrations.length, 1);
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.deepEqual(pendingItems(f.engine).filter(item => item.startsWith('trigger:')), ['trigger:1']);
  while (f.engine.items.length) {
    f.engine.advance();
    const item = f.engine.items.at(-1);
    if (item) f.engine.pass(item.controller);
  }
  const ids = f.asked.map(request => request.id);
  assert.ok(ids.includes('finalize:trigger:1:optional'), ids);
  assert.ok(ids.includes('target:kennen.attack.unit'), ids);
  assert.equal(f.kernel.player('A').energy, 2);
  assert.equal(f.get('victim').stunned, true);
});

test('EG-TRIGGERS: buff event reflexively enqueues and finalizes the ready trigger', () => {
  const program = mistfallProgram();
  const f = fixture({
    programs: [program], energy: { A: 5 }, power: { A: ['Body'] },
    answers: {
      'finalize:trigger:1:optional': true,
      'target:mistfall.buffed-unit': ['friendly']
    },
    setup(builder) {
      builder.unit('mistfall', { cardId: program.canonicalCardId, power: ['Body'], exhausted: true, location: field('one') });
      builder.unit('friendly', { owner: 'A', power: ['Body'], exhausted: true, location: field('one') });
    }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('mistfall'));
  f.engine.commit({ type: 'buff', object: f.ref('friendly'), amount: 1 });
  f.engine.advance();
  const eventIndex = f.engine.trace.findIndex(entry => entry.step === 'event' && entry.timingPoint === 'buff-added');
  const pendingIndex = f.engine.trace.findIndex(entry => entry.step === 'pending' && entry.item === 'trigger:1');
  assert.ok(eventIndex >= 0, JSON.stringify(f.engine.trace));
  assert.ok(pendingIndex > eventIndex, JSON.stringify(f.engine.trace));
  assert.deepEqual(pendingItems(f.engine).filter(item => item.startsWith('trigger:')), ['trigger:1']);
  while (f.engine.items.length) {
    f.engine.advance();
    const item = f.engine.items.at(-1);
    if (item) f.engine.pass(item.controller);
  }
  assert.equal(f.get('mistfall').exhausted, false);
  assert.equal(f.get('friendly').exhausted, false);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.ok(f.engine.pipeline.events.some(event => event.timingPoint === 'object-exhausted' && event.object?.ref.id === 'mistfall'));
  assert.equal(f.errors.length, 0);
});

test('EG-TRIGGERS: declining the ready may leaves its cost unpaid', () => {
  const program = mistfallProgram();
  const f = fixture({
    programs: [program], energy: { A: 5 }, power: { A: ['Body'] },
    answers: { 'finalize:trigger:1:optional': false },
    setup(builder) {
      builder.unit('mistfall', { cardId: program.canonicalCardId, power: ['Body'], exhausted: true, location: field('one') });
      builder.unit('friendly', { owner: 'A', power: ['Body'], exhausted: true, location: field('one') });
    }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('mistfall'));
  f.engine.commit({ type: 'buff', object: f.ref('friendly'), amount: 1 });
  f.engine.advance();
  while (f.engine.items.length) {
    f.engine.advance();
    const item = f.engine.items.at(-1);
    if (item) f.engine.pass(item.controller);
  }
  assert.ok(
    f.engine.trace.some(entry => entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'declined'),
    JSON.stringify(f.engine.trace)
  );
  assert.deepEqual(f.kernel.player('A').power, ['Body']);
  assert.equal(f.get('mistfall').exhausted, true);
  assert.equal(f.get('friendly').exhausted, true);
});

test('EG-TRIGGERS: an unpayable ready cost rolls finalize back atomically', () => {
  const program = mistfallProgram();
  const f = fixture({
    programs: [program], energy: { A: 5 }, power: { A: [] },
    answers: {
      'finalize:trigger:1:optional': true,
      'target:mistfall.buffed-unit': ['friendly']
    },
    setup(builder) {
      builder.unit('mistfall', { cardId: program.canonicalCardId, power: [], exhausted: true, location: field('one') });
      builder.unit('friendly', { owner: 'A', power: ['Body'], exhausted: true, location: field('one') });
    }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('mistfall'));
  f.engine.commit({ type: 'buff', object: f.ref('friendly'), amount: 1 });
  f.engine.advance();
  while (f.engine.items.length) {
    f.engine.advance();
    const item = f.engine.items.at(-1);
    if (item) f.engine.pass(item.controller);
  }
  assert.ok(
    f.engine.trace.some(entry => entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'unperformable-trigger'),
    JSON.stringify(f.engine.trace)
  );
  assert.equal(f.get('friendly').buffs, 1);
  assert.equal(f.get('friendly').exhausted, true);
  assert.equal(f.get('mistfall').exhausted, true);
  assert.equal(f.errors.length, 0);
});

test('EG-TRIGGERS: trigger conditions are evaluated at the event timing point', () => {
  const cardPlayed = triggered(kennen)[0];
  const program = kennenProgram({
    ...cardPlayed,
    trigger: { ...cardPlayed.trigger, condition: { kind: 'never' } }
  });
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
  assert.deepEqual(pendingItems(f.engine).filter(item => item.startsWith('trigger:')), []);
  assert.ok(!f.asked.some(request => request.id.includes('trigger:1')), f.asked.map(request => request.id));
  assert.equal(f.get('victim').stunned, false);
  assert.equal(f.kernel.player('A').energy, 2);
});

test('EG-TRIGGERS: a leading optional outside the bound shape keeps the scan question', () => {
  const legacyAbility = {
    kind: 'triggered',
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } },
    optional: true,
    body: [{
      id: 'legacy.choice',
      op: 'choice.optional',
      args: {
        body: c([{
          id: 'legacy.draw',
          op: 'effect.draw',
          args: { amount: c(1) }
        }])
      }
    }]
  };
  const program = cardProgram('test:eg-triggers-legacy-optional', [], [legacyAbility]);
  const f = fixture({
    programs: [program], energy: { A: 1 }, power: { A: [] },
    setup(builder) {
      builder.unit('watcher', { cardId: program.canonicalCardId, location: field('one') });
    }
  });
  const [registrationId] = f.binding.registerProgramTriggers(f.engine, f.get('watcher'));
  const scanQuestion = `trigger:1:${registrationId}:optional`;
  assert.throws(
    () => f.engine.emit({ timingPoint: 'turn-end' }),
    error => error instanceof AwaitChoice && error.request.id === scanQuestion
  );
  assert.ok(f.asked.some(request => request.id === scanQuestion));
  assert.ok(!f.asked.some(request => request.id.startsWith('finalize:')));
  f.answers.set(scanQuestion, true);
  f.answers.set('legacy.choice/optional', true);
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.ok(pendingItems(f.engine).includes('trigger:1'));
  while (f.engine.items.length) {
    f.engine.advance();
    const item = f.engine.items.at(-1);
    if (item) f.engine.pass(item.controller);
  }
  assert.equal(f.kernel.player('A').deckSize, 1);
});
