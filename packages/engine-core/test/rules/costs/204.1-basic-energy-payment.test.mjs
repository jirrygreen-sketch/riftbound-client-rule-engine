// CR v1.5 204.1 / 357.1 / 163.1 — scenario costs-basic-energy-payment.
// The ChainEngine Finalize transaction pays the printed Energy cost through
// the real cost layer; the migrated resource kernel covers Rune activation.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  world, makeEngine, unitDraft, printedCost,
  createDuelResources, channelDuelRunes, activateBasicRuneEnergy, payDuelRuneCost,
  BASE_LOCATIONS, basicRune, paymentWindow
} from './harness.mjs';

test('costs-basic-energy-payment: printed Energy is paid during Finalize', () => {
  const kernel = world()
    .player('A', { energy: 2 })
    .player('B', { energy: 0 })
    .hand('unit', { types: ['unit'], energy: 2, power: [], might: 3 })
    .deck(['A:deck:1'], { owner: 'A' })
    .deck(['B:deck:1'], { owner: 'B' })
    .build();
  const { engine } = makeEngine(kernel);

  engine.execute(unitDraft(kernel, 'unit', { cost: printedCost('cost:unit') }));

  // A permanent Finalizes and Resolves immediately, so payment is observed on
  // the resulting state and event stream rather than a retained chain item.
  assert.equal(kernel.player('A').energy, 0);
  assert.equal(kernel.getObject('unit').zone, 'board');
  assert.equal(kernel.getObject('unit').exhausted, true);
  assert.ok(kernel.events.some(event => event.action === 'pay'));
  assert.deepEqual(
    engine.trace.filter(event => ['pending', 'finalized'].includes(event.step)).map(event => `${event.step}:${event.item}`),
    ['pending:unit', 'finalized:unit']
  );
});

test('costs-basic-energy-payment: two Runes add exactly [1][1] before the payment step', () => {
  const runes = [basicRune('rune-1', 'Fury'), basicRune('rune-2', 'Fury')];
  let state = channelDuelRunes(createDuelResources({ playerIds: ['A', 'B'], baseLocations: BASE_LOCATIONS, runeDecks: [runes, []] }), 'A', 2);
  const window = paymentWindow('A');
  state = activateBasicRuneEnergy(state, 'A', 'rune-1', window);
  state = activateBasicRuneEnergy(state, 'A', 'rune-2', window);
  assert.equal(state.players[0].runePool.energy, 2);

  const paid = payDuelRuneCost(state, 'A', { energy: 2, power: [] }, window);
  assert.equal(paid.resources.players[0].runePool.energy, 0);
  assert.deepEqual(paid.resources.bases[0].baseRunes.map(rune => rune.readied), [false, false]);
});
