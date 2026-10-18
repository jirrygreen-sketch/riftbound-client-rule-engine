import { world } from '../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';

export const c = value => ({ kind: 'constant', value });
export const draw = (id = 'draw', amount = 1) => ({ id, op: 'effect.draw', args: { amount: c(amount) } });
export const add = (id = 'add', amount = 2) => ({ id, op: 'effect.repeat', args: { count: c(1), action: { type: 'gain-energy', player: c('A'), amount: c(amount) } } });
export const damage = (id = 'hit', amount = 1, target = 'victim') => ({ id, op: 'effect.damage', args: { amount: c(amount), target }, targets: [{ id: target, filter: { type: 'unit', zone: 'board', controller: 'B' }, max: 1 }] });
export function fixture({ turnOrder = ['A', 'B'], turnPlayer = 'A', phase = 'main', choose, energy = 20, cards = [], cleanup, describePlay } = {}) {
  const builder = world().player('A', { energy }).player('B', { energy }).base('source', { energy: 0, power: [], might: 2 }).base('enemy', { owner: 'B', might: 5 });
  for (const player of turnOrder) if (!['A', 'B'].includes(player)) builder.player(player, { energy });
  for (const player of turnOrder) builder.deck([`${player}:deck:1`, `${player}:deck:2`, `${player}:deck:3`, `${player}:deck:4`], { owner: player });
  for (const card of cards) builder.hand(card.id, { energy: 1, power: [], ...card });
  const kernel = builder.build();
  const answers = new Map();
  const decide = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (choose) { const answer = choose(request); if (answer !== undefined) return answer; }
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }), restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action), choose: decide,
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const lethalCleanup = engine => {
    let changed = false;
    engine.layers.setObjects(kernel.objects);
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone === 'board' && object.types.includes('unit') && object.might !== null && (object.might <= 0 || object.damage >= object.might)) {
        const before = kernel.ref(object.ref.id);
        engine.commit({ type: 'kill', object: object.ref });
        const after = kernel.ref(object.ref.id);
        changed ||= before.zoneEntryId !== after.zoneEntryId;
      }
    }
    return changed;
  };
  const engine = new ChainEngine({ turnOrder, turnPlayer, phase, host, cleanup: cleanup ?? lethalCleanup, describePlay });
  const draft = (id, options = {}) => ({ id, controller: 'A', source: kernel.getObject('source'), kind: 'activated', speed: 'reaction', body: [draw(id)], ...options });
  const card = (id, options = {}) => draft(id, { source: kernel.getObject(id), kind: 'spell', speed: 'normal', ...options });
  return { engine, kernel, host, draft, card, answers };
}
export function trigger(f, id = 'watch', options = {}) {
  const { spec, ...rest } = options;
  f.engine.pipeline.registerTrigger({ id, source: f.kernel.getObject('source'), controller: 'A', spec: { at: 'object-enters-board', filter: {}, ...spec }, body: [draw(id)], ...rest });
}
export function resolveAll(engine) {
  let count = 0;
  while (engine.items.length) {
    if (++count > 50) throw new Error('Nonterminating test chain');
    engine.pass(engine.priority);
  }
}
export const stages = engine => engine.trace.filter(event => ['pending', 'finalized', 'resolved', 'removed'].includes(event.step)).map(event => `${event.step}:${event.item}`);
