// RIFT-629 golden test — scenario `journal-replay-per-view-projection-matches`（positive）
// 依据：contract:4#replay、contract:5#full-match。
//
// 回放不只校验终局比分：A/B/观众三种视角的投影都要与实时对局逐字段一致，
// 特别是 spectator 视角下手牌等隐私字段必须保持隐藏。被测对象是
// src/projection/v2/project-for.ts，输入由权威内核对象构造（不是 DTO）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchState, newMatch, projectFor, projectionInput } from './support.mjs';

const identityCount = (projection, player, zone) =>
  projection.players[player][zone].cards.filter(card => card.visibility === 'identity').length;

test('journal-replay-per-view-projection-matches (contract 4 replay / contract 5 full-match): A, B and the spectator each get their own consistent projection', () => {
  const live = newMatch({ seed: 'journal-per-view' });
  const replayed = newMatch({ seed: 'journal-per-view' });
  for (const target of [live, replayed]) {
    target.match.flow.pass('A');
    target.match.flow.pass('B');
  }
  assert.deepEqual(matchState(replayed), matchState(live));

  const input = projectionInput(live);
  const asA = projectFor(input, 'A');
  const asB = projectFor(input, 'B');
  const spectator = projectFor(input, null);

  // Own hand identities are visible; the opponent's hand is only a count.
  assert.equal(identityCount(asA, 'A', 'hand'), asA.players.A.hand.count);
  assert.equal(identityCount(asA, 'B', 'hand'), 0);
  assert.equal(asA.players.B.hand.count, live.kernel.objectsInZone('B', 'hand').length);
  assert.equal(identityCount(asB, 'B', 'hand'), asB.players.B.hand.count);
  assert.equal(identityCount(asB, 'A', 'hand'), 0);
  // The spectator sees no hand identity for either seat, but keeps the counts.
  assert.equal(identityCount(spectator, 'A', 'hand'), 0);
  assert.equal(identityCount(spectator, 'B', 'hand'), 0);
  assert.equal(spectator.players.A.hand.count, asA.players.A.hand.count);
  assert.equal(spectator.players.B.hand.count, asA.players.B.hand.count);
  // Deck identity never leaves the privacy boundary, not even to the owner.
  assert.equal(asA.players.A.deck.identitiesVisible, false);
  assert.equal(spectator.players.B.deck.identitiesVisible, false);

  // Replaying the same journal rebuilds identical per-view projections.
  const replayInput = projectionInput(replayed);
  assert.deepEqual(projectFor(replayInput, 'A'), asA);
  assert.deepEqual(projectFor(replayInput, 'B'), asB);
  assert.deepEqual(projectFor(replayInput, null), spectator);
});
