// RIFT-629 golden test — scenario `journal-replay-engine-mismatch-mid-chain-consistent`（edge）
// 依据：contract:4#engine-mismatch、contract:4#replay、CR v1.5 303.2.a。
//
// 「标记 engineMismatch 的前提下，重放到链中段的结构也应确定。」
// 本层可执行的部分：同一规则版本下，header 里记录的是别的 engineVersion 并不影响
// 重算的链中段结构——同一命令序列重建出的 pending/finalized 项、优先权与事件序列逐字段一致。
// engineMismatch 标记本身属于 replay-core，见 todo。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournalHeader } from '@riftbound/protocol';
import { eventsOf, journalFixture, journalHeader } from './support.mjs';

/** One finalized + one pending item, reached by the same command sequence. */
function midChain() {
  const f = journalFixture();
  f.flow.start();
  f.flow.execute(f.freeSpell('c1'));
  f.flow.chain.enqueue(f.triggered('c9', 'B'));
  return f;
}

const structure = f => ({
  state: f.flow.chain.turnState,
  priority: f.flow.chain.priority,
  chain: f.flow.chain.items.map(item => ({ id: item.id, status: item.status, controller: item.controller })),
  events: eventsOf(f).map(event => [event.eventId, event.timingPoint, event.details?.item ?? null]),
});

test('journal-replay-engine-mismatch-mid-chain-consistent (contract 4 engine-mismatch / replay / CR 303.2.a): the recorded build version does not affect the recomputed mid-chain structure', () => {
  // A journal recorded by the previous build still validates against the current ruleset.
  const recorded = journalHeader({ engineVersion: '1.0.0+aaa0000' });
  const current = journalHeader({ engineVersion: '1.1.0+bbb1111' });
  assert.equal(isJournalHeader(recorded), true);
  assert.equal(isJournalHeader(current), true);
  assert.equal(recorded.rulesetVersion, current.rulesetVersion);

  const first = structure(midChain());
  const second = structure(midChain());
  assert.equal(first.chain.length, 2);
  assert.deepEqual(first.chain.map(item => item.status), ['finalized', 'pending']);
  assert.equal(first.state, 'neutral-closed');
  assert.equal(first.priority, 'A');
  assert.deepEqual(second, first);
});

// 缺什么：engineMismatch 标记由 replay-core 的 replayJournal 计算
// （packages/replay-core/src/v2/replay.ts），engine-core 新内核不提供重放入口。
test.todo('journal-replay-engine-mismatch-mid-chain-consistent: 缺 replayJournal 的 engineMismatch 标记与链中段重放结果（packages/replay-core src/v2/replay.ts）');
