// CR v1.5 383.1.b golden test — scenario `triggers-nth-time-simultaneous-pick-one`
// (docs/rules/scenarios/triggers.yaml).
//
// 383.1.b: "If an ability triggers 'the [Nth] time' something happens and that
// trigger condition is met multiple times simultaneously, the ability's controller
// picks one of those instances to serve as the trigger condition. The ability
// triggers only once, due to the chosen condition." The example is Wraith of Echoes
// with two other friendly units dying simultaneously.
//
// The executed slice uses the merged event pipeline's own simultaneous machinery:
// `deferTriggerScan` publishes both object-killed events as one wave, the frequency
// key (`per-turn`) is consumed once, and the controller really is offered the order
// choice over the two instances. The engine currently expresses "first time" as
// `once: 'per-turn'` rather than a card-authored Nth-time trigger condition, and
// there is no `choose-trigger-instance` command, so those parts stay todo.
import test from 'node:test';
import assert from 'node:assert/strict';

import { fixture, resolveAll } from '../../chain/helpers.mjs';
import { createProgramBinding } from '../../../dist/programs/index.js';
import { drawBody, itemTrace, program } from './harness.mjs';

const WRAITH = 'card.probe-wraith';
const WRAITH_PROGRAM = program(WRAITH, [{
  kind: 'triggered',
  optional: false,
  trigger: {
    at: 'object-killed',
    once: 'per-turn',
    filter: { event: 'object-killed', object: { type: 'unit', controller: 'self' } },
  },
  body: drawBody('wraith-draw'),
}]);

/**
 * A board with one Wraith of Echoes and two doomed friendly units, all at the
 * same Battlefield. The two kills are published as one simultaneous wave through
 * the pipeline's own `deferTriggerScan`, exactly as a combat-damage batch would.
 */
function simultaneousDeaths() {
  const orderAnswers = [];
  const f = fixture({ cards: [{ id: 'wraith', cardId: WRAITH, types: ['unit'], might: 2 }],
    choose: request => {
      if (request.type === 'mode' && /order/.test(request.id)) { orderAnswers.push(request.options); return request.options[0]; }
      if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
      return undefined;
    } });
  const template = f.kernel.getObject('wraith');
  for (const id of ['d1', 'd2']) {
    f.kernel.addObject({ ...template, ref: { id, zoneEntryId: 1 }, cardId: `card:${id}`, types: ['unit'],
      controller: 'A', owner: 'A', location: { type: 'battlefield', id: 'battlefield-1' },
      exhausted: false, damage: 0, keywords: [] }, 'board');
  }
  const binding = createProgramBinding({ cardPrograms: [WRAITH_PROGRAM] });
  // The Wraith is a Permanent: its trigger is only evaluated while on the Board
  // (384.2). Enter it through the real Move action, never by writing the zone.
  f.engine.commit({ type: 'move-zone', object: f.kernel.ref('wraith'), to: 'base', location: { type: 'base', player: 'A' } });
  binding.registerProgramTriggers(f.engine, f.kernel.getObject('wraith'));
  f.engine.pipeline.deferTriggerScan(() => {
    f.engine.commit({ type: 'kill', object: f.kernel.ref('d1') });
    f.engine.commit({ type: 'kill', object: f.kernel.ref('d2') });
  });
  return { f, orderAnswers };
}

test('triggers-nth-time-simultaneous-pick-one (383.1.b): two simultaneous deaths offer one instance choice and trigger the ability once', () => {
  const { f, orderAnswers } = simultaneousDeaths();
  const killed = f.engine.pipeline.events.filter(event => event.timingPoint === 'object-killed')
    .map(event => event.object.ref.id);
  // Both deaths really occurred in the same wave; neither was collapsed into the other.
  assert.deepEqual(killed, ['d1', 'd2']);
  // The controller (not the test) chose which instance serves as the trigger condition.
  assert.equal(orderAnswers.length, 1);
  assert.equal(orderAnswers[0].length, 2);

  f.engine.advance();
  // 383.1.b: only the chosen instance reaches Finalize; the second is removed by
  // the once-per-turn frequency key instead of triggering again.
  const trace = f.engine.trace;
  assert.deepEqual(itemTrace(f.engine, 'trigger:1'), ['pending', 'finalize-start', 'finalized']);
  assert.deepEqual(itemTrace(f.engine, 'trigger:2'), ['pending', 'finalize-start', 'removed']);
  assert.equal(trace.find(event => event.item === 'trigger:2' && event.step === 'removed').reason, 'frequency-exhausted');
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.kernel.player('A').handSize, 0, 'the body has not resolved yet');

  // Both players pass before the Triggered Ability resolves (403/404).
  resolveAll(f.engine);
  assert.equal(f.kernel.player('A').handSize, 1, 'the ability triggered only once');
  assert.equal(f.engine.items.length, 0);
});

test('triggers-nth-time-simultaneous-pick-one (383.1.b): non-simultaneous deaths in the same turn keep the ability at one trigger', () => {
  // The frequency key scopes to the turn, so a later sequential death must not
  // re-offer the choice or enter the Chain again.
  const { f, orderAnswers } = simultaneousDeaths();
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.kernel.player('A').handSize, 1);
  assert.equal(f.engine.items.length, 0);
  // A third friendly unit dies later in the same turn.
  f.kernel.addObject({ ...f.kernel.getObject('d1'), ref: { id: 'd3', zoneEntryId: 1 }, zone: 'board',
    location: { type: 'battlefield', id: 'battlefield-1' } }, 'board');
  f.engine.commit({ type: 'kill', object: f.kernel.ref('d3') });
  f.engine.advance();
  assert.equal(f.engine.items.length, 0, 'the frequency key blocks a second trigger this turn');
  assert.equal(orderAnswers.length, 1, 'no second instance choice');
  assert.equal(f.kernel.player('A').handSize, 1);
});

test.todo('triggers-nth-time-simultaneous-pick-one (383.1.b, card-authored Nth time): 缺卡面“第 N 次”触发条件的 IR 与 `choose-trigger-instance` 命令——能力只能把“first time … each turn”编码为 `once: "per-turn"` 的频度键，控制器对同刻实例的选择由事件管线的 order 请求代替，不是场景里的显式命令');
