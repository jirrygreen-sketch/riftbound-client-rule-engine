// CR v1.5 204.1 / 163.2 / 163.2.a.1 — scenario costs-basic-power-domain-match.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  world, makeEngine, spellDraft, printedCost,
  createDuelResources, channelDuelRunes, activateBasicRunePower, payDuelRuneCost,
  BASE_LOCATIONS, basicRune, paymentWindow
} from './harness.mjs';

test('costs-basic-power-domain-match: Calm Power pays a Calm requirement', () => {
  const kernel = world()
    .player('A', { energy: 0, power: ['Calm'] })
    .player('B', { energy: 0 })
    .hand('spell', { types: ['spell'], energy: 0, power: ['Calm'] })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(spellDraft(kernel, 'spell', { cost: printedCost('cost:spell') }));

  const item = engine.items[0];
  assert.equal(item.status, 'finalized');
  assert.deepEqual(item.costPlan.total.power, [{ amount: 1, allowedDomains: ['Calm'] }]);
  assert.deepEqual(item.payment.actions[0].action.plan.power, ['Calm']);
});

test('costs-basic-power-domain-match: recycling a Rune returns it and spends its Power', () => {
  const state = channelDuelRunes(
    createDuelResources({ playerIds: ['A', 'B'], baseLocations: BASE_LOCATIONS, runeDecks: [[basicRune('rune-calm', 'Calm')], []] }),
    'A', 1
  );
  const window = paymentWindow('A');
  const powered = activateBasicRunePower(state, 'A', 'rune-calm', window);
  assert.equal(powered.players[0].runePool.power.Calm, 1);
  assert.equal(powered.players[0].runeDeck.length, 1);

  const paid = payDuelRuneCost(powered, 'A', { energy: 0, power: [{ allowedDomains: ['Calm'], amount: 1 }] }, window);
  assert.equal(paid.resources.players[0].runePool.power.Calm, 0);
  assert.equal(paid.resources.players[0].runeDeck.length, 1);
});
