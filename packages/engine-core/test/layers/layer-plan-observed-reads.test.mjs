// RIFT-1163: a completed command plan survives events and timing-point changes
// only when its pass made no read an event can change. Every event used to
// discard the plan, so one seeded M1 game recomputed about 65% of its
// whole-board passes over an unchanged host generation. Reads of the timing
// point, history, players or last-known information through a host context,
// and every function condition not marked observed, keep the old per-event
// invalidation.
import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { markObservedCondition } from '../../dist/layers/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { projectStaticAbilityGrant } from '../../dist/programs/ability-grants/index.js';

const constant = value => ({ kind: 'constant', value });
const field = id => ({ type: 'battlefield', id });
const PLAIN = 'synthetic:rift-1163:plain-might';
const XP = 'synthetic:rift-1163:xp-might';

const program = (canonicalCardId, condition) => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: 'Synthetic RIFT-1163 plan-cache regression.',
  abilities: [{
    kind: 'static',
    ...(condition === undefined ? {} : { condition }),
    effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: constant(2) },
  }],
});
// "While your XP is 1 or more, I have +2 Might": a read of player state.
const xpCondition = {
  kind: 'compare',
  left: { kind: 'player-property', player: 'controller', property: 'xp' },
  operator: 'gte',
  right: constant(1),
};

// Production hosts hand out deeply frozen snapshots; a mutable one never
// reuses a plan, so this fixture freezes every level.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
const frozenView = objects => deepFreeze(structuredClone(objects));

function runtime(cardId) {
  const kernel = world().player('A', { energy: 10 }).player('B', { energy: 10 })
    .unit('subject', { cardId, might: 3, location: field('field') })
    .build();
  let objectView;
  const objects = () => objectView ??= frozenView(kernel.objects);
  const choose = request => { throw new AwaitChoice(request); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); objectView = undefined; },
    objects: () => Object.freeze([...objects()]),
    perform: action => { objectView = undefined; return kernel.perform(action); },
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const chain = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false });
  createProgramBinding({ cardPrograms: [program(PLAIN), program(XP, xpCondition)] })
    .attachLifecycle(chain, error => { throw error; });
  chain.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('subject'), player: 'A' });
  chain.layers.enableDiagnostics();
  return { kernel, chain };
}

const view = chain => chain.withStableLayers(() => chain.pipeline.host.objects());
const might = chain => view(chain).find(object => object.ref.id === 'subject').might;
// An event that changes no object: only the timing point and history move.
const event = chain => chain.pipeline.emit({ timingPoint: 'main-end', player: 'A' });

test('RIFT-1163: a plan that read nothing an event can change survives the event', () => {
  const { chain } = runtime(PLAIN);
  chain.atomic(() => {
    const before = view(chain);
    assert.equal(before.find(object => object.ref.id === 'subject').might, 5);
    const hits = chain.layers.diagnostics.planCacheHits;
    event(chain);
    assert.deepEqual(view(chain), before);
    assert.ok(chain.layers.diagnostics.planCacheHits > hits, 'the completed plan is reused across the event');
  });
});

test('RIFT-1163: a static condition that reads player state is recomputed after an event', () => {
  const { kernel, chain } = runtime(XP);
  chain.atomic(() => {
    assert.equal(might(chain), 3, 'XP 0: the condition is false');
    // Player state is outside the host object generation; only the event
    // boundary tells the plan that it may have changed.
    kernel.addPlayer('A', { xp: 1 });
    event(chain);
    assert.equal(might(chain), 5, 'the event discards a plan whose condition read the player');
  });
});

test('RIFT-1163: a timing-point read through a host context is recomputed after the timing point moves', () => {
  const { chain } = runtime(PLAIN);
  // Built like the static adapter's condition: it creates a host context at
  // the current timing point and reads that context's timing point.
  const condition = markObservedCondition(object => chain.pipeline.host.context(object, 'A',
    chain.layers.currentTimingPoint ?? 'cleanup-start').timingPoint === 'main-end');
  chain.layers.addContinuous({
    id: 'synthetic:rift-1163:timing', layer: 'arithmetic', source: { id: 'subject', zoneEntryId: 1 },
    filter: { objectId: 'subject' }, effect: { kind: 'increase', amount: constant(1), condition },
  }, { type: 'permanent' });
  chain.atomic(() => {
    assert.equal(might(chain), 5);
    event(chain);
    assert.equal(might(chain), 6, 'the timing point moved to main-end');
  });
});

test('RIFT-1163: an ability-grant condition is opaque and keeps the per-event invalidation', () => {
  const { chain } = runtime(PLAIN);
  // Its condition reads through the AbilityGrantSource captured when it was
  // projected, which no layer pass can observe.
  let beaconMight = 1;
  const subject = view(chain).find(object => object.ref.id === 'subject');
  const [grant] = projectStaticAbilityGrant({
    ref: subject.ref, snapshot: subject, controller: 'A',
    object: ref => ref.id === 'subject' ? { ...subject, might: beaconMight } : null,
    query: () => [subject],
  }, {
    kind: 'static',
    condition: { kind: 'compare', left: { kind: 'object-property', object: 'self', property: 'might' },
      operator: 'gte', right: constant(5) },
    effect: { kind: 'continuous.grant-ability', filter: { objectId: 'subject' },
      ability: { kind: 'static', effect: { kind: 'continuous.might', layer: 'arithmetic', appliesTo: 'self', amount: constant(1) } } },
  });
  assert.equal(typeof grant.effect.condition, 'function');
  chain.layers.addContinuous({
    id: 'synthetic:rift-1163:grant', layer: 'arithmetic', source: subject.ref,
    filter: { objectId: 'subject' }, effect: { kind: 'increase', amount: constant(1), condition: grant.effect.condition },
  }, { type: 'permanent' });
  chain.atomic(() => {
    assert.equal(might(chain), 5);
    beaconMight = 9;
    event(chain);
    assert.equal(might(chain), 6, 'the event discards a plan that ran an unobserved condition');
  });
});
