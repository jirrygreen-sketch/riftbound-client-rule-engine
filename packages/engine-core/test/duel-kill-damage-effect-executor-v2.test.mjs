import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelMatchV2, resolveDuelMulliganV2, commitDuelPlayingMutationV2,
  createDuelRecruitUnitV2,
} from '../dist/duel/core-v2.js';
import { projectPublicDuelUnitObjects } from '../dist/duel/unit-lifecycle.js';
import { placeDuelUnit } from '../dist/duel/battlefields.js';
import {
  createDuelKillDamageEffectAuthorityV2 as create,
  beginDuelKillDamageEffectV2 as begin,
  submitDuelKillDamageEffectChoiceV2 as submit,
  resumeDuelKillDamageEffectV2 as resume,
  DuelKillDamageEffectBlockedErrorV2,
} from '../dist/duel/kill-damage-effect-executor-v2.js';
import {
  createDuelOfficialProgramRegistry, duelAbilitySourceFromCatalog,
} from '@riftbound/card-dsl/duel';

const digest = 'sha256:local-kill-damage-fixture';
const version = 'local-kill-damage-fixture';
const effects = {
  one: 'Kill a unit.',
  all: 'Kill all units.',
  each: 'Each player kills one of their units.',
  damage: 'Deal 6 to each of up to two units.',
  unknown: 'Kill something unknown.',
};
const enemyTrigger = 'When you play me, kill an enemy unit.';
const card = (id, cardType, ability = '') => ({ id, cardType, ability,
  energy: null, power: null, might: cardType === 'Unit' ? 1 : null,
  domains: ['Colorless'], tags: [], canonicalCardId: `fixture-${id}`,
  name: id, fullName: id, localizedName: id, setCode: 'test', cardNumber: id,
  variant: 'standard' });
const catalog = { dataVersion: version, digest,
  cards: [card('unit', 'Unit'), card('trigger-unit', 'Unit', enemyTrigger),
    card('champ', 'Champion'), card('legend', 'Legend'),
    card('rune', 'Rune'), ...Object.keys(effects).map(kind =>
      card(`spell-${kind}`, 'Spell', effects[kind])),
    ...['a', 'b'].flatMap(player => Array.from({ length: 3 }, (_, i) =>
      card(`${player}-field-${i}`, 'Battlefield'))) ] };
const registry = createDuelOfficialProgramRegistry(duelAbilitySourceFromCatalog(catalog));
let serial = 0;

function scene(kind = 'one') {
  const matchId = `kill-damage-${++serial}`;
  const seats = ['a', 'b'].map(playerId => ({ playerId,
    mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-${i}`,
      cardId: playerId === 'a' && i === 0 ?
        (kind === 'trigger' ? 'trigger-unit' : `spell-${kind}`) : 'unit' })),
    champion: { uid: `${playerId}-champ`, cardId: 'champ' },
    legend: { uid: `${playerId}-legend`, cardId: 'legend' },
    runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`,
      cardId: 'rune', domain: 'Fury' })),
    battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
      cardId: `${playerId}-field-${i}` })),
  }));
  const metadata = { matchId, dataVersion: version, catalogDigest: digest,
    roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
  const types = cardId => {
    const value = catalog.cards.find(item => item.id === cardId)?.cardType;
    return value === 'Spell' ? 'Other' : value;
  };
  let state = createDuelMatchV2(seats, metadata, () => 0, types);
  state = resolveDuelMulliganV2(state, 'a', []);
  state = resolveDuelMulliganV2(state, 'b', []);
  const units = { a: state.players[0].hand.filter(item => item.cardId === 'unit').slice(0, 2).map(item => item.uid),
    b: state.players[1].hand.filter(item => item.cardId === 'unit').slice(0, 2).map(item => item.uid) };
  const sourceOnBoard = kind === 'trigger';
  state = commitDuelPlayingMutationV2(state, draft => {
    let board = draft.board;
    for (const player of ['a', 'b']) for (const uid of units[player]) {
      const locationId = board.bases.find(base => base.ownerPlayerId === player).locationId;
      board = placeDuelUnit(board, { objectId: uid, controllerPlayerId: player, locationId });
    }
    if (sourceOnBoard) {
      const locationId = board.bases.find(base => base.ownerPlayerId === 'a').locationId;
      board = placeDuelUnit(board, { objectId: 'a-0', controllerPlayerId: 'a', locationId });
    }
    const placed = new Set([...units.a, ...units.b, ...(sourceOnBoard ? ['a-0'] : [])]);
    return { match: { ...draft, board, frame: { ...draft.frame, phase: 'main' },
      legendStates: Object.fromEntries(Object.entries(draft.legendStates)
        .map(([uid, value]) => [uid, { ...value, readiness: 'ready' }])),
      players: draft.players.map(player => ({ ...player,
        hand: player.hand.filter(item => !placed.has(item.uid)),
        remainingMainDeck: player.remainingMainDeck.filter(item => !placed.has(item.uid)) })),
      unitMeta: Object.fromEntries([...placed].map(uid => [uid, {
        ownerPlayerId: uid.startsWith('a-') ? 'a' : 'b', readied: false,
        damageMarks: [], trait: { kind: 'card', cardId: uid === 'a-0' ? 'trigger-unit' : 'unit' },
      }])) },
      transitions: [...placed].map(uid => ({ uid,
        from: { kind: draft.players.some(player => player.hand.some(card => card.uid === uid))
          ? 'hand' : 'main-deck', zonePlayerId: uid.startsWith('a-') ? 'a' : 'b' },
        to: { kind: 'board-base', locationId: board.units.find(item => item.objectId === uid).locationId },
      })) };
  });
  let head = state;
  const ref = registry.reference(kind === 'trigger' ? 'trigger-unit' : `spell-${kind}`);
  const source = ref && { sourceUID: 'a-0', sourceZoneEpoch: state.physicalCardsByUID['a-0'].zoneEpoch,
    controllerPlayerId: 'a', cardId: ref.cardId, programId: ref.programId,
    dataVersion: version, catalogDigest: digest, effectId: `effect-${matchId}`,
    phase: kind === 'trigger' ? 'trigger' : 'spell-resolution', window: 'main' };
  const approved = { status: 'approved', proofId: 'local-fixture-proof' };
  const options = { state, source, registry, readHead: () => head,
    verifyCost: () => approved,
    verifyChain: () => ({ ...approved, selectionTiming: kind === 'each' ? 'resolution' : 'finalization' }),
    resolveKill: ({ plan }) => ({ ...approved, approvedUnitUIDs: plan.snapshots.map(item => item.objectId),
      targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved' }),
    resolveDamage: ({ targetUIDs, source }) => ({ ...approved,
      resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 6, responsiblePlayerId: 'a',
        sourceObjectIds: [source.sourceUID, source.effectId] })),
      targetLegality: 'approved', preventionReplacement: 'resolved', attribution: 'approved',
      requiredCleanup: 'scheduled' }),
  };
  return { state, units, source, options, head: () => head, setHead: next => { head = next; } };
}
const choose = (ctx, authority, actor, values = {}) => submit(authority,
  { expectedStateVersion: ctx.state.stateVersion, actorPlayerId: actor, ...values });
const blocked = (fn, code) => assert.throws(fn,
  error => error instanceof DuelKillDamageEffectBlockedErrorV2 && error.code === code);

test('terminal cancelled Kill and fully prevented Damage consume the effect even without a Core mutation', () => {
  for (const kind of ['one', 'damage']) {
    const ctx = scene(kind);
    let cancelled = true;
    const resolver = kind === 'one' ? {
      resolveKill: request => cancelled ? { ...ctx.options.resolveKill(request), approvedUnitUIDs: [] }
        : ctx.options.resolveKill(request),
    } : {
      resolveDamage: request => cancelled ? { ...ctx.options.resolveDamage(request), resolvedMarks: [] }
        : ctx.options.resolveDamage(request),
    };
    const authority = create({ ...ctx.options, ...resolver });
    const selected = kind === 'one' ? { targetUID: ctx.units.b[0] } : { targetUIDs: [ctx.units.b[0]] };
    const first = choose(ctx, authority, 'a', selected);
    assert.equal(first.status, 'no-change');
    assert.strictEqual(first.state, ctx.state);
    cancelled = false;
    blocked(() => choose(ctx, authority, 'a', selected), 'in-use');
    assert.equal(ctx.state.board.units.length, 4);
    assert.equal(ctx.state.unitMeta[ctx.units.b[0]].damageMarks.length, 0);
  }
});

test('empty resolver results still reject head drift before reporting a terminal no-change', () => {
  for (const kind of ['one', 'damage']) {
    const ctx = scene(kind);
    const drift = () => ctx.setHead(commitDuelPlayingMutationV2(ctx.state, d => ({
      match: { ...d, frame: { ...d.frame, stateOpen: !d.frame.stateOpen } }, transitions: [] })));
    const resolver = kind === 'one' ? {
      resolveKill: request => { drift(); return { ...ctx.options.resolveKill(request), approvedUnitUIDs: [] }; },
    } : {
      resolveDamage: request => { drift(); return { ...ctx.options.resolveDamage(request), resolvedMarks: [] }; },
    };
    const authority = create({ ...ctx.options, ...resolver });
    const selected = kind === 'one' ? { targetUID: ctx.units.b[0] } : { targetUIDs: [ctx.units.b[0]] };
    blocked(() => choose(ctx, authority, 'a', selected), 'stale-head');
    assert.notStrictEqual(ctx.head(), ctx.state);
    assert.equal(ctx.state.board.units.length, 4);
    assert.equal(ctx.state.unitMeta[ctx.units.b[0]].damageMarks.length, 0);
  }
});

test('one target Kill uses pre-exit snapshot and owner trash in one outer clock', () => {
  const ctx = scene('one');
  const authority = create(ctx.options);
  assert.equal(begin(authority).status, 'pending');
  const before = JSON.stringify(ctx.state);
  const done = choose(ctx, authority, 'a', { targetUID: ctx.units.b[0] });
  assert.equal(done.status, 'complete');
  assert.equal(done.state.stateVersion, ctx.state.stateVersion + 1);
  assert.equal(done.state.eventSeq, ctx.state.eventSeq + 1);
  assert.equal(JSON.stringify(ctx.state), before);
  assert.deepEqual(done.notices.map(item => item.kind), ['Killed', 'TrashEntry']);
  assert.ok(done.state.players[1].trash.some(item => item.uid === ctx.units.b[0]));
  assert.equal(done.attribution[0].responsiblePlayerId, 'a');
  blocked(() => choose(ctx, authority, 'a', { targetUID: ctx.units.b[0] }), 'in-use');
});

test('all Kill removes both sides simultaneously and records four ordered physical transitions', () => {
  const ctx = scene('all');
  const done = begin(create(ctx.options));
  assert.equal(done.status, 'complete');
  assert.equal(done.state.board.units.length, 0);
  assert.equal(done.notices.length, 8);
  assert.equal(done.state.provenance.transitions.length, ctx.state.provenance.transitions.length + 4);
  assert.equal(done.state.stateVersion, ctx.state.stateVersion + 1);
  assert.equal(done.state.eventSeq, ctx.state.eventSeq + 1);
  const empty = begin(create({ ...ctx.options, state: done.state,
    source: { ...ctx.source, effectId: 'all-empty' }, readHead: () => done.state }));
  assert.equal(empty.status, 'no-change');
  assert.strictEqual(empty.state, done.state);
});

test('each player submits only their own unit at resolution', () => {
  const ctx = scene('each');
  const authority = create(ctx.options);
  assert.equal(begin(authority).status, 'pending');
  blocked(() => choose(ctx, authority, 'a', { targetUID: ctx.units.b[0] }), 'illegal-target');
  assert.equal(choose(ctx, authority, 'b', { targetUID: ctx.units.b[0] }).status, 'pending');
  const done = choose(ctx, authority, 'a', { targetUID: ctx.units.a[0] });
  assert.equal(done.status, 'complete');
  assert.deepEqual(done.attribution.map(item => item.responsiblePlayerId), ['a', 'b']);
  assert.equal(done.state.board.units.length, 2);
});

test('source-bound unit-enter trigger admits only an enemy target', () => {
  const ctx = scene('trigger');
  const authority = create(ctx.options);
  assert.equal(begin(authority).status, 'pending');
  blocked(() => choose(ctx, authority, 'a', { targetUID: ctx.units.a[0] }), 'illegal-target');
  const done = choose(ctx, authority, 'a', { targetUID: ctx.units.b[0] });
  assert.equal(done.status, 'complete');
  assert.equal(done.state.board.units.some(unit => unit.objectId === ctx.units.b[0]), false);
  assert.equal(done.state.board.units.some(unit => unit.objectId === 'a-0'), true);
});

test('Damage marks two distinct units with responsibility, source and separate cleanup obligation', () => {
  const ctx = scene('damage');
  const authority = create(ctx.options);
  const result = choose(ctx, authority, 'a', { targetUIDs: [ctx.units.a[0], ctx.units.b[0]] });
  assert.equal(result.status, 'complete');
  assert.equal(result.state.stateVersion, ctx.state.stateVersion + 1);
  assert.equal(result.state.eventSeq, ctx.state.eventSeq + 1);
  for (const uid of [ctx.units.a[0], ctx.units.b[0]]) {
    assert.deepEqual(result.state.unitMeta[uid].damageMarks.at(-1),
      { amount: 6, responsiblePlayerId: 'a', sourceObjectIds: [ctx.source.sourceUID, ctx.source.effectId] });
  }
  assert.equal(result.state.board.units.length, 4, 'lethal cleanup is separate');
  assert.equal(JSON.stringify(projectPublicDuelUnitObjects(result.state)).includes(ctx.source.effectId), false);
  blocked(() => choose(ctx, create({ ...ctx.options, source: { ...ctx.source, effectId: 'damage-duplicate-targets' } }),
    'a', { targetUIDs: [ctx.units.a[0], ctx.units.a[0]] }), 'illegal-target');
});

test('unknown source, forged authority, clone, stale epoch/head and reentry fail closed', () => {
  const ctx = scene('one');
  blocked(() => create({ ...ctx.options, source: { ...ctx.source, cardId: 'spell-unknown' } }),
    'source-not-live');
  blocked(() => create({ ...ctx.options, source: { ...ctx.source, sourceZoneEpoch: 99 } }),
    'source-not-live');
  const authority = create(ctx.options);
  blocked(() => begin(structuredClone(authority)), 'invalid-authority');
  blocked(() => choose(ctx, {}, 'a', { targetUID: ctx.units.b[0] }), 'invalid-authority');
  const foreign = scene('one').state;
  ctx.setHead(foreign);
  blocked(() => begin(authority), 'stale-head');
  ctx.setHead(ctx.state);
  assert.equal(begin(authority).status, 'pending');
  blocked(() => create(ctx.options), 'duplicate-effect-id');
  blocked(() => choose(ctx, authority, 'a', { targetUID: 'missing' }), 'illegal-target');
  const reentry = { ...ctx.options, source: { ...ctx.source, effectId: `${ctx.source.effectId}-reentry` },
    resolveKill: request => {
      blocked(() => choose(ctx, reentrant, 'a', { targetUID: ctx.units.b[0] }), 'in-use');
      return ctx.options.resolveKill(request);
    } };
  const reentrant = create(reentry);
  assert.equal(choose(ctx, reentrant, 'a', { targetUID: ctx.units.b[0] }).status, 'complete');
});

test('missing closure proof remains pending and zero damage has no committed change', () => {
  const ctx = scene('damage');
  const missing = create({ ...ctx.options, verifyChain: undefined });
  assert.equal(choose(ctx, missing, 'a', { targetUIDs: [] }).reason, 'chain-proof-required');
  const zero = create({ ...ctx.options, source: { ...ctx.source, effectId: 'zero-damage' } });
  const result = choose(ctx, zero, 'a', { targetUIDs: [] });
  assert.equal(result.status, 'no-change');
  assert.strictEqual(result.state, ctx.state);
  assert.equal(ctx.state.eventSeq, result.state.eventSeq);
  const incomplete = create({ ...ctx.options, source: { ...ctx.source, effectId: 'incomplete-damage' },
    resolveDamage: () => ({ status: 'approved', proofId: 'local', resolvedMarks: [{
      uid: ctx.units.b[0], amount: 6, responsiblePlayerId: 'a', sourceObjectIds: [ctx.source.sourceUID],
    }] }) });
  assert.equal(choose(ctx, incomplete, 'a', { targetUIDs: [ctx.units.b[0]] }).status, 'pending');
});

test('resolved prevention amount is marked exactly and missing source attribution is blocked', () => {
  const ctx = scene('damage');
  const reduced = create({ ...ctx.options, resolveDamage: ({ targetUIDs, source }) => ({
    status: 'approved', proofId: 'local-partial-prevention', targetLegality: 'approved',
    preventionReplacement: 'resolved', attribution: 'approved', requiredCleanup: 'scheduled',
    resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 2, responsiblePlayerId: 'a',
      sourceObjectIds: [source.sourceUID, source.effectId] })),
  }) });
  const result = choose(ctx, reduced, 'a', { targetUIDs: [ctx.units.b[0]] });
  assert.equal(result.state.unitMeta[ctx.units.b[0]].damageMarks[0].amount, 2);
  const bad = create({ ...ctx.options, source: { ...ctx.source, effectId: 'bad-attribution' },
    resolveDamage: ({ targetUIDs }) => ({ status: 'approved', proofId: 'local',
      targetLegality: 'approved', preventionReplacement: 'resolved', attribution: 'approved',
      requiredCleanup: 'scheduled', resolvedMarks: targetUIDs.map(uid => ({ uid, amount: 6,
        responsiblePlayerId: 'a', sourceObjectIds: ['unrelated'] })) }) });
  blocked(() => choose(ctx, bad, 'a', { targetUIDs: [ctx.units.b[0]] }), 'internal-error');
});

test('canceled Kill is a no-change plan; a genuine token Kill waits for Core token history API', () => {
  const ctx = scene('one');
  const cancel = create({ ...ctx.options, resolveKill: () => ({ status: 'approved', proofId: 'local',
    approvedUnitUIDs: [], targetLegality: 'approved', deathknell: 'resolved', replacements: 'resolved' }) });
  const noChange = choose(ctx, cancel, 'a', { targetUID: ctx.units.b[0] });
  assert.equal(noChange.status, 'no-change');
  assert.strictEqual(noChange.state, ctx.state);

  const base = ctx.state.board.bases.find(item => item.ownerPlayerId === 'a').locationId;
  const request = { kind: 'recruit', tokenUID: 'recruit-test', sourceEffectId: 'recruit-create',
    eventId: 'recruit-birth', sourceUID: ctx.source.sourceUID,
    sourceZoneEpoch: ctx.source.sourceZoneEpoch, sourceMode: 'current',
    effectControllerPlayerId: 'a', controllerPlayerId: 'a', locationId: base,
    readied: false, name: 'Recruit', baseMight: 1, tags: ['Recruit'] };
  const tokenState = createDuelRecruitUnitV2(ctx.state, request, ({ match, request: input }) => ({
    ...input, matchId: match.matchId, dataVersion: match.dataVersion,
    catalogDigest: match.catalogDigest, sourceProofId: 'local-token-birth' }));
  const tokenAuthority = create({ ...ctx.options, state: tokenState,
    source: { ...ctx.source, effectId: 'kill-recruit-test' }, readHead: () => tokenState });
  const pending = submit(tokenAuthority, { expectedStateVersion: tokenState.stateVersion,
    actorPlayerId: 'a', targetUID: 'recruit-test' });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.reason, 'multi-token-kill-core-api-required');
  assert.strictEqual(pending.state, tokenState);
  assert.equal(tokenState.board.units.some(item => item.objectId === 'recruit-test'), true);
});
