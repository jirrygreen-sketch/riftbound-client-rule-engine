import assert from 'node:assert/strict';
import test from 'node:test';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { world } from '../../dist/effects/testing/index.js';

// RIFT-898: production Finalize must apply active cost modifications. Before
// this, ChainEngine built the plan with buildCostPlan only, so a card's own
// "This costs [2] less if ..." and Board statics such as "Your spells cost 1
// less" were silently ignored on every real play (CR 356 / contract 5.1).

const c = value => ({ kind: 'constant', value });

const selfDiscountSpell = {
  canonicalCardId: 'synthetic:rift-898:self-discount-spell',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  abilities: [
    {
      kind: 'static',
      effect: { kind: 'continuous.cost-modification', amount: -2, resource: 'energy', appliesTo: 'self' },
      condition: {
        kind: 'compare',
        left: { kind: 'count', subject: 'units', filter: { tags: 'Mech', controller: 'you' } },
        operator: 'gte',
        right: c(1),
      },
    },
    { kind: 'play', body: [] },
  ],
  sourceText: 'This costs 2 less if you control a Mech.',
};

const spellDiscounter = {
  canonicalCardId: 'synthetic:rift-898:spell-discounter',
  rulesetVersion: 'core-1.5',
  status: 'executable',
  abilities: [
    {
      kind: 'static',
      effect: { kind: 'continuous.cost-modification', amount: -1, resource: 'energy', appliesTo: 'spell-play-cost' },
    },
  ],
  sourceText: 'Your spells cost 1 less.',
};

function playSpell({ energy = 6, mech = false, discounter = false }) {
  const builder = world()
    .player('A', { energy, power: [] })
    .player('B', { energy: 0 })
    .object('spell', { owner: 'A', controller: 'A', cardId: selfDiscountSpell.canonicalCardId, types: ['spell'], zone: 'hand', energy: 4, power: [] });
  if (mech) builder.unit('mech', { owner: 'A', controller: 'A', might: 2, tags: ['Mech'], location: { type: 'base', player: 'A' } });
  if (discounter) builder.unit('discounter', { owner: 'A', controller: 'A', cardId: spellDiscounter.canonicalCardId, might: 1, location: { type: 'base', player: 'A' } });
  const kernel = builder.build();
  const choose = request => { throw new Error(`Unexpected choice ${request.type} ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({ cardPrograms: [selfDiscountSpell, spellDiscounter] });
  const engine = new ChainEngine({ turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host, cleanup: () => false, describePlay: binding.describePlay });
  binding.attachLifecycle(engine, error => { throw error; });
  // A Board object built before attach binds its statics on entry, as in the
  // RIFT-823 lifecycle tests.
  if (discounter) engine.pipeline.emit({ timingPoint: 'object-enters-board', object: kernel.getObject('discounter'), player: 'A' });
  const source = kernel.getObject('spell');
  const draft = binding.describePlay({ type: 'play', object: source.ref, player: 'A' }, source);
  engine.execute(draft);
  for (let guard = 0; engine.items.length; guard++) {
    if (guard > 10) throw new Error('Chain did not settle');
    engine.pass(engine.priority);
  }
  return { kernel, engine, draft };
}

test('RIFT-898: describePlay carries the played card\'s own cost statics into the draft', () => {
  const { draft } = playSpell({ mech: true });
  assert.equal(draft.costStatics.length, 1);
  assert.equal(draft.costStatics[0].ability.effect.appliesTo, 'self');
});

test('RIFT-898: an unmet own-cost condition leaves the printed cost', () => {
  const { kernel } = playSpell({});
  assert.equal(kernel.player('A').energy, 2);
});

test('RIFT-898: a met own-cost condition reduces the cost at Finalize', () => {
  const { kernel } = playSpell({ mech: true });
  assert.equal(kernel.player('A').energy, 4);
});

test('RIFT-898: a Board static discount applies once, not once per registry mirror', () => {
  const { kernel } = playSpell({ discounter: true });
  assert.equal(kernel.player('A').energy, 3);
});

test('RIFT-898: own and Board discounts stack', () => {
  const { kernel } = playSpell({ mech: true, discounter: true });
  assert.equal(kernel.player('A').energy, 5);
});

test('RIFT-898: the reduced cost is what decides affordability', () => {
  assert.throws(() => playSpell({ energy: 2 }), /insufficient Energy/);
  const { kernel } = playSpell({ energy: 2, mech: true });
  assert.equal(kernel.player('A').energy, 0);
});
