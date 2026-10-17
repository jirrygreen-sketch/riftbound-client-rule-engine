// Shared harness for the setup chapter golden tests (RIFT-627).
//
// Scenario source: docs/rules/scenarios/setup.yaml. Everything here drives the
// merged, non-duel kernel layers through their public APIs only:
//   * src/effects/testing/test-kernel.js — the reference test kernel
//   * src/events/action-adapter.js       — the single event pipeline host
//   * src/game/lifecycle.js (createMatch) — CR 110-118 setup over TurnFlow
//   * src/turn/flow.js (TurnFlow)         — the CR v1.5 turn driver
//   * src/projection/v2/project-for.js    — the privacy projection used by 108.*
//
// Positions are built by handing the real createMatch a deck list, then every
// assertion reads the resulting state, the committed turn pipeline events or the
// match seed report. `makeMatch` additionally records each primitive the real
// lifecycle issues through the MatchHost port, so order-of-operation rules
// (CR 114 shuffle order, 117 mulligan order, 487.5 battlefield placement) can be
// asserted without re-settling any state by hand.
import assert from 'node:assert/strict';

import { world } from '../../../dist/effects/testing/test-kernel.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { createMatch } from '../../../dist/game/lifecycle.js';
import { projectFor } from '../../../dist/projection/v2/index.js';

export { assert, projectFor };

/** A complete seat: main deck, rune deck, champion legend, chosen champion, 3 battlefields. */
export function seatDeck({ main = 16, rune = 12, tag = 'a' } = {}) {
  const card = (id, types = ['unit']) => ({ id, cardId: 'card:' + id, types });
  return {
    mainDeck: Array.from({ length: main }, (_, index) => card(tag + index)),
    runeDeck: Array.from({ length: rune }, (_, index) => card('rune-' + tag + index, ['rune'])),
    championLegend: card('legend-' + tag, ['legend']),
    chosenChampion: card('champion-' + tag, ['champion']),
    battlefields: [
      card('bf-' + tag + '1', ['battlefield']),
      card('bf-' + tag + '2', ['battlefield']),
      card('bf-' + tag + '3', ['battlefield']),
    ],
  };
}

/**
 * Build the reference kernel, wrap it in the pipeline host the match expects,
 * and record every primitive the lifecycle issues through that host port.
 * `seed` runs before the match so tests can pre-place Trash cards (CR 432.2.b).
 */
export function makeMatch({
  decks,
  mainDeck = 16,
  runeDeck = 12,
  seed = 'setup-seed',
  firstPlayer,
  battlefieldChoice = [0, 0],
  mulligans = [[], []],
  victoryScore,
  seedWorld,
} = {}) {
  const builder = world().player('A').player('B');
  seedWorld?.(builder);
  const kernel = builder.build();
  const actions = [];
  const pipelineHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => {
      throw new Error('match setup made no choices');
    },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => false,
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(pipelineHost)), pipelineHost, {
    player: id => kernel.player(id),
    execute: action => {
      // Record before performing so the snapshot still names the source zone/owner
      // of a Move; the primitive itself may bump zoneEntryId (CR 448.3).
      const snapshot = 'object' in action ? kernel.getObject(action.object.id) : null;
      actions.push({ action: structuredClone(action), object: snapshot === null ? null : structuredClone(snapshot) });
      return pipelineHost.execute(action);
    },
  });
  const match = createMatch({
    decks: decks ?? [seatDeck({ main: mainDeck, rune: runeDeck, tag: 'a' }), seatDeck({ main: mainDeck, rune: runeDeck, tag: 'b' })],
    seed,
    host,
    battlefieldChoice,
    mulligans,
    ...(firstPlayer === undefined ? {} : { firstPlayer }),
    ...(victoryScore === undefined ? {} : { victoryScore }),
  });
  return { match, kernel, host, actions };
}

/** cardIds of one player's zone, in zone order. */
export function zoneCardIds(kernel, player, zone) {
  return kernel.objectsInZone(player, zone).map(ref => kernel.getObject(ref.id).cardId);
}

/**
 * Projection input assembled from the authoritative kernel state (read-only).
 *
 * Each zone entry is the full authoritative ObjectSnapshot, which is what the
 * projection needs to decide identity vs. face-down per viewer; passing bare
 * ObjectRefs would drop the card characteristics the privacy decision publishes
 * to the owner. `id` is the kernel's authoritative `ref.id` because
 * ObjectSnapshot has no top-level id field and the projection keys its object
 * table by that id (a missing id falls back to a per-zone ordinal, which would
 * collide across seats). `objects` is left out on purpose so the zone lists are
 * the only carrier of an object, exactly one entry per physical card.
 */
export function projectionState(kernel, players = ['A', 'B']) {
  const state = { players: {} };
  for (const player of players) {
    const snapshots = zone => kernel.objectsInZone(player, zone)
      .map(ref => ({ ...kernel.getObject(ref.id), id: ref.id }));
    state.players[player] = {
      id: player,
      hand: snapshots('hand'),
      deck: snapshots('deck'),
      runeDeck: snapshots('rune-deck'),
      rune: snapshots('rune-zone'),
      trash: snapshots('trash'),
      score: kernel.player(player).score,
    };
  }
  return state;
}

/** Timing points the committed turn pipeline emitted, in order. */
export function pipelineTimings(match) {
  return match.flow.chain.pipeline.events.map(event => event.timingPoint);
}

/** Turn-start emissions with their player, in order (CR 115.1.c). */
export function turnStarts(match) {
  return match.flow.chain.pipeline.events
    .filter(event => event.timingPoint === 'turn-start')
    .map(event => event.player);
}

/** Every recorded primitive of one type. */
export function actionsOfType(actions, type) {
  return actions.filter(entry => entry.action.type === type).map(entry => entry.action);
}

/** One recorded primitive rendered for readable assertion failures. */
export function describeAction(entry) {
  const action = entry.action;
  const player = 'player' in action ? action.player : entry.object?.owner ?? '?';
  if (action.type === 'draw') return `draw(${action.player},${action.amount})`;
  if (action.type === 'move-zone') return `move(${entry.object?.cardId}->${action.to})`;
  if (action.type === 'recycle') return `recycle(${entry.object?.cardId})`;
  if (action.type === 'score') return `score(${action.player},+${action.amount})`;
  if (action.type === 'channel-rune') return `channel(${action.player},${action.amount})`;
  if (action.type === 'order-top') return `shuffle(${action.player},${action.zone ?? 'deck'})`;
  if (action.type === 'create-token') return `create(${player},${(action.token.types ?? []).join('/')})`;
  return `${action.type}(${player})`;
}

export const trace = actions => actions.map(describeAction).join(' | ');
