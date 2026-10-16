import { world } from '../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { TurnFlow } from '../../dist/turn/flow.js';

export const c = value => ({ kind: 'constant', value });
export const draw = id => ({ id, op: 'effect.draw', args: { amount: c(1) } });
export const move = (id, to) => ({ id, op: 'effect.move', args: { to: c(to) } });
export function fixture({ setup, fields = [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }], score = {}, energy = 0, deck = true } = {}) {
  const builder = world().player('A', { energy, score: score.A ?? 0 }).player('B', { score: score.B ?? 0 })
    .base('source', { might: 4, energy: 0, power: [] }).base('enemy', { owner: 'B', might: 4, energy: 0, power: [] });
  if (deck) for (const player of ['A', 'B']) builder.deck(Array.from({ length: 8 }, (_, i) => `${player}:deck:${i}`), { owner: player });
  for (const player of ['A', 'B']) builder.rune(Array.from({ length: 8 }, (_, i) => `${player}:rune:${i}`), { owner: player });
  setup?.(builder);
  const kernel = builder.build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({ host, player: id => kernel.player(id), turnOrder: ['A', 'B'], battlefields: fields });
  const draft = (id, body, options = {}) => ({ id, controller: 'A', source: kernel.getObject('source'), kind: 'activated', speed: 'normal', body, ...options });
  return { kernel, host, flow, answers, draft };
}
export function trigger(f, id, at, options = {}) {
  f.flow.chain.pipeline.registerTrigger({ id, source: f.kernel.getObject('source'), controller: 'A',
    spec: { at, filter: {} }, body: [draw(id)], ...options });
}
export function settle(flow) {
  let budget = 0;
  while (flow.chain.items.length) {
    if (++budget > 100) throw new Error('Nonterminating test chain');
    flow.pass(flow.chain.priority);
  }
  flow.advance();
}
export const timings = flow => flow.chain.pipeline.events.map(event => event.timingPoint);
export const nonCleanup = flow => timings(flow).filter(id => !id.startsWith('cleanup-'));
