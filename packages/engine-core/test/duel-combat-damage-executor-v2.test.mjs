import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelMatchV2, resolveDuelMulliganV2, commitDuelPlayingMutationV2,
} from '../dist/duel/core-v2.js';
import { placeDuelUnit, applyOpenDuelCleanup, beginDuelCombat } from '../dist/duel/battlefields.js';
import {
  createDuelCombatDamageAuthorityV2 as create,
  submitDuelCombatDamageChoiceV2 as submit,
  DuelCombatDamageBlockedErrorV2,
} from '../dist/duel/combat-damage-executor-v2.js';

const seats = ['a', 'b'].map(playerId => ({
  playerId,
  mainDeck: Array.from({ length: 10 }, (_, i) => ({ uid: `${playerId}-${i}`, cardId: 'unit' })),
  champion: { uid: `${playerId}-champ`, cardId: 'champ' },
  legend: { uid: `${playerId}-legend`, cardId: 'legend' },
  runeDeck: Array.from({ length: 6 }, (_, i) => ({ uid: `${playerId}-rune-${i}`, cardId: 'rune', domain: 'Fury' })),
  battlefields: Array.from({ length: 3 }, (_, i) => ({ instanceId: `${playerId}-field-${i}`,
    cardId: `${playerId}-field-print-${i}` })),
}));
const metadata = { matchId: 'damage-bridge-test', dataVersion: 'fixture', catalogDigest: 'sha256:fixture',
  roster: seats.map(seat => ({ playerId: seat.playerId, displayName: seat.playerId })) };
const type = cardId => cardId.includes('-field-print-') ? 'Battlefield' :
  ({ champ: 'Champion', legend: 'Legend', rune: 'Rune' })[cardId] ?? 'Unit';
const proven = () => ({ currentMight: 'validated', assignmentModifier: 'proven-none',
  preventionReplacement: 'proven-none', keywordPriority: 'proven-none' });
const amount = (uid, value) => ({ uid, amount: value });
const mark = (amount, responsiblePlayerId, sourceObjectIds) => ({ amount, responsiblePlayerId, sourceObjectIds });
const blocked = (call, code) => assert.throws(call,
  error => error instanceof DuelCombatDamageBlockedErrorV2 && error.code === code);

function scene(might = { a: 5, b: 3 }, existing = { a: 1, b: 2 }) {
  let match = createDuelMatchV2(seats, metadata, () => 0, type);
  match = resolveDuelMulliganV2(match, 'a', []);
  match = resolveDuelMulliganV2(match, 'b', []);
  const fieldId = match.board.battlefields[0].locationId;
  const units = Object.fromEntries(match.players.map(player => [player.playerId, player.hand[0].uid]));
  match = commitDuelPlayingMutationV2(match, draft => {
    let board = draft.board;
    for (const playerId of ['a', 'b']) board = placeDuelUnit(board,
      { objectId: units[playerId], controllerPlayerId: playerId, locationId: fieldId });
    board = beginDuelCombat(applyOpenDuelCleanup(board), fieldId);
    const unitMeta = { ...draft.unitMeta };
    for (const playerId of ['a', 'b']) unitMeta[units[playerId]] = {
      ownerPlayerId: playerId, readied: false, trait: { kind: 'card', cardId: 'unit' },
      damageMarks: existing[playerId] ? [mark(existing[playerId], playerId === 'a' ? 'b' : 'a',
        [units[playerId === 'a' ? 'b' : 'a']])] : [],
    };
    return { match: { ...draft, board, unitMeta,
      players: draft.players.map(player => ({ ...player,
        hand: player.hand.filter(card => card.uid !== units[player.playerId]) })) },
    transitions: ['a', 'b'].map(playerId => ({ uid: units[playerId],
      from: { kind: 'hand', zonePlayerId: playerId },
      to: { kind: 'board-battlefield', locationId: fieldId } })) };
  });
  let head = match;
  const service = { currentMight: unit => might[Object.keys(units).find(key => units[key] === unit.uid)],
    proveBasicCombat: proven };
  return { match, fieldId, units, service, head: () => head, setHead: value => { head = value; } };
}
function choose(ctx, authority, actor, assignments) {
  return submit(authority, { actorPlayerId: actor, orderedUIDAmounts: assignments,
    expectedStateVersion: ctx.match.stateVersion });
}

test('admitted V2 combat deals both sides atomically, preserves old marks and leaves cleanup pending', () => {
  const ctx = scene();
  const before = JSON.stringify(ctx.match);
  const authority = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  const other = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  const first = choose(ctx, authority, 'a', [amount(ctx.units.b, 5)]);
  assert.equal(first.kind, 'awaiting-defender');
  assert.equal(JSON.stringify(ctx.match), before);
  const done = choose(ctx, authority, 'b', [amount(ctx.units.a, 3)]);
  assert.equal(done.kind, 'damage-dealt');
  assert.equal(done.pendingCleanup, true);
  assert.equal(done.state.stateVersion, ctx.match.stateVersion + 1);
  assert.equal(done.state.eventSeq, ctx.match.eventSeq + 1);
  assert.deepEqual(done.state.unitMeta[ctx.units.a].damageMarks, [
    mark(1, 'b', [ctx.units.b]), mark(3, 'b', [ctx.units.b])]);
  assert.deepEqual(done.state.unitMeta[ctx.units.b].damageMarks, [
    mark(2, 'a', [ctx.units.a]), mark(5, 'a', [ctx.units.a])]);
  assert.equal(done.state.board.units.length, 2, 'lethal units await cleanup');
  assert.equal(JSON.stringify(ctx.match), before);
  blocked(() => choose(ctx, authority, 'b', [amount(ctx.units.a, 3)]), 'already-dealt');
  blocked(() => choose(ctx, other, 'a', [amount(ctx.units.b, 5)]), 'already-dealt');
  blocked(() => create(ctx.match, ctx.fieldId, ctx.service, ctx.head), 'already-dealt');
});

test('two opposing lethal assignments remain present together until cleanup', () => {
  const ctx = scene({ a: 3, b: 3 }, { a: 1, b: 1 });
  const authority = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  choose(ctx, authority, 'a', [amount(ctx.units.b, 3)]);
  const done = choose(ctx, authority, 'b', [amount(ctx.units.a, 3)]);
  assert.equal(done.state.board.units.length, 2);
  assert.deepEqual(['a', 'b'].map(id => done.state.unitMeta[ctx.units[id]].damageMarks.at(-1).amount), [3, 3]);
});

test('zero Might commits a canonical Deal clock without marks and is consumed once', () => {
  const ctx = scene({ a: 0, b: 0 }, { a: 0, b: 0 });
  const authority = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  choose(ctx, authority, 'a', []);
  const done = choose(ctx, authority, 'b', []);
  assert.deepEqual(done.state.unitMeta, ctx.match.unitMeta);
  assert.notStrictEqual(done.state, ctx.match);
  assert.equal(done.afterStateVersion, ctx.match.stateVersion + 1);
  assert.equal(done.state.eventSeq, ctx.match.eventSeq + 1);
  assert.equal(done.pendingCleanup, true);
  assert.equal(done.state.board.battlefields.find(field => field.locationId === ctx.fieldId).combat, 'active');
  blocked(() => choose(ctx, authority, 'b', []), 'already-dealt');
});

test('choice getter and Proxy head changes are rejected before Deal without consuming the battle', () => {
  const ctx = scene();
  const before = JSON.stringify(ctx.match);
  const authority = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  choose(ctx, authority, 'a', [amount(ctx.units.b, 5)]);
  const foreign = scene().match;
  blocked(() => submit(authority, { actorPlayerId: 'b', expectedStateVersion: ctx.match.stateVersion,
    get orderedUIDAmounts() {
      ctx.setHead(foreign);
      return [amount(ctx.units.a, 3)];
    },
  }), 'stale-branch');
  assert.equal(JSON.stringify(ctx.match), before);
  ctx.setHead(ctx.match);
  const assignment = new Proxy(amount(ctx.units.a, 3), {
    ownKeys(target) {
      ctx.setHead(foreign);
      return Reflect.ownKeys(target);
    },
  });
  blocked(() => choose(ctx, authority, 'b', [assignment]), 'stale-branch');
  ctx.setHead(ctx.match);
  assert.equal(choose(ctx, authority, 'b', [amount(ctx.units.a, 3)]).kind, 'damage-dealt');
});

test('source callbacks cannot issue an authority after the current head moves', () => {
  for (const method of ['proveBasicCombat', 'currentMight']) {
    const ctx = scene();
    const foreign = scene().match;
    const service = { ...ctx.service,
      [method]: (...args) => {
        ctx.setHead(foreign);
        return ctx.service[method](...args);
      },
    };
    blocked(() => create(ctx.match, ctx.fieldId, service, ctx.head), 'stale-branch');
    ctx.setHead(ctx.match);
    assert.equal(choose(ctx, create(ctx.match, ctx.fieldId, ctx.service, ctx.head),
      'a', [amount(ctx.units.b, 5)]).kind, 'awaiting-defender');
  }
});

test('shared battle ledger blocks cross-authority and provider reentry', () => {
  const ctx = scene();
  let nested = false;
  const source = { ...ctx.service, proveBasicCombat: request => {
    blocked(() => create(ctx.match, ctx.fieldId, ctx.service, ctx.head), 'in-use');
    nested = true;
    return ctx.service.proveBasicCombat(request);
  } };
  const authority = create(ctx.match, ctx.fieldId, source, ctx.head);
  assert.equal(nested, true);
  const other = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  choose(ctx, authority, 'a', [amount(ctx.units.b, 5)]);
  const done = submit(authority, { actorPlayerId: 'b', expectedStateVersion: ctx.match.stateVersion,
    get orderedUIDAmounts() {
      blocked(() => choose(ctx, other, 'a', [amount(ctx.units.b, 5)]), 'in-use');
      return [amount(ctx.units.a, 3)];
    },
  });
  assert.equal(done.kind, 'damage-dealt');
  blocked(() => choose(ctx, other, 'a', [amount(ctx.units.b, 5)]), 'already-dealt');
});

test('unknown or missing source proof never opens authority', () => {
  const ctx = scene();
  for (const proveBasicCombat of [() => null, () => ({ ...proven(), keywordPriority: 'unknown' }),
    () => { throw Error('private proof'); }]) {
    assert.throws(() => create(ctx.match, ctx.fieldId,
      { ...ctx.service, proveBasicCombat }, ctx.head));
  }
  assert.equal(choose(ctx, create(ctx.match, ctx.fieldId, ctx.service, ctx.head),
    'a', [amount(ctx.units.b, 5)]).kind, 'awaiting-defender');
});

test('wrong actor, field, version, branch and forged authority are rejected without consumption', () => {
  const ctx = scene();
  assert.throws(() => create(ctx.match, 'other-field', ctx.service, ctx.head));
  const authority = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  blocked(() => submit({}, { actorPlayerId: 'a', orderedUIDAmounts: [],
    expectedStateVersion: ctx.match.stateVersion }), 'invalid-authority');
  blocked(() => choose(ctx, authority, 'b', [amount(ctx.units.b, 5)]), 'unexpected-actor');
  blocked(() => submit(authority, { actorPlayerId: 'a', orderedUIDAmounts: [amount(ctx.units.b, 5)],
    expectedStateVersion: ctx.match.stateVersion + 1 }), 'stale-version');
  const foreign = scene();
  ctx.setHead(foreign.match);
  blocked(() => choose(ctx, authority, 'a', [amount(ctx.units.b, 5)]), 'stale-branch');
  ctx.setHead(ctx.match);
  choose(ctx, authority, 'a', [amount(ctx.units.b, 5)]);
  ctx.setHead(foreign.match);
  blocked(() => choose(ctx, authority, 'b', [amount(ctx.units.a, 3)]), 'stale-branch');
  ctx.setHead(ctx.match);
  assert.equal(choose(ctx, authority, 'b', [amount(ctx.units.a, 3)]).kind, 'damage-dealt');
});

test('provider throw and reentry reject safely; failed read and choice can retry', () => {
  const ctx = scene();
  let throwHead = true;
  const readHead = () => { if (throwHead) throw Error('private head'); return ctx.head(); };
  blocked(() => create(ctx.match, ctx.fieldId, ctx.service, readHead), 'internal-error');
  throwHead = false;
  const authority = create(ctx.match, ctx.fieldId, ctx.service, readHead);
  throwHead = true;
  blocked(() => choose(ctx, authority, 'a', [amount(ctx.units.b, 5)]), 'internal-error');
  throwHead = false;
  blocked(() => choose(ctx, authority, 'a', []), 'invalid-choice');
  const hostile = new Proxy(amount(ctx.units.b, 5), {
    ownKeys(target) {
      blocked(() => choose(ctx, authority, 'a', [amount(ctx.units.b, 5)]), 'in-use');
      return Reflect.ownKeys(target);
    },
  });
  choose(ctx, authority, 'a', [hostile]);
  assert.equal(choose(ctx, authority, 'b', [amount(ctx.units.a, 3)]).kind, 'damage-dealt');
});

test('failed atomic commit does not consume the battle or append a partial mark', () => {
  const ctx = scene({ a: Number.MAX_SAFE_INTEGER, b: 2 }, { a: 0, b: 1 });
  const before = JSON.stringify(ctx.match);
  const authority = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  choose(ctx, authority, 'a', [amount(ctx.units.b, Number.MAX_SAFE_INTEGER)]);
  const defender = [amount(ctx.units.a, 2)];
  blocked(() => choose(ctx, authority, 'b', defender), 'internal-error');
  assert.equal(JSON.stringify(ctx.match), before);
  blocked(() => choose(ctx, authority, 'b', defender), 'internal-error');
  assert.equal(JSON.stringify(ctx.match), before);
  const second = create(ctx.match, ctx.fieldId, ctx.service, ctx.head);
  assert.equal(choose(ctx, second, 'a', [amount(ctx.units.b, Number.MAX_SAFE_INTEGER)]).kind,
    'awaiting-defender');
});

test('source evaluation cannot mutate an admitted plan basis in place', () => {
  const ctx = scene();
  const before = JSON.stringify(ctx.match);
  blocked(() => create(ctx.match, ctx.fieldId, {
    ...ctx.service,
    currentMight: () => {
      ctx.match.unitMeta[ctx.units.b].damageMarks[0].amount = 0;
      return 3;
    },
  }, ctx.head), 'invalid-authority');
  assert.equal(JSON.stringify(ctx.match), before);
  assert.equal(Object.isFrozen(ctx.match.unitMeta[ctx.units.b].damageMarks[0]), true);
  assert.equal(choose(ctx, create(ctx.match, ctx.fieldId, ctx.service, ctx.head),
    'a', [amount(ctx.units.b, 5)]).kind, 'awaiting-defender');
});
