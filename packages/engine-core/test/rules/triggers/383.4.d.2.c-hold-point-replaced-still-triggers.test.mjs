// CR v1.5 383.4.d.2.c golden test — scenario `triggers-hold-point-replaced-still-triggers`
// (docs/rules/scenarios/triggers.yaml).
//
// 383.4.d.2.c: "If the act of gaining one point from Holding is negated or replaced
// in any way, the Hold Effect will still trigger."
//
// 状态：test.todo。缺什么：结构性 Score 替代任务。
// 现状：
//   * 未被替代的 Hold 波已由同目录 `383.4.d.2.a-hold-unit-present.test.mjs` 真实执行
//     （points-gained → hold → score → chain-item-pending，全部来自 TurnFlow 的
//     Beginning Phase Scoring Step，没有手工结算）。
//   * 与 383.4.c.2.c 同源：点数的取得是 TurnFlow 的结构性 Score 任务，登记的点数替代
//     会让 `turn/flow.ts` 抛
//     `TurnCombatBlockedError('replaced-scoring', 'Replaced point gains require a structural Score task contract')`，
//     不会继续发布 hold/score 波。
//   * 按规则红线不近似实现，也不写“断言该功能不存在”的测试。
// 需要的机制：Score 动作的替代协议（被替代/否定后仍完成 Scoring、发布 hold 与 score 时点）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { turnFixture as fixture, settle, draw, markEvents, eventsAfter, eventsAt, stages } from '../turn/harness.mjs';

test('triggers-hold-point-replaced-still-triggers (383.4.d.2.c)', () => {
  const f = fixture({
    fields: [{ id: 'bf1', controller: 'A' }, { id: 'bf2', controller: null }],
    setup: w => w.unit('u1', { location: { type: 'battlefield', id: 'bf1' } }),
  });
  f.trigger('trigger:hold', 'hold', [draw('hold-draw')], { sourceId: 'u1', filter: { event: 'held', player: 'self' } });
  f.flow.chain.pipeline.registerReplacement({ id: 'replace-score', matches: action => action.type === 'score',
    apply: action => ({ status: 'replace', actions: [{ type: 'draw', player: action.player, amount: 1 }] }) });
  const mark = markEvents(f);
  const drawsBefore = eventsAt(f, 'card-drawn').length;
  f.flow.start();
  settle(f);
  assert.equal(f.kernel.player('A').score, 0);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  assert.equal(f.flow.chain.items.length, 0);
  assert.deepEqual(stages(f), [
    'pending:trigger:1', 'finalized:trigger:1', 'resolved:trigger:1', 'removed:trigger:1',
  ]);
  const drawEvents = eventsAfter(f, mark).filter(event => event.timingPoint === 'card-drawn');
  assert.equal(drawEvents.length, 3, 'one normal Draw, one replacement Draw, and the trigger body Draw');
  assert.equal(eventsAt(f, 'card-drawn').length, drawsBefore + 3);
  assert.equal(f.kernel.player('A').handCount, 3);
  // Order: the replacement Draw, the trigger body Draw, then the Draw Step.
  assert.equal(drawEvents[1].source?.ref.id, 'u1', 'the resolved trigger Draw comes from the holding Unit');
  // RIFT-1156: the Draw Step is a turn-based action (CR 412.2); it no longer
  // inherits the trigger that resolved before it.
  assert.equal(drawEvents[2].source, undefined, 'the Draw Step has no effect source');
  assert.equal(eventsAt(f, 'hold')[0].object?.ref.id, 'u1');
});
