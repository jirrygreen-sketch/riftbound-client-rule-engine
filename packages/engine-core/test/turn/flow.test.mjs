import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, trigger, settle, timings, nonCleanup, draw, c } from './helpers.mjs';

const phases = ['turn-start', 'awaken-start', 'awaken-end', 'beginning-start', 'beginning-end', 'channel-start',
  'channel-end', 'draw-start', 'draw-end', 'main-start'];

test('turn-phase-sequence-full / turn-play-continues-until-win: two full turns use batch 4 timings', () => {
  const f = fixture();
  f.flow.start();
  assert.equal(f.flow.phase, 'main'); assert.equal(f.flow.turn, 1); assert.equal(f.flow.chain.priority, 'A');
  const phaseEvents = () => timings(f.flow).filter(id => phases.includes(id) || ['main-end', 'turn-end'].includes(id));
  assert.deepEqual(phaseEvents(), phases);
  f.flow.endTurn('A');
  assert.equal(f.flow.turnPlayer, 'B'); assert.equal(f.flow.turn, 2); assert.equal(f.flow.chain.priority, 'B');
  f.flow.endTurn('B');
  assert.equal(f.flow.turnPlayer, 'A'); assert.equal(f.flow.turn, 3);
  assert.deepEqual(phaseEvents(), [...phases, 'main-end', 'turn-end', ...phases, 'main-end', 'turn-end', ...phases]);
  assert.deepEqual(f.flow.chain.pipeline.events.filter(event => event.timingPoint === 'turn-start').map(event => [event.turnNumber, event.activePlayerId]), [[1, 'A'], [2, 'B'], [3, 'A']]);
});

test('turn-awaken-readies-all-controlled / turn-awaken-already-ready-noop: real Ready actions only for exhausted own objects', () => {
  const f = fixture({ setup: w => w.base('tired', { exhausted: true }).base('gear', { types: ['gear'], exhausted: true })
    .base('opponent', { owner: 'B', exhausted: true }).object('rune-on-board', { types: ['rune'], zone: 'rune-zone', exhausted: true }) });
  f.flow.start();
  for (const id of ['tired', 'gear', 'rune-on-board']) assert.equal(f.kernel.getObject(id).exhausted, false);
  assert.equal(f.kernel.getObject('opponent').exhausted, true);
  const readyActions = f.flow.chain.pipeline.events.filter(event => event.action?.type === 'ready');
  assert.deepEqual(readyActions.map(event => event.object.ref.id), ['tired', 'gear', 'rune-on-board']);
  assert.equal(f.kernel.events.filter(event => event.action === 'ready').length, 3);
});

test('turn-channel-phase-two-runes-ready / turn-draw-phase-draws-one / turn-first-turn-second-player-extra-channel', () => {
  const f = fixture(); f.flow.start();
  assert.equal(f.kernel.player('A').runeDeckCount, 6); assert.equal(f.kernel.player('A').handCount, 1);
  f.flow.endTurn('A');
  assert.equal(f.kernel.player('B').runeDeckCount, 5); assert.equal(f.kernel.player('B').handCount, 1);
  f.flow.endTurn('B'); f.flow.endTurn('A');
  assert.equal(f.kernel.player('B').runeDeckCount, 3);
});

test('turn-channel-partial-when-rune-deck-short: repeated legal turns exhaust Rune Deck without Burn Out', () => {
  const f = fixture(); f.flow.start();
  for (let i = 0; i < 8; i++) f.flow.endTurn(f.flow.turnPlayer);
  assert.equal(f.kernel.player('A').runeDeckCount, 0); assert.equal(f.kernel.player('B').runeDeckCount, 0);
  assert.equal(f.kernel.player('A').score, 0); assert.equal(f.kernel.player('B').score, 0);
});

test('turn-beginning-trigger-goes-on-chain: Beginning FEPR finishes before Channel', () => {
  const f = fixture(); trigger(f, 'begin', 'beginning-start'); f.flow.start();
  assert.equal(f.flow.phase, 'beginning'); assert.equal(f.flow.chain.items[0].status, 'finalized');
  assert.equal(timings(f.flow).includes('channel-start'), false);
  settle(f.flow);
  assert.equal(f.flow.phase, 'main'); assert.equal(f.kernel.player('A').handCount, 2);
  const events = timings(f.flow);
  assert.ok(events.indexOf('chain-item-resolve') < events.indexOf('channel-start'));
});

test('turn-simultaneous-phase-triggers-turn-order: choice rollback and resume do not repeat earlier phase actions', () => {
  const f = fixture({ setup: w => w.base('tired', { exhausted: true }) });
  trigger(f, 'one', 'beginning-start'); trigger(f, 'two', 'beginning-start');
  let prompt;
  assert.throws(() => f.flow.start(), error => { prompt = error.request; return prompt?.type === 'mode'; });
  assert.equal(timings(f.flow).filter(id => id === 'beginning-start').length, 0);
  assert.equal(f.kernel.getObject('tired').exhausted, false);
  f.answers.set(prompt.id, prompt.options[1]); f.flow.advance(); settle(f.flow);
  assert.equal(timings(f.flow).filter(id => id === 'beginning-start').length, 1);
  assert.equal(f.kernel.events.filter(event => event.action === 'ready').length, 1);
  assert.equal(f.kernel.player('A').handCount, 3);
});

test('turn-ending-step-eot-triggers-on-chain / turn-expiration-this-turn-effects-expire: expiry waits for Ending FEPR', () => {
  const f = fixture();
  f.flow.layers.addContinuous({ id: 'temporary', layer: 'trait', filter: { objectId: 'source' }, effect: { kind: 'add-tag', tag: 'temporary' } }, { type: 'end-of-turn' });
  trigger(f, 'ending', 'turn-end', { spec: { at: 'turn-end', filter: {} } });
  f.flow.start(); f.flow.endTurn('A');
  assert.equal(f.flow.phase, 'ending'); assert.equal(f.flow.layers.registry.list().length, 1);
  assert.equal(f.flow.layers.evaluate(f.kernel.ref('source')).tags.includes('temporary'), true);
  settle(f.flow);
  assert.equal(f.flow.turnPlayer, 'B'); assert.equal(f.flow.layers.registry.list().length, 0);
  const events = f.flow.chain.pipeline.events;
  const end = events.findIndex(event => event.timingPoint === 'turn-end');
  assert.equal(events.slice(end).filter(event => event.timingPoint === 'chain-item-resolve').length, 1);
});

test('turn-expiration-heals-all-units / turn-special-cleanup-repeat-is-normal: actual Heal then normal fixed-point cleanup', () => {
  const f = fixture({ setup: w => w.base('damaged', { might: 5, damage: 2 }).base('other-damaged', { owner: 'B', might: 5, damage: 1 }) });
  f.flow.start(); assert.equal(f.kernel.getObject('damaged').damage, 2);
  f.flow.endTurn('A');
  assert.equal(f.kernel.getObject('damaged').damage, 0); assert.equal(f.kernel.getObject('other-damaged').damage, 0);
  assert.equal(f.kernel.events.filter(event => event.action === 'heal').length, 2);
});

test('turn-main-phase-priority-and-rune-pool-empty / turn-expiration-empties-rune-pool: both pools empty before Main', () => {
  const f = fixture({ energy: 1 });
  f.kernel.addPlayer('B', { energy: 3, power: ['Calm'] });
  f.flow.start();
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.player('B').energy, 0);
  assert.deepEqual(f.kernel.player('B').power, []);
  assert.equal(f.flow.chain.priority, 'A');
  assert.equal(timings(f.flow).includes('main-start'), true);
});

test('turn-negative-end-turn-while-chain-exists / turn-phases-cannot-skip / turn-negative-opponent-action-in-main', () => {
  const f = fixture(); trigger(f, 'begin', 'beginning-start'); f.flow.start();
  assert.throws(() => f.flow.endTurn('A'), /Cannot end/); settle(f.flow);
  assert.throws(() => f.flow.endTurn('B'), /Cannot end/);
  assert.throws(() => f.flow.execute(f.draft('wrong-player', [draw('draw')], { controller: 'B' })), /timed/);
  f.flow.execute(f.draft('ability', [draw('draw')]));
  assert.throws(() => f.flow.endTurn('A'), /Cannot end/);
});

test('turn-draw-burnout-recycles-trash-and-gives-point: real Burn Out recycles, scores opponent, and draws', () => {
  const f = fixture({ deck: false, score: { B: 3 },
    setup: w => w.card('deck-1', { zone: 'trash' }) });
  f.flow.start();
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.kernel.player('B').score, 4);
  assert.equal(f.kernel.player('A').deckCount, 0);
  assert.equal(f.kernel.player('A').handCount, 1);
  // Channel Phase still channels before the empty deck causes Burn Out.
  assert.equal(f.kernel.player('A').runePool.length, 2);
  assert.ok(nonCleanup(f.flow).includes('card-drawn'));
});

test('turn-cleanup-deferred-during-resolution: damage then Heal uses the actual interpreter before Cleanup', () => {
  const f = fixture(); f.flow.start();
  f.flow.execute(f.draft('damage-and-heal', [
    { id: 'damage', op: 'effect.damage', args: { target: 'self', amount: c(4) },
      targets: [{ id: 'self', filter: { objectId: 'source', type: 'unit', zone: 'board' }, min: 1, max: 1 }] },
    { id: 'heal', op: 'effect.heal', args: {} },
  ]));
  settle(f.flow);
  assert.equal(f.kernel.getObject('source').zone, 'board'); assert.equal(f.kernel.getObject('source').damage, 0);
  assert.equal(f.kernel.events.filter(event => event.action === 'kill').length, 0);
  const events = f.flow.chain.pipeline.events;
  const hit = events.findIndex(event => event.timingPoint === 'damage-dealt');
  const resolved = events.findIndex((event, i) => i > hit && event.timingPoint === 'chain-item-resolve');
  assert.ok(hit >= 0 && resolved > hit);
  assert.equal(events.slice(hit + 1, resolved).some(event => event.timingPoint === 'cleanup-start'), false);
});

test('turn-cleanup-blocks-finalize-and-priority / turn-cleanup-chains-to-fixed-point: real lethal Cleanup has no player grants', () => {
  const f = fixture({ setup: w => w.base('lethal', { might: 2, damage: 2 }).base('zero', { might: 0 }) });
  f.flow.start();
  assert.equal(f.kernel.getObject('lethal').zone, 'trash'); assert.equal(f.kernel.getObject('zero').zone, 'board');
  assert.equal(f.kernel.events.filter(event => event.action === 'kill').length, 1);
  let cleaning = false;
  for (const event of f.flow.chain.trace) {
    if (event.timingPoint === 'cleanup-start') cleaning = true;
    if (event.timingPoint === 'cleanup-end') cleaning = false;
    if (cleaning) assert.equal(['priority-granted', 'focus-granted', 'finalized', 'resolved'].includes(event.step), false);
  }
  assert.ok(timings(f.flow).filter(id => id === 'cleanup-start').length > 1);
});

test('RIFT-124 regression: driver advance preserves Priority after the first Pass', () => {
  const f = fixture(); f.flow.start();
  f.flow.execute(f.draft('draw-ability', [draw('draw')]));
  const before = f.kernel.player('A').handCount;
  f.flow.pass('A');
  assert.equal(f.flow.chain.priority, 'B');
  f.flow.advance(); assert.equal(f.flow.chain.priority, 'B');
  assert.throws(() => f.flow.pass('A'), /cannot pass/);
  assert.equal(f.kernel.player('A').handCount, before);
  f.flow.pass('B');
  assert.equal(f.kernel.player('A').handCount, before + 1);
  assert.deepEqual(f.flow.chain.trace.filter(event => event.step === 'pass').map(event => event.player), ['A', 'B']);
});
