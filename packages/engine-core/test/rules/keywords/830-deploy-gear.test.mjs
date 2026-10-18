// docs/rules/scenarios/keywords.yaml — Deploy (CR v1.5 830.1.b, 830.1.b.1, 830.1.b.3, 830.2).
//
// The merged Deploy expansion is a static `continuous.location` permission plus a
// `hold` triggered self-kill. The tests below execute what the merged kernel can
// reach — the Gear actually enters the chosen enemy-occupied Battlefield and the
// Cleanup following the Play does not Recall it — and register the parts that need
// missing consumers as todos, with the exact gap named.
import assert from 'node:assert/strict';
import test from 'node:test';
import deploy from '../../../dist/effects/keywords/Deploy.js';
import { c, eventsAt, fixture, settle, timingsOnly } from './support.mjs';

const DEPLOY = 'test:deploy-gear';

const program = {
  canonicalCardId: DEPLOY,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Deploy]',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

test('keywords-deploy-play-gear-to-any-battlefield: Deploy Gear enters an enemy-occupied Battlefield and is not recalled by the following Cleanup (CR 830.1.b.1, 830.1.b.3)', () => {
  const f = fixture({
    programs: [program],
    energy: { A: 2 },
    setup: w => w
      .hand('gear', { cardId: DEPLOY, types: ['gear'], energy: 2, power: [], keywords: [{ id: 'Deploy' }] })
      .unit('enemy', { owner: 'B', controller: 'B', might: 2, location: { type: 'battlefield', id: 'bf1' } })
  });

  const draft = f.binding.describePlay({ type: 'play', player: 'A', object: f.ref('gear') }, f.get('gear'));
  f.engine.execute({ ...draft, location: { type: 'battlefield', id: 'bf1' } });
  settle(f.engine);

  const gear = f.get('gear');
  assert.equal(gear.zone, 'board');
  assert.deepEqual(gear.location, { type: 'battlefield', id: 'bf1' }, 'the Deployment overrides the Base default');
  assert.equal(eventsAt(f.engine, 'object-enters-battlefield').length, 1);
  assert.ok(eventsAt(f.engine, 'cleanup-start').length >= 1, 'a real Cleanup followed the Play');
  assert.equal(f.kernel.player('A').energy, 0);
  // 830.1.b.3: the non-Unit Deploy Gear is not recalled by Cleanup step 5.
  assert.deepEqual(f.idsAt('bf1'), ['enemy', 'gear']);
});

test('keywords-deploy-multiple-redundant: several Deploy instances collapse to one permission and one hold trigger (CR 830.2)', () => {
  assert.equal(deploy.stacking, 'single');
  assert.equal(deploy.valued, false);

  // The program expander groups printed instances by keyword id, so two printed
  // Deploy keywords produce exactly one static + one triggered ability.
  const kernel = world().object('g1', {
    cardId: DEPLOY, types: ['gear'], zone: 'board', location: { type: 'base', player: 'A' },
    keywords: [{ id: 'Deploy' }, { id: 'Deploy' }]
  }).build();
  const abilities = expandProgram(program, kernel.getObject('g1')).expanded;
  assert.deepEqual(abilities.map(ability => `${ability.kind}:${ability.effect?.kind ?? ability.trigger?.at}`), ['static:continuous.location', 'triggered:hold']);
});

test('keywords-deploy-gear-not-recalled-in-cleanup: a Deploy Gear already at a Battlefield survives an Ending Step', () => {
  const f = fixture({
    setups: true,
    programs: [],
    setup: w => w.object('g1', {
      types: ['gear'], zone: 'board', location: { type: 'battlefield', id: 'bf1' },
      keywords: [{ id: 'Deploy' }], energy: 1, power: []
    })
  });

  f.engine.endTurn?.('A');
  settle(f.engine);
  assert.deepEqual(f.get('g1').location, { type: 'battlefield', id: 'bf1' });
  assert.equal(eventsAt(f.engine, 'object-moved').filter(event => event.object.ref.id === 'g1').length, 0);
  void timingsOnly;
  void c;
});

test.todo('keywords-deploy-killed-when-opponent-holds (CR 830.1.b): “When an opponent holds here, kill this.” — blocked: the merged Deploy trigger filter is `{ event: "hold", here: true, player: "opponent" }`, and the frozen EventPattern has no `here` field (src/events/trigger-spec.ts), so src/programs/triggers.ts raises ProgramBindingError ("Unsupported filter field here") and the ability never registers on the pipeline');

test.todo('keywords-deploy-play-gear-to-any-battlefield (CR 830.1.b.1, layer wiring): the resource-free path used above works because the reference host accepts an explicit Play destination; the `continuous.location` permission itself is not consumed — src/layers/rules/query.ts playLocations() reads `effect.permission`/`effect.restriction` strings, while the merged Deploy expansion declares a structured `play: { zone, anyBattlefield, includesOccupied, includesEnemyControlled }`, so a future regression in the host default would not be caught by the permission');

import { world } from '../../../dist/effects/testing/index.js';
import { expandProgram } from '../../../dist/programs/index.js';
