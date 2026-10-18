import test from 'node:test';
import assert from 'node:assert/strict';
import { assignDamage, declareAttack, declareDefense, executeGameCommand, inspectStandardMove, move, moveUnits, resolveCombatDamage } from '../../../dist/game/commands/index.js';
import { setup, state, readyUnits } from './helpers.mjs';

test('RIFT-761: formation validation uses real readiness and never partially exhausts a valid member', () => {
  const f = setup();
  const [ready] = readyUnits(f);
  const exhausted = f.play();
  const before = state(f);
  const to = { zone: 'battlefield', locationId: f.fields[0] };
  assert.throws(() => moveUnits(f.context(), 'A', [ready, exhausted], to), error => error.code === 'illegal-move');
  assert.deepEqual(state(f), before);
  assert.deepEqual(inspectStandardMove(f.context(), 'A', [ready], to), {
    objects: [f.kernel.ref(ready)], to: { type: 'battlefield', id: f.fields[0] }, execution: 'blocked', code: 'standard-move-transaction',
  });
  assert.throws(() => moveUnits(f.context(), 'A', [ready], to), error => error.status === 'blocked' && error.code === 'standard-move-transaction');
  assert.deepEqual(state(f), before);
});

test('RIFT-761: v2 move rejects arbitrary zone teleports and leaves state unchanged', () => {
  const f = setup(); const [id] = readyUnits(f);
  const before = state(f);
  for (const to of [{ zone: 'trash' }, { zone: 'hand' }, { zone: 'board' }, { zone: 'chain' }, { zone: 'banishment' }, { zone: 'deck', position: 'top' }, { zone: 'rune-deck', position: 'bottom' }]) {
    assert.throws(() => f.send('A', 'move', { objectId: id, to }), error => error.code === 'illegal-destination');
  }
  assert.throws(() => f.send('A', 'move', { objectId: id, to: { zone: 'battlefield', locationId: f.fields[0] } }), error => error.code === 'standard-move-transaction');
  assert.deepEqual(state(f), before);
});

test('RIFT-761: moving to own Base is recognized; Ganking and continuous restrictions use the real rules layer', () => {
  const f = setup(); const [id] = readyUnits(f);
  f.activate(id, 0);
  const showdown = state(f);
  assert.throws(() => moveUnits(f.context(), 'A', [id], { zone: 'base' }), error => error.code === 'illegal-move');
  assert.deepEqual(state(f), showdown);
  f.send('A', 'pass'); f.send('B', 'pass'); // Real noncombat Showdown and Conquer.
  const before = state(f);
  assert.deepEqual(inspectStandardMove(f.context(), 'A', [id], { zone: 'base' }).to, { type: 'base', player: 'A' });
  assert.throws(() => moveUnits(f.context(), 'A', [id], { zone: 'base', playerId: 'B' }), error => error.code === 'illegal-destination');
  assert.throws(() => moveUnits(f.context(), 'A', [id], { zone: 'battlefield', locationId: f.fields[1] }), error => error.code === 'illegal-move');
  assert.deepEqual(state(f), before);
  const source = f.kernel.getObject(id);
  f.match.flow.layers.registry.register({
    id: 'synthetic:ganking', layer: 'ability', source: source.ref, filter: { objectId: id },
    effect: { kind: 'movement', permission: { routes: ['battlefield-to-battlefield'] } },
  }, { type: 'permanent' });
  assert.equal(inspectStandardMove(f.context(), 'A', [id], { zone: 'battlefield', locationId: f.fields[1] }).execution, 'blocked');
  f.match.flow.layers.registry.register({
    id: 'synthetic:no-move', layer: 'ability', source: source.ref, filter: { objectId: id },
    effect: { kind: 'restriction', actions: ['move'], restriction: 'cannot-move' },
  }, { type: 'permanent' });
  const restricted = state(f);
  assert.throws(() => moveUnits(f.context(), 'A', [id], { zone: 'base' }), error => error.code === 'illegal-move');
  assert.deepEqual(state(f), restricted);
});

test('RIFT-761: group destinations, identities, turn priority and duplicates are validated before mutation', () => {
  const f = setup({ firstPlayer: 1 }); const [one, two] = readyUnits(f, 2);
  const before = state(f);
  const to = { zone: 'battlefield', locationId: f.fields[0] };
  assert.equal(inspectStandardMove(f.context(), 'B', [one, two], to).objects.length, 2);
  for (const ids of [[], [one, one], ['missing']]) {
    assert.throws(() => moveUnits(f.context(), 'B', ids, to));
  }
  assert.throws(() => moveUnits(f.context(), 'A', [one], to), error => error.code === 'unavailable-object');
  assert.throws(() => moveUnits(f.context(), 'B', [one], { zone: 'battlefield', locationId: 'missing' }), error => error.code === 'illegal-destination');
  assert.throws(() => moveUnits(f.context(), 'B', [one], { zone: 'base', locationId: 'spoofed' }), error => error.code === 'illegal-destination');
  assert.deepEqual(state(f), before);
  f.nextTurn();
  const wrongTurn = state(f);
  assert.throws(() => moveUnits(f.context(), 'B', [one], to), error => error.code === 'illegal-move');
  assert.deepEqual(state(f), wrongTurn);
});

test('RIFT-761: automatic combat designations and simultaneous damage remain blocked without synthetic events', () => {
  const f = setup(); const id = f.play(); const before = state(f);
  const base = { commandId: 'combat', stateVersion: f.context().stateVersion, battlefieldId: f.fields[0] };
  assert.throws(() => declareAttack(f.context(), 'A', { ...base, type: 'declare-attack', attackerObjectIds: [] }), error => error.code === 'invalid-command');
  assert.throws(() => declareAttack(f.context(), 'A', { ...base, type: 'declare-attack', attackerObjectIds: [id] }), error => error.status === 'blocked' && error.code === 'combat-start-transaction');
  assert.throws(() => declareDefense(f.context(), 'B', { ...base, type: 'declare-defense', defenderObjectIds: [id] }), error => error.status === 'blocked' && error.code === 'combat-designation-task');
  assert.throws(() => assignDamage(f.context(), 'A', { commandId: 'damage', stateVersion: f.context().stateVersion, type: 'choose', choiceId: 'unissued', answer: [3] }), error => error.status === 'blocked' && error.code === 'combat-damage-choice');
  assert.throws(() => resolveCombatDamage(f.context()), error => error.status === 'blocked' && error.code === 'simultaneous-damage-transaction');
  assert.deepEqual(state(f), before);
});

test('RIFT-761: stale/malformed/unknown-actor requests cannot reach authoritative actions', () => {
  const f = setup(); const before = state(f);
  for (const input of [null, {}, { type: 'pass', commandId: 'bad', stateVersion: 0, extra: true }]) {
    assert.throws(() => executeGameCommand(f.context(), 'A', input), error => error.code === 'invalid-command');
  }
  assert.throws(() => executeGameCommand(f.context(), 'A', { type: 'pass', commandId: 'old', stateVersion: 9 }), error => error.code === 'stale-version');
  assert.throws(() => executeGameCommand(f.context(), 'spectator', { type: 'pass', commandId: 'guest', stateVersion: 0 }), error => error.code === 'unknown-player');
  assert.deepEqual(state(f), before);
});

test('RIFT-761: specialized command entry points reject another valid v2 command type', () => {
  const f = setup(); const before = state(f);
  const pass = { commandId: 'wrong-kind', stateVersion: 0, type: 'pass' };
  for (const command of [move, declareAttack, declareDefense, assignDamage]) {
    assert.throws(() => command(f.context(), 'A', pass), error => error.code === 'invalid-command');
  }
  assert.deepEqual(state(f), before);
});

test('RIFT-761: unsupported selections, unknown ability IDs and unresolved programs never become no-op success', () => {
  const f = setup(); const id = f.play(); const before = state(f);
  for (const abilityId of ['unknown', '-1', '01', '999']) {
    assert.throws(() => f.send('A', 'activate', { sourceObjectId: id, abilityId }));
  }
  assert.throws(() => f.send('A', 'activate', { sourceObjectId: id, abilityId: '0', targets: [] }), error => error.code === 'command-selections');
  assert.throws(() => f.send('A', 'play', { cardObjectId: id }), error => error.code === 'illegal-play-zone');
  assert.throws(() => f.send('A', 'choose', { choiceId: 'unissued', answer: true }), error => error.code === 'choice-continuation');
  assert.throws(() => f.send('A', 'mulligan', { selectedObjectIds: [] }), error => error.code === 'setup-complete');
  assert.deepEqual(state(f), before);
  const blocked = setup({ status: 'judge-required' }); const initial = state(blocked);
  assert.throws(() => blocked.play(), error => error.code === 'judge-required');
  assert.deepEqual(state(blocked), initial);
});

test('RIFT-761: concede delegates to match lifecycle and every further command is rejected', () => {
  const f = setup(); const result = f.send('A', 'concede');
  assert.equal(result.winnerPlayerId, 'B');
  const before = state(f);
  assert.throws(() => f.send('A', 'pass'), error => error.code === 'game-over');
  assert.throws(() => f.send('B', 'concede'), error => error.code === 'game-over');
  assert.deepEqual(state(f), before);
});
