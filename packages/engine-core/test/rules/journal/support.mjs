// Shared harness for the RIFT-629 journal chapter golden tests.
//
// Scenario source: docs/rules/scenarios/journal.yaml (rulesetVersion core-1.5).
//
// Objects under test (merged new layers only):
//   * `@riftbound/protocol` journal-v1 — the frozen v1 format validator
//     (contract 4 “journal format” + the RIFT-47 v1 extension);
//   * src/game/lifecycle.ts        — createMatch/concede deterministic match lifecycle;
//   * src/turn/flow.ts (TurnFlow)  — CR v1.5 turn driver over ChainEngine;
//   * src/chain/engine.ts          — HOT FEPR, Priority and chain structure;
//   * src/events/action-adapter.ts — the single event pipeline host;
//   * src/projection/v2/project-for.ts — the per-view privacy boundary.
//
// `src/duel/` and `src/core/` are never the tested object; the chapter is about
// journal/replay/restart mechanics, which the merged layers expose as:
// deterministic match construction from a seed + the same command sequence,
// transactional rollback of a rejected command, and viewer-scoped projections.
// Server-side pieces (room sessions, resume cursors, command identity) are
// recorded per scenario as `test.todo` instead of being approximated here.
import {
  JOURNAL_FORMAT,
  JOURNAL_FORMAT_VERSION,
  JOURNAL_RULESET_VERSION,
  computeJournalDigest,
  computeJournalHeaderDigest,
  computeJournalRecordDigest,
  createJournalRecordIntegrity,
} from '@riftbound/protocol';
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { AwaitChoice } from '../../../dist/effects/contract.js';
import { bindResolveContext, createActionPipelineHost } from '../../../dist/events/action-adapter.js';
import { createMatch, concede } from '../../../dist/game/lifecycle.js';
import { TurnFlow } from '../../../dist/turn/flow.js';
import { projectFor } from '../../../dist/projection/v2/index.js';

/** card-dsl constant expression used by every explicit cost/argument. */
export const c = value => ({ kind: 'constant', value });

// ---------------------------------------------------------------------------
// journal v1 format fixtures (protocol validator is the frozen authority).
// ---------------------------------------------------------------------------

export const JOURNAL_DIGEST = 'a'.repeat(64);

/**
 * A conforming journal v1 header. Field set follows the frozen v1 extension in
 * contract section 4 (matchId/roomId, roster/trusted-deck digests, creation
 * transcript); the scenario samples only carry the pre-extension minimum.
 */
export function journalHeader(overrides = {}) {
  const header = {
    format: JOURNAL_FORMAT,
    formatVersion: JOURNAL_FORMAT_VERSION,
    engineVersion: '1.0.0+aaa0000',
    rulesetVersion: JOURNAL_RULESET_VERSION,
    matchId: 'match-1',
    roomId: 'room-1',
    catalogDigest: JOURNAL_DIGEST,
    rosterDigest: JOURNAL_DIGEST,
    trustedDeckDigest: JOURNAL_DIGEST,
    seed: 'seed-1',
    seats: [{ playerId: 'p1', name: 'A' }, { playerId: 'p2', name: 'B' }],
    createdAt: '2026-10-15T00:00:00Z',
    creation: {
      entropy: [{ kind: 'uid', value: 'uid-setup' }],
      deterministicSeed: 'seed-1',
      uidSeed: 'uid-seed-1',
      creator: 'game-server',
    },
  };
  return { ...header, ...overrides };
}

/** One conforming journal v1 command entry body (without its digest link). */
export function journalEntry(overrides = {}) {
  return {
    kind: 'entry',
    seq: 1,
    playerId: 'p1',
    actor: 'p1',
    requestId: 'request-1',
    commandId: 'cmd-1',
    command: { type: 'pass' },
    payload: { type: 'pass' },
    acceptedAt: '2026-10-15T00:00:01Z',
    expectedStateVersion: 0,
    expectedRoomVersion: 0,
    appliedStateVersion: 1,
    roomVersion: 1,
    eventSeq: 1,
    result: { accepted: true, appliedStateVersion: 1 },
    publicReceipt: { type: 'command-result', commandId: 'cmd-1', appliedVersion: 1 },
    duplicate: false,
    rejection: null,
    entropyConsumed: [],
    projectionDigestByViewer: { p1: JOURNAL_DIGEST, p2: JOURNAL_DIGEST },
    ...overrides,
  };
}

/** Seal entry bodies into the parent/current digest chain the validator requires. */
export function sealEntries(header, inputs) {
  let parentDigest = computeJournalHeaderDigest(header);
  return inputs.map(input => {
    const { integrity: _ignored, ...body } = input;
    const integrity = createJournalRecordIntegrity(body, parentDigest);
    parentDigest = integrity.currentDigest;
    return { ...body, integrity };
  });
}

export function journalFrom(header, inputs) {
  const last = inputs.at(-1);
  const journal = {
    header,
    head: {
      stateVersion: last ? (last.kind === 'entry' ? last.appliedStateVersion : last.stateVersion) : 0,
      eventSeq: last?.eventSeq ?? 0,
      roomVersion: last?.roomVersion ?? 0,
      parentJournalDigest: null,
      journalDigest: JOURNAL_DIGEST,
      stateDigest: JOURNAL_DIGEST,
      privateStateDigest: JOURNAL_DIGEST,
    },
    entries: inputs,
    integrity: {
      parentDigest: null,
      currentDigest: JOURNAL_DIGEST,
      revision: 0,
      nonce: 'nonce-0',
      protectedHeadReference: { revision: 0, nonce: 'nonce-0' },
    },
  };
  const digest = computeJournalDigest(journal);
  journal.head.journalDigest = digest;
  journal.integrity.currentDigest = digest;
  return journal;
}

/**
 * Recompute the parent/current digest links of a raw entry list without applying
 * the seq / commandId / seat rules. Negative format scenarios need to prove the
 * rejection comes from the structural rule under test, not from a broken chain.
 */
export function verifyRawDigestChain(header, entries) {
  let parentDigest = computeJournalHeaderDigest(header);
  for (const entry of entries) {
    if (entry.integrity?.parentDigest !== parentDigest) return false;
    if (entry.integrity?.currentDigest !== computeJournalRecordDigest(entry, parentDigest)) return false;
    parentDigest = entry.integrity.currentDigest;
  }
  return true;
}

/** A conforming two-entry journal used as the positive baseline. */
export function validJournal() {
  const header = journalHeader();
  const entries = sealEntries(header, [
    journalEntry(),
    journalEntry({
      seq: 2, playerId: 'p2', actor: 'p2', requestId: 'request-2', commandId: 'cmd-2',
      expectedStateVersion: 1, expectedRoomVersion: 1, appliedStateVersion: 2, roomVersion: 2,
      eventSeq: 2, publicReceipt: { type: 'command-result', commandId: 'cmd-2', appliedVersion: 2 },
    }),
  ]);
  return journalFrom(header, entries);
}

// ---------------------------------------------------------------------------
// TurnFlow fixture over the reference test kernel (no duel runtime).
// ---------------------------------------------------------------------------

/**
 * Two-player world wired exactly like the other merged-layer chapters:
 * reference kernel → action pipeline host → TurnFlow → ChainEngine → pipeline.
 */
export function journalFixture({ fields, setup, deckSize = 8 } = {}) {
  const builder = world().player('A').player('B').base('source', { might: 4, energy: 0, power: [] });
  for (const player of ['A', 'B']) {
    builder.deck(Array.from({ length: deckSize }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: deckSize }, (_, index) => `${player}:rune:${index}`), { owner: player });
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
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ['A', 'B'],
    battlefields: fields ?? [{ id: 'bf1', controller: null }, { id: 'bf2', controller: null }],
  });
  /** Free-cost spell draft so the chain can hold a finalized, unresolved item. */
  const freeSpell = (id, controller = 'A', sourceId = 'source') => ({
    id,
    controller,
    source: kernel.getObject(sourceId),
    kind: 'spell',
    speed: 'normal',
    body: [],
    cost: { id: `cost:${id}`, cost: { energy: c(0), power: c([]) } },
  });
  /** Rules-generated pending ability (bypasses the discretionary timing check). */
  const triggered = (id, controller = 'B', sourceId = 'source') => ({
    id,
    controller,
    source: kernel.getObject(sourceId),
    kind: 'triggered',
    speed: 'reaction',
    body: [],
  });
  return { kernel, host, flow, answers, choose, freeSpell, triggered };
}

/** Committed pipeline events in commit order. */
export const eventsOf = target => target.flow.chain.pipeline.events;

/** Authoritative chain state, comparable before/after a rejected command. */
export function chainState(f) {
  return {
    events: eventsOf(f).map(event => [event.eventId, event.timingPoint, event.player ?? null, event.details?.item ?? null]),
    items: f.flow.chain.items.map(item => ({ id: item.id, status: item.status, controller: item.controller })),
    priority: f.flow.chain.priority,
    turnState: f.flow.chain.turnState,
    world: f.kernel.stateForTest(),
  };
}

/**
 * Run a draft the engine must refuse and prove the refused command left *no*
 * trace: not in the committed event sequence, not in the chain, not in the world
 * state, and without moving Priority. This is the engine-level half of
 * “rejected commands are never written” (contract 4 journal-entry).
 */
export function refusedDraftLeavesNoTrace(f, draft) {
  const before = chainState(f);
  let error = null;
  try {
    f.flow.execute(draft);
  } catch (cause) {
    error = cause;
  }
  return { error, before, after: chainState(f), unchanged: JSON.stringify(before) === JSON.stringify(chainState(f)) };
}

// ---------------------------------------------------------------------------
// Deterministic match lifecycle fixture (createMatch over the test kernel).
// ---------------------------------------------------------------------------

export function matchCard(id, types = ['unit']) {
  return { id, cardId: 'card:' + id, types };
}

/** 16-card main deck + 4 runes + legend/champion + three candidate battlefields. */
export function matchDeck() {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => matchCard('a' + index)),
    runeDeck: Array.from({ length: 4 }, (_, index) => matchCard('r' + index, ['rune'])),
    championLegend: matchCard('legend', ['legend']),
    chosenChampion: matchCard('champion', ['champion']),
    battlefields: [matchCard('bf1', ['battlefield']), matchCard('bf2', ['battlefield']), matchCard('bf3', ['battlefield'])],
  };
}

/**
 * A headless match over the reference kernel. Same `seed` + same setup inputs
 * reconstruct the same opening state, which is what journal replay means at
 * this layer (`contract:4#replay` — recompute from header + command sequence).
 */
export function newMatch({ seed = 'journal-seed-1', decks } = {}) {
  const kernel = world().player('A').player('B').build();
  const answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    throw new AwaitChoice(request);
  };
  const pipelineHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(pipelineHost)), pipelineHost, {
    player: id => kernel.player(id),
  });
  const match = createMatch({
    decks: decks ?? [matchDeck(), matchDeck()],
    seed,
    firstPlayer: 0,
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    host,
  });
  return { match, kernel, host, answers, concede: player => concede(match, player) };
}

export function zoneCardIds(kernel, player, zone) {
  return kernel.objectsInZone(player, zone).map(ref => kernel.getObject(ref.id).cardId);
}

/** Authoritative, comparable view of a live or replayed match. */
export function matchState({ match, kernel, host }) {
  return {
    phase: match.flow.phase,
    turnPlayer: match.flow.turnPlayer,
    turn: match.flow.turn,
    winner: match.result().winner,
    players: ['A', 'B'].map(player => host.player(player)),
    battlefields: match.flow.battlefields.map(field => ({
      id: field.id, controller: field.controller, contestedBy: field.contestedBy, staged: field.staged,
    })),
    zones: Object.fromEntries(['A', 'B'].flatMap(player => ['hand', 'deck', 'rune-deck', 'trash', 'base', 'board'].map(
      zone => [`${player}:${zone}`, zoneCardIds(kernel, player, zone)]))),
    priority: match.flow.chain.priority,
    chain: match.flow.chain.items.map(item => ({
      id: item.id, status: item.status, controller: item.controller, kind: item.kind,
      object: item.object, source: item.source.ref,
    })),
  };
}

/** Committed event sequence (timing point + actor), the replay-visible trace. */
export function matchEvents(match) {
  return match.events().map(event => [event.eventId, event.timingPoint, event.player ?? null]);
}

/**
 * Projection-v2 input built from the authoritative kernel, never from a DTO.
 * Objects carry an explicit `id`/`zoneEntryId` pair so the privacy boundary is
 * exercised on real identities instead of a synthesized fallback id.
 */
export function projectionInput({ match, kernel }, { stateVersion = 0 } = {}) {
  const objects = kernel.objects.map(object => ({
    id: object.ref.id,
    zoneEntryId: object.ref.zoneEntryId,
    zone: object.zone,
    owner: object.owner,
    controller: object.controller,
    cardId: object.cardId,
    name: object.name,
    types: object.types,
    might: object.might,
    faceDown: object.faceDown,
    location: object.location,
  }));
  const refs = (player, zone) => kernel.objectsInZone(player, zone).map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
  return {
    stateVersion,
    eventSeq: match.events().length,
    phase: match.flow.phase,
    turn: match.flow.turn,
    objects,
    players: ['A', 'B'].map(player => ({
      id: player,
      energy: kernel.player(player).energy,
      score: kernel.player(player).score,
      hand: refs(player, 'hand'),
      deck: refs(player, 'deck'),
      runeDeck: refs(player, 'rune-deck'),
      trash: refs(player, 'trash'),
      base: refs(player, 'board').filter(ref => kernel.getObject(ref.id).location?.type === 'base'),
    })),
  };
}

export { projectFor };
