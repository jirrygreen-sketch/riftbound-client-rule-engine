// RIFT-1165 production-path provenance for Treasure Hoard (SFD-220/221):
// "When you conquer here, you may pay :rb_energy_1: to play a Gold gear token
// exhausted."
//
// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 383.3.a: a leading "you may" is decided by the controller during Finalize.
// - 383.3.d: one controller orders multiple abilities triggered simultaneously.
// - 405.1/.2: accepted costs are paid in Finalize; declining an incurred cost
//   removes the Triggered Ability without resolving it.
// canonicalCardId: card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564.
import assert from 'node:assert/strict';
import test from 'node:test';

import treasureHoard from '../../../card-dsl/dist/cards/sfd/treasure-hoard.js';
import poro from '../../../card-dsl/dist/cards/sfd/plundering-poro.js';
import gold from '../../../card-dsl/dist/cards/sfd/gold.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { triggerRegistrations } from '../../dist/programs/triggers.js';

function battlefield(id, card) {
  return {
    ref: { id, zoneEntryId: 2 }, cardId: card.canonicalCardId, name: 'Treasure Hoard',
    types: ['battlefield'], tags: [], keywords: [], owner: 'A', controller: 'A',
    zone: 'board', location: { type: 'battlefield', id }, combatRole: null,
    might: null, energy: null, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: true,
  };
}

test('RIFT-1165 Treasure Hoard binds as a Finalize may and uses Gold exhausted entry', () => {
  const source = battlefield('treasure-field', treasureHoard);
  const binding = createProgramBinding({ cardPrograms: [treasureHoard, poro, gold] });
  const [registration] = triggerRegistrations(binding.registry, source);
  assert.ok(registration);
  assert.equal(registration.spec.at, 'conquer');
  assert.equal(registration.mayAtFinalize, true);
  assert.deepEqual(registration.cost?.cost.energy, { kind: 'constant', value: 1 });
  assert.equal(registration.body.some(instruction => instruction.op === 'effect.token'), true);
  assert.equal(registration.body.some(instruction => instruction.op === 'cost.pay'), false,
    'the leading cost moved to Finalize and will not be paid twice on Resolve');
  const token = registration.body.find(instruction => instruction.op === 'effect.token');
  assert.equal(token.args.entersExhausted.value, true);
  assert.equal(token.args.location.value, 'ability-controller-base');
});
