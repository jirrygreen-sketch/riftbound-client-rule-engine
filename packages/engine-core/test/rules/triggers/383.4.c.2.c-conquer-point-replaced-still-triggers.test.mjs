// CR v1.5 383.4.c.2.c golden test — scenario `triggers-conquer-point-replaced-still-triggers`
// (docs/rules/scenarios/triggers.yaml).
//
// 383.4.c.2.c: "If the act of gaining one point from Conquering is negated or replaced
// in any way, the Conquer Effect will still trigger."
//
// 状态：test.todo。缺什么：结构性 Score 替代任务。
// 现状：
//   * 未被替代的 Conquer 波已由同目录 `383.4.c.2.a-conquer-unit-present.test.mjs` 真实执行
//     （control-established → points-gained → conquer → score → chain-item-pending）。
//   * 得分动作本身是 TurnFlow 的结构性任务：`turn/flow.ts` 的 execute 包装在结算 Score 时
//     要求该动作就是 Score/Draw；当登记的点数替代（replacement 命中 `score`）导致
//     `scoreLedger` 不再更新时，它抛
//     `TurnCombatBlockedError('replaced-scoring', 'Replaced point gains require a structural Score task contract')`，
//     而不是继续发布 conquer/score 波。
//   * 因此无法执行“点数被否定后 Conquer Effect 仍入链”的场景；按规则红线不近似实现，
//     也不写“断言该功能不存在”的测试。
// 需要的机制：Score 动作的替代协议（被替代/否定后仍完成 Scoring、发布 conquer 与 score 时点）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { turnFixture as fixture, settle, markEvents, eventsAfter, eventsAt } from './harness.mjs';
import { move } from '../scoring/harness.mjs';

test('triggers-conquer-point-replaced-still-triggers (383.4.c.2.c)', () => {
  const f = fixture({ fields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }],
    setup: w => w.base('u1', { might: 3 }) });
  f.trigger('trigger:conquer', 'conquer', [{ id: 'draw', op: 'effect.draw', args: { amount: { kind: 'constant', value: 1 } } }], {
    sourceId: 'u1', filter: { event: 'conquered', player: 'self' },
  });
  f.flow.chain.pipeline.registerReplacement({ id: 'replace-score', matches: action => action.type === 'score',
    apply: action => ({ status: 'replace', actions: [{ type: 'draw', player: action.player, amount: 1 }] }) });
  f.flow.start();
  const mark = markEvents(f);
  const handBefore = f.kernel.player('A').handCount;
  const drawsBefore = eventsAt(f, 'card-drawn').length;
  f.flow.execute(f.activated('enter', [move('enter', { type: 'battlefield', id: 'bf1' })], 'A', 'u1'));
  settle(f);
  assert.equal(f.kernel.player('A').score, 0);
  assert.deepEqual(f.flow.scored('A'), ['bf1']);
  const conquer = eventsAt(f, 'conquer');
  assert.equal(conquer.length, 1);
  assert.equal(conquer[0].object?.ref.id, 'u1');
  assert.equal(conquer[0].source?.ref.id, 'u1');
  assert.equal(conquer[0].it?.ref.id, 'u1');
  const itemTrace = itemId => f.flow.chain.trace.filter(entry => entry.item === itemId).map(entry => entry.step);
  assert.deepEqual(itemTrace('enter'), [
    'pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed',
  ]);
  assert.deepEqual(itemTrace('trigger:1'), [
    'pending', 'finalize-start', 'finalized', 'resolve-start', 'resolved', 'removed',
  ]);
  const drawEvents = eventsAfter(f, mark).filter(event => event.timingPoint === 'card-drawn');
  assert.equal(drawEvents.length, 2, 'one replacement Draw plus the trigger body Draw');
  assert.equal(f.kernel.player('A').handCount, handBefore + 2);
  assert.equal(eventsAt(f, 'card-drawn').length, drawsBefore + 2);
  assert.equal(drawEvents.at(-1).source?.ref.id, 'u1', 'the resolved trigger Draw comes from the conquering Unit');
});
