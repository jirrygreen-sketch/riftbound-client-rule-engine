// RIFT-629 golden test — scenario `journal-invalid-command-not-written`（negative）
// 依据：contract:4#journal-entry、contract:4#idempotency、CR v1.5 312（优先权）。
//
// 「合法性校验在写入日志之前；listLegalActions 不匹配的命令直接拒绝，保证日志只包含已被
// 权威状态机接受的命令。」本任务 owns 只有 engine-core 的新内核，没有 room/journal 写入层；
// 能真实执行的是它的引擎侧等价物：被拒绝的动作必须在 ChainEngine 的事务里回滚，不留下任何
// 事件、链项、状态改动或优先权移动——这样“不写日志”才是结构上成立的，而不是靠调用方自觉。
import assert from 'node:assert/strict';
import test from 'node:test';
import { chainState, journalFixture, refusedDraftLeavesNoTrace } from './support.mjs';

test('journal-invalid-command-not-written (contract 4 journal-entry): an unpayable play is refused and leaves no trace at all', () => {
  const f = journalFixture();
  f.flow.start();
  const before = chainState(f);

  // Energy 9 is not available: the cost plan fails during Finalize.
  const draft = { ...f.freeSpell('too-expensive'), cost: { id: 'cost:too-expensive', cost: { energy: { kind: 'constant', value: 9 }, power: { kind: 'constant', value: [] } } } };
  const run = refusedDraftLeavesNoTrace(f, draft);
  assert.notEqual(run.error, null);
  assert.equal(run.unchanged, true);
  // The audit surface is unchanged: no new event, no leftover chain item, same Priority.
  assert.deepEqual(run.after.events, before.events);
  assert.deepEqual(run.after.items, []);
  assert.equal(run.after.priority, 'A');
  assert.equal(run.after.turnState, 'neutral-open');
});

test('journal-invalid-command-not-written (contract 4 journal-entry / CR 312): a non-priority player action is refused without an entry either', () => {
  const f = journalFixture();
  f.flow.start();
  // Priority is with the turn player A; B cannot start a normal action.
  const run = refusedDraftLeavesNoTrace(f, f.freeSpell('by-opponent', 'B'));
  assert.notEqual(run.error, null);
  assert.match(run.error.message, /legally timed/u);
  assert.equal(run.unchanged, true);
  assert.equal(run.after.priority, 'A');
  assert.deepEqual(run.after.items, []);
});

test('journal-invalid-command-not-written (contract 4 journal-entry): an accepted command is the only one that produces an entry', () => {
  const f = journalFixture();
  f.flow.start();
  const accepted = chainState(f);
  f.flow.execute(f.freeSpell('legal'));
  const after = chainState(f);
  // The accepted action did advance the audit surface, which is why the refused
  // ones above can be asserted as byte-identical.
  assert.ok(after.events.length > accepted.events.length);
  assert.deepEqual(after.items.map(item => [item.id, item.status]), [['legal', 'finalized']]);
  // chain-item-pending is the committed marker that a legal action entered the chain.
  assert.equal(after.events.some(event => event[1] === 'chain-item-pending' && event[3] === 'legal'), true);
});
