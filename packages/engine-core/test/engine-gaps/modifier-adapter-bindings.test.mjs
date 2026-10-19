// RIFT-847 production bindings for the RIFT-819 modifiers, Shield Value,
// Stun selectors, and default grant object selectors. Every scenario starts
// from raw EffectIR, enters createProgramBinding/ChainEngine, and asserts the
// registrations, links, choices, costs, and consumed state that resulted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { fixture, resolveAll } from '../chain/helpers.mjs';
import brawl from '../../node_modules/@riftbound/card-dsl/dist/cards/rad/brawl.js';

const c = value => ({ kind: 'constant', value });
const activated = body => ({ kind: 'activated', timing: 'action', cost: { kind: 'activated', payments: [{ kind: 'exhaust', object: 'self' }] }, body });
const play = body => ({ kind: 'play', body });
const program = (canonicalCardId, ability) => ({
  canonicalCardId, rulesetVersion: 'core-1.5', status: 'executable', sourceText: canonicalCardId, abilities: [ability],
});

function assembly(ability, { choose, setup } = {}) {
  const sourceProgram = program('card.rift-847', ability);
  const binding = createProgramBinding({ cardPrograms: [sourceProgram] });
  const f = fixture({ choose, describePlay: binding.describePlay });
  f.kernel.addObject({ ...f.kernel.getObject('source'), cardId: sourceProgram.canonicalCardId }, 'board');
  setup?.(f);
  return { ...f, binding, sourceProgram };
}

function resolveActivation(f, id = 'rift-847-chain') {
  const source = f.kernel.getObject('source');
  f.engine.execute({ ...f.binding.describeActivate(source, 'A'), id });
  resolveAll(f.engine);
}

function registrations(f) {
  return f.engine.layers.registry.snapshot().map(entry => entry.effect);
}

test('modifier IR preserves target Exprs, decodes only schema literals, and is consumed through the default chain', () => {
  const body = [
    {
      id: 'bonus', op: 'continuous.bonus-damage',
      args: { amount: c(2), appliesTo: c('deal-actions'), filter: c({ type: 'unit', zone: 'board', controller: 'opponent' }), target: c('bonus-target') },
      targets: [{ id: 'bonus-target', filter: { type: 'unit', zone: 'board', controller: 'opponent', objectId: 'foe' }, min: 1, max: 1, selection: 'one' }],
    },
    {
      id: 'threshold', op: 'continuous.lethal-threshold',
      args: { amount: c(1), appliesTo: c({ damageController: 'controller', target: 'enemy-units' }), filter: c({ type: 'unit', zone: 'board' }), target: c('threshold-target') },
      targets: [{ id: 'threshold-target', filter: { type: 'unit', zone: 'board', controller: 'opponent', objectId: 'foe' }, min: 1, max: 1, selection: 'one' }],
    },
    {
      id: 'reduction', op: 'continuous.modify-might-reduction',
      args: { mode: c('additional'), amount: c(-1), appliesTo: c('controller-spells-and-abilities'), filter: c({ type: 'unit', zone: 'board' }), target: c('reduction-target') },
      targets: [{ id: 'reduction-target', filter: { type: 'unit', zone: 'board', controller: 'opponent', objectId: 'foe' }, min: 1, max: 1, selection: 'one' }],
    },
  ];
  const f = assembly(activated(body), {
    setup: f => f.kernel.addObject({ ref: { id: 'foe', zoneEntryId: 1 }, cardId: 'card:foe', name: 'foe', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'battlefield', id: 'bf' }, might: 4 }),
  });
  resolveActivation(f);
  const effects = registrations(f).map(entry => entry.effect);
  assert.deepEqual(effects.map(effect => effect.kind), [
    'continuous.bonus-damage', 'continuous.lethal-threshold', 'continuous.modify-might-reduction',
  ]);
  assert.deepEqual(effects.map(effect => effect.amount), [2, 1, -1]);
  assert.equal(effects.every(effect => effect.targetRefs[0].id === 'foe'), true);
  assert.deepEqual(effects[1].appliesTo, { damageController: 'controller', target: 'enemy-units' });
  assert.deepEqual(effects[0].targetRefs, [{ id: 'foe', zoneEntryId: 1 }]);
  assert.equal(f.kernel.getObject('source').exhausted, true);
});

test('shield-value reads the selected unit through default chain TargetSpec binding', () => {
  const body = [{
    id: 'shield', op: 'effect.shield-value',
    args: { object: c({ target: 'shield-target' }), linkKey: c('shieldValue') },
    targets: [{ id: 'shield-target', filter: { type: 'unit', zone: 'board', controller: 'self', objectId: 'shielded' }, min: 1, max: 1, selection: 'one' }],
  }];
  const f = assembly(activated(body), {
    setup: f => f.kernel.addObject({ ref: { id: 'shielded', zoneEntryId: 1 }, cardId: 'card:shielded', name: 'shielded', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' }, might: 2, keywords: [{ id: 'Shield', value: 2 }, { id: 'Shield' }] }),
  });
  resolveActivation(f);
  assert.equal(f.kernel.linked('shield.shieldValue'), 3);
});

test('a targetless grant uses the authored TargetSpec as its default object selector through the default chain', () => {
  const body = [{
    id: 'grant', op: 'continuous.grant-keyword',
    args: { keyword: c('Shield'), value: c(2), duration: c('end-of-turn') },
    targets: [{ id: 'friendly', filter: { type: 'unit', zone: 'board', controller: 'self', objectId: 'friend' }, min: 1, max: 1, selection: 'one' }],
  }];
  const f = assembly(activated(body), {
    setup: f => f.kernel.addObject({ ref: { id: 'friend', zoneEntryId: 1 }, cardId: 'card:friend', name: 'friend', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' }, might: 3 }),
  });
  resolveActivation(f);
  const granted = f.kernel.linked('grant.granted');
  assert.deepEqual(granted.objects, [{ id: 'friend', zoneEntryId: 1 }]);
  assert.equal(granted.count, 1);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref('friend')).keywords.some(keyword => keyword.id === 'Shield' && keyword.value === 2), true);
});

test('explicit grant selectors are not replaced, and multi-target or appliesTo forms fail closed', () => {
  const explicit = [{
    id: 'grant', op: 'continuous.grant-keyword',
    args: { keyword: c('Shield'), objects: c({ kind: 'target', id: 'friend' }) },
    targets: [{ id: 'friend', filter: { type: 'unit', zone: 'board', objectId: 'friend' }, min: 1, max: 1, selection: 'one' }],
  }];
  const f = assembly(activated(explicit), {
    setup: f => f.kernel.addObject({ ref: { id: 'friend', zoneEntryId: 1 }, cardId: 'card:friend', name: 'friend', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' }, might: 3 }),
  });
  resolveActivation(f);
  assert.deepEqual(f.kernel.linked('grant.granted.objects'), [{ id: 'friend', zoneEntryId: 1 }]);

  for (const [id, instruction] of [
    ['multi-target', { id: 'grant', op: 'continuous.grant-keyword', args: { keyword: c('Shield') }, targets: [
      { id: 'a', filter: { type: 'unit', zone: 'board', objectId: 'friend' }, min: 1, max: 1, selection: 'one' },
      { id: 'b', filter: { type: 'unit', zone: 'board', objectId: 'friend' }, min: 1, max: 1, selection: 'one' },
    ] }],
    ['applies-to', { id: 'grant', op: 'continuous.grant-keyword', args: { keyword: c('Shield'), appliesTo: c('self') }, targets: [
      { id: 'a', filter: { type: 'unit', zone: 'board', objectId: 'friend' }, min: 1, max: 1, selection: 'one' },
    ] }],
  ]) {
    const g = assembly(activated([instruction]), {
      setup: f => f.kernel.addObject({ ref: { id: 'friend', zoneEntryId: 1 }, cardId: 'card:friend', name: 'friend', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' }, might: 3 }),
    });
    assert.throws(() => resolveActivation(g), error => error instanceof TypeError, id);
    assert.equal(g.kernel.linked('grant.granted'), undefined, id);
  }
});

test('effect.stun keeps all three authored selector keys and rejects missing or cross-item selections', () => {
  const target = {
    id: 'stun-target', op: 'effect.stun', args: { target: c('stun-unit') },
    targets: [{ id: 'stun-unit', filter: { type: 'unit', zone: 'board', controller: 'opponent', objectId: 'foe' }, min: 1, max: 1, selection: 'one' }],
  };
  const f = assembly(activated([target]), {
    setup: f => f.kernel.addObject({ ref: { id: 'foe', zoneEntryId: 1 }, cardId: 'card:foe', name: 'foe', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'base', player: 'B' }, might: 2 }),
  });
  resolveActivation(f);
  assert.equal(f.kernel.getObject('foe').stunned, true);
  assert.equal(f.kernel.linked('stun-target.stunned.count'), 1);

  const picked = assembly(activated([{
    id: 'stun-pick', op: 'effect.stun', args: { pick: c('stun-pick') },
    picks: [{ id: 'stun-pick', options: [], ordered: true, selection: 'all', zoneSlice: { zone: 'board', from: 'top', count: c(1) } }],
  }]));
  resolveActivation(picked);
  assert.equal(picked.kernel.getObject('source').stunned, true);
  assert.equal(picked.kernel.linked('stun-pick.stunned.count'), 1);

  assert.throws(() => resolveActivation(assembly(activated([{ id: 'stun', op: 'effect.stun', args: {} }]))), TypeError);

  const stale = assembly(activated([{
    id: 'stun', op: 'effect.stun', args: { pick: c('stale-pick') },
    picks: [{ id: 'stale-pick', options: ['dynamic:unit'], min: 1, max: 1, selection: 'one' }],
  }]), {
    setup: f => {
      f.kernel.addObject({ ref: { id: 'foe', zoneEntryId: 1 }, cardId: 'card:foe', name: 'foe', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'base', player: 'B' }, might: 2 });
      f.kernel.setPicks('stale-pick', [{ id: 'foe', zoneEntryId: 999 }]);
    },
  });
  resolveActivation(stale);
  assert.equal(stale.kernel.getObject('foe').stunned, false);
  assert.equal(stale.kernel.linked('stun.stunned.count'), 0);

  assert.throws(() => resolveActivation(assembly(activated([{
    id: 'stun', op: 'effect.stun',
    args: { target: c('stun-unit'), amount: { kind: 'linked', instructionId: 'foreign' } },
    targets: [{ id: 'stun-unit', filter: { objectId: 'foe' }, min: 1, max: 1 }],
  }]), {
    setup: f => f.kernel.addObject({ ref: { id: 'foe', zoneEntryId: 1 }, cardId: 'card:foe', name: 'foe', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'base', player: 'B' }, might: 2 }),
  })), error => error?.name === 'ProgramBindingError' || error?.name === 'MissingInformation');
});

test('AwaitChoice rolls back modifier registration and activation cost, then replays stun once', () => {
  const body = [
    { id: 'bonus', op: 'continuous.bonus-damage', args: { amount: c(1), appliesTo: c('deal-actions') } },
    { id: 'stun', op: 'effect.stun', args: { choose: c({ id: 'stun-choice', filter: { type: 'unit', zone: 'board', controller: 'opponent' } }) } },
  ];
  const f = assembly(activated(body), {
    setup: f => f.kernel.addObject({ ref: { id: 'foe', zoneEntryId: 1 }, cardId: 'card:foe', name: 'foe', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'base', player: 'B' }, might: 2 }),
  });
  let request;
  assert.throws(() => resolveActivation(f), error => { request = error.request; return error instanceof AwaitChoice; });
  assert.equal(request.id.endsWith('/stun-choice'), true);
  assert.equal(registrations(f).length, 0);
  // Finalize has already paid the activation cost before Resolve asks for the
  // stun choice. The Resolve transaction itself must still roll back its
  // registration and result writes, and the retry must not pay again.
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-exhausted').length, 1);
  assert.equal(f.kernel.getObject('foe').stunned, false);
  assert.equal(f.kernel.linked('stun.stunned'), undefined);
  f.answers.set(request.id, [f.kernel.ref('foe')]);
  const priority = f.engine.priority;
  assert.ok(priority);
  f.engine.pass(priority);
  resolveAll(f.engine);
  assert.equal(registrations(f).length, 1);
  assert.equal(f.kernel.getObject('source').exhausted, true);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-exhausted').length, 1);
  assert.equal(f.kernel.getObject('foe').stunned, true);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'unit-stunned').length, 1);
  assert.equal(f.kernel.linked('stun.stunned.count'), 1);
});

test('unknown modifier fields remain schema errors instead of being silently dropped', () => {
  const f = assembly(play([{
    id: 'bonus', op: 'continuous.bonus-damage', args: { amount: c(1), unknownSelector: c('not-a-selector') },
  }]));
  f.kernel.addObject({ ref: { id: 'spell', zoneEntryId: 1 }, cardId: 'card.rift-847', name: 'spell', types: ['spell'], owner: 'A', controller: 'A', zone: 'hand', location: null, energy: 0, power: [], might: null });
  f.engine.execute({ ...f.binding.describePlay({ type: 'play', object: f.kernel.ref('spell'), player: 'A' }, f.kernel.getObject('spell')), id: 'unknown-field' });
  assert.throws(() => resolveAll(f.engine), /Invalid continuous\.bonus-damage argument: unknownSelector/);
  assert.equal(registrations(f).length, 0);
});

test('original Brawl IR binds its TargetSpec and consumes a linked Might through the default chain', () => {
  const sourceProgram = { ...brawl };
  const binding = createProgramBinding({ cardPrograms: [sourceProgram] });
  const f = fixture({ describePlay: binding.describePlay, choose: request => request.id === 'target:brawl.unit' ? [f.kernel.ref('unit')] : undefined });
  f.kernel.addObject({ ref: { id: 'brawl', zoneEntryId: 1 }, cardId: sourceProgram.canonicalCardId, name: 'Brawl', types: ['spell'], owner: 'A', controller: 'A', zone: 'hand', location: null, energy: 0, power: [], might: null });
  f.kernel.addObject({ ref: { id: 'unit', zoneEntryId: 1 }, cardId: 'card:unit', name: 'unit', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' }, might: 4 });
  const source = f.kernel.getObject('brawl');
  f.engine.execute({ ...binding.describePlay({ type: 'play', object: source.ref, player: 'A' }, source), id: 'brawl-production' });
  resolveAll(f.engine);
  const entries = f.engine.layers.registry.snapshot();
  assert.equal(entries.some(entry => entry.effect.effect.kind === 'continuous.grant-keyword'), true);
  const layered = f.engine.layers.evaluate(f.kernel.ref('unit'));
  assert.equal(layered.keywords.some(keyword => keyword.id.toLowerCase() === 'assault' && keyword.value === 4), true);
  assert.equal(f.kernel.linked('brawl.capture-might.might'), 4);
});

test('grant selectors support self, source, pick, and query exactly where the schema declares them', () => {
  const body = [
    { id: 'self-grant', op: 'continuous.grant-keyword', args: { keyword: c('Shield'), appliesTo: c('self') } },
    { id: 'source-grant', op: 'continuous.grant-keyword', args: { keyword: c('Shield'), objects: c({ kind: 'source' }) } },
    { id: 'query-grant', op: 'continuous.grant-keyword', args: { keyword: c('Shield'), objects: c({ kind: 'query', filter: { type: 'unit', zone: 'board', controller: 'self' } }) } },
    { id: 'pick-grant', op: 'continuous.grant-keyword', args: { keyword: c('Shield'), pick: c('source-pick') }, picks: [{ id: 'source-pick', options: [], ordered: true, selection: 'all', zoneSlice: { zone: 'board', from: 'top', count: c(1) } }] },
  ];
  const f = assembly(activated(body));
  resolveActivation(f);
  assert.equal(f.kernel.linked('self-grant.granted.count'), 1);
  assert.equal(f.kernel.linked('source-grant.granted.count'), 1);
  assert.equal(f.kernel.linked('query-grant.granted.count'), 1);
  assert.equal(f.kernel.linked('pick-grant.granted.count'), 1);
  const keywords = f.engine.layers.evaluate(f.kernel.ref('source')).keywords;
  assert.equal(keywords.filter(keyword => keyword.id.toLowerCase() === 'shield').length, 1);
  assert.equal(registrations(f).filter(effect => effect.effect.kind === 'continuous.grant-keyword').length, 4);
});

test('a grant consumes a prior reveal result through the linked object selector', () => {
  const body = [
    { id: 'reveal', op: 'effect.reveal', args: { target: c('reveal-target') }, targets: [{ id: 'reveal-target', filter: { objectId: 'hidden-unit' }, min: 1, max: 1 }] },
    { id: 'linked-grant', op: 'continuous.grant-keyword', linkedTo: 'reveal', args: { keyword: c('Shield'), objects: { kind: 'linked-value', instructionId: 'reveal', key: 'revealed' } } },
  ];
  const f = assembly(activated(body), {
    setup: f => f.kernel.addObject({ ref: { id: 'hidden-unit', zoneEntryId: 1 }, cardId: 'card:hidden-unit', name: 'hidden-unit', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' }, might: 2, faceDown: true }),
  });
  resolveActivation(f);
  assert.equal(f.kernel.linked('reveal.revealedCount'), 1);
  assert.equal(f.kernel.linked('linked-grant.granted.count'), 1);
});
