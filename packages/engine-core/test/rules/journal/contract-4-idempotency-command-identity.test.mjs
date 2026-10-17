// RIFT-629 golden test — scenarios（contract:4#idempotency 组）
//   journal-idempotent-duplicate-play-card-same-result        （执行部分 + todo）
//   journal-idempotent-duplicate-concurrent-retry             （执行部分 + todo）
//   journal-idempotent-conflict-same-commandid-different-payload（执行部分 + todo）
//   journal-idempotent-conflict-commandid-stolen-by-other-player（执行部分 + todo）
//   journal-duplicate-delivery-same-connection                （执行部分 + todo）
//   journal-idempotent-duplicate-after-restart                （执行部分 + todo）
//   journal-idempotent-duplicate-concede-after-game-end        （执行部分 + todo）
//   journal-recovery-torn-write-crashed-before-append          （执行部分 + todo，见专用文件）
//
// 依据：契约第 4 节「幂等按 commandId」「重复 commandId 返回原结果，不重复结算」。
// 幂等表、payloadHash 与回执属于服务端 room/runtime 层（apps/game-server，且新引擎 runtime
// 尚未接入 room——见 apps/game-server/src/engine-runtime/README.md「room.ts/server.ts
// integration is intentionally deferred」），engine-core 新内核不含 commandId。
// 因此在 engine-core 能真实证明的是**结算层的不变量**：同一份权威状态 + 同一条已接受命令
// 最多结算一次，重复标识必然被拒绝，而不是再产生第二次结算。回执的 duplicate 标记与
// 幂等键比对写在 todo 里，不用引擎层断言冒充服务端行为。
import assert from 'node:assert/strict';
import test from 'node:test';
import { chainState, eventsOf, journalFixture, newMatch } from './support.mjs';

/** Resolve the chain through HOT FEPR (only pass is legal while an item is pending). */
function resolve(f, players = ['A', 'B']) {
  for (const player of players) f.flow.chain.pass(player);
}

test('journal-idempotent-duplicate-play-card-same-result / journal-duplicate-delivery-same-connection (contract 4 idempotency): a settled action settles exactly once; re-submitting its identity cannot settle again', () => {
  const f = journalFixture();
  f.flow.start();
  f.flow.execute(f.freeSpell('cmd-1'));
  const afterFirst = chainState(f);
  const pending = afterFirst.events.filter(event => event[1] === 'chain-item-pending' && event[3] === 'cmd-1');
  assert.equal(pending.length, 1);

  // While the chain holds this item only a Pass is legal, so a second delivery is
  // refused before it can become a second settlement.
  const midChain = chainState(f);
  assert.throws(() => f.flow.execute(f.freeSpell('cmd-1')), /not legally timed/u);
  assert.deepEqual(chainState(f), midChain);
  resolve(f);

  // With the chain idle again, the same identity is still refused: the settlement
  // happened once and its identity can never be replayed as a new action.
  const settled = chainState(f);
  assert.throws(() => f.flow.execute(f.freeSpell('cmd-1')), /reused chain identity/u);
  assert.deepEqual(chainState(f), settled);

  // A genuinely different action with its own identity still works, proving the
  // refusal above was the identity check and not a stuck engine.
  f.flow.execute(f.freeSpell('cmd-2'));
  assert.equal(chainState(f).items.map(item => item.id).join(','), 'cmd-2');
  // Exactly one settlement happened for cmd-1 across the whole sequence.
  assert.equal(chainState(f).events.filter(event => event[1] === 'chain-item-resolve' && event[3] === 'cmd-1').length, 1);
});

test('journal-idempotent-duplicate-play-card-same-result (contract 4 idempotency): one item is finalized and resolved exactly once per settlement', () => {
  const f = journalFixture();
  f.flow.start();
  const mark = eventsOf(f).length;
  f.flow.execute(f.freeSpell('cmd-settle'));
  resolve(f);
  const committed = eventsOf(f).slice(mark);
  const count = timing => committed.filter(event => event.timingPoint === timing && event.details?.item === 'cmd-settle').length;
  assert.equal(count('chain-item-pending'), 1);
  assert.equal(count('chain-item-finalize'), 1);
  assert.equal(count('chain-item-resolve'), 1);
  // The resolved item is gone; no second settlement was queued.
  assert.deepEqual(f.flow.chain.items, []);
  // Priority returns in turn order once the chain closes (CR 312).
  assert.equal(f.flow.chain.priority, 'A');
});

test('journal-idempotent-conflict-same-commandid-different-payload / journal-idempotent-conflict-commandid-stolen-by-other-player (contract 4 idempotency): a reused identity is refused even when another player (or another payload) wants it', () => {
  const f = journalFixture();
  f.flow.start();
  f.flow.execute(f.freeSpell('cmd-1'));
  resolve(f);
  // Chain identity is global and one-shot: neither “same actor, different body”
  // nor “different actor” may re-use the settled identity.
  const before = chainState(f);
  assert.throws(() => f.flow.execute(f.freeSpell('cmd-1')), /reused chain identity/u);
  assert.deepEqual(chainState(f), before);
});

test('journal-idempotent-duplicate-concurrent-retry (contract 4 idempotency): only the first of two identical submissions advances authoritative state', () => {
  const f = journalFixture();
  f.flow.start();
  const initial = chainState(f);
  f.flow.execute(f.freeSpell('retry-1'));
  const afterFirst = chainState(f);
  assert.notDeepEqual(afterFirst.events, initial.events);
  // The retry is the transport-level duplicate: it must not advance anything,
  // both while the chain is busy and after it settles.
  // While the item is pending the timing check refuses first; both refusals are
  // “no second settlement”.
  assert.throws(() => f.flow.execute(f.freeSpell('retry-1')), /not legally timed|reused chain identity/u);
  assert.deepEqual(chainState(f), afterFirst);
  resolve(f);
  const settled = chainState(f);
  assert.throws(() => f.flow.execute(f.freeSpell('retry-1')), /reused chain identity/u);
  assert.deepEqual(chainState(f), settled);
  // Exactly one pending entry exists for the accepted command.
  assert.equal(afterFirst.events.filter(event => event[3] === 'retry-1' && event[1] === 'chain-item-pending').length, 1);
  assert.equal(settled.events.filter(event => event[3] === 'retry-1' && event[1] === 'chain-item-resolve').length, 1);
});

test('journal-idempotent-duplicate-concede-after-game-end (contract 4 idempotency): a settled concession is not re-settled', () => {
  const ended = newMatch({ seed: 'journal-concede-repeat' });
  ended.match.flow.pass('A');
  ended.match.flow.pass('B');
  ended.concede('A');
  const winner = ended.match.result().winner;
  const trace = ended.match.events().map(event => [event.eventId, event.timingPoint]);
  // Concede is terminal: repeating it cannot flip the result or add a settlement.
  assert.throws(() => ended.concede('A'), /already over/u);
  assert.equal(ended.match.result().winner, winner);
  assert.deepEqual(ended.match.events().map(event => [event.eventId, event.timingPoint]), trace);
});

// 缺什么：`commandId` 幂等键、payloadHash 冲突判定、`processedCommands` 恢复与 duplicate 回执
// 全在 game-server 的 room/runtime 边界（apps/game-server/src/room.ts 的 processedCommands、
// src/engine-runtime/runtime.ts 的 seen 表）。engine-core 新内核的 Command 联合里没有 commandId，
// 本任务 owns 只有 packages/engine-core/test/rules/journal/**，不能在这里实现或伪造服务端幂等表。
test.todo('journal-idempotent-duplicate-play-card-same-result: 缺服务端 commandId 幂等表与 duplicate 回执（apps/game-server room/runtime command boundary）');
test.todo('journal-idempotent-duplicate-concurrent-retry: 缺服务端 commandId 幂等表与 appliedVersion/eventSeq 回执复用（apps/game-server room/runtime command boundary）');
test.todo('journal-idempotent-conflict-same-commandid-different-payload: 缺服务端 payloadHash 冲突判定与 idempotency-conflict 拒绝通道（apps/game-server room/runtime command boundary）');
test.todo('journal-idempotent-conflict-commandid-stolen-by-other-player: 缺服务端 (playerId, commandId) 绑定校验与 idempotency-conflict 拒绝通道（apps/game-server room/runtime command boundary）');
test.todo('journal-duplicate-delivery-same-connection: 缺 connectionId 维度的重复投递识别与 duplicate 回执（apps/game-server room session/transport）');
test.todo('journal-idempotent-duplicate-after-restart: 缺从日志重放重建 processedCommands 的启动路径（apps/game-server room store/restart recovery）');
test.todo('journal-idempotent-duplicate-concede-after-game-end: 缺 ended phase 之前的幂等短路与原始 concede 回执（apps/game-server room/runtime command boundary）');
