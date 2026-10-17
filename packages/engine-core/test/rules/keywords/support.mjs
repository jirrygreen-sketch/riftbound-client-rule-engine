// Shared harness for the RIFT-626 keywords rule golden tests.
//
// Object under test: only merged new-layer code — the reference test kernel
// (`src/effects/testing/`), the program binding (`src/programs/`), the
// ChainEngine (`src/chain/`), the unified event pipeline (`src/events/`), the
// layer engine (`src/layers/`) and the merged keyword expansions
// (`src/effects/keywords/`). `src/duel/` is never the tested object; where the
// zones kernel still consumes a DuelBoard it is used as the board factory only,
// exactly like `test/rules/movement/support.mjs`.
//
// Nothing here settles a scenario by hand: positions come from the kernel
// builders, every state change goes through a real `GameAction` and every
// assertion reads committed events or the resulting state.
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { createProgramBinding } from '../../../dist/programs/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { ChainEngine } from '../../../dist/chain/engine.js';

export { world, AwaitChoice, createProgramBinding };

/** card-dsl constant expression */
export const c = value => ({ kind: 'constant', value });

/** A card program whose play ability has the given EffectIR body. */
export function cardProgram(canonicalCardId, body = [], extraAbilities = []) {
  return {
    canonicalCardId,
    rulesetVersion: 'core-1.5',
    status: 'executable',
    sourceText: canonicalCardId,
    abilities: [{ kind: 'play', cost: { kind: 'printed' }, body }, ...extraAbilities]
  };
}

/** effect.damage of one target spec, used by the speed-keyword scenarios. */
export const damage = (id, amount, target = 'victim') => ({
  id,
  op: 'effect.damage',
  args: { amount: c(amount), target: c(target) },
  targets: [{ id: target, filter: { type: 'unit', zone: 'board' }, min: 1, max: 1 }]
});

/** effect.draw for the given player (defaults to the ability controller). */
export const drawOne = (id, player) => ({
  id,
  op: 'effect.draw',
  args: { amount: c(1), ...(player === undefined ? {} : { player: c(player) }) }
});

/**
 * A ChainEngine over the reference kernel with the production program binding
 * and lifecycle attached. `programs` are the synthetic executable card
 * programs the scenario needs; `setup` fills the given position through the
 * public WorldBuilder.
 */
export function fixture({
  programs = [], setup, energy = {}, power = {}, turnPlayer = 'A', phase = 'main', answers = {}, cleanup = 'lethal'
} = {}) {
  const binding = createProgramBinding({ cardPrograms: programs });
  const builder = world();
  for (const id of ['A', 'B']) {
    builder.player(id, { energy: energy[id] ?? 0, power: power[id] ?? [] });
    builder.deck([`${id}:deck:1`, `${id}:deck:2`], { owner: id });
    builder.rune([`${id}:rune:1`, `${id}:rune:2`], { owner: id });
  }
  setup?.(builder);
  const kernel = builder.build();
  const store = new Map(Object.entries(answers));
  const asked = [];
  /**
   * Scenario answers may name objects by their scenario id; the kernel only ever
   * sees current `ObjectRef` values, so ids are translated here (never re-bound
   * after the fact).
   */
  const refsOf = value => {
    if (!Array.isArray(value)) return value;
    return value.map(entry => typeof entry === 'string'
      ? kernel.objects.find(object => object.ref.id === entry)?.ref ?? (() => { throw new Error(`Answer names unknown object ${entry}`); })()
      : entry);
  };
  const choose = request => {
    asked.push(request);
    if (store.has(request.id)) return refsOf(store.get(request.id));
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === 'select-objects' && request.min === 0) return [];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, at) => bindResolveContext(kernel, { source, controller, timingPoint: at, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  /** Lethal-damage Cleanup over the merged layers engine (CR 323.10). */
  const lethalCleanup = engine => {
    let changed = false;
    engine.layers.setObjects(kernel.objects);
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone !== 'board' || !object.types.includes('unit') || object.might === null) continue;
      if (!(object.might <= 0 || object.damage >= object.might)) continue;
      const before = kernel.ref(object.ref.id);
      engine.commit({ type: 'kill', object: object.ref });
      const after = kernel.ref(object.ref.id);
      changed ||= before.zoneEntryId !== after.zoneEntryId;
    }
    return changed;
  };
  const engine = new ChainEngine({
    turnOrder: ['A', 'B'], turnPlayer, phase,
    host,
    cleanup: cleanup === 'none' ? () => false : lethalCleanup
  });
  const errors = [];
  const lifecycle = binding.attachLifecycle(engine, error => errors.push(error));
  const layered = () => { engine.layers.setObjects(kernel.objects); return engine.layers; };
  return {
    kernel, engine, binding, host, answers: store, asked, errors, lifecycle, choose, layered,
    get: id => kernel.getObject(id),
    ref: id => kernel.ref(id),
    /** Layered keywords of one object (production layer engine, not raw data). */
    keywords: id => layered().evaluate(kernel.ref(id)).keywords,
    /** Layered snapshot of one object. */
    snapshot: id => layered().evaluate(kernel.ref(id)),
    /** Current objects at one Base or Battlefield, sorted by scenario id. */
    idsAt: locationId => kernel.objects
      .filter(object => object.location?.type === 'battlefield' && object.location.id === locationId)
      .map(object => object.ref.id).sort(),
    /** Play a card in Hand through the production program binding. */
    play(id, { player = 'A', draft = {} } = {}) {
      return engine.execute({
        ...binding.describePlay({ type: 'play', player, object: kernel.ref(id) }, kernel.getObject(id)),
        ...draft
      });
    },
    /** Activate a printed activated ability (default: the first one). */
    activate(id, { player = 'A', ability = 0, draft = {} } = {}) {
      return engine.execute({ ...binding.describeActivate(kernel.getObject(id), player, ability), ...draft });
    }
  };
}

/** Resolve every chain item by passing priority until the chain is empty. */
export function settle(engine) {
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error('Nonterminating test chain');
    if (engine.priority === null) break;
    engine.pass(engine.priority);
  }
}

/** Committed timing points without the high-frequency Cleanup pair. */
export const timings = engine => engine.pipeline.events.map(event => event.timingPoint);
export const timingsOnly = engine => timings(engine).filter(id => !id.startsWith('cleanup-'));
export const eventsAt = (engine, timingPoint) => engine.pipeline.events.filter(event => event.timingPoint === timingPoint);
export const pendingItems = engine => engine.trace.filter(entry => entry.step === 'pending').map(entry => entry.item);
export const resolvedItems = engine => engine.trace.filter(entry => entry.step === 'resolved').map(entry => entry.item);

/** Assert `expected` appears in `actual` in order (the YAML `ordered: subsequence`). */
export function assertSubsequence(actual, expected, label = 'event sequence') {
  let cursor = 0;
  for (const entry of expected) {
    const index = actual.indexOf(entry, cursor);
    if (index < 0) throw new Error(`Expected ${JSON.stringify(entry)} after index ${cursor} of ${label} ${JSON.stringify(actual)}`);
    cursor = index + 1;
  }
}

/** Keywords of one layered snapshot reduced to `id:value` strings. */
export const keywordIds = snapshot => snapshot.keywords.map(keyword => `${keyword.id}:${keyword.value ?? '-'}`);
