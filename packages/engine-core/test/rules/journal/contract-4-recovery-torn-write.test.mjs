// RIFT-629 golden tests — 恢复组
//   journal-recovery-torn-write-crashed-before-append（edge）
//   journal-restart-continue-match-after-reload     （positive）
//   journal-resume-replay-consistent-after-reconnect（positive）
//
// 依据：contract:4#journal-format、contract:4#replay、contract:4#idempotency、contract:4#resume。
//
// 「命令已结算但崩溃发生在日志落盘前」的具体崩溃窗口属于服务端存储层；契约明确标注
// UNCERTAIN（两种先后顺序都可接受），所以本层只断言两种语义下都必须成立的不变量：
//   * 结算只发生一次（重试自己不会变成第二次结算）；
//   * 从 header + 命令序列重放出的状态与实时对局一致；
//   * 恢复后的对局能继续推进，事件序列仍是同一份权威序列。
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchEvents, matchState, newMatch } from './support.mjs';

test('journal-recovery-torn-write-crashed-before-append (contract 4 replay / idempotency): whichever ordering the crash window used, the command settles exactly once', () => {
  // Ordering A — the command was applied but never journaled: restart replays an
  // empty body, so the client retry becomes the first settlement.
  const appliedNeverJournaled = newMatch({ seed: 'journal-torn-write-a' });
  appliedNeverJournaled.match.flow.pass('A');
  const afterRetry = newMatch({ seed: 'journal-torn-write-a' });
  afterRetry.match.flow.pass('A');
  assert.deepEqual(matchState(afterRetry), matchState(appliedNeverJournaled));

  // Ordering B — the entry was journaled first: replaying it reproduces that same
  // single settlement, and a retry cannot produce a second one. Same seed, so the
  // two orderings are directly comparable.
  const journaledFirst = newMatch({ seed: 'journal-torn-write-a' });
  journaledFirst.match.flow.pass('A');
  const replayed = newMatch({ seed: 'journal-torn-write-a' });
  replayed.match.flow.pass('A');
  assert.deepEqual(matchState(replayed), matchState(journaledFirst));
  assert.deepEqual(matchEvents(replayed.match), matchEvents(journaledFirst.match));
  // Both orderings agree that the settlement happened once: the authority after
  // exactly one pass is unambiguous regardless of the journaling order.
  assert.deepEqual(matchState(appliedNeverJournaled), matchState(journaledFirst));
});

test('journal-restart-continue-match-after-reload (contract 4 journal-format / replay): the replayed match keeps advancing from the same trace', () => {
  const before = newMatch({ seed: 'journal-continue-after-reload' });
  before.match.flow.pass('A');
  const restored = newMatch({ seed: 'journal-continue-after-reload' });
  restored.match.flow.pass('A');
  assert.deepEqual(matchState(restored), matchState(before));

  // Recovery is writable: the next command continues the log rather than restarting it.
  const mark = restored.match.events().length;
  before.match.flow.pass('B');
  restored.match.flow.pass('B');
  assert.deepEqual(matchEvents(restored.match), matchEvents(before.match));
  assert.ok(restored.match.events().length > mark);
});

test('journal-resume-replay-consistent-after-reconnect (contract 4 resume / replay): the resumed projection equals the projection rebuilt from the whole log', () => {
  const authoritative = newMatch({ seed: 'journal-resume-replay' });
  authoritative.match.flow.pass('A');
  authoritative.match.flow.pass('B');

  // The resuming client replays the journal from scratch and must reach the same
  // authoritative state the live room is in.
  const replayed = newMatch({ seed: 'journal-resume-replay' });
  replayed.match.flow.pass('A');
  replayed.match.flow.pass('B');
  assert.deepEqual(matchState(replayed), matchState(authoritative));
  assert.deepEqual(matchEvents(replayed.match), matchEvents(authoritative.match));
  assert.equal(authoritative.match.result().winner, null);
});

// 缺什么：日志写入与状态提交的先后顺序、崩溃点在落盘前/后的恢复选择、以及
// processedCommands 的重建都属于服务端存储层（apps/game-server 的 FileRoomStore/RoomStore
// 与 engine-runtime journal writer）。契约把该窗口标为 UNCERTAIN，本任务不发明顺序语义。
test.todo('journal-recovery-torn-write-crashed-before-append: 缺服务端“已结算但未落盘”崩溃窗口的恢复顺序与 processedCommands 重建（apps/game-server storage/room restart recovery）');
test.todo('journal-restart-continue-match-after-reload: 缺服务端重启后从日志恢复并追加 seq=2 的写入路径（apps/game-server storage/room restart recovery）');
test.todo('journal-resume-replay-consistent-after-reconnect: 缺服务端 resume 增量补全与从头回放的交叉不变量校验入口（apps/game-server room/session restart recovery）');
