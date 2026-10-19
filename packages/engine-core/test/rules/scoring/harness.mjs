// Shared harness for the scoring chapter golden tests (RIFT-278).
//
// Everything here drives the merged, non-duel kernel layers through their public
// APIs only:
//   * src/effects/testing/test-kernel.js — the reference test kernel
//   * src/events/action-adapter.js       — the single event pipeline host
//   * src/turn/flow.js (TurnFlow)        — the CR v1.5 turn driver over ChainEngine
//   * src/scoring/scoring.js             — the scoring leaf kernel
//   * src/duel/battlefields.js           — the canonical board (locations/control)
//   * src/effects/keywords/Deploy.js     — the merged Deploy keyword expansion
//
// No scenario settles points by hand, edits the score ledger, fakes a cleanup or
// calls a duel runtime. Positions are built through board/scoring factories and
// the assertions read the resulting state or the committed event sequence.
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { TurnFlow } from '../../../dist/turn/flow.js';
// The board module is the canonical board authority the Scoring leaf requires
// (src/scoring/scoring.ts never re-implements locations/control). It is imported
// only as the position fixture for scoring-leaf tests; the tested object of those
// tests is always the src/scoring layer, never the duel runtime.
import {
  selectDuelBattlefields, createDuelBoard, placeDuelUnit, applyOpenDuelCleanup, beginDuelShowdown,
  endDuelNonCombatShowdown, removeDuelUnit, relocateDuelUnit,
} from '../../../dist/duel/battlefields.js';
import {
  gainDuelPoints, getDuelWinnerAtCleanup, loseDuelPoints, restoreDuelScoring, scoreDuelBattlefield,
  setDuelVictoryScoreForEffect,
} from '../../../dist/scoring/scoring.js';
import deploy from '../../../dist/effects/keywords/Deploy.js';

export { AwaitChoice, TurnFlow, applyOpenDuelCleanup, beginDuelShowdown, createDuelBoard,
  deploy, endDuelNonCombatShowdown, gainDuelPoints, getDuelWinnerAtCleanup, loseDuelPoints, placeDuelUnit,
  relocateDuelUnit, removeDuelUnit, restoreDuelScoring, scoreDuelBattlefield,
  selectDuelBattlefields, setDuelVictoryScoreForEffect, world };

/** card-dsl constant expression */
export const c = value => ({ kind: 'constant', value });

/** effect.draw instruction */
export const draw = (id, amount = 1) => ({ id, op: 'effect.draw', args: { amount: c(amount) } });

/** effect.move instruction to a fixed destination */
export const move = (id, to) => ({ id, op: 'effect.move', args: { to: c(to) } });

/** “Score X points.” — Gaining Points, not Scoring (CR 470.2) */
export const gainPoints = (id, amount = 1) => ({ id, op: 'effect.score', args: { amount: c(amount) } });

const STARTING_DECK = 8;

/**
 * Build a TurnFlow over the reference kernel with deterministic decks/rune decks.
 * `fields` are the two duel battlefields with their initial canonical controllers.
 */
export function turnFixture({ fields, score = {}, victoryScore, turnOrder = ['A', 'B'], setup, deck = STARTING_DECK } = {}) {
  const builder = world().player('A', { score: score.A ?? 0 }).player('B', { score: score.B ?? 0 })
    .base('source', { might: 4, energy: 0, power: [] });
  for (const player of turnOrder) {
    if (deck) builder.deck(Array.from({ length: deck }, (_, i) => `${player}:deck:${i}`), { owner: player });
    builder.rune(Array.from({ length: STARTING_DECK }, (_, i) => `${player}:rune:${i}`), { owner: player });
  }
  setup?.(builder);
  const kernel = builder.build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const options = {
    host, player: id => kernel.player(id), turnOrder,
    battlefields: fields ?? [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  };
  if (victoryScore !== undefined) options.victoryScore = victoryScore;
  const flow = new TurnFlow(options);
  /** Chain draft for an activated ability of a Board object. */
  const activated = (id, body, controller = 'A', sourceId = 'source', speed = 'normal') => ({
    id, controller, source: kernel.getObject(sourceId), kind: 'activated', speed, body,
  });
  /** Chain draft for a spell card currently in Hand. */
  const spell = (id, body, controller = 'A', sourceId = 's1', speed = 'normal') => ({
    id, controller, source: kernel.getObject(sourceId), kind: 'spell', speed, body,
  });
  /** Mandatory trigger registered on the real event pipeline. */
  const trigger = (id, at, body, options = {}) => flow.chain.pipeline.registerTrigger({
    id, source: kernel.getObject(options.sourceId ?? 'source'), controller: options.controller ?? 'A',
    spec: { at, filter: options.filter ?? {}, ...(options.once ? { once: options.once } : {}) }, body,
  });
  return { kernel, host, flow, answers, choose, activated, spell, trigger };
}

/** Every committed pipeline event, in commit order. */
export const eventsOf = f => f.flow.chain.pipeline.events;

/** Mark the current event count so a later assertion can scope to new events. */
export const markEvents = f => eventsOf(f).length;

/** Events committed after `mark`, in commit order. */
export const eventsAfter = (f, mark) => eventsOf(f).slice(mark);

/** Timing points committed after `mark`. */
export const timingsAfter = (f, mark) => eventsAfter(f, mark).map(event => event.timingPoint);

/** Every committed timing point, in commit order. */
export const timings = f => eventsOf(f).map(event => event.timingPoint);

/** Committed timing points without the pipeline's high-frequency cleanup pair. */
export const nonCleanup = f => timings(f).filter(id => !id.startsWith('cleanup-'));

/** Committed scoring-related entries (timing point + player + battlefield) in commit order. */
export const scoreEvents = f => eventsOf(f)
  .filter(event => ['points-gained', 'hold', 'conquer', 'score', 'final-point', 'control-established', 'control-lost'].includes(event.timingPoint))
  .map(event => `${event.timingPoint}:${event.player ?? ''}${event.details?.battlefieldId ? `:${event.details.battlefieldId}` : ''}`);

/** Committed events for a single timing point. */
export const eventsAt = (f, timingPoint) => eventsOf(f).filter(event => event.timingPoint === timingPoint);

/** Assert `expected` appears in `actual` in the given order (YAML `ordered: subsequence`). */
export function assertSubsequence(actual, expected) {
  let cursor = 0;
  for (const entry of expected) {
    const index = actual.indexOf(entry, cursor);
    if (index < 0) {
      throw new Error(`Expected subsequence entry ${JSON.stringify(entry)} after index ${cursor} in ${JSON.stringify(actual)}`);
    }
    cursor = index + 1;
  }
}

/**
 * Pass Priority/Focus until the chain and Showdown are idle again, exactly as the
 * turn driver expects a player to do. Never resolves items by hand.
 */
export function settle(f, budget = 60) {
  let guard = 0;
  while (guard++ < budget) {
    if (f.flow.chain.items.length) { f.flow.pass(f.flow.chain.priority); continue; }
    const focus = f.flow.chain.focus;
    if (focus) { f.flow.pass(focus); continue; }
    return;
  }
  throw new Error('settle did not reach an idle chain');
}

/**
 * Canonical duel board helper (v1.5 487.4–5): a three-battlefield seat per player,
 * one selection each, then the board factory. Control is established through the
 * real place → Open cleanup → non-combat Showdown chain (190.4 / 348.2).
 */
export function newDuelBoard(firstIndex = 0, secondIndex = 0) {
  const indices = [firstIndex, secondIndex];
  let cursor = 0;
  const selection = selectDuelBattlefields([
    { playerId: 'A', battlefields: [
      { instanceId: 'a-1', cardId: 'printing-x' }, { instanceId: 'a-2', cardId: 'printing-y' },
      { instanceId: 'a-3', cardId: 'printing-z' },
    ] },
    { playerId: 'B', battlefields: [
      { instanceId: 'b-1', cardId: 'printing-x' }, { instanceId: 'b-2', cardId: 'printing-y' },
      { instanceId: 'b-3', cardId: 'printing-z' },
    ] },
  ], () => indices[cursor++] ?? 0);
  const board = createDuelBoard(selection);
  return { board, f1: board.battlefields[0].locationId, f2: board.battlefields[1].locationId,
    selected: selection.selected };
}

/** Place a unit and run Open cleanup + non-combat Showdown to establish control (190.4 / 348.2). */
export function establishControl(board, locationId, owner, objectId) {
  let current = placeDuelUnit(board, { objectId, controllerPlayerId: owner, locationId });
  current = applyOpenDuelCleanup(current);
  current = beginDuelShowdown(current, locationId);
  current = endDuelNonCombatShowdown(current, locationId);
  return current;
}

export const fieldOf = (board, locationId) => board.battlefields.find(field => field.locationId === locationId);

const HOLD_STEP = turnPlayerId => ({ phase: 'beginning-scoring', turnPlayerId,
  controlEstablishedForPlayerId: null, controlEstablishedLocationId: null });
const OTHER_PHASE = turnPlayerId => ({ phase: 'other', turnPlayerId,
  controlEstablishedForPlayerId: null, controlEstablishedLocationId: null });
const CONQUER_STEP = (turnPlayerId, playerId, locationId) => ({ phase: 'other', turnPlayerId,
  controlEstablishedForPlayerId: playerId, controlEstablishedLocationId: locationId });

/** The legal Beginning-Phase Scoring Step timing for the turn player (315.2.b). */
export const holdTiming = HOLD_STEP;
/** Any non-Scoring-Step timing (Main Phase actions, Conquer). */
export const otherTiming = OTHER_PHASE;
/** Trusted control-established record from the canonical outer executor (469.1/471.1.b). */
export const conquerTiming = CONQUER_STEP;

/** A restore-shaped scoring state with points and the current-turn ledger (470/472). */
export function scoringState(board, { points = { A: 0, B: 0 }, ledger = {}, turnNumber = 1, victoryScore = 8 } = {}) {
  return restoreDuelScoring({
    playerIds: [...board.playerIds],
    battlefieldLocationIds: board.battlefields.map(field => field.locationId),
    victoryScore, turnNumber,
    players: board.playerIds.map(playerId => ({ playerId, points: points[playerId] ?? 0,
      scoredBattlefieldLocationIds: [...(ledger[playerId] ?? [])] })),
  }, board);
}

/** Public projection of a scoring state for assertions. */
export const pointsOf = (state, playerId) => state.players.find(player => player.playerId === playerId).points;
export const ledgerOf = (state, playerId) => state.players.find(player => player.playerId === playerId).scoredBattlefieldLocationIds;

/** Board helper: place `objectId` for `owner` at the first battlefield and establish control. */
export function boardControlledBy(firstIndex = 0, owner = 'A', objectId = 'u1') {
  const { board, f1, f2 } = newDuelBoard(firstIndex, firstIndex);
  return { board: establishControl(board, f1, owner, objectId), f1, f2 };
}
