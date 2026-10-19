// EG-TRIGGERS: production binding for trigger conditions and leading may/cost.
//
// CR-v1.5 383.3.a (:2698): the controller decides a leading may at Finalize.
// CR-v1.5 383.3.b.1 (:2728): the cost must be paid to finalize the ability.
// CR-v1.5 383.2.c (:2639): conditions are evaluated after the inciting event.
//
// A Finalize-moved cost instruction has no Resolve-scope receipt. Pure
// linkedTo gates are safe because any failed payment prevents Resolve;
// linked/linked-value reads of that instruction remain judge-required.
import assert from 'node:assert/strict';
import test from 'node:test';

import { fixture, settle, pendingItems, cardProgram, c } from '../rules/keywords/support.mjs';
import { triggerRegistrations } from '../../dist/programs/triggers.js';
import { eventItBinding } from '../../dist/programs/trigger-adapters/event-it.js';
import kennen from '../../../card-dsl/dist/cards/ven/kennen-keeper-of-balance.js';
import mistfall from '../../../card-dsl/dist/cards/ogn/mistfall.js';
import monastery from '../../../card-dsl/dist/cards/ogn/monastery-of-hirana.js';
import immortalPhoenix from '../../../card-dsl/dist/cards/ogn/immortal-phoenix.js';
import avaAchiever from '../../../card-dsl/dist/cards/ogn/ava-achiever.js';
import baccaiReaper from '../../../card-dsl/dist/cards/ven/baccai-reaper.js';

const field = id => ({ type: 'battlefield', id });
const triggered = program => program.abilities.filter(ability => ability.kind === 'triggered');
const executable = program => {
  const { judgeReason: _dropped, ...rest } = program;
  return { ...rest, status: 'executable' };
};
const withAbility = (program, ability) => executable({ ...program, abilities: [ability] });

function paymentAbility(card, payments, effect) {
  const source = card.abilities.find(ability => ability.kind === 'triggered');
  const [choice] = source.body;
  return {
    ...source,
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } },
    body: [{
      ...choice,
      args: {
        ...choice.args,
        body: c([
          {
            id: 'test.pay',
            op: 'cost.pay',
            args: { payments: c(payments) }
          },
          effect
        ])
      }
    }]
  };
}

test('EG-TRIGGERS: Kennen payment gate is decided and paid at Finalize', () => {
  const program = withAbility(kennen, triggered(kennen)[0]);
  const f = fixture({
    programs: [program], energy: { A: 5 },
    answers: { 'finalize:trigger:1:optional': true, 'target:kennen.play.unit': ['victim'] },
    setup(builder) {
      builder.hand('kennen', { cardId: program.canonicalCardId, energy: 3, power: null, might: 2 });
      builder.unit('victim', { owner: 'B', might: 2, location: field('one') });
    }
  });
  f.play('kennen');
  settle(f.engine);
  const ids = f.asked.map(request => request.id);
  assert.ok(ids.includes('finalize:trigger:1:optional'), ids);
  assert.ok(!ids.some(id => id.startsWith('trigger:')));
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.get('victim').stunned, true);
});

test('EG-TRIGGERS: original Baccai pure payment gate is moved to Finalize', () => {
  const program = withAbility(baccaiReaper, triggered(baccaiReaper)[0]);
  const turnEnd = {
    ...triggered(baccaiReaper)[0],
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } }
  };
  const turnEndProgram = withAbility(baccaiReaper, turnEnd);
  const f = fixture({
    programs: [turnEndProgram], power: { A: ['Fury'] },
    answers: { 'finalize:trigger:1:optional': true },
    setup(builder) { builder.unit('reaper', { cardId: turnEndProgram.canonicalCardId, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('reaper'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  const [item] = f.engine.items;
  assert.equal(item?.status, 'finalized');
  assert.equal(item?.payment?.paid, true);
  assert.deepEqual(item?.payment?.total.power, [{ amount: 1, allowedDomains: ['Fury'] }]);
  assert.deepEqual(item?.payment?.actions.map(entry => entry.action), [
    { type: 'pay', player: 'A', plan: { finalized: true, energy: 0, power: ['Fury'] } }
  ]);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.ok(f.engine.trace.some(entry => entry.step === 'finalized' && entry.item === 'trigger:1'));
  assert.equal(baccaiReaper.status, 'judge-required');
});

test('EG-TRIGGERS: Baccai decline pays nothing and asks no target', () => {
  const program = withAbility(baccaiReaper, triggered(baccaiReaper)[0]);
  const turnEndProgram = withAbility(baccaiReaper, {
    ...triggered(baccaiReaper)[0],
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } }
  });
  const f = fixture({
    programs: [turnEndProgram], power: { A: ['Fury'] },
    answers: { 'finalize:trigger:1:optional': false },
    setup(builder) { builder.unit('reaper', { cardId: turnEndProgram.canonicalCardId, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('reaper'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.ok(!f.asked.some(request => request.id.startsWith('target:')));
  assert.ok(f.engine.trace.some(entry => entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'declined'));
});

test('EG-TRIGGERS: Baccai unavailable Fury is atomic and removed', () => {
  const program = withAbility(baccaiReaper, triggered(baccaiReaper)[0]);
  const turnEndProgram = withAbility(baccaiReaper, {
    ...triggered(baccaiReaper)[0],
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } }
  });
  const f = fixture({
    programs: [turnEndProgram], power: { A: [] },
    answers: { 'finalize:trigger:1:optional': true },
    setup(builder) { builder.unit('reaper', { cardId: turnEndProgram.canonicalCardId, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('reaper'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.ok(f.engine.trace.some(entry => entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'unperformable-trigger'));
});

test('EG-TRIGGERS: Energy plus domain Power pays once before an independent effect', () => {
  const ability = paymentAbility(
    immortalPhoenix,
    { energy: 1, power: ['Fury'] },
    { id: 'test.draw', op: 'effect.draw', args: { amount: c(1) } }
  );
  const program = withAbility(immortalPhoenix, ability);
  const f = fixture({
    programs: [program], energy: { A: 3 }, power: { A: ['Fury'] },
    answers: { 'finalize:trigger:1:optional': true },
    setup(builder) { builder.unit('phoenix', { cardId: program.canonicalCardId, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('phoenix'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  settle(f.engine);
  assert.equal(f.kernel.player('A').energy, 2);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.player('A').deckSize, 1);
  assert.equal(f.engine.items.length, 0);
});

test('EG-TRIGGERS: domain-only Power pays once and an independent effect resolves', () => {
  const ability = paymentAbility(
    avaAchiever,
    { power: ['Mind'] },
    { id: 'test.draw', op: 'effect.draw', args: { amount: c(1) } }
  );
  const program = withAbility(avaAchiever, ability);
  const f = fixture({
    programs: [program], energy: { A: 3 }, power: { A: ['Mind'] },
    answers: { 'finalize:trigger:1:optional': true },
    setup(builder) { builder.unit('ava', { cardId: program.canonicalCardId, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('ava'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  settle(f.engine);
  assert.equal(f.kernel.player('A').energy, 3);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.kernel.player('A').deckSize, 1);
});

test('EG-TRIGGERS: no-cost leading may is decided at Finalize', () => {
  const source = monastery.abilities.find(ability => ability.kind === 'triggered');
  const program = withAbility(monastery, {
    ...source,
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } }
  });
  const f = fixture({
    programs: [program], answers: { 'finalize:trigger:1:optional': true },
    setup(builder) { builder.unit('watcher', { cardId: program.canonicalCardId, buffs: 1, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('watcher'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  const ids = f.asked.map(request => request.id);
  assert.ok(!ids.some(id => id.startsWith('trigger:')));
  assert.ok(ids.includes('finalize:trigger:1:optional'));
  assert.equal(monastery.status, 'judge-required');
});

test('EG-TRIGGERS: unknown leading shape fails closed at binding', () => {
  const legacy = {
    kind: 'triggered',
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } },
    optional: true,
    body: [{
      id: 'legacy.choice',
      op: 'choice.optional',
      args: { body: c([{ id: 'legacy.sequence', op: 'sequence', args: { body: c([]) } }]) }
    }]
  };
  const program = cardProgram('test:eg-triggers-legacy-optional', [], [legacy]);
  const f = fixture({
    programs: [program],
    setup(builder) { builder.unit('watcher', { cardId: program.canonicalCardId, location: field('one') }); }
  });
  assert.throws(() => f.binding.registerProgramTriggers(f.engine, f.get('watcher')), error => error?.code === 'judge-required');
  assert.equal(f.engine.items.length, 0);
});

test('EG-TRIGGERS: trigger conditions are evaluated at the event timing point', () => {
  const program = cardProgram('test:eg-triggers-condition', [], [{
    kind: 'triggered',
    trigger: { at: 'turn-end', filter: { event: 'turn-end' }, condition: { kind: 'never' } },
    optional: false,
    body: [{ id: 'draw', op: 'effect.draw', args: { amount: c(1) } }]
  }]);
  const f = fixture({
    programs: [program],
    setup(builder) { builder.unit('watcher', { cardId: program.canonicalCardId, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('watcher'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.deepEqual(pendingItems(f.engine).filter(item => item.startsWith('trigger:')), []);
  assert.ok(!f.asked.some(request => request.id.includes('trigger:1')));
});

test('EG-TRIGGERS: a linked-value read of the moved cost fails closed', () => {
  const ability = paymentAbility(
    immortalPhoenix,
    { energy: 1, power: ['Fury'] },
    { id: 'test.consume', op: 'effect.draw', args: { amount: c(1), player: { kind: 'linked-value', instructionId: 'test.pay', key: 'player' } } }
  );
  const program = withAbility(immortalPhoenix, ability);
  const f = fixture({
    programs: [program],
    setup(builder) { builder.unit('phoenix', { cardId: program.canonicalCardId, location: field('one') }); }
  });
  assert.throws(() => f.binding.registerProgramTriggers(f.engine, f.get('phoenix')), error => error?.code === 'judge-required');
});

test('EG-TRIGGERS: pure payment gate removes only linkedTo, not a receipt read', () => {
  const ability = paymentAbility(
    baccaiReaper,
    { power: ['Fury'] },
    { id: 'test.gated', op: 'continuous.grant-keyword', linkedTo: 'test.pay', args: {
      keyword: c('Assault'), value: c(2), duration: c('end-of-turn'), objects: c({ kind: 'source' })
    } }
  );
  const program = withAbility(baccaiReaper, {
    ...ability,
    trigger: { at: 'turn-end', filter: { event: 'turn-end' } }
  });
  const f = fixture({
    programs: [program], power: { A: ['Fury'] },
    answers: { 'finalize:trigger:1:optional': true },
    setup(builder) { builder.unit('reaper', { cardId: program.canonicalCardId, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('reaper'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.deepEqual(f.kernel.player('A').power, []);
});

test('EG-TRIGGERS: Mistfall event-it ready fails closed until the 835 bridge', () => {
  const program = withAbility(mistfall, triggered(mistfall)[0]);
  const f = fixture({
    programs: [program],
    setup(builder) { builder.unit('mistfall', { cardId: program.canonicalCardId, location: field('one') }); }
  });
  assert.throws(
    () => triggerRegistrations(f.binding.registry, f.get('mistfall')),
    error => error?.code === 'judge-required'
  );
  assert.equal(mistfall.status, 'judge-required');
});

test('EG-TRIGGERS: event-it binding freezes eventId, ref, and snapshot for 835', () => {
  const f = fixture({
    setup(builder) { builder.unit('buffed', { owner: 'A', exhausted: true, location: field('one') }); }
  });
  const snapshot = f.get('buffed');
  const binding = eventItBinding({
    eventId: 41,
    timingPoint: 'buff-added',
    object: snapshot
  });
  assert.ok(binding);
  assert.equal(binding.eventId, 41);
  assert.equal(binding.role, 'it');
  assert.deepEqual(binding.ref, snapshot.ref);
  assert.equal(binding.snapshot.exhausted, true);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.ref), true);
  assert.equal(Object.isFrozen(binding.snapshot), true);
  assert.equal(Object.isFrozen(binding.snapshot.ref), true);
  assert.equal(Object.isFrozen(binding.snapshot.printed), true);
  assert.equal(eventItBinding({ eventId: 42, timingPoint: 'turn-end' }), null);
});

test('EG-TRIGGERS: mid-payment failure rolls back Energy and Power', () => {
  const ability = paymentAbility(
    immortalPhoenix,
    [
      { kind: 'energy', amount: 1 },
      { kind: 'power', amount: 1, allowedDomains: ['Fury'] },
      { kind: 'exhaust', object: 'self' }
    ],
    { id: 'test.draw', op: 'effect.draw', args: { amount: c(1) } }
  );
  const program = withAbility(immortalPhoenix, ability);
  const f = fixture({
    programs: [program], energy: { A: 3 }, power: { A: ['Fury'] },
    answers: { 'finalize:trigger:1:optional': true },
    setup(builder) { builder.unit('phoenix', { cardId: program.canonicalCardId, exhausted: true, location: field('one') }); }
  });
  f.binding.registerProgramTriggers(f.engine, f.get('phoenix'));
  f.engine.emit({ timingPoint: 'turn-end' });
  f.engine.advance();
  assert.equal(f.kernel.player('A').energy, 3);
  assert.deepEqual(f.kernel.player('A').power, ['Fury']);
  assert.ok(f.engine.trace.some(entry => entry.step === 'removed' && entry.item === 'trigger:1' && entry.reason === 'unperformable-trigger'));
});
