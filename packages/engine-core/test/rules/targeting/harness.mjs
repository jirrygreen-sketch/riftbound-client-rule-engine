// Shared scene harness for the targeting rules golden tests (RIFT-275).
//
// Only merged layers of the new kernel are used:
//   - src/effects/testing/       deterministic reference kernel (world / TestWorld)
//   - src/chain/interpreter-adapter.ts  real interpreter + primitive registry
//   - src/chain/engine.ts        Pending / Finalize / Resolve, HOT FEPR, trigger scan
//   - src/target/target-plan.ts  TargetPlan finalize / resolve / reselect
//
// Directory depth: test/rules/targeting/*.test.mjs -> packages/engine-core/{dist,test}.
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { world } from '../../../dist/effects/testing/index.js';
import { resolveChainBody } from '../../../dist/chain/interpreter-adapter.js';
import { ChainEngine } from '../../../dist/chain/engine.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';

export const constant = value => ({ kind: 'constant', value });
export const linked = (instructionId, key = 'value') => ({ kind: 'linked-value', instructionId, key });
export const property = (object, name) => ({ kind: 'object-property', object, property: name });
export const instruction = (id, op, args = {}, extra = {}) => ({ id, op, args, ...extra });
export const atBattlefield = (id = 'bf1') => ({ type: 'battlefield', id });
export const atBase = (player = 'A') => ({ type: 'base', player });

/** Execute one ability body through the real interpreter and primitive registry. */
export function runBody(body, kernel) {
  return resolveChainBody(body, kernel);
}

export function statuses(outcome) {
  return Object.fromEntries(outcome.results.map(entry => [entry.id, entry.result.status]));
}

export function reasons(outcome) {
  return Object.fromEntries(outcome.results.map(entry => [entry.id, entry.result.reason]));
}

/**
 * Build a ChainEngine scene over the reference kernel.
 * build(WorldBuilder) returns the builder; options.choose answers ChoiceRequests.
 */
export function scene(build, options = {}) {
  const kernel = build(world()).build();
  const answers = new Map(Object.entries(options.answers ?? {}));
  const asked = [];
  const choose = options.choose ?? (() => undefined);
  const decide = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    const answer = choose(request);
    if (answer !== undefined) return answer;
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  // Real lethal-damage cleanup: Board units at Might <= 0 or damage >= Might die.
  const cleanup = engine => {
    let changed = false;
    engine.layers.setObjects(kernel.objects);
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone !== 'board' || !object.types.includes('unit') || object.might === null) continue;
      if (object.might > 0 && object.damage < object.might) continue;
      if (kernel.object(object.ref) === null) continue;
      const before = kernel.ref(object.ref.id);
      engine.commit({ type: 'kill', object: object.ref });
      changed ||= before.zoneEntryId !== kernel.ref(object.ref.id).zoneEntryId;
    }
    return changed;
  };
  const engine = new ChainEngine({
    turnOrder: options.turnOrder ?? ['A', 'B'],
    turnPlayer: options.turnPlayer ?? 'A',
    phase: options.phase ?? 'main',
    host,
    cleanup: options.cleanup ?? cleanup,
    describePlay: options.describePlay
  });
  const draft = (id, overrides = {}) => ({
    id, controller: 'A', source: kernel.getObject(id), kind: 'spell', speed: 'action', body: [], ...overrides
  });
  const watch = (id, sourceId, opts = {}) => engine.pipeline.registerTrigger({
    id,
    source: kernel.getObject(sourceId),
    controller: opts.controller ?? kernel.getObject(sourceId).controller,
    spec: { at: 'became-target', filter: { event: 'object-targeted', ...(opts.filter ?? {}) }, ...(opts.spec ?? {}) },
    body: opts.body ?? [instruction('trigger-draw', 'effect.draw', { amount: constant(opts.draw ?? 1) })],
    ...(opts.rest ?? {})
  });
  return { kernel, engine, host, draft, watch, answers, asked, choose };
}

/** Pass priority until the chain is empty. */
export function spend(engine) {
  let guard = 0;
  while (engine.items.length > 0) {
    if (++guard > 40) throw new Error('Chain did not drain');
    if (!engine.priority) break;
    engine.pass(engine.priority);
  }
  return guard;
}

/** Pass priority until the given player holds it. */
export function passTo(engine, player) {
  let guard = 0;
  while (engine.priority !== player) {
    if (++guard > 12) throw new Error('Cannot reach priority holder ' + player);
    engine.pass(engine.priority);
  }
}

/**
 * Place a rune into the Rune Zone (the reference builder's rune() fills the
 * Rune Deck instead). Used by scenarios that recycle a rune.
 */
export function placeRune(kernel, id, owner = 'A', zone = 'rune-zone') {
  return kernel.addObject({
    ref: { id, zoneEntryId: 1 },
    cardId: 'card:' + id,
    name: id,
    types: ['rune'],
    tags: [],
    keywords: [],
    owner,
    controller: owner,
    zone,
    location: null,
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }, zone);
}

/** Place a Legend on the Board (the reference builder has no legend helper). */
export function placeLegend(kernel, id, owner = 'A') {
  return kernel.addObject({
    ref: { id, zoneEntryId: 1 },
    cardId: 'card:' + id,
    name: id,
    types: ['legend'],
    tags: [],
    keywords: [],
    owner,
    controller: owner,
    zone: 'board',
    location: { type: 'base', player: owner },
    might: null,
    energy: null,
    power: null,
    exhausted: true,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }, 'board');
}
