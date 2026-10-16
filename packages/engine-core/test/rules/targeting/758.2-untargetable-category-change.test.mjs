// Scenario: targeting-untargetable-category-change (CR v1.5 758.2)
//
// Untargetability is judged by category. While the object still belongs to the
// restricted category the spell cannot choose it; once it no longer matches,
// the same spell may choose it again.
import assert from 'node:assert/strict';
import test from 'node:test';
import { queryTargetCandidates } from '../../../dist/target/target-plan.js';
import { world } from '../../../dist/effects/testing/index.js';
import { atBase } from './harness.mjs';

test('targeting-untargetable-category-change: category membership decides targetability', () => {
  const kernel = world()
    .player('A', {})
    .player('B', {})
    .build();
  // "I can't be chosen by enemy spells and abilities while I'm a gear."
  const isGear = snapshot => snapshot.types.includes('gear');
  const requirement = { id: 'g1', filter: { zone: 'board', controller: 'B' } };

  kernel.addObject({
    ref: { id: 'g1', zoneEntryId: 1 }, cardId: 'card:g1', name: 'g1', types: ['gear'], tags: [], keywords: [],
    owner: 'B', controller: 'B', zone: 'board', location: atBase('B'), might: null, energy: null, power: null,
    exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  }, 'board');

  const restricted = queryTargetCandidates(kernel, requirement, { isLegal: snapshot => !isGear(snapshot) });
  assert.deepEqual(restricted, [], '758.2: the restricted category is not a legal target');

  // The object stops being a gear; 758.2 applies by category, so it becomes legal.
  kernel.addObject({
    ref: { id: 'g1', zoneEntryId: 1 }, cardId: 'card:g1', name: 'g1', types: ['unit'], tags: [], keywords: [],
    owner: 'B', controller: 'B', zone: 'board', location: atBase('B'), might: 2, energy: null, power: null,
    exhausted: false, damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
  }, 'board');
  const afterChange = queryTargetCandidates(kernel, requirement, { isLegal: snapshot => !isGear(snapshot) });
  assert.deepEqual(afterChange, [kernel.ref('g1')], 'the same spell may choose it after the category change');
});
