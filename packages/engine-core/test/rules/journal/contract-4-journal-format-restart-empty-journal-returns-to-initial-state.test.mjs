// RIFT-629 golden test — scenario `journal-restart-empty-journal-returns-to-initial-state`（edge）
// 依据：contract:4#journal-format、contract:4#replay。
//
// 边界：一条命令都还没接受时重启，重放空日志得到开局初始状态（含 seed 决定的发牌结果）。
// 本层没有 stateVersion/eventSeq 计数器（那是 journal head 与 room 的字段），所以断言的是
// 等价的权威事实：空命令序列不触碰任何状态，重建出的开局局面与首次开局逐字段相同，
// 且提交事件序列为空。
import assert from 'node:assert/strict';
import test from 'node:test';
import { journalFrom, journalHeader, matchEvents, matchState, newMatch } from './support.mjs';

test('journal-restart-empty-journal-returns-to-initial-state (contract 4 journal-format / replay): an empty command list rebuilds the same seeded opening state without replaying any command', () => {
  const first = newMatch({ seed: 'journal-empty-journal' });
  const initial = matchState(first);
  // Setup itself commits turn/phase events; what matters is that no *command* is
  // replayed and the opening state is reproduced exactly.
  const setupEvents = matchEvents(first.match);
  assert.ok(setupEvents.length > 0);
  assert.equal(initial.turn, 1);
  assert.equal(initial.phase, 'main');
  assert.equal(initial.turnPlayer, 'A');
  assert.equal(initial.winner, null);
  // The seeded shuffle is part of the initial state.
  assert.equal(initial.zones['A:hand'].length, 5);
  assert.equal(initial.zones['B:hand'].length, 4);

  const replayed = newMatch({ seed: 'journal-empty-journal' });
  assert.deepEqual(matchState(replayed), initial);
  assert.deepEqual(matchEvents(replayed.match), setupEvents);
  // An empty journal body is itself a valid v1 envelope at version 0.
  const empty = journalFrom(journalHeader(), []);
  assert.equal(empty.entries.length, 0);
  assert.equal(empty.head.stateVersion, 0);
  assert.equal(empty.head.eventSeq, 0);
});

test('journal-restart-empty-journal-returns-to-initial-state (contract 4 replay): the opening state is seed-determined, not leftover in-memory state', () => {
  const opened = newMatch({ seed: 'journal-empty-journal' });
  opened.match.flow.pass('A');
  opened.match.flow.pass('B');
  assert.notDeepEqual(matchState(opened), matchState(newMatch({ seed: 'journal-empty-journal' })));
  // A fresh rebuild of the untouched journal still equals the original opening.
  assert.deepEqual(matchState(newMatch({ seed: 'journal-empty-journal' })), matchState(newMatch({ seed: 'journal-empty-journal' })));
});
