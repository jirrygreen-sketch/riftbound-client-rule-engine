// RIFT-1186 (player report 89bb9408): Assembly Rig could never be activated.
//
// Official Assembly Rig (sfd-019-221), zh_CN gallery (updated 2026-10-28):
// "支付:rb_energy_1:和:rb_rune_fury:，从你的废牌堆中回收一名单位，:rb_exhaust:：
// 打出一名3:rb_might:的“机器人”到你的基地。"
// Riftbound Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 405.1 and 430.2-.3: an ability may be activated when its costs can be paid.
// canonicalCardId: Assembly Rig
// card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569
//
// The recycle cost asks which trash unit to recycle during Finalize. The
// availability check answered no question at all, so the ability was never
// offered even with Energy, Fury Power and a unit in trash.
import assert from 'node:assert/strict';
import test from 'node:test';

import assemblyRig from '../../../card-dsl/dist/cards/sfd/assembly-rig.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding, inspectActivations } from '../../dist/programs/index.js';

const BASE_A = Object.freeze({ type: 'base', player: 'A' });

function scene({ energy = 1, power = ['Fury'], trashUnit = true, rigExhausted = false, choices } = {}) {
  const builder = world()
    .player('A', { energy, power })
    .player('B')
    .base('rig', {
      cardId: assemblyRig.canonicalCardId, name: 'Assembly Rig', types: ['gear'], tags: [],
      location: BASE_A, energy: 4, power: null, might: null, exhausted: rigExhausted,
    });
  if (trashUnit) {
    builder.object('fallen', {
      cardId: 'test:fallen-unit', name: 'Fallen', types: ['unit'], tags: [], zone: 'trash',
      location: null, owner: 'A', controller: 'A', energy: 2, power: null, might: 2,
    });
  }
  const kernel = builder.build();
  const choose = request => {
    choices?.push(request);
    throw new AwaitChoice(request);
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
  const binding = createProgramBinding({ cardPrograms: [assemblyRig] });
  const listed = () => inspectActivations({
    engine, registry: binding.registry, controller: 'A', sources: kernel.objects, window: 'priority',
  }).map(candidate => `${candidate.source.ref.id}#${candidate.abilityIndex}`);
  return { kernel, listed };
}

test('RIFT-1186: Assembly Rig is offered once its Energy, Fury Power and a trash unit are available', () => {
  const choices = [];
  const f = scene({ choices });
  const before = structuredClone(f.kernel.stateForTest());
  assert.deepEqual(f.listed(), ['rig#0']);
  assert.deepEqual(choices, [], 'the availability check never asks the player');
  assert.deepEqual(f.kernel.stateForTest(), before, 'the availability check recycles and pays nothing');
});

test('RIFT-1186: without a unit in trash the recycle cost cannot be paid', () => {
  assert.deepEqual(scene({ trashUnit: false }).listed(), []);
});

test('RIFT-1186: without the printed Energy or Fury Power the ability is not offered', () => {
  assert.deepEqual(scene({ energy: 0 }).listed(), []);
  assert.deepEqual(scene({ power: [] }).listed(), []);
  assert.deepEqual(scene({ power: ['Order'] }).listed(), []);
});

test('RIFT-1186: an exhausted Assembly Rig cannot pay its exhaust cost', () => {
  assert.deepEqual(scene({ rigExhausted: true }).listed(), []);
});
