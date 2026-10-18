import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  canonicalJournalJson, computeJournalDigest, computeJournalHeaderDigest, createJournalRecordIntegrity,
  isJournal, parseJournalJsonl, serializeJournalJsonl,
} from '../../../../protocol/dist/journal-v1.js';
import { executeJournalGameCommand } from '../../../dist/game/commands/index.js';
import { projectFor } from '../../../dist/projection/v2/index.js';
import { setup, state } from './helpers.mjs';

const hash = value => createHash('sha256').update(canonicalJournalJson(value)).digest('hex');
const viewers = ['A', 'B', 'spectator'];
const engineVersion = '@riftbound/engine-core/0.1.0+RIFT-761';

function projections(f) {
  const objects = f.kernel.objects.map(object => ({ ...object, id: object.ref.id }));
  const inZone = (player, zone) => f.kernel.objectsInZone(player, zone).map(ref => objects.find(object => object.id === ref.id));
  const input = {
    stateVersion: f.context().stateVersion, eventSeq: f.match.events().length,
    phase: f.match.flow.phase, turn: { number: f.match.flow.turn, player: f.match.flow.turnPlayer },
    priorityPlayerId: f.match.flow.chain.priority, focusPlayerId: f.match.flow.chain.focus,
    // State projections use the real authority. The complete event stream is
    // compared separately in every state() snapshot, including optional fields.
    // Raw event projections currently contain undefined values, so cannot be
    // fed to the shared canonical JSON digest (see the integration request).
    objects, chain: f.match.flow.chain.items,
    players: ['A', 'B'].map(id => ({
      ...f.kernel.player(id), id, name: id,
      ...Object.fromEntries([
        ['hand', 'hand'], ['deck', 'deck'], ['runeDeck', 'rune-deck'], ['trash', 'trash'],
        ['banishment', 'banishment'], ['board', 'board'], ['runeZone', 'rune-zone'],
        ['championZone', 'champion-zone'], ['legendZone', 'legend-zone'],
      ].map(([key, zone]) => [key, inZone(id, zone)])),
    })),
  };
  return viewers.map(viewer => projectFor(input, viewer));
}

/** Records actual accepted commands and their results; never supplies rules state. */
function recordGame() {
  const f = setup({ summonRecruit: true });
  const header = {
    format: 'riftbound-journal', formatVersion: 1, engineVersion, rulesetVersion: 'core-1.5',
    matchId: 'match:RIFT-761', roomId: 'room:RIFT-761', catalogDigest: hash(f.decks),
    rosterDigest: hash(['A', 'B']), trustedDeckDigest: hash(f.decks), seed: 'RIFT-761',
    seats: ['A', 'B'].map(playerId => ({ playerId, name: playerId })), createdAt: '2026-10-18T00:00:00.000Z',
    creation: { entropy: [], deterministicSeed: 'RIFT-761', uidSeed: null, creator: 'RIFT-761-test' },
  };
  const entries = [];
  const snapshots = [state(f)];
  const views = [projections(f)];
  let parent = computeJournalHeaderDigest(header);
  const append = (playerId, command) => {
    const version = f.context().stateVersion;
    const commandId = `journal-command:${entries.length + 1}`;
    const wire = command.type === 'play-card'
      ? { type: 'play', cardObjectId: command.instanceId }
      : { type: command.type };
    const result = f.submit(playerId, { ...wire, commandId, stateVersion: version });
    const currentViews = projections(f);
    const body = {
      kind: 'entry', seq: entries.length + 1, playerId, actor: playerId,
      requestId: `request:${entries.length + 1}`, commandId, command, payload: structuredClone(command),
      acceptedAt: header.createdAt, expectedStateVersion: version, expectedRoomVersion: version,
      appliedStateVersion: f.context().stateVersion, roomVersion: f.context().stateVersion,
      eventSeq: f.match.events().length, result, publicReceipt: structuredClone(result),
      duplicate: false, rejection: null, entropyConsumed: [],
      projectionDigestByViewer: Object.fromEntries(viewers.map((viewer, i) => [viewer, hash(currentViews[i])])),
    };
    const integrity = createJournalRecordIntegrity(body, parent);
    entries.push({ ...body, integrity }); parent = integrity.currentDigest;
    snapshots.push(state(f)); views.push(currentViews);
  };
  const play = player => {
    const card = f.kernel.objects.find(object => object.zone === 'hand' && object.controller === player && object.types.includes('unit'));
    assert.ok(card);
    append(player, { type: 'play-card', instanceId: card.ref.id, targets: [] });
    let budget = 0;
    while (f.match.flow.chain.items.length) {
      assert.ok(++budget < 50, 'actual card program must resolve');
      append(f.match.flow.chain.priority, { type: 'pass' });
    }
    return card.ref.id;
  };
  const scout = play('A');
  assert.deepEqual(f.kernel.getObject(scout).location, { type: 'base', player: 'A' });
  const recruit = f.kernel.objects.find(object => object.isToken && object.controller === 'A' && object.zone === 'board' && object.name === 'Recruit');
  assert.ok(recruit);
  assert.deepEqual(recruit.location, { type: 'battlefield', id: f.fields[0] });
  assert.equal(recruit.energy, null); assert.equal(recruit.power, null);
  assert.equal(f.match.flow.chain.turnState, 'showdown-open');
  append('A', { type: 'pass' }); append('B', { type: 'pass' });
  assert.equal(f.kernel.player('A').score, 1);
  append('A', { type: 'pass' });
  play('B');
  let budget = 0;
  while (!f.match.result().winner) {
    assert.ok(++budget < 20, 'normal turn progression must reach victory');
    append(f.match.flow.turnPlayer, { type: 'pass' });
  }
  assert.deepEqual(f.match.result(), { winner: 'A', turnNumber: 15 });
  assert.deepEqual(['A', 'B'].map(player => f.kernel.player(player).score), [8, 0]);
  const journal = {
    header, entries,
    head: {
      stateVersion: f.context().stateVersion, eventSeq: f.match.events().length, roomVersion: f.context().stateVersion,
      parentJournalDigest: null, journalDigest: '0'.repeat(64),
      stateDigest: hash(views.at(-1)[2]), privateStateDigest: hash(views.at(-1).slice(0, 2)),
    },
    integrity: { parentDigest: null, currentDigest: '0'.repeat(64), revision: 0, nonce: 'RIFT-761',
      protectedHeadReference: { revision: 0, nonce: 'RIFT-761' } },
  };
  journal.integrity.currentDigest = computeJournalDigest(journal);
  journal.head.journalDigest = journal.integrity.currentDigest;
  assert.equal(isJournal(journal), true);
  return { f, journal, snapshots, views };
}

test('RIFT-761: an eight-point match replays an unchanged journal-v1 with identical state and all viewer digests at every command', () => {
  const recorded = recordGame();
  const serialized = serializeJournalJsonl(recorded.journal);
  const journal = parseJournalJsonl(serialized); // Existing strict digest/actor/version validation.
  assert.deepEqual(journal, recorded.journal);
  assert.deepEqual(new Set(journal.entries.map(entry => entry.command.type)), new Set(['play-card', 'pass']));
  const replay = setup({ summonRecruit: true });
  assert.equal(hash(replay.decks), journal.header.trustedDeckDigest);
  assert.equal(replay.match.seed, recorded.f.match.seed);
  assert.deepEqual(state(replay), recorded.snapshots[0]);
  for (const [index, entry] of journal.entries.entries()) {
    const result = replay.submitJournal(entry);
    assert.deepEqual(result, entry.result, `receipt at journal sequence ${entry.seq}`);
    assert.equal(replay.context().stateVersion, entry.appliedStateVersion);
    assert.equal(replay.match.events().length, entry.eventSeq);
    assert.deepEqual(state(replay), recorded.snapshots[index + 1], `full state at journal sequence ${entry.seq}`);
    const currentViews = projections(replay);
    assert.deepEqual(currentViews, recorded.views[index + 1]);
    for (const [i, viewer] of viewers.entries()) assert.equal(hash(currentViews[i]), entry.projectionDigestByViewer[viewer]);
  }
  assert.deepEqual(state(replay), state(recorded.f));
  assert.equal(replay.kernel.player('A').score, 8);
  assert.equal(replay.match.events().filter(event => event.timingPoint === 'conquer').length, 1);
  assert.equal(replay.match.events().filter(event => event.timingPoint === 'hold').length, 7);
  assert.equal(replay.match.events().filter(event => event.timingPoint === 'combat-start').length, 0);
  assert.equal(serializeJournalJsonl(journal), serialized, 'replay never upgrades or rewrites the log');

  const corrupted = structuredClone(recorded.journal);
  corrupted.entries[0].command.instanceId = 'tampered';
  assert.equal(isJournal(corrupted), false);
  assert.throws(() => parseJournalJsonl(JSON.stringify(corrupted)));
});

test('RIFT-761: journal compatibility rejects malformed, duplicate, stale and unsupported records before state changes', () => {
  const recorded = recordGame();
  const f = setup({ summonRecruit: true }); const before = state(f);
  const first = recorded.journal.entries[0];
  assert.throws(() => executeJournalGameCommand(f.context(), { ...first, command: { type: 'activate' } }), error => error.code === 'invalid-journal-entry');
  assert.throws(() => executeJournalGameCommand(f.context(), { ...first, duplicate: true }), error => error.code === 'journal-duplicate');
  assert.throws(() => executeJournalGameCommand(f.context(), { ...first, playerId: 'spectator', actor: 'spectator' }), error => error.code === 'unknown-player');
  assert.throws(() => executeJournalGameCommand({ ...f.context(), stateVersion: 1 }, first), error => error.code === 'stale-version');
  const targeted = { ...first.command, targets: [{ targetKind: 'object', targetId: 'hidden' }] };
  assert.throws(() => executeJournalGameCommand(f.context(), { ...first, command: targeted, payload: targeted }), error => error.code === 'command-selections');
  const prompt = { type: 'respond-to-prompt', promptId: 'unissued', optionId: '0', targets: [] };
  assert.throws(() => executeJournalGameCommand(f.context(), { ...first, command: prompt, payload: prompt }), error => error.code === 'choice-continuation');
  assert.deepEqual(state(f), before);
  const concede = { type: 'concede' };
  assert.equal(f.submitJournal({ ...first, command: concede, payload: concede }).winnerPlayerId, 'B');
  const ended = state(f);
  const pass = { type: 'pass' };
  assert.throws(() => executeJournalGameCommand(f.context(), { ...first, command: pass, payload: pass }), error => error.code === 'game-over');
  assert.deepEqual(state(f), ended);
});
