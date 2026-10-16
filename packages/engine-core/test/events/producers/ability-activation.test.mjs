import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveAbilityActivatedEmission } from '../../../dist/events/producers/ability-activation.js';

test('ability producer emits only after a committed legal activation', () => {
  const event = deriveAbilityActivatedEmission({
    status: 'committed', chainItemId: 'chain:1', playerId: 'A', sourceId: 'gear:1', abilityId: 'equip:attach'
  });
  assert.equal(event.timingPoint, 'ability-activated');
  assert.deepEqual(event.details, { chainItemId: 'chain:1', playerId: 'A', sourceId: 'gear:1', abilityId: 'equip:attach' });
});

test('ability producer emits nothing for cancelled or countered activation', () => {
  for (const status of ['cancelled', 'countered', 'invalid']) {
    assert.equal(deriveAbilityActivatedEmission({
      status, chainItemId: 'chain:1', playerId: 'A', sourceId: 'gear:1', abilityId: 'equip:attach'
    }), null);
  }
});
