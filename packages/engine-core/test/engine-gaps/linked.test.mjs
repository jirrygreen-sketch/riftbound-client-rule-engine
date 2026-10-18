import assert from 'node:assert/strict';
import test from 'node:test';

import sarcophagus from '../../../card-dsl/dist/cards/unl/cursed-sarcophagus.js';
import grenade from '../../../card-dsl/dist/cards/unl/dancing-grenade.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { createLinkedAbilityHost, LinkedAbilityState } from '../../dist/effects/linked-abilities/index.js';
import { resolveLinkedObjects } from '../../dist/effects/interpreter/linked-objects.js';
import { resolveObjectSelector } from '../../dist/effects/interpreter/selectors.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { cardProgram, settle as settleChain } from '../rules/keywords/support.mjs';

const c = value => ({ kind: 'constant', value });
const base = player => ({ type: 'base', player });
const field = id => ({ type: 'battlefield', id });
const banish = sarcophagus.abilities[0].body[0];
const rawGrenade = grenade.abilities[0];
const collection = 'units-banished-with-this';

// These executable envelopes test engine primitives. Official programs, statuses,
// and all original instructions remain untouched. Consumer IR needs its owner.
const sarcophagusProgram = cardProgram('test:linked-sarcophagus', [], [sarcophagus.abilities[0]]);
const grenadeProgram = cardProgram('test:linked-grenade', rawGrenade.body);
grenadeProgram.abilities[0] = rawGrenade;

const declaration = (program = sarcophagusProgram, overrides = {}) => ({
  cardId: program.canonicalCardId, setId: 'banished-units',
  members: [banish.id, 'consume-linked'],
  captures: [{ path: [banish.id], key: 'banishedTrashUnits', action: 'banish', zone: 'banishment' }],
  reads: [{ key: collection, member: 'consume-linked' }],
  ...overrides
});

function runtime(builder, programs = [], bindings = []) {
  const kernel = builder.build();
  const answers = new Map(), asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const port = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  let engine;
  const { host, state } = createLinkedAbilityHost(port, { bindings, clock: () => engine.pipeline.clock });
  const binding = createProgramBinding({ cardPrograms: [...programs, cardProgram('test:linked-target')] });
  engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, describePlay: binding.describePlay,
    cleanup(current) {
      current.layers.setObjects(kernel.objects);
      let changed = false;
      for (const object of current.layers.evaluateAll()) {
        if (object.zone !== 'board' || !object.types.includes('unit') || object.might === null ||
          object.might > 0 && object.damage < object.might) continue;
        assert.equal(current.commit({ type: 'kill', object: object.ref }).status, 'done');
        changed = true;
      }
      return changed;
    }
  });
  binding.attachLifecycle(engine, error => { throw error; });
  const context = (source = kernel.getObject('source')) => host.context(source, source.controller, 'chain-item-resolve');
  const play = id => {
    engine.advance();
    return engine.execute(binding.describePlay(
      { type: 'play', player: 'A', object: kernel.ref(id) }, kernel.getObject(id)
    ));
  };
  return { kernel, engine, host, state, answers, asked, context, play };
}

function settle(engine) {
  engine.advance();
  settleChain(engine);
}

function sarcophagusWorld() {
  return world().player('A', { energy: 16, power: ['Chaos', 'Chaos', 'Chaos', 'Chaos'] }).player('B')
    .hand('source', { cardId: sarcophagusProgram.canonicalCardId, name: 'Cursed Sarcophagus',
      types: ['gear'], energy: 4, power: ['Chaos'], might: null })
    .hand('copy', { cardId: sarcophagusProgram.canonicalCardId, name: 'Cursed Sarcophagus',
      types: ['gear'], energy: 4, power: ['Chaos'], might: null })
    .unit('fallen', { zone: 'trash', owner: 'A', controller: 'A', might: 5 })
    .unit('unrelated', { zone: 'banishment', owner: 'A', controller: 'A', might: 5 });
}

function grenadeWorld() {
  return world().player('A', { energy: 6, power: ['Fury', 'Fury', 'Fury'] }).player('B')
    .hand('source', { cardId: grenadeProgram.canonicalCardId, name: 'Dancing Grenade',
      types: ['spell'], energy: 2, power: ['Fury'], might: null })
    .hand('copy', { cardId: grenadeProgram.canonicalCardId, name: 'Dancing Grenade',
      types: ['spell'], energy: 2, power: ['Fury'], might: null })
    .unit('target', { cardId: 'test:linked-target', owner: 'B', controller: 'B', zone: 'board', location: base('B'), might: 20 });
}

test('raw Sarcophagus play trigger captures actual new refs and the object selector reads only its set', () => {
  const f = runtime(sarcophagusWorld(), [sarcophagusProgram], [declaration()]);
  const old = f.kernel.ref('fallen');
  f.play('source');
  settle(f.engine);
  const actual = f.kernel.ref('fallen');
  assert.notDeepEqual(actual, old);
  assert.equal(f.kernel.object(old), null);
  const context = f.context();
  assert.deepEqual(resolveLinkedObjects(collection, context, f.state), [actual]);
  assert.deepEqual(resolveObjectSelector({ linked: collection }, { context, linked: key => context.linked(key) }), [actual]);
  assert.deepEqual(f.state.zoneReceipts(old).map(receipt => [receipt.action, receipt.fromZone, receipt.toZone, receipt.to]),
    [['banish', 'trash', 'banishment', actual]]);
  assert.equal(f.kernel.getObject('source').energy, 4);
  assert.equal(f.kernel.getObject('unrelated').zone, 'banishment');
});

test('same-name sources and unrelated banishments cannot share linked collections', () => {
  const f = runtime(sarcophagusWorld().unit('later', { zone: 'hand', owner: 'A', controller: 'A' }),
    [sarcophagusProgram], [declaration()]);
  f.play('source'); settle(f.engine);
  const first = f.kernel.ref('fallen');
  assert.equal(f.engine.commit({ type: 'discard', object: f.kernel.ref('later') }).status, 'done');
  f.play('copy'); settle(f.engine);
  const second = f.kernel.ref('later');
  assert.deepEqual(resolveLinkedObjects(collection, f.context(), f.state), [first]);
  assert.deepEqual(resolveLinkedObjects(collection, f.context(f.kernel.getObject('copy')), f.state), [second]);
  assert.equal(f.kernel.getObject('later').zone, 'banishment');
  assert.equal(f.kernel.getObject('unrelated').zone, 'banishment');
});

test('leaving and returning to banishment never revives the captured incarnation', () => {
  const f = runtime(sarcophagusWorld(), [sarcophagusProgram], [declaration()]);
  f.play('source'); settle(f.engine);
  const banished = f.kernel.ref('fallen');
  assert.equal(f.engine.commit({ type: 'move-zone', object: banished, to: 'trash' }).status, 'done');
  assert.equal(f.engine.commit({ type: 'banish', object: f.kernel.ref('fallen') }).status, 'done');
  assert.notDeepEqual(f.kernel.ref('fallen'), banished);
  assert.deepEqual(resolveLinkedObjects(collection, f.context(), f.state), []);
  assert.equal(f.kernel.getObject('fallen').zone, 'banishment');
});

test('source re-entry creates a fresh set; already pending origin and delayed source windows remain distinct', () => {
  const f = runtime(sarcophagusWorld(), [sarcophagusProgram], [declaration()]);
  f.play('source'); settle(f.engine);
  const origin = f.kernel.getObject('source');
  const affected = f.kernel.ref('fallen');
  assert.equal(f.engine.commit({ type: 'return-to-hand', object: origin.ref }).status, 'done');
  assert.deepEqual(resolveLinkedObjects(collection, f.context(origin), f.state, { kind: 'affected-objects' }), [affected]);
  assert.deepEqual(resolveLinkedObjects(collection, f.context(origin), f.state, { kind: 'source', zone: 'board' }), []);
  f.play('source'); settle(f.engine);
  assert.notDeepEqual(f.kernel.ref('source'), origin.ref);
  assert.deepEqual(resolveLinkedObjects(collection, f.context(), f.state), []);
  assert.deepEqual(resolveLinkedObjects(collection, f.context(origin), f.state), [affected]);
});

test('board movement and control changes preserve the exact linked source', () => {
  const f = runtime(sarcophagusWorld(), [sarcophagusProgram], [declaration()]);
  f.play('source'); settle(f.engine);
  const origin = f.kernel.ref('source');
  const affected = f.kernel.ref('fallen');
  assert.equal(f.engine.commit({ type: 'move-location', object: origin, to: field('bf') }).status, 'done');
  assert.equal(f.engine.commit({ type: 'take-control', object: origin, player: 'B' }).status, 'done');
  assert.deepEqual(f.kernel.ref('source'), origin);
  assert.deepEqual(resolveLinkedObjects(collection, f.context(), f.state), [affected]);
});

test('partial prevention records only successful banishments, even when the producer is negated', () => {
  const f = runtime(sarcophagusWorld().unit('prevented', { zone: 'trash', owner: 'A', controller: 'A' }),
    [sarcophagusProgram], [declaration()]);
  f.engine.pipeline.registerReplacement({ id: 'prevent-one',
    matches: action => action.type === 'banish' && action.object.id === 'prevented',
    apply: () => ({ status: 'prevent' }) });
  f.play('source'); settle(f.engine);
  assert.deepEqual(resolveLinkedObjects(collection, f.context(), f.state), [f.kernel.ref('fallen')]);
  assert.equal(f.kernel.getObject('prevented').zone, 'trash');
  assert.equal(f.state.zoneReceipts().some(receipt => receipt.from.id === 'prevented'), false);
});

test('separate granted origins and nested producer paths keep their component sets distinct', () => {
  const secondBanish = { id: 'second-banish', op: 'effect.banish', args: {
    objects: c({ zone: 'trash', player: 'A' }), linkKey: c('second-banished')
  } };
  const program = cardProgram('test:linked-grants', [], [{ ...sarcophagus.abilities[0], body: [
    { id: 'grant-one', op: 'sequence', args: { body: c([banish]) } },
    { id: 'grant-two', op: 'sequence', args: { body: c([secondBanish]) } }
  ] }]);
  const builder = world().player('A', { energy: 4, power: ['Chaos'] }).player('B')
    .hand('source', { cardId: program.canonicalCardId, types: ['gear'], energy: 4, power: ['Chaos'] })
    .unit('grantor-one', { name: 'Same Grantor' }).unit('grantor-two', { name: 'Same Grantor' })
    .unit('fallen', { zone: 'trash', owner: 'A', controller: 'A' });
  const bindings = ['one', 'two'].map((id, index) => declaration(program, {
    grantedBy: { source: builder.kernel.ref(`grantor-${id}`), grantId: 'same-grant-name' },
    members: [banish.id, secondBanish.id, 'consume-linked'],
    captures: [{ path: [`grant-${id}`, index === 0 ? banish.id : secondBanish.id],
      key: index === 0 ? 'banishedTrashUnits' : 'second-banished', action: 'banish', zone: 'banishment' }],
    reads: [{ key: `${collection}-${index}`, member: 'consume-linked' }]
  }));
  const f = runtime(builder, [program], bindings);
  f.play('source'); settle(f.engine);
  assert.deepEqual(resolveLinkedObjects(`${collection}-0`, f.context(), f.state), [f.kernel.ref('fallen')]);
  assert.deepEqual(resolveLinkedObjects(`${collection}-1`, f.context(), f.state), []);
});

test('a replacement moving the object elsewhere produces no banishment association', () => {
  const f = runtime(sarcophagusWorld(), [sarcophagusProgram], [declaration()]);
  f.engine.pipeline.registerReplacement({ id: 'replace-banish', matches: action => action.type === 'banish',
    apply: action => ({ status: 'rewrite', action: { type: 'return-to-hand', object: action.object } }) });
  f.play('source'); settle(f.engine);
  assert.equal(f.kernel.getObject('fallen').zone, 'hand');
  assert.deepEqual(resolveLinkedObjects(collection, f.context(), f.state), []);
});

test('AwaitChoice rolls back captured links, zone receipts and source writes; refusal retries deterministically', () => {
  const optional = { id: 'after-capture', op: 'choice.optional', args: {
    body: c([{ id: 'draw', op: 'effect.draw', args: { amount: c(1) } }])
  } };
  const program = cardProgram('test:linked-transaction', [], [
    { ...sarcophagus.abilities[0], body: [banish, optional] }
  ]);
  // Only the synthetic envelope's identity is assigned in this initial position.
  const builder = world().player('A', { energy: 4, power: ['Chaos'] }).player('B')
    .hand('source', { cardId: program.canonicalCardId, types: ['gear'], energy: 4, power: ['Chaos'] })
    .unit('fallen', { zone: 'trash', owner: 'A', controller: 'A' }).deck(['drawn'], { owner: 'A' });
  const transaction = runtime(builder, [program], [declaration(program)]);
  transaction.play('source');
  const before = transaction.kernel.snapshot(), links = transaction.state.checkpoint();
  assert.throws(() => settle(transaction.engine), AwaitChoice);
  assert.deepEqual(transaction.kernel.snapshot(), before);
  assert.deepEqual(transaction.state.checkpoint(), links);
  assert.deepEqual(resolveLinkedObjects(collection, transaction.context(), transaction.state), []);
  const request = transaction.asked.at(-1);
  transaction.answers.set(request.id, 'invalid-optional-answer');
  assert.throws(() => settle(transaction.engine), /boolean/);
  assert.deepEqual(transaction.kernel.snapshot(), before);
  assert.deepEqual(transaction.state.checkpoint(), links);
  transaction.answers.set(request.id, false);
  settle(transaction.engine);
  assert.deepEqual(resolveLinkedObjects(collection, transaction.context(), transaction.state), [transaction.kernel.ref('fallen')]);
  assert.equal(transaction.kernel.getObject('drawn').zone, 'deck');
  assert.equal(transaction.state.zoneReceipts().filter(receipt => receipt.action === 'banish').length, 1);
  assert.equal(transaction.engine.items.length, 0);
});

test('raw Dancing Grenade damage produces entity and incarnation histories and a real Chain-to-Trash receipt', () => {
  const f = runtime(grenadeWorld(), [grenadeProgram]);
  const origin = f.kernel.getObject('source');
  f.play('source');
  const chainRef = f.engine.items[0].object;
  settle(f.engine);
  const history = f.state.damageHistory({ source: origin.ref, identity: 'incarnation', turn: 1 });
  assert.equal(history.length, 1);
  assert.equal(history[0].amount, 2);
  assert.deepEqual(history[0].target, f.kernel.ref('target'));
  assert.equal(history[0].combatDamage, false);
  assert.match(history[0].actionId, /^action:/);
  assert.equal(history[0].batchId, history[0].actionId);
  assert.equal(f.kernel.getObject('target').damage, 2);
  assert.deepEqual(f.state.newReference(f.context(origin), chainRef, 'trash'), f.kernel.ref('source'));
  assert.equal(f.state.newReference(f.context(origin), origin.ref, 'trash'), null);
  assert.equal(f.kernel.player('A').energy, 4);
  assert.deepEqual(f.kernel.player('A').power, ['Fury', 'Fury']);
});

test('damage histories follow physical entities across real plays without sharing a same-name card', () => {
  const f = runtime(grenadeWorld(), [grenadeProgram]);
  const first = f.kernel.getObject('source');
  f.play('source'); settle(f.engine);
  assert.equal(f.engine.commit({ type: 'return-to-hand', object: f.kernel.ref('source') }).status, 'done');
  const second = f.kernel.getObject('source');
  f.play('source'); settle(f.engine);
  f.play('copy'); settle(f.engine);
  assert.equal(f.state.damageHistory({ source: first.ref, identity: 'entity' }).length, 2);
  assert.equal(f.state.damageHistory({ source: first.ref, identity: 'incarnation' }).length, 1);
  assert.equal(f.state.damageHistory({ source: second.ref, identity: 'incarnation' }).length, 1);
  assert.equal(f.state.damageHistory({ source: f.kernel.ref('copy'), identity: 'entity' }).length, 1);
  assert.equal(f.kernel.getObject('target').damage, 6);
});

test('an old new-reference receipt cannot follow an unrelated return to the same zone', () => {
  const f = runtime(grenadeWorld(), [grenadeProgram]);
  const source = f.kernel.getObject('source');
  f.play('source');
  const chain = f.engine.items[0].object;
  settle(f.engine);
  const trash = f.kernel.ref('source');
  assert.equal(f.engine.commit({ type: 'return-to-hand', object: trash }).status, 'done');
  assert.equal(f.engine.commit({ type: 'discard', object: f.kernel.ref('source') }).status, 'done');
  assert.equal(f.state.newReference(f.context(source), chain, 'trash'), null);
});

test('illegal targeting and mistargeted resolution never produce damage history', () => {
  const illegal = runtime(world().player('A', { energy: 2, power: ['Fury'] }).player('B')
    .hand('source', { cardId: grenadeProgram.canonicalCardId, types: ['spell'], energy: 2, power: ['Fury'] }), [grenadeProgram]);
  const before = illegal.kernel.snapshot();
  assert.throws(() => illegal.play('source'), /target|legal/i);
  assert.deepEqual(illegal.kernel.snapshot(), before);
  assert.deepEqual(illegal.state.damageHistory({ identity: 'entity' }), []);
  assert.deepEqual(illegal.state.zoneReceipts(), []);

  const f = runtime(grenadeWorld(), [grenadeProgram]);
  f.play('source');
  assert.equal(f.engine.commit({ type: 'return-to-hand', object: f.kernel.ref('target') }).status, 'done');
  settle(f.engine);
  assert.equal(f.kernel.getObject('target').damage, 0);
  assert.deepEqual(f.state.damageHistory({ identity: 'entity' }), []);
});

test('prevention, zero damage and impossible actions are excluded; rewritten damage uses its real amount', () => {
  const f = runtime(grenadeWorld(), [grenadeProgram]);
  const source = f.kernel.ref('source'), target = f.kernel.ref('target');
  assert.equal(f.engine.commit({ type: 'damage', source, target, amount: 0, combat: false }).status, 'done');
  assert.equal(f.engine.commit({ type: 'damage', source, target: { id: 'missing', zoneEntryId: 0 }, amount: 8, combat: false }).status, 'impossible');
  assert.deepEqual(f.state.damageHistory({ identity: 'entity' }), []);
  f.engine.pipeline.registerReplacement({ id: 'prevent', matches: action => action.type === 'damage' && action.amount === 8,
    apply: () => ({ status: 'prevent' }) });
  assert.equal(f.engine.commit({ type: 'damage', source, target, amount: 8, combat: false }).status, 'prevented');
  f.engine.pipeline.registerReplacement({ id: 'reduce', matches: action => action.type === 'damage' && action.amount === 2,
    apply: action => ({ status: 'rewrite', action: { ...action, amount: 1 } }) });
  f.play('source'); settle(f.engine);
  const history = f.state.damageHistory({ source, identity: 'entity' });
  assert.deepEqual(history.map(entry => entry.amount), [1]);
  assert.equal(f.kernel.getObject('target').damage, 1);
});

test('a choice after raw damage rolls the damage history back with the real spell resolution', () => {
  const f = runtime(grenadeWorld(), [grenadeProgram]);
  const source = f.kernel.getObject('source');
  f.engine.pipeline.registerReplacement({ id: 'trash-choice', optional: true,
    matches: action => action.type === 'move-zone' && action.to === 'trash' && action.object.id === 'source',
    apply: action => ({ status: 'rewrite', action: { type: 'banish', object: action.object } }) });
  f.play('source');
  f.engine.pass('A');
  const before = f.kernel.snapshot(), links = f.state.checkpoint(), events = f.engine.pipeline.events;
  assert.throws(() => f.engine.pass('B'), AwaitChoice);
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.state.checkpoint(), links);
  assert.deepEqual(f.engine.pipeline.events, events);
  assert.equal(f.kernel.getObject('target').damage, 0);
  const request = f.asked.at(-1);
  f.answers.set(request.id, false);
  f.engine.pass('B');
  settle(f.engine);
  assert.equal(f.kernel.getObject('source').zone, 'trash');
  assert.equal(f.kernel.getObject('target').damage, 2);
  assert.equal(f.state.damageHistory({ source: source.ref, identity: 'entity' }).length, 1);
});

test('damage queries distinguish target incarnations, combat provenance, and immutable history results', () => {
  const f = runtime(grenadeWorld(), [grenadeProgram]);
  const source = f.kernel.ref('source'), target = f.kernel.ref('target');
  assert.equal(f.engine.commit({ type: 'damage', source, target, amount: 3, combat: true }).status, 'done');
  assert.equal(f.engine.commit({ type: 'return-to-hand', object: target }).status, 'done');
  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref('target'), to: 'base', location: base('B') }).status, 'done');
  const next = f.kernel.ref('target');
  assert.equal(f.engine.commit({ type: 'damage', source, target: next, amount: 1, combat: false }).status, 'done');
  assert.equal(f.state.damageHistory({ target, identity: 'entity' }).length, 2);
  assert.equal(f.state.damageHistory({ target, identity: 'incarnation' }).length, 1);
  assert.equal(f.state.damageHistory({ target: next, identity: 'incarnation' }).length, 1);
  assert.equal(f.state.damageHistory({ identity: 'entity', combatDamage: true, turn: 1, combat: 0 }).length, 1);
  assert.equal(f.state.damageHistory({ identity: 'entity', turn: 2 }).length, 0);
  const returned = f.state.damageHistory({ identity: 'entity' });
  returned[0].source.id = 'tampered';
  assert.deepEqual(f.state.damageHistory({ identity: 'entity' })[0].source, source);
});

test('malformed or ambiguous component declarations fail closed', () => {
  assert.throws(() => new LinkedAbilityState([declaration({ canonicalCardId: 'x' }, { members: [banish.id] })]), /component/);
  assert.throws(() => new LinkedAbilityState([declaration(), declaration()]), /duplicate set/);
  assert.throws(() => new LinkedAbilityState([declaration(), declaration(sarcophagusProgram, { setId: 'other' })]), /ambiguous/);
  assert.throws(() => new LinkedAbilityState([declaration(sarcophagusProgram, {
    captures: [{ path: ['unrelated-ability'], key: 'banishedTrashUnits', action: 'banish', zone: 'banishment' }]
  })]), /member/);
});
