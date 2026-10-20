import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, trigger, settle, timings, nonCleanup, move, draw } from '../turn/helpers.mjs';

function enter(f, field = 'bf1') {
  f.flow.execute(f.draft('move-to-field', [move('move', { type: 'battlefield', id: field })]));
  settle(f.flow);
}
function conquer(f) {
  enter(f);
  f.flow.pass('A'); f.flow.pass('B');
}

test('combat-move-opens-noncombat-showdown-contested / priority-contested-player-gains-focus: effect Move uses actual FEPR', () => {
  const f = fixture(); f.flow.start(); enter(f);
  assert.equal(f.kernel.getObject('source').location.id, 'bf1');
  assert.equal(f.kernel.getObject('source').exhausted, false);
  assert.equal(f.flow.battlefields[0].contestedBy, 'A');
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.chain.focus, 'A'); assert.equal(f.flow.chain.priority, 'A');
  const events = timings(f.flow);
  assert.ok(events.indexOf('object-moved') < events.indexOf('contested-applied'));
  assert.ok(events.indexOf('contested-applied') < events.indexOf('showdown-open'));
});

test('combat-noncombat-showdown-control-established / scoring-conquer-via-noncombat-showdown: complete event sequence to Conquer', () => {
  const f = fixture(); f.flow.start();
  const before = nonCleanup(f.flow).length;
  conquer(f);
  assert.deepEqual(nonCleanup(f.flow).slice(before), [
    'chain-item-pending', 'chain-item-finalize', 'object-moved', 'object-leaves-base', 'object-enters-battlefield', 'contested-applied', 'chain-item-resolve',
    'showdown-open', 'showdown-close', 'control-established', 'points-gained', 'conquer', 'score',
  ]);
  assert.equal(f.flow.chain.turnState, 'neutral-open'); assert.equal(f.flow.chain.focus, null);
  assert.equal(f.flow.battlefields[0].controller, 'A'); assert.equal(f.flow.battlefields[0].contestedBy, null);
  assert.equal(f.kernel.player('A').score, 1); assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.deepEqual(f.flow.chain.pipeline.events.filter(event => ['conquer', 'score'].includes(event.timingPoint)).map(event => event.details.battlefieldId), ['bf1', 'bf1']);
});

test('scoring-ledger-resets-next-turn / turn-scoring-step-hold-scores-point: Conquer then next own Beginning Hold', () => {
  const f = fixture(); f.flow.start(); conquer(f);
  f.flow.endTurn('A'); f.flow.endTurn('B');
  assert.equal(f.flow.turnPlayer, 'A'); assert.equal(f.kernel.player('A').score, 2);
  assert.equal(timings(f.flow).filter(id => id === 'conquer').length, 1);
  assert.equal(timings(f.flow).filter(id => id === 'hold').length, 1);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
});

test('scoring-final-point-conquer-single-battlefield-draws / scoring-trigger-fires-on-final-point-draw', () => {
  const f = fixture({ score: { A: 7 } }); trigger(f, 'score-watch', 'score');
  f.flow.start(); conquer(f); settle(f.flow);
  assert.equal(f.kernel.player('A').score, 7); assert.equal(f.kernel.player('A').handCount, 3);
  assert.equal(timings(f.flow).filter(id => id === 'final-point').length, 1);
  assert.equal(timings(f.flow).filter(id => id === 'score').length, 1);
  assert.equal(timings(f.flow).filter(id => id === 'points-gained').length, 0);
});

test('scoring-hold-at-final-point-still-scores / turn-victory-check-in-cleanup-step-one: Score wave before victory', () => {
  const f = fixture({ score: { A: 7 }, fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('guard', { location: { type: 'battlefield', id: 'bf1' } }) });
  f.flow.start();
  assert.equal(f.kernel.player('A').score, 8); assert.equal(f.flow.winner, 'A');
  assert.equal(timings(f.flow).filter(id => id === 'hold').length, 1);
  assert.equal(timings(f.flow).filter(id => id === 'score').length, 1);
  assert.equal(timings(f.flow).includes('channel-start'), false);
  assert.throws(() => f.flow.endTurn('A'), /Cannot end/);
});

test('scoring-triggers-fire-on-score-conquer-hold: optional trigger rollback preserves score and ledger atomically', () => {
  const f = fixture({ fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('guard', { location: { type: 'battlefield', id: 'bf1' } }) });
  trigger(f, 'optional-hold', 'hold', { optional: true });
  let prompt;
  assert.throws(() => f.flow.start(), error => { prompt = error.request; return prompt?.type === 'optional'; });
  assert.equal(f.kernel.player('A').score, 0); assert.deepEqual(f.flow.scored('A'), []);
  assert.equal(timings(f.flow).includes('hold'), false);
  f.answers.set(prompt.id, true); f.flow.advance(); settle(f.flow);
  assert.equal(f.kernel.player('A').score, 1); assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(timings(f.flow).filter(id => id === 'hold').length, 1);
  assert.equal(f.kernel.player('A').handCount, 2);
});

test('combat-negative-nonfocus-player-cannot-play / turn-negative-end-turn-while-chain-exists', () => {
  const f = fixture(); f.flow.start(); enter(f);
  assert.throws(() => f.flow.execute(f.draft('wrong-focus', [draw('draw')], { controller: 'B', speed: 'action' })), /timed/);
  assert.throws(() => f.flow.endTurn('A'), /Cannot end/);
});

test('combat-focus-passes-after-player-chain: Focus comes only from batch 4', () => {
  const f = fixture(); f.flow.start(); enter(f);
  f.flow.execute(f.draft('action', [draw('draw')], { speed: 'action' })); settle(f.flow);
  assert.equal(f.flow.chain.focus, 'B'); assert.equal(f.flow.chain.priority, 'B');
});

// CR v1.5 (updated 2026-10-09, effective 2026-10-16) 316.7, 345, 462,
// 466.1, 466.2.b/c/c.1/c.1.a/c.2/c.3/e.1, and 312/313/347 define this generic Combat
// Showdown transition. Synthetic Units exercise the rules path only:
// canonicalCardId is null. Sources:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
test('combat-move-to-enemy-opens-combat-showdown / illegal commands roll back: default TurnFlow production path', () => {
  const f = fixture({ fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('defender', { owner: 'B', location: { type: 'battlefield', id: 'bf1' } }) });
  f.flow.start();
  f.flow.execute(f.draft('move-to-enemy', [move('move', { type: 'battlefield', id: 'bf1' })]));
  settle(f.flow);
  assert.deepEqual(f.kernel.getObject('source').location, { type: 'battlefield', id: 'bf1' });
  assert.equal(f.kernel.getObject('source').exhausted, false);
  assert.deepEqual(f.flow.battlefields[0], {
    id: 'bf1', controller: 'B', contestedBy: 'A', staged: 'none',
  });
  assert.equal(f.flow.combat.active, true);
  assert.deepEqual(f.flow.combat.lifecycle, {
    phase: 'showdown', field: 'bf1', combatId: 'combat:bf1:1', attacker: 'A', defender: 'B',
  });
  assert.equal(f.flow.combat.snapshot(f.kernel.getObject('source')).combatRole, 'attacker');
  assert.equal(f.flow.combat.snapshot(f.kernel.getObject('defender')).combatRole, 'defender');
  assert.equal(f.flow.chain.turnState, 'showdown-open');
  assert.equal(f.flow.chain.focus, 'A');
  assert.equal(f.flow.chain.priority, 'A');
  assert.equal(f.flow.chain.canAct('A', 'action'), true);
  assert.equal(f.flow.chain.canAct('B', 'action'), false);
  assert.equal(f.kernel.getObject('source').damage, 0);
  assert.equal(f.kernel.getObject('defender').damage, 0);
  assert.equal(f.kernel.player('A').score, 0);
  assert.equal(f.kernel.player('B').score, 0);

  const combatTimeline = f.flow.chain.pipeline.events
    .filter(event => ['object-moved', 'contested-applied', 'chain-item-resolve', 'showdown-open',
      'combat-start', 'attack-declared', 'defense-declared'].includes(event.timingPoint));
  assert.deepEqual(combatTimeline.map(event => event.timingPoint), [
    'object-moved', 'contested-applied', 'chain-item-resolve', 'showdown-open',
    'combat-start', 'attack-declared', 'defense-declared',
  ]);
  assert.deepEqual(combatTimeline.find(event => event.timingPoint === 'combat-start').details, {
    combatId: 'combat:bf1:1', battlefieldId: 'bf1', attackerId: 'A', defenderId: 'B',
  });
  assert.equal(combatTimeline.filter(event => event.timingPoint === 'showdown-open')[0].player, 'A');
  const attack = combatTimeline.find(event => event.timingPoint === 'attack-declared');
  const defense = combatTimeline.find(event => event.timingPoint === 'defense-declared');
  assert.deepEqual([attack.object.ref.id, attack.player], ['source', 'A']);
  assert.deepEqual([defense.object.ref.id, defense.player], ['defender', 'B']);
  assert.equal(attack.batchId, defense.batchId);
  assert.equal(timings(f.flow).some(id => ['damage-dealt', 'combat-result', 'combat-end', 'conquer', 'score'].includes(id)), false);

  const rejectedWithoutMutation = (operation, pattern) => {
    const state = f.kernel.snapshot();
    const events = structuredClone(f.flow.chain.pipeline.events);
    const trace = f.flow.chain.trace;
    const items = f.flow.chain.items;
    const combat = f.flow.combat.checkpoint();
    assert.throws(operation, pattern);
    assert.deepEqual(f.kernel.snapshot(), state);
    assert.deepEqual(f.flow.chain.pipeline.events, events);
    assert.deepEqual(f.flow.chain.trace, trace);
    assert.deepEqual(f.flow.chain.items, items);
    assert.deepEqual(f.flow.combat.checkpoint(), combat);
  };
  rejectedWithoutMutation(
    () => f.flow.execute(f.draft('wrong-focus', [draw('draw')], { controller: 'B', speed: 'action' })),
    /legally timed/,
  );
  rejectedWithoutMutation(() => f.flow.pass('B'), /cannot pass/);
  rejectedWithoutMutation(() => f.flow.endTurn('A'), /Cannot end turn/);
});

test('combat-damage-dealt-simultaneously-shared-deathknell: block unsupported transaction without marking damage', () => {
  const f = fixture(); f.flow.start();
  const before = f.kernel.snapshot(), events = f.flow.chain.pipeline.events;
  assert.throws(() => f.flow.combat.dealDamage(), error => error.status === 'blocked' && error.code === 'simultaneous-damage-transaction');
  assert.deepEqual(f.kernel.snapshot(), before); assert.deepEqual(f.flow.chain.pipeline.events, events);
});

test('movement-standard-move-base-to-battlefield: blocked before Exhaust cost can be partially paid', () => {
  const f = fixture(); f.flow.start(); const before = f.flow.chain.pipeline.events;
  assert.throws(() => f.flow.move('A', f.kernel.ref('source'), 'bf1'), error => error.code === 'standard-move-transaction');
  assert.equal(f.kernel.getObject('source').exhausted, false); assert.equal(f.kernel.getObject('source').location.type, 'base');
  assert.deepEqual(f.flow.chain.pipeline.events, before);
});

test('scoring-control-lost-at-open-cleanup-no-score: moving out causes real cleanup to lose control', () => {
  const f = fixture(); f.flow.start(); conquer(f);
  f.flow.execute(f.draft('leave', [move('leave-field', { type: 'base', player: 'A' })])); settle(f.flow);
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.equal(timings(f.flow).filter(id => id === 'control-lost').length, 1);
  assert.equal(f.kernel.player('A').score, 1);
});

test('RIFT-124 regression: Control and Conquer commit in one wave and roll back together on a choice', () => {
  const f = fixture(); trigger(f, 'control-watch', 'control-established', { optional: true });
  f.flow.start(); enter(f); f.flow.pass('A');
  let prompt;
  assert.throws(() => f.flow.pass('B'), error => { prompt = error.request; return prompt?.type === 'optional'; });
  assert.equal(f.flow.battlefields[0].controller, null);
  assert.equal(f.kernel.player('A').score, 0); assert.deepEqual(f.flow.scored('A'), []);
  assert.equal(timings(f.flow).includes('control-established'), false);
  assert.equal(f.kernel.getObject('source').location.id, 'bf1');
  f.answers.set(prompt.id, true); f.flow.advance();
  assert.equal(f.flow.battlefields[0].controller, 'A'); assert.equal(f.kernel.player('A').score, 1);
  assert.equal(f.flow.chain.items[0].status, 'finalized');
  settle(f.flow);
  assert.equal(timings(f.flow).filter(id => id === 'conquer').length, 1);
  assert.equal(timings(f.flow).filter(id => id === 'control-established').length, 1);
});

test('RIFT-124 regression: Score replacement completes Scoring without awarding its point', () => {
  const f = fixture({ fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('guard', { location: { type: 'battlefield', id: 'bf1' } }) });
  f.flow.chain.pipeline.registerReplacement({ id: 'point-to-draw', matches: action => action.type === 'score',
    apply: action => ({ status: 'replace', actions: [{ type: 'draw', player: action.player, amount: 1 }] }) });
  f.flow.start();
  assert.equal(f.kernel.player('A').score, 0); assert.equal(f.kernel.player('A').handCount, 2);
  assert.deepEqual(f.flow.scored('A'), ['bf1']); assert.equal(timings(f.flow).includes('hold'), true);
});
