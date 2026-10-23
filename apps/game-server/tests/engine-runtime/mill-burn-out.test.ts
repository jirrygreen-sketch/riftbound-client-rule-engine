import { describe, expect, it } from 'vitest';

import { ChainEngine } from '../../../../packages/engine-core/dist/chain/engine.js';
import { createActionPipelineHost } from '../../../../packages/engine-core/dist/events/action-adapter.js';
import { world } from '../../../../packages/engine-core/dist/effects/testing/index.js';
import { createProgramBinding } from '../../../../packages/engine-core/dist/programs/index.js';
import { EngineRuntimeHost } from '../../src/engine-runtime/host.js';

const c = (value: unknown) => ({ kind: 'constant' as const, value });

function program(amount: number) {
  return {
    canonicalCardId: `test:server-mill-burn-out:${amount}`,
    rulesetVersion: 'core-1.5' as const,
    status: 'executable' as const,
    sourceText: `Burn ${amount}.`,
    abilities: [{
      kind: 'activated' as const, timing: 'action' as const,
      cost: { kind: 'activated', energy: c(0) },
      body: [{ id: 'mill', op: 'effect.mill', args: { amount: c(amount) } }],
    }],
  };
}

function runtime(amount: number, cards: readonly { readonly id: string; readonly zone: 'deck' | 'trash' }[]) {
  const cardProgram = program(amount);
  const state = new EngineRuntimeHost({ A: 'A', B: 'B' }, request => {
    if (request.type === 'optional') return true as never;
    if (request.type === 'mode') return request.options[0] as never;
    throw new Error(`Unexpected choice ${request.id}`);
  });
  const source = state.addCard('A', {
    id: 'source', cardId: cardProgram.canonicalCardId, name: 'Source', types: ['gear'],
    energy: null, power: null, might: null,
  }, 'board');
  for (const card of cards) state.addCard('A', { id: card.id, cardId: card.id, name: card.id, types: ['unit'] }, card.zone);
  const pipeline = createActionPipelineHost({
    checkpoint: () => state.checkpoint(), restore: checkpoint => state.restore(checkpoint),
    objects: () => state.objects(), perform: action => state.perform(action),
    choose: request => state.choose(request), context: (object, controller, timingPoint) =>
      state.context(object, controller, timingPoint),
    testTrigger: registration => world().build().test(registration.spec.condition),
  });
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', host: pipeline, cleanup: () => false,
  });
  const binding = createProgramBinding({ cardPrograms: [cardProgram] });
  binding.attachLifecycle(engine, error => { throw error; });
  return { state, engine, binding };
}

function settle(engine: ChainEngine): void {
  for (let guard = 0; engine.items.length; guard++) {
    expect(guard).toBeLessThan(30);
    engine.pass(engine.priority!);
  }
}

function activate(f: ReturnType<typeof runtime>): void {
  const source = f.state.objects().find(object => object.ref.id === 'source');
  if (source === undefined) throw new Error('Missing mill source');
  f.engine.execute(f.binding.describeActivate(source, 'A'));
  settle(f.engine);
}

describe('RIFT-988 game-server mill Burn Out continuation', () => {
  it('moves two available cards without a Burn Out', () => {
    const f = runtime(2, [
      { id: 'top', zone: 'deck' }, { id: 'next', zone: 'deck' },
    ]);
    activate(f);
    expect(f.state.zoneObjects('A', 'deck')).toEqual([]);
    expect(f.state.zoneObjects('A', 'trash').map(object => object.ref.id).sort()).toEqual(['next', 'top']);
    expect(f.state.player('B').score).toBe(0);
  });

  it('burns the remaining card, recycles and randomizes Trash, awards one point, and continues', () => {
    const f = runtime(2, [
      { id: 'top', zone: 'deck' }, { id: 'trash-a', zone: 'trash' }, { id: 'trash-b', zone: 'trash' },
    ]);
    activate(f);
    expect(f.state.player('B').score).toBe(1);
    expect(f.state.zoneObjects('A', 'trash')).toHaveLength(1);
  });

  it('handles an empty Main Deck with Trash and records the real sequence', () => {
    const f = runtime(2, [
      { id: 'trash-a', zone: 'trash' }, { id: 'trash-b', zone: 'trash' },
    ]);
    activate(f);
    expect(f.state.player('B').score).toBe(1);
    expect(f.state.zoneObjects('A', 'trash')).toHaveLength(2);
  });

  it('stops at the state-owner terminal winner instead of inventing a continuation', () => {
    const f = runtime(2, []);
    f.state.perform({ type: 'score', player: 'B', amount: 8 });
    activate(f);
    expect(f.state.player('B').score).toBe(10);
    expect(f.state.burnOutWinner()).toBe('B');
  });
});
