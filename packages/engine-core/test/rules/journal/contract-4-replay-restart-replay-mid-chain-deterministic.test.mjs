// RIFT-629 golden test — scenario `journal-restart-replay-mid-chain-deterministic`（edge）
// 依据：contract:4#replay、CR v1.5 303.2.a（同时触发按回合顺序入链）。
//
// 「引擎确定性要求：同一份 header(seed) + 命令序列重放后，链上 pending/finalized 项、
// priority 归属、触发排序都应逐字段一致，不依赖内存中的瞬时调度。」
// 本层真实可执行的形态：用 TurnFlow/ChainEngine 构造链未结算完的中段状态
// （一个 finalized 项 + 一个 pending 项），再从头重建同一序列，比较链结构、优先权与
// 提交事件序列。CR 303.2.a 的“按回合顺序”由 pending 项的 controller 归属体现。
import assert from 'node:assert/strict';
import test from 'node:test';
import { eventsOf, journalFixture } from './support.mjs';

/** A chain paused with one finalized (A) and one pending (B) item. */
function midChain() {
  const f = journalFixture();
  f.flow.start();
  f.flow.execute(f.freeSpell('spell-A'));
  f.flow.chain.enqueue(f.triggered('trig-B', 'B'));
  return f;
}

const snapshot = f => ({
  state: f.flow.chain.turnState,
  priority: f.flow.chain.priority,
  items: f.flow.chain.items.map(item => ({ id: item.id, status: item.status, controller: item.controller, kind: item.kind })),
  events: eventsOf(f).map(event => [event.eventId, event.timingPoint, event.player ?? null]),
});

test('journal-restart-replay-mid-chain-deterministic (contract 4 replay / CR 303.2.a): rebuilding the same command sequence reproduces the pending/finalized chain exactly', () => {
  const first = snapshot(midChain());
  const second = snapshot(midChain());

  // This is genuinely mid-chain: one item finalized, the next still pending.
  assert.deepEqual(first.items.map(item => item.status), ['finalized', 'pending']);
  assert.deepEqual(first.items.map(item => item.controller), ['A', 'B']);
  assert.equal(first.state, 'neutral-closed');
  // CR 312/303.2.a: Priority sits with the player who finalized, not with the new item.
  assert.equal(first.priority, 'A');
  assert.deepEqual(second, first);
});

test('journal-restart-replay-mid-chain-deterministic (contract 4 replay): the replayed chain keeps resolving from the restored pending item', () => {
  const f = midChain();
  // HOT FEPR finalizes the still-pending item, so replaying from the restored
  // mid-chain state continues instead of restarting the whole sequence.
  f.flow.chain.advance();
  const mark = eventsOf(f).length;
  assert.deepEqual(f.flow.chain.items.map(item => item.status), ['finalized', 'finalized']);
  assert.equal(f.flow.chain.priority, 'B');
  // Both players pass: only the last pending item resolves, the earlier one is done.
  f.flow.chain.pass('B');
  f.flow.chain.pass('A');
  const resolved = eventsOf(f).slice(mark).filter(event => event.timingPoint === 'chain-item-resolve');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].details?.item, 'trig-B');
  assert.deepEqual(f.flow.chain.items.map(item => item.id), ['spell-A']);
});
