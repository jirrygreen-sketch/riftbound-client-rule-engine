// RIFT-1167 production candidate coverage for Gold and Equip activations.
//
// Official Gold (sfd-t03): "Kill this, :rb_exhaust:: [Reaction] — [Add]
// :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)"
// Official Long Sword (sfd-022-221): "[Quick-Draw] ... / [Equip]
// :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)"
// Riftbound Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 312.1, 377.1-.3, 403.3, 404.1.a, 405.1, 415.1.b, 415.4,
// 430.2-.3, and 818.1.b/.b.1/.c.2 govern this focused test.
// canonicalCardIds:
// Gold card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511
// Long Sword card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010
import assert from 'node:assert/strict';
import test from 'node:test';

import gold from '../../../card-dsl/dist/cards/sfd/gold.js';
import longSword from '../../../card-dsl/dist/cards/sfd/long-sword.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { activateReactionAddDuringPayment } from '../../dist/chain/finalize/add-window.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding, inspectActivations } from '../../dist/programs/index.js';

const BASE_A = Object.freeze({ type: 'base', player: 'A' });
const GOLD_ID = gold.canonicalCardId;
const SWORD_ID = longSword.canonicalCardId;
const constant = value => ({ kind: 'constant', value });
const EQUIP = Object.freeze({
  canonicalCardId: SWORD_ID,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)',
  abilities: longSword.abilities,
});

function scene({ goldExhausted = false, power = [], goldZone = 'board', onPayment, mixedCosts = false } = {}) {
  const builder = world()
    .player('A', { energy: 0, power })
    .player('B')
    .object('gold', {
      cardId: GOLD_ID, name: 'Gold', types: ['gear'], tags: ['Token'], zone: goldZone,
      location: goldZone === 'board' ? BASE_A : null, energy: null, power: null, might: null,
      exhausted: goldExhausted,
    })
    .unit('unit', { owner: 'A', controller: 'A', location: BASE_A, might: 4 })
    .base('sword', {
      cardId: SWORD_ID, name: 'Long Sword', types: ['gear'], tags: ['Equipment'],
      location: BASE_A, energy: 2, power: ['Fury'], might: 2, exhausted: false,
      keywords: [{ id: 'Equip' }],
    });
  if (mixedCosts) {
    builder.object('mixed', {
      cardId: 'test:mixed-activation-costs', name: 'Mixed costs', types: ['unit'],
      zone: 'board', location: BASE_A, controller: 'A', energy: 0, power: null, might: 1,
      exhausted: false,
    });
  }
  const kernel = builder.build();
  const choose = request => {
    if (request.id === 'cost:parent:base') {
      if (onPayment === undefined) throw new AwaitChoice(request);
      onPayment({ engine, binding, kernel });
      return 'normal';
    }
    if (request.type === 'select-objects' && request.id.startsWith('target:equip-target:')) {
      return request.options.filter(ref => ref.id === 'unit');
    }
    throw new AwaitChoice({ id: 'unexpected', type: 'optional', chooser: 'A', visibility: 'public' });
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  const binding = createProgramBinding({ cardPrograms: [gold, EQUIP, ...(mixedCosts ? [{
    canonicalCardId: 'test:mixed-activation-costs',
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'One executable activation and one unsupported activation.',
    abilities: [
      { kind: 'activated', timing: 'action', cost: { kind: 'explicit', energy: constant(0) }, body: [] },
      { kind: 'activated', timing: 'action', cost: { kind: 'unsupported' }, body: [] },
    ],
  }] : [])] });
  return { kernel, engine, binding };
}

function candidates(f, window = 'priority') {
  return inspectActivations({
    engine: f.engine,
    registry: f.binding.registry,
    controller: 'A',
    sources: f.kernel.objects,
    window,
  });
}

test('RIFT-1167 exhausted Gold is not offered before it is readied', () => {
  const f = scene({ goldExhausted: true });
  assert.deepEqual(candidates(f).filter(candidate => candidate.source.ref.id === 'gold'), []);
});

test('RIFT-1167 active Gold is a Reaction Add candidate and its real activation kills it for universal Power', () => {
  const f = scene();
  const [goldCandidate] = candidates(f).filter(candidate => candidate.source.ref.id === 'gold');
  assert.ok(goldCandidate);
  assert.equal(goldCandidate.abilityIndex, 0);
  assert.equal(goldCandidate.reaction, true);
  assert.equal(goldCandidate.add, true);
  assert.match(goldCandidate.label, /^Kill this, :rb_exhaust:: \[Reaction\] — \[Add\] :rb_rune_rainbow:\./u);

  f.engine.execute(f.binding.describeActivate(
    f.kernel.getObject('gold'), 'A', goldCandidate.abilityIndex));
  assert.equal(f.kernel.getObject('gold').zone, 'trash');
  assert.deepEqual(f.kernel.player('A').power, ['universal']);
  assert.equal(f.engine.items.length, 0, 'Reaction Add resolves immediately');
});

test('RIFT-1167 Gold being paid is offered only in the Reaction Add payment window', () => {
  const f = scene();
  assert.ok(candidates(f, 'priority').some(candidate => candidate.source.ref.id === 'gold'));
  assert.ok(candidates(f, 'payment').some(candidate => candidate.source.ref.id === 'gold'));
  const equipped = scene({ power: ['Fury'] });
  const payment = candidates(equipped, 'payment');
  assert.equal(payment.some(candidate => candidate.label === 'Equip'), false);
});

test('RIFT-1167 Gold resolves as a Reaction Add inside a real parent Pay Costs step', () => {
  let receipt;
  const f = scene({
    onPayment: ({ engine, binding, kernel }) => {
      receipt = activateReactionAddDuringPayment({
        engine,
        registry: binding.registry,
        source: kernel.getObject('gold'),
        controller: 'A',
      });
    },
  });
  const source = f.kernel.getObject('sword');
  const power = { kind: 'constant', value: 1 };
  f.engine.execute({
    id: 'parent-payment', controller: 'A', source, kind: 'activated', speed: 'normal', body: [],
    cost: {
      id: 'cost:parent',
      cost: { kind: 'explicit', payments: [{ kind: 'power', amount: constant(1), allowedDomains: ['Fury'] }] },
      baseChoices: [{
        id: 'normal',
        cost: { kind: 'explicit', payments: [{ kind: 'power', amount: power, allowedDomains: ['Fury'] }] },
      }],
    },
  });

  assert.equal(receipt?.status, 'resolved');
  assert.deepEqual(receipt?.resources, { energy: 0, power: ['universal'] });
  assert.equal(receipt?.priorityTransferred, false);
  assert.equal(f.kernel.getObject('gold').zone, 'trash');
  assert.deepEqual(f.kernel.player('A').power, [], 'the parent consumed the added Universal Power');
  assert.deepEqual(f.engine.items.map(item => item.id), ['parent-payment']);
});

test('RIFT-1167 an unsupported activation does not suppress executable candidates', () => {
  const f = scene({ mixedCosts: true });
  const mixed = candidates(f).filter(candidate => candidate.source.ref.id === 'mixed');
  assert.deepEqual(mixed.map(candidate => candidate.abilityIndex), [0]);
  assert.ok(candidates(f).some(candidate => candidate.source.ref.id === 'gold'));
});

test('RIFT-1167 a continuous activation restriction is enforced before advertising', () => {
  const f = scene();
  const restricted = scene();
  const gold = restricted.kernel.getObject('gold');
  restricted.engine.layers.registry.register(
    {
      id: 'RIFT-1167:block-gold-activate',
      layer: 'ability',
      source: gold.ref,
      filter: {},
      effect: { kind: 'restriction', actions: ['activate'], actionKind: 'activate' },
    },
    { type: 'permanent' },
  );
  restricted.engine.layers.setObjects(restricted.kernel.objects);
  assert.ok(candidates(f).some(candidate => candidate.source.ref.id === 'gold'));
  assert.equal(candidates(restricted).some(candidate => candidate.source.ref.id === 'gold'), false);
});

test('RIFT-1167 Equip is listed only while its Fury cost and friendly target are available', () => {
  const unavailable = scene();
  assert.equal(candidates(unavailable).some(candidate => candidate.label === 'Equip'), false);

  const payable = scene({ power: ['Fury'] });
  const [equip] = candidates(payable).filter(candidate => candidate.label === 'Equip');
  assert.ok(equip);
  assert.equal(equip.abilityIndex, 0);
  assert.equal(equip.reaction, false);
  assert.equal(equip.add, false);
  assert.equal(equip.source.ref.id, 'sword');

  const wrapsBefore = payable.binding.activationAbilities(equip.source).length;
  const visibleBefore = candidates(payable).length;
  payable.engine.execute(payable.binding.describeActivate(equip.source, 'A', equip.abilityIndex));
  while (payable.engine.items.length) payable.engine.pass(payable.engine.priority);
  assert.deepEqual(payable.kernel.getObject('sword').attachedTo, payable.kernel.ref('unit'));
  payable.engine.layers.setObjects(payable.kernel.objects);
  assert.equal(payable.engine.layers.evaluate(payable.kernel.ref('unit')).might, 6);
  assert.equal(payable.binding.activationAbilities(equip.source).length, wrapsBefore,
    'projection and execution do not persist keyword copy state');
  assert.ok(candidates(payable).length <= visibleBefore);
});
