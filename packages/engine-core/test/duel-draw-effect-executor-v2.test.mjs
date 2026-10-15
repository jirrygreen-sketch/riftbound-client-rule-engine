import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelOfficialProgramRegistry, duelAbilitySourceFromCatalog,
} from '@riftbound/card-dsl/duel';
import { createDuelMatchV2, resolveDuelMulliganV2, commitDuelPlayingMutationV2 } from '../dist/duel/core-v2.js';
import {
  createDuelDrawEffectAuthorityV2, beginDuelDrawEffectV2, resumeDuelDrawEffectV2,
} from '../dist/duel/draw-effect-executor-v2.js';

const spell = {
  id: 'print:draw4', cardType: 'Spell', ability: 'Draw 4.', energy: null, power: null, might: null,
  domains: [], tags: [], canonicalCardId: 'print:draw4', name: 'Draw Four', fullName: 'Draw Four',
  localizedName: 'Draw Four', setCode: 'TST', cardNumber: '001', variant: 'normal',
};
const hold = {
  id: 'print:hold1', cardType: 'Battlefield', ability: 'When you hold here, draw 1.', energy: null,
  power: null, might: null, domains: [], tags: [], canonicalCardId: 'print:hold1', name: 'Hold One',
  fullName: 'Hold One', localizedName: 'Hold One', setCode: 'TST', cardNumber: '002', variant: 'normal',
};
const registry = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog({
  dataVersion: 'catalog:test', digest: 'sha256:test', cards: [spell, hold],
}));
const card = (uid, cardId = `print:unit:${uid}`) => ({ uid, cardId });
const seats = () => ['alice', 'bob'].map(playerId => ({
  playerId,
  mainDeck: [
    ...(playerId === 'alice' ? [card(`${playerId}:spell`, spell.id)] : []),
    ...Array.from({ length: 9 }, (_, i) => card(`${playerId}:main:${i}`)),
  ],
  champion: card(`${playerId}:champion`, `print:${playerId}:champion`),
  legend: card(`${playerId}:legend`, `print:${playerId}:legend`),
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ ...card(`${playerId}:rune:${i}`, `print:${playerId}:rune`), domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}:field:${i}`,
    cardId: i === 0 ? hold.id : `print:${playerId}:field:${i}` })),
}));
const metadata = { matchId: 'draw-effect-test', dataVersion: 'catalog:test', catalogDigest: 'sha256:test',
  roster: [{ playerId: 'alice', displayName: 'alice' }, { playerId: 'bob', displayName: 'bob' }] };
const typeOf = id => id === spell.id ? 'Other' : id === hold.id ? 'Battlefield' :
  id.includes('champion') ? 'Champion' : id.includes('legend') ? 'Legend' : id.includes('rune') ? 'Rune' :
    id.includes('field') ? 'Battlefield' : 'Unit';
let matchNumber = 0;
function playing() {
  let state = createDuelMatchV2(seats(), { ...metadata, matchId: `${metadata.matchId}:${++matchNumber}` }, bound => bound - 1, typeOf);
  state = resolveDuelMulliganV2(state, state.turnOrder[0], [], undefined);
  state = resolveDuelMulliganV2(state, state.turnOrder[1], [], undefined);
  return state;
}
function source(state, phase = 'spell-resolution') {
  const physical = state.players[0].hand.find(c => c.cardId === spell.id);
  assert.ok(physical);
  const reference = registry.reference(spell.id);
  assert.ok(reference);
  return {
    sourceUID: physical.uid, sourceZoneEpoch: state.physicalCardsByUID[physical.uid].zoneEpoch,
    controllerPlayerId: 'alice', cardId: spell.id, programId: reference.programId,
    dataVersion: reference.dataVersion, catalogDigest: reference.sourceCatalogDigest,
    effectId: `effect:${phase}:draw4`, phase,
  };
}
function authority(state, sourceValue, extra = {}) {
  let head = state;
  const authorityValue = createDuelDrawEffectAuthorityV2({ state, source: sourceValue, registry,
    readHead: () => head, ...extra });
  return { authority: authorityValue, get head() { return head; }, set head(value) { head = value; } };
}

function depleted() {
  const state = playing();
  return commitDuelPlayingMutationV2(state, draft => ({ match: { ...draft,
    players: draft.players.map(p => p.playerId === 'alice' ? { ...p,
      hand: [...p.hand, ...p.remainingMainDeck], remainingMainDeck: [] } : p) },
    transitions: draft.players[0].remainingMainDeck.map(card => ({ uid: card.uid,
      from: { kind: 'main-deck', zonePlayerId: 'alice' }, to: { kind: 'hand', zonePlayerId: 'alice' } })) }));
}

test('a Burn Out continuation rejects a later native head and cannot fork from the original authority', () => {
  const state = depleted();
  const ctx = authority(state, source(state));
  const pending = beginDuelDrawEffectV2(ctx.authority);
  assert.equal(pending.status, 'pending');
  assert.throws(() => beginDuelDrawEffectV2(ctx.authority), /consumed/);
  const later = commitDuelPlayingMutationV2(pending.state, d => ({ match: { ...d,
    players: d.players.map(p => p.playerId === 'alice' ? { ...p, hand: [...p.hand].reverse() } : p) }, transitions: [] }));
  assert.notStrictEqual(later, pending.state);
  ctx.head = later;
  assert.throws(() => resumeDuelDrawEffectV2(pending.cursor, later), /stale-head/);
  assert.throws(() => resumeDuelDrawEffectV2(pending.cursor, pending.state), /stale-head/);
});

test('resolver head drift is rejected even when the resolver keeps Burn Out pending', () => {
  const state = depleted();
  let ctx;
  ctx = authority(state, source(state), { resolveFirstBurnout: ({ state: pending }) => {
    ctx.head = commitDuelPlayingMutationV2(pending, d => ({ match: { ...d,
      frame: { ...d.frame, stateOpen: !d.frame.stateOpen } }, transitions: [] }));
    return { status: 'pending' };
  } });
  const pending = beginDuelDrawEffectV2(ctx.authority);
  ctx.head = pending.state;
  assert.throws(() => resumeDuelDrawEffectV2(pending.cursor, pending.state), /stale-head/);
});

test('Draw 4 installs one canonical transaction and ordered deck-to-hand transitions', () => {
  const state = playing();
  const sourceValue = source(state);
  const ctx = authority(state, sourceValue);
  const result = beginDuelDrawEffectV2(ctx.authority);
  assert.equal(result.status, 'complete');
  assert.equal(result.drawnCount, 4);
  assert.equal(result.state.stateVersion, state.stateVersion + 1);
  assert.equal(result.state.players[0].hand.length, state.players[0].hand.length + 4);
  assert.deepEqual(result.state.provenance.transitions.slice(-4).map(step => [step.from.kind, step.to.kind]),
    [['main-deck', 'hand'], ['main-deck', 'hand'], ['main-deck', 'hand'], ['main-deck', 'hand']]);
  assert.throws(() => beginDuelDrawEffectV2(ctx.authority), /consumed|stale/);
});

test('Burn Out stays pending without trusted resolution; clone cursor and duplicate effect are rejected', () => {
  let state = playing();
  const sourceValue = source(state);
  state = commitDuelPlayingMutationV2(state, draft => {
    const player = draft.players[0];
    const transitions = player.remainingMainDeck.map(cardValue => ({ uid: cardValue.uid,
      from: { kind: 'main-deck', zonePlayerId: 'alice' }, to: { kind: 'trash', zonePlayerId: 'alice' } }));
    return { match: { ...draft, players: draft.players.map(p => p.playerId === 'alice'
      ? { ...p, remainingMainDeck: [], trash: [...p.trash, ...player.remainingMainDeck] } : p) }, transitions };
  });
  // The source epoch is unchanged because the spell remains in hand.
  const sourceAfter = source(state);
  let head = state;
  const ctx = authority(state, sourceAfter, { randomIndex: () => 0 });
  const pending = beginDuelDrawEffectV2(ctx.authority);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.cursor.draw.step, 'awaiting-first-resolution');
  assert.deepEqual(pending.state.players[0].trash, []);
  assert.throws(() => resumeDuelDrawEffectV2(structuredClone(pending.cursor), pending.state), /unbound/);
  ctx.head = pending.state;
  const stillPending = resumeDuelDrawEffectV2(pending.cursor, pending.state);
  assert.equal(stillPending.status, 'pending');
  head = pending.state;
  assert.throws(() => createDuelDrawEffectAuthorityV2({ state: pending.state, source: sourceAfter, registry,
    readHead: () => head }), /duplicate-effect-id/);
});

test('trusted first resolution and intervention resume Burn Out, while stale head blocks continuation', () => {
  let state = playing();
  state = commitDuelPlayingMutationV2(state, draft => {
    const p = draft.players[0];
    const transitions = p.remainingMainDeck.map(cardValue => ({ uid: cardValue.uid,
      from: { kind: 'main-deck', zonePlayerId: 'alice' }, to: { kind: 'hand', zonePlayerId: 'alice' } }));
    return { match: { ...draft, players: draft.players.map(value => value.playerId === 'alice'
      ? { ...value, remainingMainDeck: [], hand: [...value.hand, ...p.remainingMainDeck] } : value) }, transitions };
  });
  const sourceValue = source(state);
  const ctx = authority(state, sourceValue, {
    randomIndex: () => 0,
    resolveFirstBurnout: ({ state: current }) => ({ firstBurnoutResolution: { kind: 'prevented', scoring: current.scoring } }),
    resolveIntervention: () => ({ interventionComplete: true }),
  });
  let result = beginDuelDrawEffectV2(ctx.authority);
  ctx.head = result.state;
  assert.equal(result.status, 'pending');
  result = resumeDuelDrawEffectV2(result.cursor, result.state);
  ctx.head = result.state;
  assert.equal(result.status, 'pending');
  assert.equal(result.cursor.draw.step, 'awaiting-intervention');
  result = resumeDuelDrawEffectV2(result.cursor, result.state);
  ctx.head = result.state;
  assert.equal(result.status, 'pending');
  assert.equal(result.state.scoring.players[1].points, 1);
  const stale = { ...result.state, stateVersion: result.state.stateVersion + 1 };
  assert.throws(() => resumeDuelDrawEffectV2(result.cursor, stale), /stale-head|unbound/);
});
