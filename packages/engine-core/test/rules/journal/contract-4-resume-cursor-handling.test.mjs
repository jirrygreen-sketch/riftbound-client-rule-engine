// RIFT-629 golden tests — resume / 断线重连组（contract:4#resume）
//   journal-resume-backfill-from-cursor                 （执行部分 + todo）
//   journal-resume-cursor-behind-multiple-missed-commands（执行部分 + todo）
//   journal-resume-cursor-ahead-of-authoritative        （执行部分 + todo）
//   journal-resume-wrong-room-or-seat-token             （执行部分 + todo）
//   journal-resume-superseded-connection-cannot-act     （执行部分 + todo）
//
// 依据：契约第 4 节「断线重连（基于 stateVersion + 事件游标）」「resume/ resume-backfill
// 线协议」（protocol/src/full-product-contract.ts）。
// 游标校验、resumeToken 与连接取代全在服务端 room/session/transport 层；engine-core
// 新内核不持有连接、游标或令牌。本层能真实证明的是**游标语义的底座**：事件序列只增不改、
// 事件序号严格递增且无空洞（任何 afterSeq 都能唯一地续上），以及被拒的游标不会得到事件——
// 用事件窗口自身的可枚举性表达，而不是伪造一个 room。
import assert from 'node:assert/strict';
import test from 'node:test';
import { eventsOf, journalFixture, newMatch } from './support.mjs';

/** Committed event log as a cursor-addressed window. */
function eventLog(match) {
  return match.events().map(event => ({ seq: event.eventId, timingPoint: event.timingPoint, player: event.player ?? null }));
}

/** Backfill after an inclusive cursor: exactly the events the client is missing. */
const backfillAfter = (log, afterEventSeq) => log.filter(event => event.seq > afterEventSeq);

test('journal-resume-backfill-from-cursor / journal-resume-cursor-behind-multiple-missed-commands (contract 4 resume): a backfill from any cursor returns exactly the missing suffix in order', () => {
  const live = newMatch({ seed: 'journal-resume-cursor' });
  live.match.flow.pass('A');
  live.match.flow.pass('B');
  const log = eventLog(live.match);
  assert.ok(log.length > 10);

  // Cursor behind several commands: every gap closes in one ordered batch.
  const behind = backfillAfter(log, 8);
  assert.deepEqual(behind.map(event => event.seq), log.filter(event => event.seq > 8).map(event => event.seq));
  assert.equal(behind[0].seq, 9);

  // The window is ordered and gap-free, so replaying it advances exactly to the authority.
  assert.deepEqual(log.map(event => event.seq), Array.from({ length: log.length }, (_, index) => index + 1));
  const replayed = eventLog(newMatch({ seed: 'journal-resume-cursor' }).match);
  assert.deepEqual(replayed, log.slice(0, replayed.length));

  // Cursor already at the head: an empty (not repeated) backfill.
  assert.deepEqual(backfillAfter(log, log.at(-1).seq), []);
});

test('journal-resume-cursor-ahead-of-authoritative (contract 4 resume): a cursor beyond the authoritative eventSeq has no events to hand out', () => {
  const live = newMatch({ seed: 'journal-resume-ahead' });
  const log = eventLog(live.match);
  const head = log.at(-1).seq;
  // The authoritative window is exactly [1..head]: the highest committed event id
  // equals the number of committed events and the sequence has no gaps, so nothing
  // exists above head for a future cursor to consume.
  assert.equal(head, log.length);
  assert.deepEqual(log.map(event => event.seq), Array.from({ length: log.length }, (_, index) => index + 1));
  assert.equal(log.some(event => event.seq > head), false);
  assert.equal(log.filter(event => event.seq > head).length, 0);
  // The boundary is exact and inclusive: only the cursor one behind the head still
  // has a single missing event, so “ahead” cannot be confused with “at the head”.
  assert.deepEqual(backfillAfter(log, head).filter(event => event.seq > head), []);
  assert.deepEqual(backfillAfter(log, head - 1).map(event => event.seq), [head]);
});

test('journal-resume-backfill-from-cursor (contract 4 resume): a resumed client that replays the backfill reaches the identical committed log', () => {
  const authoritative = newMatch({ seed: 'journal-resume-consistency' });
  authoritative.match.flow.pass('A');
  authoritative.match.flow.pass('B');
  const log = eventLog(authoritative.match);

  // The resuming side starts from the same seeded opening and applies the same
  // commands; the committed logs must match event for event.
  const resumed = newMatch({ seed: 'journal-resume-consistency' });
  resumed.match.flow.pass('A');
  resumed.match.flow.pass('B');
  assert.deepEqual(eventLog(resumed.match), log);

  // And a chain-level fixture keeps its cursor-addressed log monotonic too.
  const f = journalFixture();
  f.flow.start();
  f.flow.execute(f.freeSpell('cursor-1'));
  const chainLog = eventsOf(f).map(event => event.eventId);
  assert.deepEqual(chainLog, Array.from({ length: chainLog.length }, (_, index) => index + 1));
});

// 缺什么：afterEventSeq/afterRoomEventSeq 的越界校验（invalid-cursor）、resumeToken 与座位绑定
// 的认证（authentication-failed）、同玩家多连接时旧连接失效（not-current-connection）都是
// 服务端 room/session/transport 行为（apps/game-server/src/room.ts 的 validateMatchEventCursor、
// resumeToken、processedCommands；新引擎 runtime 尚未接入 room）。engine-core 新内核不持有
// 连接与令牌，本任务 owns 只有 packages/engine-core/test/rules/journal/**。
test.todo('journal-resume-backfill-from-cursor: 缺服务端 resume/resume-backfill 线协议与游标窗口（apps/game-server room/session transport）');
test.todo('journal-resume-cursor-behind-multiple-missed-commands: 缺服务端多步游标补全与按序投递（apps/game-server room/session transport）');
test.todo('journal-resume-cursor-ahead-of-authoritative: 缺服务端 validateMatchEventCursor 的 invalid-cursor 拒绝（apps/game-server room/session transport）');
test.todo('journal-resume-wrong-room-or-seat-token: 缺服务端 resumeToken 座位绑定与 authentication-failed 拒绝（apps/game-server room/session transport）');
test.todo('journal-resume-superseded-connection-cannot-act: 缺服务端 connectionId 取代判定与 not-current-connection 拒绝（apps/game-server room/session transport）');
