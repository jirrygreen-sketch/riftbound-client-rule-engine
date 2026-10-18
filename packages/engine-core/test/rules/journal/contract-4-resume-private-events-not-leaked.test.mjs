// RIFT-629 golden test — scenario `journal-resume-private-events-not-leaked`（edge）
// 依据：contract:4#resume、contract:5#full-match、CR v1.5 312（任意时刻至多一名玩家持有优先权）。
//
// 「补发事件按视角过滤：对手隐私信息不出现在自己的回填流」。回填流是投影的输出，
// 因此被测对象是 src/projection/v2/project-for.ts 的事件视图：B 从手牌打出这一私密事实
// 对 A 不可见（身份被投影为 viewer-scoped 的不透明引用），A 只能看到链项 pending/finalized
// 等公开时点；B 自己仍能读到该事件的身份。事件载荷与状态对象使用同一套隐私过滤。
import assert from 'node:assert/strict';
import test from 'node:test';
import { world } from '../../../dist/effects/testing/test-kernel.js';
import { projectFor } from './support.mjs';

/** A resume-backfill shaped event window: public chain events around B's private hand play. */
function resumeWindow(kernel) {
  const hand = kernel.objectsInZone('B', 'hand')[0];
  return {
    kernel,
    stateVersion: 6,
    eventSeq: 11,
    phase: 'main',
    objects: kernel.objects.map(object => ({
      id: object.ref.id, zoneEntryId: object.ref.zoneEntryId, zone: object.zone,
      owner: object.owner, controller: object.controller, cardId: object.cardId, name: object.name,
    })),
    players: { A: { id: 'A' }, B: { id: 'B', hand: [hand] } },
    events: [
      { seq: 9, type: 'chain.item-pending', timingPoint: 'chain-item-pending', item: 'B:c9' },
      { seq: 10, type: 'zone.leave', timingPoint: 'zone-leave', object: hand, owner: 'B' },
      { seq: 11, type: 'chain.item-finalized', timingPoint: 'chain-item-finalize', item: 'B:c9' },
    ],
  };
}

test('journal-resume-private-events-not-leaked (contract 4 resume / 5 full-match / CR 312): backfill keeps the opponent hand-play fact private to its owner', () => {
  const kernel = world().player('A').player('B').hand('hB', { owner: 'B', cardId: 'card-hidden' }).build();
  const state = resumeWindow(kernel);

  const asA = projectFor(state, 'A');
  const asB = projectFor(state, 'B');
  const spectator = projectFor(state, null);

  // Every backfilled event is delivered, in order, to every view.
  assert.deepEqual(asA.events.map(event => event.seq), [9, 10, 11]);
  assert.deepEqual(asB.events.map(event => event.seq), [9, 10, 11]);
  assert.deepEqual(spectator.events.map(event => event.seq), [9, 10, 11]);

  // The public chain timings stay intact for A.
  assert.deepEqual(asA.events.filter(event => event.seq !== 10).map(event => event.item), ['B:c9', 'B:c9']);

  // seq 10 is B's private zone-leave; A must not learn the card identity.
  const privateForA = asA.events.find(event => event.seq === 10);
  assert.equal(privateForA.object.cardId, undefined);
  assert.equal(privateForA.object.name, undefined);
  assert.equal(privateForA.object.visibility, 'face-down');
  assert.equal(JSON.stringify(privateForA).includes('card-hidden'), false);
  assert.equal(JSON.stringify(privateForA).includes('hB'), false);
  const privateForSpectator = spectator.events.find(event => event.seq === 10);
  assert.equal(JSON.stringify(privateForSpectator).includes('card-hidden'), false);
  assert.equal(privateForSpectator.object.visibility, 'face-down');

  // The owner still sees the real identity of their own private event.
  assert.equal(asB.events.find(event => event.seq === 10).object.cardId, 'card-hidden');
  assert.equal(asB.events.find(event => event.seq === 10).object.visibility, 'identity');
});

test('journal-resume-private-events-not-leaked (contract 5 full-match): the same privacy boundary holds for the state carried with the backfill', () => {
  const kernel = world().player('A').player('B').hand('hB', { owner: 'B', cardId: 'card-hidden' })
    .hand('hA', { owner: 'A', cardId: 'card-own' }).build();
  const state = resumeWindow(kernel);
  state.players.A = { id: 'A', hand: kernel.objectsInZone('A', 'hand') };

  const asA = projectFor(state, 'A');
  assert.equal(asA.players.B.hand.cards.every(card => card.visibility === 'face-down'), true);
  assert.equal(asA.players.B.hand.count, 1);
  assert.equal(asA.players.A.hand.cards[0].visibility, 'identity');
  assert.equal(JSON.stringify(asA).includes('card-hidden'), false);
});
