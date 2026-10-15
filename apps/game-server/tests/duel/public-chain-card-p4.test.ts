import { describe, expect, it } from 'vitest';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { createAuthoritativeDuelRuntimeP4 } from '../../src/duel/authoritative-runtime-p4.js';
import {
  createDuelRecordedRuntimeP4, createDuelReplayGateP4, digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4, DUEL_REPLAY_PROFILE_P4_SPELL, DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN
} from '../../src/duel/command-journal-p4.js';
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';
import {
  DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN,
  DUEL_RUNTIME_SEMANTIC_VERSION_P4_PUBLIC_CHAIN
} from '../../src/duel/authoritative-runtime-p4.js';
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, isDuelProjectionV3Actions1,
  isDuelPublicChainSummaryV3Actions1, type DuelCommandMessageV3Actions1 } from '@riftbound/protocol';

const reactionId = 'ogn-004-298';
const reactionText = '[Reaction] (Play any time, even before spells and abilities resolve.)\nDraw 3.';
type Runtime = ReturnType<typeof createAuthoritativeDuelRuntimeP4>;
type Deck = typeof setupAdapterFixtureDecks.a.submission;
function frontLoad(deck: Deck): Deck {
  const rest = [...deck.mainDeck];
  const index = rest.findIndex(card => card.cardId === reactionId);
  const first = rest.splice(index, 1);
  return { ...deck, mainDeck: [...first, ...rest] };
}
async function options() {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === 'Unit' ? '' : card.cardType === 'Spell'
      ? card.id === reactionId ? reactionText : 'Draw 4.' : card.ability,
    ...(card.cardType === 'Spell' ? { energy: 1 } : {}) }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: '2026-10-12-official-gallery',
    digest: 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10' } });
  let uid = 0;
  return { catalog, matchId: 'p4-public-chain-cards', randomIndex: () => 0,
    uidFactory: () => `public-chain-${String(++uid).padStart(6, '0')}`,
    roster: [
      { playerId: 'alice', displayName: 'Alice', deck: frontLoad(setupAdapterFixtureDecks.a.submission) },
      { playerId: 'bob', displayName: 'Bob', deck: frontLoad(setupAdapterFixtureDecks.b.submission) }
    ] as const };
}
function send(runtime: Runtime, actor: string, id: string, command: DuelCommandMessageV3Actions1['command']) {
  const packet: DuelCommandMessageV3Actions1 = { type: 'duel-command',
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, requestId: `${id}:request`, commandId: id,
    expectedVersion: runtime.project(actor).match.stateVersion, command };
  return runtime.dispatch(actor, packet);
}
function mulligans(runtime: Runtime) {
  for (const id of ['m1', 'm2']) {
    const view = runtime.project(null);
    if (view.match.stage !== 'setup') throw Error('setup expected');
    const actor = view.match.setup.currentMulliganOwner!;
    expect(send(runtime, actor, id, { type: 'mulligan', selectedUIDs: [] }).ack.ok).toBe(true);
  }
}
function play(runtime: Runtime, actor: string, id: string) {
  const action = runtime.project(actor).actions.find(value => value.kind === 'play-card' && value.label === '施放法术' && value.enabled);
  if (!action || action.kind !== 'play-card') throw Error('Spell action expected');
  expect(send(runtime, actor, id, { type: 'play-card', cardUID: action.cardUID, windowId: action.windowId }).ack.pending).toBe(true);
  return action.cardUID;
}
function pay(runtime: Runtime, actor: string, id: string) {
  const rune = runtime.project(actor).actions.find(value => value.kind === 'rune-energy' && value.enabled);
  if (!rune || rune.kind !== 'rune-energy') throw Error('Rune expected');
  const spent = send(runtime, actor, `${id}:rune`, { type: 'rune-energy', uid: rune.uid });
  expect(spent.ack.ok || spent.ack.pending).toBe(true);
  const payment = runtime.project(actor).actions.find(value => value.kind === 'pay-pending' && value.enabled);
  if (!payment || payment.kind !== 'pay-pending') throw Error('payment expected');
  expect(send(runtime, actor, `${id}:pay`, { type: 'pay-pending', paymentId: payment.paymentId }).ack.ok).toBe(true);
  return payment.paymentId;
}
function pass(runtime: Runtime, actor: string, id: string) {
  const action = runtime.project(actor).actions.find(value => value.kind === 'pass-priority');
  if (!action || action.kind !== 'pass-priority') throw Error('pass expected');
  expect(send(runtime, actor, id, { type: 'pass-priority', windowId: action.windowId }).ack.ok).toBe(true);
}
function chain(runtime: Runtime) {
  const view = runtime.project(null);
  if (view.match.stage !== 'playing') throw Error('playing expected');
  return view.match.frame.chain;
}

describe('P4 public Chain card contract', () => {
  it('projects real pending and finalized Spells through a two-card Reaction Chain and LIFO exit', async () => {
    const runtime = createAuthoritativeDuelRuntimeP4(await options());
    mulligans(runtime);
    const first = runtime.project('alice');
    const end = first.actions.find(value => value.kind === 'end-turn' && value.enabled);
    if (!end || end.kind !== 'end-turn') throw Error('end action expected');
    expect(send(runtime, 'alice', 'end', { type: 'end-turn', windowId: end.windowId }).ack.ok).toBe(true);
    const bobUID = play(runtime, 'bob', 'bob-spell');
    expect(chain(runtime)).toMatchObject({ active: true, itemCount: 1, pendingCount: 1,
      cards: [{ cardId: reactionId, controllerPlayerId: 'bob', status: 'pending' }] });
    const paymentId = pay(runtime, 'bob', 'bob');
    expect(chain(runtime)).toMatchObject({ active: true, itemCount: 1, pendingCount: 0,
      cards: [{ cardId: reactionId, controllerPlayerId: 'bob', status: 'finalized' }] });
    const opponent = JSON.stringify(runtime.project('alice'));
    expect(opponent).toContain(reactionId);
    expect(opponent).not.toContain(bobUID);
    expect(opponent).not.toContain(paymentId);
    pass(runtime, 'bob', 'pass-bob-1');
    play(runtime, 'alice', 'alice-reaction');
    pay(runtime, 'alice', 'alice');
    expect(chain(runtime)).toMatchObject({ active: true, itemCount: 2, pendingCount: 0,
      cards: [
        { cardId: reactionId, controllerPlayerId: 'bob', status: 'finalized' },
        { cardId: reactionId, controllerPlayerId: 'alice', status: 'finalized' }
      ] });
    expect(isDuelProjectionV3Actions1(runtime.project(null))).toBe(true);
    pass(runtime, 'alice', 'pass-alice-1');
    pass(runtime, 'bob', 'pass-bob-2');
    expect(chain(runtime)).toMatchObject({ active: true, itemCount: 1,
      cards: [{ cardId: reactionId, controllerPlayerId: 'bob', status: 'finalized' }] });
    pass(runtime, 'bob', 'pass-bob-3');
    pass(runtime, 'alice', 'pass-alice-2');
    expect(chain(runtime)).toEqual({ active: false });
    expect(chain(runtime)).toEqual({ active: false });
  }, 60_000);

  it('records schema 4 by default, forks strictly, and replays schema 3 with its explicit gate', async () => {
    const opts = await options();
    const current = createDuelRecordedRuntimeP4(opts);
    expect(current.profile).toBe(DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN);
    expect(current.archive()).toMatchObject({ schemaVersion: 4, profile: DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN,
      semanticVersion: DUEL_RUNTIME_SEMANTIC_VERSION_P4_PUBLIC_CHAIN });
    expect(current.fork().archive()).toEqual(current.archive());
    const old = createDuelRecordedRuntimeP4(opts, DUEL_REPLAY_PROFILE_P4_SPELL);
    const oldArchive = old.archive();
    expect(oldArchive).toMatchObject({ schemaVersion: 3, profile: DUEL_REPLAY_PROFILE_P4_SPELL,
      semanticVersion: 'riftbound-p4-spell-v1' });
    expect(replayDuelCommandArchiveP4(oldArchive,
      createDuelReplayGateP4(opts, digestDuelCommandArchiveP4(oldArchive), DUEL_REPLAY_PROFILE_P4_SPELL)).archive())
      .toEqual(oldArchive);
    expect(() => replayDuelCommandArchiveP4(oldArchive,
      createDuelReplayGateP4(opts, digestDuelCommandArchiveP4(oldArchive), DUEL_REPLAY_PROFILE_P4_PUBLIC_CHAIN)))
      .toThrow(/profile mismatch/);
  }, 30_000);
  it('keeps the execution profile server-owned and allows repeated printings', () => {
    expect(DUEL_RUNTIME_PROFILE_P4_PUBLIC_CHAIN).toBe('public-chain-v1');
    expect(DUEL_RUNTIME_SEMANTIC_VERSION_P4_PUBLIC_CHAIN).toContain('public-chain');
    expect(isDuelPublicChainSummaryV3Actions1({
      active: true,
      itemCount: 2,
      pendingCount: 2,
      cards: [
        { cardId: 'same-printing', controllerPlayerId: 'alice', status: 'pending' },
        { cardId: 'same-printing', controllerPlayerId: 'alice', status: 'pending' }
      ]
    }, ['alice', 'bob'])).toBe(true);
  });

  it('rejects private fields, foreign controllers and count mismatch', () => {
    const base = {
      active: true,
      itemCount: 1,
      pendingCount: 0,
      cards: [{ cardId: 'spell', controllerPlayerId: 'alice', status: 'finalized' as const }]
    };
    expect(isDuelPublicChainSummaryV3Actions1({ ...base, paymentId: 'secret' }, ['alice', 'bob'])).toBe(false);
    expect(isDuelPublicChainSummaryV3Actions1({ ...base, pendingCount: 1 }, ['alice', 'bob'])).toBe(false);
    expect(isDuelPublicChainSummaryV3Actions1({ ...base,
      cards: [{ ...base.cards[0], controllerPlayerId: 'mallory' }] }, ['alice', 'bob'])).toBe(false);
  });
});
