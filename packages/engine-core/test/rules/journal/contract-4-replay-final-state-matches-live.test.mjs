// RIFT-629 golden test — scenario `journal-replay-final-state-matches-live`（positive）
// 依据：contract:4#replay、contract:5#full-match。
//
// 契约第 5 节整局回归要求「终局一致、重放一致」；回放不重发任何网络消息，只用 header
// （seed + setup 决定）+ 命令序列重算。这里用真实 createMatch 建两局相同种子的对局：
// 一局作为实时对局，另一局作为“从日志重算”的对照，执行同一条命令序列后比较终局结果、
// 逐字段状态与提交事件序列。src/duel/ 与 src/core/ 不参与。
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchEvents, matchState, newMatch } from './support.mjs';

test('journal-replay-final-state-matches-live (contract 4 replay / contract 5 full-match): recomputing from the seeded header and command list reproduces the live final state', () => {
  const live = newMatch({ seed: 'journal-replay-live' });
  const replayed = newMatch({ seed: 'journal-replay-live' });

  // Same commands, same order: pass A, pass B, concede A.
  live.match.flow.pass('A');
  replayed.match.flow.pass('A');
  live.match.flow.pass('B');
  replayed.match.flow.pass('B');
  live.concede('A');
  replayed.concede('A');

  assert.equal(live.match.result().winner, 'B');
  assert.equal(replayed.match.result().winner, 'B');
  assert.deepEqual(replayed.match.result(), live.match.result());
  assert.deepEqual(matchState(replayed), matchState(live));
  // The committed event trace is the replay-visible consequence of the commands.
  assert.deepEqual(matchEvents(replayed.match), matchEvents(live.match));
});

test('journal-replay-final-state-matches-live (contract 4 replay): the header seed is the only setup entropy, so a different seed is a different match', () => {
  const first = newMatch({ seed: 'journal-seed-one' });
  const second = newMatch({ seed: 'journal-seed-two' });
  assert.deepEqual(matchState(newMatch({ seed: 'journal-seed-one' })), matchState(first));
  assert.notDeepEqual(matchState(second), matchState(first));
});
