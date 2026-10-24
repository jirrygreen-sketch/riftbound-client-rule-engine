// RIFT-1038 production regression: an effect-Played token is its own Chain item.
//
// Official evidence: Core Rules v1.5 (last updated 2026-10-09, effective
// 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Radiance rulings (effective 2026-10-16):
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
//
// CR 185.2.a makes Played tokens follow the card Play procedure. CR 350.2 and
// 354.1-354.3 put the token on the Chain as Pending, then defer its remaining
// Play steps while the creating effect finishes Resolve. CR 337.1.b finalizes
// oldest Pending first. A Unit/Gear then resolves immediately under 337.2;
// spells and ordinary abilities reach the Priority/Reaction steps under
// 337.4, 338-340, 359.3.b-c and 407.3-4. CR 303.2.a orders simultaneous
// actions by Turn Order; it is not a blanket FIFO/LIFO rule for this sequence.
//
// Canonical cards:
// - Assembly Rig sfd-019-221,
//   card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569
// - Wages of Pain sfd-070-221,
//   card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c
// Their source text is read from packages/card-data/data/deck-catalog.json.
import assert from 'node:assert/strict';
import test from 'node:test';

import assemblyRig from '../../../card-dsl/dist/cards/sfd/assembly-rig.js';
import gold from '../../../card-dsl/dist/cards/sfd/gold.js';
import wagesOfPain from '../../../card-dsl/dist/cards/sfd/wages-of-pain.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { ChainEngine } from '../../dist/chain/engine.js';

const GOLD = gold.canonicalCardId;
const admitted = program => ({ ...program, status: 'executable', judgeReason: undefined });
const base = player => ({ type: 'base', player });
const battlefield = id => ({ type: 'battlefield', id });

function runtime(programs, build, choose = () => undefined) {
  const builder = world().player('A', { energy: 20, power: ['Fury', 'Calm', 'Mind'] }).player('B');
  build(builder);
  const kernel = builder.build();
  const decisions = [];
  const decide = request => {
    decisions.push(structuredClone(request));
    const answer = choose(request, kernel);
    if (answer !== undefined) return answer;
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, id) => kernel.performBatchLeafForCapability(action, id),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
  });
  const binding = createProgramBinding({ cardPrograms: programs.map(admitted) });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host,
    describePlay: binding.describePlay, cleanup: () => false,
  });
  const errors = [];
  const lifecycle = binding.attachLifecycle(engine, error => errors.push(error));
  return { kernel, binding, engine, lifecycle, decisions, errors };
}

function itemFor(engine, prefix) {
  return engine.trace.find(entry => entry.item?.startsWith(prefix));
}

function tokenTimeline(engine, token) {
  const id = itemFor(engine, `play:${token.ref.id}:`)?.item;
  assert.ok(id, `the token has an independent Play item: ${token.ref.id}`);
  const item = engine.trace.filter(entry => entry.item === id).map(entry => entry.step);
  return { id, item };
}

test('RIFT-1038 Assembly Rig: effect Played Mech Pending waits for the parent Resolve, then Finalize and immediate Unit Resolve', () => {
  const play = assemblyRig.abilities.find(ability => ability.kind === 'activated');
  const carrier = { ...assemblyRig, judgeReason: undefined, abilities: [play] };
  const f = runtime([carrier], builder => {
    builder.card('recycle', { owner: 'A', types: ['unit'], zone: 'trash' });
    builder.base('rig', {
      cardId: assemblyRig.canonicalCardId, name: 'Assembly Rig', types: ['gear'],
      energy: 4, power: null, might: null,
    });
  }, request => request.type === 'select-objects' ? [request.options[0]] : undefined);
  const rig = f.kernel.getObject('rig');
  const draft = f.binding.describeActivate(rig, 'A', 0);
  assert.deepEqual(draft.body.map(instruction => instruction.op), ['effect.token']);
  assert.equal(draft.body[0].args.mode.value, 'play');

  f.engine.execute(draft);
  assert.deepEqual(f.engine.items.map(item => ({ id: item.id, status: item.status })), [{ id: draft.id, status: 'finalized' }]);
  assert.equal(f.engine.priority, 'A');
  f.engine.pass('A');
  f.engine.pass('B');

  const [mech] = f.kernel.objects.filter(object => object.isToken && object.name === 'Mech');
  assert.ok(mech, 'the original Mech definition was played');
  assert.equal(mech.name, 'Mech');
  assert.equal(mech.might, 3);
  assert.deepEqual(mech.tags, ['Mech']);
  assert.deepEqual(mech.location, base('A'));
  assert.equal(mech.exhausted, true, 'CR 143.4 / 185.2.d default Unit entry');
  assert.equal(mech.energy, null, 'token printed Energy stays absent');
  assert.equal(mech.power, null, 'token printed Power stays absent');

  const token = tokenTimeline(f.engine, mech);
  const parent = draft.id;
  const parentResolve = f.engine.trace.findIndex(entry => entry.item === parent && entry.step === 'resolve-start');
  const tokenPending = f.engine.trace.findIndex(entry => entry.item === token.id && entry.step === 'pending');
  const parentResolved = f.engine.trace.findIndex(entry => entry.item === parent && entry.step === 'resolved');
  const tokenFinalize = f.engine.trace.findIndex(entry => entry.item === token.id && entry.step === 'finalized');
  const tokenResolve = f.engine.trace.findIndex(entry => entry.item === token.id && entry.step === 'resolve-start');
  assert.ok(parentResolve < tokenPending, 'CR 354.2: Pending is created during the parent Resolve');
  assert.ok(tokenPending < parentResolved, 'CR 354.3: nested Play pauses while the parent is resolving');
  assert.ok(parentResolved < tokenFinalize && tokenFinalize < tokenResolve,
    'CR 337.1-337.2: the oldest Pending token Finalizes after the parent and resolves immediately');
  assert.deepEqual(token.item, ['pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed']);
  assert.equal(f.engine.trace.slice(tokenFinalize, tokenResolve).some(entry => entry.step === 'pass'), false,
    'CR 337.2 has no Priority pass between a Unit token\'s Finalize and Resolve');
  const eventOrder = f.engine.pipeline.events
    .filter(event => ['chain-item-pending', 'chain-item-finalize', 'chain-item-resolve'].includes(event.timingPoint) &&
      (event.details?.item === parent || event.details?.item === token.id))
    .map(event => `${event.timingPoint}:${event.details.item}`);
  assert.deepEqual(eventOrder, [
    `chain-item-pending:${parent}`,
    `chain-item-finalize:${parent}`,
    `chain-item-pending:${token.id}`,
    `chain-item-resolve:${parent}`,
    `chain-item-finalize:${token.id}`,
    `chain-item-resolve:${token.id}`,
  ]);
  const tokenPendingEvent = f.engine.trace.findIndex(event => event.item === token.id && event.step === 'pending');
  const tokenFinalizeEvent = f.engine.trace.findIndex(event => event.item === token.id && event.step === 'finalized');
  assert.ok(tokenPendingEvent < tokenFinalizeEvent,
    'the child Play is registered Pending before Finalize');
  assert.deepEqual(f.errors, []);
  assert.equal(assemblyRig.status, 'judge-required', 'the card file remains parent-owned');
  assert.equal(f.engine.items.length, 0);
  f.lifecycle.detach();
});

test('RIFT-1038 Wages of Pain: effect Played Gold Pending waits for spell Resolve, then its own Finalize/Resolve', () => {
  const original = wagesOfPain.abilities.find(ability => ability.kind === 'play');
  const carrier = {
    canonicalCardId: wagesOfPain.canonicalCardId,
    rulesetVersion: wagesOfPain.rulesetVersion,
    sourceText: wagesOfPain.sourceText,
    abilities: [{ ...original, cost: { kind: 'printed' } }],
  };
  const target = original.body[0].targets[0].id;
  const f = runtime([carrier, gold], builder => {
    builder.unit('victim', { owner: 'B', might: 5, location: battlefield('bf1') });
    builder.hand('wages', {
      cardId: wagesOfPain.canonicalCardId, name: 'Wages of Pain', types: ['spell'], energy: 3, power: null,
    });
  }, (request, kernel) => request.id === target || request.id.endsWith('/' + target)
    ? [kernel.ref('victim')]
    : undefined);
  const wages = f.kernel.getObject('wages');
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: wages.ref }, wages);
  f.engine.execute(draft);
  f.engine.pass('A');
  f.engine.pass('B');

  const [playedGold] = f.kernel.objects.filter(object => object.isToken && object.cardId === GOLD);
  assert.ok(playedGold, 'the original Wages body played Gold');
  assert.equal(playedGold.exhausted, true, 'CR 184.1 preserves the exhausted stipulation');
  assert.deepEqual(playedGold.location, base('A'));
  const token = tokenTimeline(f.engine, playedGold);
  const parentResolve = f.engine.trace.findIndex(entry => entry.item === draft.id && entry.step === 'resolve-start');
  const tokenPending = f.engine.trace.findIndex(entry => entry.item === token.id && entry.step === 'pending');
  const parentResolved = f.engine.trace.findIndex(entry => entry.item === draft.id && entry.step === 'resolved');
  const tokenFinalize = f.engine.trace.findIndex(entry => entry.item === token.id && entry.step === 'finalized');
  const tokenResolve = f.engine.trace.findIndex(entry => entry.item === token.id && entry.step === 'resolve-start');
  assert.ok(parentResolve < tokenPending && tokenPending < parentResolved,
    'CR 354.2-354.3: Gold becomes Pending during spell Resolve and waits for it to finish');
  assert.ok(parentResolved < tokenFinalize && tokenFinalize < tokenResolve);
  assert.deepEqual(token.item, ['pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed']);
  assert.equal(f.kernel.linked('play-gold-token.goldToken').blockedReason, undefined);
  assert.equal(f.engine.trace.filter(entry => entry.step === 'resolve-start').length, 2);
  assert.deepEqual(f.errors, []);
  assert.equal(wagesOfPain.status, 'executable');
  assert.equal(f.engine.items.length, 0);
  f.lifecycle.detach();
});

test('RIFT-1038 ordinary top-level Unit and Gear still Finalize and Resolve immediately under CR 337.2', () => {
  for (const kind of ['unit', 'gear']) {
    const id = `synthetic:${kind}:RIFT-1038`;
    const program = {
      canonicalCardId: id,
      rulesetVersion: 'core-1.5',
      status: 'executable',
      sourceText: `Synthetic ${kind} regression carrier.`,
      abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }],
    };
    const f = runtime([program], builder => {
      builder.hand(kind, { cardId: id, types: [kind], energy: 0, power: [], might: kind === 'unit' ? 1 : null });
    });
    const draft = f.binding.describePlay({ type: 'play', player: 'A', object: f.kernel.ref(kind) }, f.kernel.getObject(kind));
    f.engine.execute(draft);
    assert.deepEqual(f.engine.items, [], `${kind} left the Chain after immediate Resolve`);
    assert.equal(f.kernel.getObject(kind).zone, 'board');
    assert.equal(f.kernel.getObject(kind).exhausted, kind === 'unit');
    const steps = f.engine.trace.filter(entry => entry.item === draft.id).map(entry => entry.step);
    assert.deepEqual(steps, ['pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed']);
    assert.equal(f.engine.trace.some(entry => entry.item === draft.id && entry.step === 'priority-granted'), false,
      'Finalize/Resolve of a top-level Unit or Gear does not grant Priority');
    f.lifecycle.detach();
  }
});

test('RIFT-1038 a parent Resolve failure rolls back its Pending child Play and Resolve gate', () => {
  const parentId = 'synthetic:RIFT-1038:parent-failure';
  const program = {
    canonicalCardId: parentId,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: 'Synthetic parent Resolve failure regression.',
    abilities: [{
      kind: 'play',
      cost: { kind: 'printed' },
      body: [{
        id: 'create-mech', op: 'effect.token', args: {
          token: { kind: 'constant', value: 'mech' },
          mode: { kind: 'constant', value: 'play' },
          location: { kind: 'constant', value: base('controller') },
        },
      }, {
        id: 'fail-after-child', op: 'unregistered-after-child', args: {},
      }],
    }],
  };
  const f = runtime([program], builder => {
    builder.hand('parent', { cardId: parentId, types: ['spell'], energy: 0, power: [], might: null });
  });
  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: f.kernel.ref('parent') }, f.kernel.getObject('parent'));
  f.engine.execute(draft);
  const beforeResolve = f.kernel.stateForTest();
  f.engine.pass('A');
  assert.throws(() => f.engine.pass('B'), /Unregistered instruction opcode: unregistered-after-child/);
  assert.deepEqual(f.kernel.stateForTest(), beforeResolve,
    'the failed parent Resolve restores the child creation and parent incarnation');
  assert.deepEqual(f.engine.trace.filter(entry => entry.item?.startsWith('play:token-') && entry.step === 'pending'), [],
    'the tentative child Pending trace is rolled back');
  assert.deepEqual(f.engine.items.map(item => ({ id: item.id, status: item.status })), [{ id: draft.id, status: 'finalized' }]);
  const replacement = runtime([program], builder => {
    builder.hand('parent', { cardId: parentId, types: ['spell'], energy: 0, power: [], might: null });
  });
  const replacementDraft = replacement.binding.describePlay(
    { type: 'play', player: 'A', object: replacement.kernel.ref('parent') }, replacement.kernel.getObject('parent'),
  );
  replacement.engine.execute(replacementDraft);
  assert.equal(replacement.engine.items.length, 1, 'a new parent can Finalize normally on the replacement chain');
  replacement.lifecycle.detach();
  f.lifecycle.detach();
});
