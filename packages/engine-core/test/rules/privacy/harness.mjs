// Shared harness for the RIFT-628 privacy rule golden tests.
//
// Tested objects are only merged, non-duel kernel layers:
//   * src/effects/testing/test-kernel.js  — reference kernel (world / TestWorld)
//   * src/chain/engine.js + src/events/action-adapter.js — real commit path
//   * src/game/lifecycle.js — real match setup / mulligan path
//   * src/projection/v2/index.js — the engine privacy boundary under test
// `src/duel/` is never imported. Scenarios are built through public layer APIs;
// no scenario hand-settles damage, zones, resources or points.
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { ChainEngine } from '../../../dist/chain/engine.js';
import { projectFor } from '../../../dist/projection/v2/index.js';

export { AwaitChoice, ChainEngine, createActionPipelineHost, bindResolveContext, projectFor, world };

/** card-dsl constant expression */
export const c = value => ({ kind: 'constant', value });

/** A deterministic two-player reference world with no cards. */
export const emptyWorld = () => world().player('A').player('B').build();

/**
 * Build a real ChainEngine over the reference kernel.
 * `build(WorldBuilder)` returns the builder; `options.choose` may answer choices.
 */
export function scene(build, options = {}) {
  const kernel = build(world()).build();
  const answers = new Map(Object.entries(options.answers ?? {}));
  const asked = [];
  const choose = request => {
    asked.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    const answer = options.choose?.(request, kernel);
    if (answer !== undefined) return answer;
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: options.turnOrder ?? ['A', 'B'],
    turnPlayer: options.turnPlayer ?? 'A',
    phase: options.phase ?? 'main',
    host,
    cleanup: options.cleanup ?? (() => false),
    describePlay: options.describePlay
  });
  return { kernel, host, engine, answers, asked, choose };
}

/** Pass priority until the chain drains through the real HOT FEPR path. */
export function drain(engine) {
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 40) throw new Error('Chain did not drain');
    const holder = engine.priority;
    if (!holder) break;
    engine.pass(holder);
  }
  return guard;
}

/** Normal-speed spell draft whose printed cost is a free finalized override. */
export function spellDraft(kernel, id, body, overrides = {}) {
  return {
    id: 'spell:' + id,
    controller: 'A',
    source: kernel.getObject(id),
    kind: 'spell',
    speed: 'normal',
    body,
    cost: { id: 'cost:' + id, cost: { energy: c(0), power: c([]) } },
    ...overrides
  };
}

/** Normal-speed permanent draft played from its current zone. */
export function permanentDraft(kernel, id, overrides = {}) {
  return {
    id: 'play:' + id,
    controller: 'A',
    source: kernel.getObject(id),
    kind: 'unit',
    speed: 'normal',
    body: [],
    cost: { id: 'cost:' + id, cost: { energy: c(0), power: c([]) } },
    location: { type: 'base', player: 'A' },
    ...overrides
  };
}

/**
 * Card-program adapter for effect.play: a unit draft for the played card.
 * Supplied by tests that exercise "you may play a unit from your hand".
 */
export function describeUnitPlay(action, source) {
  return {
    id: 'play:' + source.ref.id,
    controller: action.player,
    source,
    kind: 'unit',
    speed: 'action',
    body: [],
    location: action.location ?? { type: 'base', player: action.player }
  };
}

/** An ordered Finalize-time zone slice (src/chain/picks/plan.js). */
export const slice = (id, count, extra = {}) => ({
  id,
  ordered: true,
  selection: 'all',
  options: [],
  zoneSlice: { zone: 'deck', from: 'top', ...(count === undefined ? {} : { count: c(count) }), ...extra }
});

/** A linked ordered pick: the refs of an earlier instruction's linked key. */
export const linkedPick = (id, linkedSpecId, key, exclude) => ({
  id,
  ordered: true,
  selection: 'all',
  options: [],
  linked: { kind: 'linked-value', instructionId: linkedSpecId, key },
  ...(exclude === undefined ? {} : { exclude: { kind: 'linked-value', instructionId: linkedSpecId, key: exclude } })
});

/**
 * Projection input built from the authoritative reference kernel.
 * Zone identity comes from the kernel's real zone lists; nothing is hand-settled.
 */
export function projectionState(kernel, overrides = {}) {
  const zoneObjects = (player, zone) => kernel.objectsInZone(player, zone).map(ref => {
    const object = kernel.object(ref);
    return { ...object, id: ref.id };
  });
  const boardAt = (player, type) => kernel.objects.filter(object =>
    object.owner === player && object.zone === 'board' && object.location?.type === type);
  const players = kernel.playerIds().map(id => ({
    id,
    ...kernel.player(id),
    hand: zoneObjects(id, 'hand'),
    deck: zoneObjects(id, 'deck'),
    mainDeck: zoneObjects(id, 'deck'),
    runeDeck: zoneObjects(id, 'rune-deck'),
    trash: zoneObjects(id, 'trash'),
    banishment: zoneObjects(id, 'banishment'),
    runeZone: zoneObjects(id, 'rune-zone'),
    base: boardAt(id, 'base'),
    board: boardAt(id, 'battlefield').filter(object => !object.faceDown),
    battlefield: boardAt(id, 'battlefield').filter(object => !object.faceDown),
    facedown: boardAt(id, 'battlefield').filter(object => object.faceDown)
  }));
  const fields = [...new Set(kernel.objects
    .filter(object => object.zone === 'board' && object.location?.type === 'battlefield')
    .map(object => object.location.id))];
  const battlefields = fields.map(id => ({
    id,
    controller: null,
    units: {
      A: kernel.objects.filter(object => object.location?.id === id && !object.faceDown),
      B: []
    },
    facedown: {
      A: kernel.objects.filter(object => object.location?.id === id && object.faceDown),
      B: []
    }
  }));
  // The projector resolves explicit ObjectRefs against the object list, so each
  // authoritative snapshot carries its own id at the top level as well.
  return { players, objects: kernel.objects.map(object => ({ ...object, id: object.ref.id })), battlefields, ...overrides };
}

/** Chain entries of a ChainEngine in the projection's chain-input shape. */
export function chainInput(engine) {
  return engine.items.map(item => ({
    id: item.id,
    status: item.status,
    controller: item.controller,
    source: kernelRefOf(item, 'source'),
    object: item.object,
    targets: item.targetPlans.flatMap(plan => plan.selected)
  }));
}

function kernelRefOf(item, key) {
  const snapshot = item[key];
  return snapshot ? { ...snapshot, id: snapshot.ref.id } : undefined;
}

/** The four privacy views the contract recognises (replay is a spectator). */
export function views(state) {
  return {
    A: projectFor(state, 'A'),
    B: projectFor(state, 'B'),
    spectator: projectFor(state, null),
    replay: projectFor(state, 'replay')
  };
}

/** Projected zone of one player's seat in one viewer's projection. */
export const zoneOf = (projection, player, zone) => projection.players[player][zone];

/** Every card in a projected zone must be face-down and carry no identity. */
export function assertZoneFaceDown(zone, message) {
  for (const card of zone.cards) {
    if (card.visibility !== 'face-down' || card.cardId !== undefined || card.name !== undefined) {
      throw new Error(`${message}: ${card.id} leaked ${card.cardId ?? card.name ?? 'identity'}`);
    }
  }
  return true;
}

/** Assert an authoritative id/name/cardId never appears in a serialized view. */
export function assertNotSerialized(value, secrets, message) {
  const json = JSON.stringify(value);
  for (const secret of secrets) {
    if (json.includes(secret)) throw new Error(`${message}: leaked ${secret}`);
  }
  return true;
}

/** Timing-point ids emitted by a chain/event pipeline, in order. */
export const timings = engine => engine.pipeline.events.map(event => event.timingPoint);

/** Events of one timing point. */
export const eventsAt = (engine, timingPoint) =>
  engine.pipeline.events.filter(event => event.timingPoint === timingPoint);

/** A grant value built from a real reveal ActionOutcome result. */
export const revealGrant = (refs, extra = {}) => ({
  kind: 'reveal',
  objectIds: refs.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId })),
  viewers: 'all',
  active: true,
  ...extra
});

/** A real createMatch host over the reference kernel (RIFT-262 lifecycle). */
export function matchFixture(options = {}) {
  const kernel = world().player('A').player('B').build();
  const host0 = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error('match setup made no choices'); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => false
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(host0)), host0, {
    player: id => kernel.player(id)
  });
  return { kernel, host, ...options };
}

/** One match deck whose card ids are greppable ('card:main-0' etc.). */
export function matchDeck(prefix = 'a') {
  const card = (id, types = ['unit']) => ({ id, cardId: `card:${id}`, types });
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`${prefix}-m${index}`)),
    runeDeck: Array.from({ length: 4 }, (_, index) => card(`${prefix}-r${index}`, ['rune'])),
    championLegend: card(`${prefix}-legend`, ['legend']),
    chosenChampion: card(`${prefix}-champion`, ['champion']),
    battlefields: [card(`${prefix}-bf1`, ['battlefield']), card(`${prefix}-bf2`, ['battlefield']), card(`${prefix}-bf3`, ['battlefield'])]
  };
}
