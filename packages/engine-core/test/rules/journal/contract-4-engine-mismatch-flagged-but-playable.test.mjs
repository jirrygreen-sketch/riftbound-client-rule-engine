// RIFT-629 golden test — scenario `journal-replay-engine-mismatch-flagged-but-playable`（positive）
// 依据：contract:4#engine-mismatch、contract:4#replay。
//
// 契约：`engineVersion` 不一致时**允许重放**但标记 engineMismatch，不做逐字节比较。
// 本层（engine-core 新内核）没有 replay 入口，可执行的部分只有该待遇的前置条件与
// 重放本身：journal v1 校验器不把 header 绑死到当前构建（同一 ruleset 下 engineVersion
// 可以是别的版本号），而 header + 命令序列的重算结果与实时对局一致。
// engineMismatch 这个标记由 replay-core 的 replayJournal 计算，见文末 todo。
import assert from 'node:assert/strict';
import test from 'node:test';
import { isJournal, isJournalHeader } from '@riftbound/protocol';
import { journalEntry, journalFrom, journalHeader, matchEvents, matchState, newMatch, sealEntries } from './support.mjs';

test('journal-replay-engine-mismatch-flagged-but-playable (contract 4 engine-mismatch / journal-v1.ts): a foreign engineVersion still yields a valid journal', () => {
  const recorded = journalHeader({ engineVersion: '1.0.0+aaa0000' });
  const current = journalHeader({ engineVersion: '1.1.0+bbb1111' });
  // Same ruleset, different build: both headers validate, so replay is not refused
  // merely because the engine moved on (no byte-for-byte comparison is owed).
  assert.equal(isJournalHeader(recorded), true);
  assert.equal(isJournalHeader(current), true);
  assert.equal(recorded.rulesetVersion, current.rulesetVersion);
  const journal = journalFrom(recorded, sealEntries(recorded, [journalEntry()]));
  assert.equal(isJournal(journal), true);
  assert.equal(journal.header.engineVersion, '1.0.0+aaa0000');
});

test('journal-replay-engine-mismatch-flagged-but-playable (contract 4 replay): the recorded engine build does not change the recomputed state', () => {
  const live = newMatch({ seed: 'journal-engine-mismatch' });
  live.match.flow.pass('A');
  const replay = newMatch({ seed: 'journal-engine-mismatch' });
  replay.match.flow.pass('A');
  assert.deepEqual(matchState(replay), matchState(live));
  assert.deepEqual(matchEvents(replay.match), matchEvents(live.match));
  assert.equal(replay.match.result().winner, null);
});

// 缺什么：engineMismatch 是重放结果上的标记，属于 replay-core 的 replayJournal
// （`packages/replay-core/src/v2/replay.ts`：`const engineMismatch = header.engineVersion !== options.engineVersion`）。
// engine-core 新内核没有任何 replay/标记入口，本任务 owns 只有 engine-core 的 golden 目录，
// 因此不在这里用 DTO 伪造重放结果，也不把“标记为 true”写成 engine-core 的断言。
test.todo('journal-replay-engine-mismatch-flagged-but-playable: 缺 replayJournal（replay-core src/v2/replay.ts）返回的 engineMismatch 标记；engine-core 新内核不提供重放入口');
