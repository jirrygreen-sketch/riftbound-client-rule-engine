// CR v1.5 163.2.b / 135.2.e.5.a — scenario costs-power-universal-any-domain.
// The migrated resource kernel keeps a universal Power source distinct from the
// six colored domains; it is spent as the chosen requirement's domain.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDuelResources, channelDuelRunes, createDuelGoldToken, activateDuelGoldPower,
  planDuelRunePayment, payDuelRuneCost, BASE_LOCATIONS, basicRune, paymentWindow
} from './harness.mjs';

test('costs-power-universal-any-domain: a Gold universal Power pays an Order requirement', () => {
  let state = channelDuelRunes(
    createDuelResources({ playerIds: ['A', 'B'], baseLocations: BASE_LOCATIONS, runeDecks: [[basicRune('rune-fury', 'Fury')], []] }),
    'A', 1
  );
  state = createDuelGoldToken(state, { uid: 'gold-1', playerId: 'A', locationId: 'base:A', readied: true });
  const window = paymentWindow('A');
  state = activateDuelGoldPower(state, 'A', 'gold-1', window);
  assert.equal(state.players[0].runePool.power.any, 1);
  assert.deepEqual(state.retiredGoldUids, ['gold-1']);

  const cost = { energy: 0, power: [{ allowedDomains: ['Order'], amount: 1 }] };
  const allocation = planDuelRunePayment(state.players[0].runePool, cost);
  assert.deepEqual(allocation.power, [{ requirementIndex: 0, from: 'any', amount: 1 }]);

  const paid = payDuelRuneCost(state, 'A', cost, window, allocation);
  assert.equal(paid.resources.players[0].runePool.power.any, 0);
  assert.equal(paid.resources.players[0].runePool.power.Order, 0);
});
