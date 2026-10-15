import test from 'node:test';
import assert from 'node:assert/strict';
import { isDuelPublicChainSummaryV3Actions1 } from '../dist/duel-actions-contract-v3.js';

const seats = ['p1', 'p2'];
const duplicateCards = {
  active: true,
  itemCount: 2,
  pendingCount: 1,
  cards: [
    { cardId: 'premonition', controllerPlayerId: 'p1', status: 'pending' },
    { cardId: 'premonition', controllerPlayerId: 'p1', status: 'finalized' }
  ]
};

test('public Chain allows repeated printings and validates status count', () => {
  assert.equal(isDuelPublicChainSummaryV3Actions1(duplicateCards, seats), true);
  assert.equal(isDuelPublicChainSummaryV3Actions1({ ...duplicateCards, pendingCount: 2 }, seats), false);
});

test('public Chain rejects private fields and unknown controllers', () => {
  assert.equal(isDuelPublicChainSummaryV3Actions1({ ...duplicateCards, paymentId: 'secret' }, seats), false);
  assert.equal(isDuelPublicChainSummaryV3Actions1({
    ...duplicateCards,
    cards: duplicateCards.cards.map(card => ({ ...card, controllerPlayerId: 'intruder' }))
  }, seats), false);
  assert.equal(isDuelPublicChainSummaryV3Actions1({ active: false, cards: [] }, seats), false);
});

test('public Chain preserves repeated identical rows for different physical copies', () => {
  const row = { cardId: 'premonition', controllerPlayerId: 'p1', status: 'pending' };
  assert.equal(isDuelPublicChainSummaryV3Actions1({ active: true, itemCount: 2,
    pendingCount: 2, cards: [row, { ...row }] }, seats), true);
  assert.equal(isDuelPublicChainSummaryV3Actions1({ active: true, itemCount: 2,
    pendingCount: 2, cards: [{ ...row, uid: 'private' }, { ...row }] }, seats), false);
});
