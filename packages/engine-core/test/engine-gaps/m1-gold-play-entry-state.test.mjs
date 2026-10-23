import assert from 'node:assert/strict';
import test from 'node:test';

import { cardPrograms } from '../../../card-dsl/dist/cards/registry.generated.js';
import wagesOfPain from '../../../card-dsl/dist/cards/sfd/wages-of-pain.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createProgramBinding } from '../../dist/programs/index.js';

// RIFT-1005: "Play a Gold gear token exhausted" (Wages of Pain sfd-070-221).
// Gear enters ready by default (359.2.d), but the creating effect stipulates
// the entry state (184.1 / 185.2.d). On the production ChainEngine the token is
// created on the Chain carrying that state and then Played as its own Chain
// item; resolving that item must not replace the stipulated exhausted entry
// with the Gear default.
// Official evidence:
// - Core Rules v1.5 (last updated 2026-10-09),
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
//   359.2.d (Non-Unit Gear enters the Board Ready at the player's Base),
//   184.1 (the effect may state the token enters ready or exhausted, contrary
//   to the default), 185.2.a / 185.2.d (tokens are played and follow their
//   type's rules unless otherwise specified). Radiance patch notes (effective
//   2026-10-16) change none of these.
// - Card: Wages of Pain sfd-070-221 (canonicalCardId below), "Deal 3 to a
//   unit at a battlefield. Play a Gold gear token exhausted."
// Timeline: Wages of Pain Finalize locks the target -> Resolve deals 3 ->
//   effect.token creates Gold on the Chain with exhausted=true and Plays it
//   (finalized zero cost, 185.3.a.1) -> Priority passes -> the Gold item
//   Resolves and enters the controller's Base, still exhausted.
// The printed program stays judge-required for its separate Hidden scoping
// gap, so the scenario binds an executable carrier with the exact original
// play body (damage, then the exhausted Gold Play) and no Hidden keyword.
const GOLD = 'card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511';
const wagesPlay = wagesOfPain.abilities.find(ability => ability.kind === 'play');
const wagesCarrier = {
  canonicalCardId: wagesOfPain.canonicalCardId,
  rulesetVersion: wagesOfPain.rulesetVersion,
  status: 'executable',
  sourceText: wagesOfPain.sourceText,
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: wagesPlay.body }],
};
const goldProgram = cardPrograms.find(program => program.canonicalCardId === GOLD);

function setup({ goldEntry }) {
  const kernel = world().player('A', { energy: 3 }).player('B')
    .unit('victim', { owner: 'B', might: 5, location: { type: 'battlefield', id: 'bf1' } })
    .hand('wages', { cardId: wagesOfPain.canonicalCardId, name: 'Wages of Pain', types: ['spell'], energy: 3, power: null })
    .build();
  const target = wagesPlay.body[0].targets[0].id;
  const choose = request => {
    if (request.id === target || request.id.endsWith(`/${target}`)) return [kernel.ref('victim')];
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  // 'unstipulated' drops the entry-state field so 359.2.d's Gear default applies.
  const body = goldEntry === undefined ? wagesPlay.body : wagesPlay.body.map(instruction => {
    if (instruction.op !== 'effect.token') return instruction;
    const { entersExhausted: _entersExhausted, entersReady: _entersReady, ...args } = instruction.args;
    return { ...instruction, args };
  });
  const binding = createProgramBinding({ cardPrograms: [{ ...wagesCarrier, abilities: [{ ...wagesCarrier.abilities[0], body }] }, goldProgram] });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false,
    describePlay: binding.describePlay,
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  return { kernel, engine, binding, errors };
}

function playWages({ kernel, engine, binding }) {
  engine.execute(binding.describePlay({ type: 'play', player: 'A', object: kernel.ref('wages') }, kernel.getObject('wages')));
  let guard = 0;
  while (engine.items.length && engine.priority !== null) {
    assert.ok(++guard < 50, 'the Chain settles');
    engine.pass(engine.priority);
  }
}

const golds = kernel => kernel.objects.filter(object => object.isToken && object.cardId === GOLD);

test('RIFT-1005: Wages of Pain plays its Gold exhausted through the production Chain', () => {
  assert.ok(goldProgram, 'the Gold token program is generated');
  const f = setup({});
  playWages(f);
  assert.deepEqual(f.errors, []);
  assert.equal(f.kernel.getObject('victim').damage, 3);
  assert.equal(f.engine.trace.filter(entry => entry.step === 'resolve-start').length, 2,
    'Wages of Pain and the Gold Play each resolved as a Chain item');
  assert.equal(golds(f.kernel).length, 1, 'exactly one Gold was played');
  const [gold] = golds(f.kernel);
  assert.equal(gold.zone, 'board');
  assert.deepEqual(gold.location, { type: 'base', player: 'A' });
  assert.equal(gold.exhausted, true, 'the stipulated exhausted entry survives Chain resolution');
  assert.equal(f.kernel.linked('play-gold-token.goldToken').blockedReason, undefined);
  assert.equal(f.engine.items.length, 0);
});

test('RIFT-1005: a Gold Play with no stipulated entry state keeps the ready Gear default (359.2.d)', () => {
  const f = setup({ goldEntry: 'unstipulated' });
  playWages(f);
  assert.deepEqual(f.errors, []);
  const [gold] = golds(f.kernel);
  assert.ok(gold, 'the Gold was played');
  assert.equal(gold.zone, 'board');
  assert.equal(gold.exhausted, false);
});
