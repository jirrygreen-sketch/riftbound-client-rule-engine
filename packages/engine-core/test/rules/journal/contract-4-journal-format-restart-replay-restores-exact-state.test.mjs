// RIFT-629 golden test — scenario `journal-restart-replay-restores-exact-state`（positive）
// 依据：contract:4#journal-format、contract:4#replay。
//
// 「重放 header + 命令序列应得到与崩溃前逐字段一致的状态」。本层可证明的部分：
// 同一 seed + 同一 setup 决定 + 同一命令序列，在新进程里重建出的对局状态与事件序列
// 逐字段相同（durability 的最小用例）。持久化本身（FileRoomStore、重启恢复）属于
// game-server 的 room/session 层，本层不含，因此不在这里伪造“进程重启”。
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchEvents, matchState, newMatch } from './support.mjs';

test('journal-restart-replay-restores-exact-state (contract 4 journal-format / replay): replaying the same seeded header and command list restores the exact authoritative state', () => {
  const before = newMatch({ seed: 'journal-restart-exact' });
  const commandList = [() => before.match.flow.pass('A'), () => before.match.flow.pass('B')];
  for (const command of commandList) command();

  const snapshot = matchState(before);
  const events = matchEvents(before.match);
  assert.equal(snapshot.turnPlayer, 'A');
  assert.ok(events.length > 0);

  // "Restart": a fresh match over the same header (seed + setup) replayed with the
  // recorded command sequence must land on identical state and events.
  const after = newMatch({ seed: 'journal-restart-exact' });
  after.match.flow.pass('A');
  after.match.flow.pass('B');
  assert.deepEqual(matchState(after), snapshot);
  assert.deepEqual(matchEvents(after.match), events);
  // Repeating the rebuild is stable (no in-memory scheduling leaks into the result).
  const again = newMatch({ seed: 'journal-restart-exact' });
  again.match.flow.pass('A');
  again.match.flow.pass('B');
  assert.deepEqual(matchState(again), snapshot);
});

test('journal-restart-replay-restores-exact-state (contract 4 replay): the restored match keeps playing and appends to the same trace', () => {
  const before = newMatch({ seed: 'journal-restart-continue' });
  before.match.flow.pass('A');
  before.match.flow.pass('B');
  const restored = newMatch({ seed: 'journal-restart-continue' });
  restored.match.flow.pass('A');
  restored.match.flow.pass('B');

  // Recovery is not a read-only snapshot: the rebuilt match accepts new commands
  // and appends to the same trace, continuing from the replayed state.
  const mark = restored.match.events().length;
  before.match.flow.pass('A');
  restored.match.flow.pass('A');
  before.match.flow.pass('B');
  restored.match.flow.pass('B');
  assert.deepEqual(matchEvents(restored.match), matchEvents(before.match));
  assert.ok(restored.match.events().length > mark);
});
