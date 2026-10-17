// RIFT-629 golden tests — 乱序 / 过期版本组
//   journal-out-of-order-stale-version-rejected      （negative，contract:4#resume）
//   journal-out-of-order-new-connection-wins-old-rejected（positive，contract:4#resume）
//   journal-stale-version-command-not-written        （negative，contract:4#resume）
//   journal-out-of-turn-command-not-written          （negative，contract:4#journal-entry + CR 312）
//
// 依据：契约第 4 节「断线重连基于 stateVersion + 事件游标」与「非法命令不写入正文」，
// CR v1.5 312（优先权）。expectedVersion 的乐观并发校验在服务端命令边界；engine-core
// 新内核的对应物是**合法时机门**：不在当前时机的命令同样在写入任何状态/事件之前被拒绝。
// 本文件断言引擎侧可执行的部分（拒绝即零痕迹、优先权不动），并把 optimistic-concurrency
// 版本比对记为 todo。
import assert from 'node:assert/strict';
import test from 'node:test';
import { chainState, journalFixture, refusedDraftLeavesNoTrace } from './support.mjs';

test('journal-out-of-turn-command-not-written (contract 4 journal-entry / CR 312): a non-priority player action is refused with no journal entry', () => {
  // Given: turn/priority is A's; B holds a card but not the right to act.
  const f = journalFixture({ setup: w => w.hand('b-card', { owner: 'B' }) });
  f.flow.start();
  assert.equal(f.flow.chain.priority, 'A');
  const run = refusedDraftLeavesNoTrace(f, f.freeSpell('cmd-b', 'B', 'b-card'));
  assert.notEqual(run.error, null);
  assert.equal(run.unchanged, true);
  assert.equal(run.after.priority, 'A');
  assert.deepEqual(run.after.items, []);
  // The rejected submission left no committed timing at all.
  assert.deepEqual(run.after.events, run.before.events);
});

test('journal-out-of-order-stale-version-rejected / journal-out-of-order-new-connection-wins-old-rejected (contract 4 resume): the later, out-of-turn command is refused while the first accepted one stays settled', () => {
  const f = journalFixture();
  f.flow.start();
  // The "new connection" command wins: it is legal and enters the chain.
  f.flow.execute(f.freeSpell('cmd-new'));
  const accepted = chainState(f);
  assert.deepEqual(accepted.items.map(item => item.id), ['cmd-new']);

  // The older connection's command arrives afterwards with a stale expectation;
  // the engine refuses it before it can change the settled state.
  const run = refusedDraftLeavesNoTrace(f, f.freeSpell('cmd-old'));
  assert.notEqual(run.error, null);
  assert.equal(run.unchanged, true);
  assert.deepEqual(run.after.items.map(item => item.id), ['cmd-new']);
  assert.equal(run.after.events.filter(event => event[1] === 'chain-item-pending').length, 1);
});

test('journal-stale-version-command-not-written (contract 4 resume / journal-entry): a refused command never advances the committed event sequence', () => {
  const f = journalFixture();
  f.flow.start();
  f.flow.execute(f.freeSpell('cmd-1'));
  f.flow.chain.pass('A');
  f.flow.chain.pass('B');
  const before = chainState(f);
  // Replaying an already-settled identity is the engine-side stale submission.
  const run = refusedDraftLeavesNoTrace(f, f.freeSpell('cmd-1'));
  assert.notEqual(run.error, null);
  assert.equal(run.unchanged, true);
  assert.deepEqual(run.after.events, before.events);
});

// 缺什么：expectedVersion / expectedStateVersion 与权威 stateVersion 的乐观并发比对、
// 以及 `stale-version` 的线协议回执都在服务端命令边界（apps/game-server room/runtime）。
// engine-core 新内核的 Command 联合没有版本字段，本任务 owns 只有 test/rules/journal/**。
test.todo('journal-out-of-order-stale-version-rejected: 缺服务端 expectedVersion 乐观并发校验与 stale-version 回执（apps/game-server room/runtime command boundary）');
test.todo('journal-out-of-order-new-connection-wins-old-rejected: 缺服务端按连接维度的版本比对与 stale-version 回执（apps/game-server room/runtime command boundary）');
test.todo('journal-stale-version-command-not-written: 缺服务端 stateVersion 门与“拒绝不落日志”的收尾断言（apps/game-server room/runtime command boundary）');
test.todo('journal-out-of-turn-command-not-written: 缺服务端合法动作列表校验与 invalid_command 回执（apps/game-server room/runtime command boundary；引擎侧零痕迹已在上方断言）');
