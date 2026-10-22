import assert from 'node:assert/strict';
import test from 'node:test';

import minefield from '../../../card-dsl/dist/cards/sfd/minefield.js';
import sunkenTemple from '../../../card-dsl/dist/cards/sfd/sunken-temple.js';
import treasureHoard from '../../../card-dsl/dist/cards/sfd/treasure-hoard.js';
import { validateCardProgram } from '../../../card-dsl/dist/index.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { validateTriggerSpec } from '../../dist/events/trigger-spec.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { translateTriggerFilter } from '../../dist/programs/filters.js';
import { TurnFlow } from '../../dist/turn/flow.js';

const constants = value => ({ kind: 'constant', value });
const field = id => ({ type: 'battlefield', id });
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });
const scoreWaveProgram = program => admitted({
  ...program,
  abilities: program.abilities.map(ability => ability.kind === 'triggered'
    ? { ...ability, trigger: { ...ability.trigger, once: 'per-batch' } }
    : ability),
});

// CR v1.5 is dated 2026-10-09 and effective 2026-10-16. The checked SFD
// errata has no replacement text for these battlefield programs.
const evidence = {
  rulesUrl: 'https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf',
  errataUrl: 'https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/',
  rules: ['190.6.a', '190.6.d', '383.4.c.2', '472', '473.2.a', '473.2.c', '706', '708', '710'],
  timeline: ['Score action', 'control-established', 'conquer timings', 'score timing', 'Pending', 'Finalize', 'Resolve'],
};

function scoreFixture({ setups = [], programs = [], fields = [
  { id: 'bf1', controller: null }, { id: 'bf2', controller: null },
], choose } = {}) {
  const builder = world().player('A', { energy: 3 }).player('B', { energy: 3 });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player })
      .rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  for (const setup of setups) setup(builder);
  const kernel = builder.build();
  const requests = [];
  const decide = request => {
    requests.push(structuredClone(request));
    if (choose) {
      const answer = choose(request);
      if (answer !== undefined) return answer;
    }
    if (request.type === 'optional') return true;
    if (request.type === 'mode') return request.options[0];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
  });
  const binding = createProgramBinding({ cardPrograms: programs });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'], battlefields: fields,
    victoryScore: 20, describePlay: binding.describePlay,
  });
  const errors = [];
  if (programs.length) binding.attachLifecycle(flow.chain, error => errors.push(error));
  const settle = (budget = 80) => {
    for (let index = 0; index < budget; index++) {
      if (flow.chain.items.length) {
        if (flow.chain.priority !== null) flow.pass(flow.chain.priority);
        else throw new Error('A pending item has no Priority holder');
        continue;
      }
      if (flow.chain.focus !== null) { flow.pass(flow.chain.focus); continue; }
      return;
    }
    throw new Error('score wave did not settle');
  };
  const activated = (id, body, sourceId, controller = 'A') => ({
    id, controller, source: kernel.getObject(sourceId), kind: 'activated', speed: 'normal', body,
  });
  return { kernel, flow, binding, requests, errors, settle, activated };
}

function enterUnitsAt(f, ids, battlefieldId) {
  f.flow.start();
  const refs = ids.map(id => f.kernel.ref(id));
  f.flow.execute(f.activated('score-wave', [{
    id: 'move-wave', op: 'effect.move',
    args: {
      objects: constants({ kind: 'choose', id: 'participants', filter: { type: 'unit', zone: 'board', controller: 'A' } }),
      amount: constants(ids.length), to: constants(field(battlefieldId)),
    },
  }], ids[0]));
  return refs;
}

test('CR 472/473.2.c: one Score wave collects one battlefield conquer trigger for all participating Units', () => {
  const f = scoreFixture({
    programs: [scoreWaveProgram(minefield)],
    setups: [w => w.battlefield('mine', {
      cardId: minefield.canonicalCardId, types: ['battlefield'], zone: 'board', location: field('bf1'),
      controller: 'A', energy: null, power: null, might: null,
    }).base('u1', { might: 3 }).base('u2', { might: 2 })],
  });
  assert.deepEqual(evidence.rules, ['190.6.a', '190.6.d', '383.4.c.2', '472', '473.2.a', '473.2.c', '706', '708', '710']);
  assert.match(evidence.rulesUrl, /CR-v1\.5|\.pdf$/);
  assert.match(evidence.errataUrl, /spiritforged-errata/);
  const setup = { now: 'setup', action: 'register existing Board battlefield', rule: '170.2.a/b' };
  const canonical = minefield.canonicalCardId;
  assert.equal(canonical, minefield.canonicalCardId);
  assert.deepEqual(setup, { now: 'setup', action: 'register existing Board battlefield', rule: '170.2.a/b' });

  // The concrete lifecycle bootstrap remains RIFT-891's write scope. Register
  // the exact program through the production adapter after attaching lifecycle.
  const source = f.kernel.getObject('mine');
  assert.deepEqual(f.binding.registerProgramTriggers(f.flow.chain, source), ['program:mine:1:0']);
  const [, u2] = enterUnitsAt(f, ['u1', 'u2'], 'bf1');
  f.settle();

  const conquer = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'conquer');
  const score = f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'score');
  assert.equal(conquer.length, 2);
  assert.equal(new Set(conquer.map(event => event.batchId)).size, 1);
  assert.equal(conquer[0].batchId, score[0].batchId);
  assert.deepEqual(score[0].details.participatingUnits, [f.kernel.ref('u1'), u2]);
  assert.equal(f.flow.chain.trace.filter(event => event.step === 'pending' && event.item.startsWith('trigger:')).length, 1);
  assert.equal(f.kernel.zone('A', 'trash').length, 2);
});

test('CR 190.6.a/d: conquest by B synchronizes the Battlefield snapshot and binds B as ability controller', () => {
  const f = scoreFixture({
    programs: [scoreWaveProgram(minefield)],
    setups: [w => w.battlefield('mine', {
      cardId: minefield.canonicalCardId, types: ['battlefield'], zone: 'board', location: field('bf1'),
      controller: 'A', energy: null, power: null, might: null,
    }).base('b-unit', { owner: 'B', controller: 'B', might: 4 })],
    choose: request => request.type === 'mode' && request.id.includes(':order:') ? request.options[0] : undefined,
  });
  const source = f.kernel.getObject('mine');
  f.binding.registerProgramTriggers(f.flow.chain, source);
  f.flow.start();
  if (f.flow.turnPlayer !== 'B') f.flow.pass(f.flow.turnPlayer);
  assert.equal(f.flow.turnPlayer, 'B');
  f.flow.execute(f.activated('b-conquers', [{
    id: 'move-b', op: 'effect.move', args: { to: constants(field('bf1')) },
  }], 'b-unit', 'B'));
  f.settle();

  assert.equal(f.flow.battlefields.find(battlefield => battlefield.id === 'bf1').controller, 'B');
  assert.equal(f.kernel.getObject('mine').controller, 'B', 'Battlefield ObjectSnapshot follows CR 190.5/.6');
  const pending = f.flow.chain.trace.filter(event => event.step === 'pending' && event.item.startsWith('trigger:'));
  assert.equal(pending.length, 1, 'the trigger controller is the new battlefield controller');
  assert.equal(f.flow.chain.items[0].controller, 'B');
});

test('CR 383.4.c.2/708/710: Sunken Temple evaluates a frozen 4-Might participant at layered Might 5', () => {
  const f = scoreFixture({
    programs: [scoreWaveProgram(sunkenTemple)],
    setups: [w => w.battlefield('temple', {
      cardId: sunkenTemple.canonicalCardId, types: ['battlefield'], zone: 'board', location: field('bf1'),
      controller: 'A', energy: null, power: null, might: null,
    }).unit('buffable', { might: 4, buffs: 1 })],
  });
  const source = f.kernel.getObject('temple');
  f.binding.registerProgramTriggers(f.flow.chain, source);
  enterUnitsAt(f, ['buffable'], 'bf1');
  f.settle();
  assert.equal(f.flow.chain.trace.filter(event => event.step === 'pending' && event.item.startsWith('trigger:')).length, 1);
  assert.equal(f.flow.layers.evaluate(f.kernel.ref('buffable')).might, 5);
  assert.equal(f.kernel.getObject('buffable').might, 4, 'raw host Might is not rewritten');
  assert.ok(f.requests.some(request => request.id === 'finalize:trigger:1:optional'));
});

test('CardProgram TriggerOnce accepts per-batch and rejects invented frequency names', () => {
  const program = {
    ...minefield,
    abilities: [{ ...minefield.abilities[0], trigger: { ...minefield.abilities[0].trigger, once: 'per-batch' } }],
  };
  assert.equal(validateCardProgram(program).ok, true);
  assert.equal(validateTriggerSpec({ at: 'conquer', filter: {}, once: 'per-batch' }).ok, true);
  assert.equal(validateTriggerSpec({ at: 'conquer', filter: {}, once: 'per-score' }).ok, false);
  for (const program of [minefield, sunkenTemple, treasureHoard]) {
    assert.equal(program.rulesetVersion, 'core-1.5');
    assert.equal(typeof program.sourceText, 'string');
  }
});
