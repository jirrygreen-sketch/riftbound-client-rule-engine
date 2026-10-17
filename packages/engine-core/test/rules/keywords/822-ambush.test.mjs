// docs/rules/scenarios/keywords.yaml — Ambush (CR v1.5 822.1.b, 822.3).
//
// Ambush expands to a declarative `play-location-permission` static ability plus a
// `continuous.timing` Reaction grant scoped to a friendly-occupied Battlefield. Both
// bind into the production layer engine (the timing grant is consumed by
// src/layers/rules/query.ts actionTimings); the `play-location-permission` effect has no
// consumer, which the todo names.
import assert from 'node:assert/strict';
import test from 'node:test';
import ambush from '../../../dist/effects/keywords/Ambush.js';
import { createEngineStaticBinder } from '../../../dist/programs/statics.js';
import { actionTimings } from '../../../dist/layers/rules/query.js';
import { c, fixture } from './support.mjs';

const AMBUSH_CARD = 'test:ambush-unit';

const program = {
  canonicalCardId: AMBUSH_CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Ambush]',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

test('keywords-ambush-play-to-friendly-occupied-battlefield: Ambush expands to a Battlefield-scoped play permission and a Reaction grant (CR 822.1.b)', () => {
  assert.equal(ambush.keyword, 'Ambush');
  assert.equal(ambush.valued, false);
  assert.equal(ambush.stacking, 'single');
  assert.ok(ambush.ruleRefs.includes('822.1.b'));
  assert.ok(ambush.ruleRefs.includes('822.3'));

  const abilities = ambush.expand({ host: { canonicalCardId: AMBUSH_CARD } });
  assert.equal(abilities.length, 2);
  const [permission, timing] = abilities;
  assert.equal(permission.kind, 'static');
  assert.equal(permission.effect.kind, 'play-location-permission');
  assert.equal(permission.effect.duration, 'while-in-hand');
  assert.deepEqual(permission.effect.value.value, {
    zone: 'battlefield',
    battlefield: { occupied: true, controller: 'controller' },
    appliesTo: 'self'
  });
  assert.equal(timing.kind, 'static');
  assert.equal(timing.effect.kind, 'continuous.timing');
  assert.deepEqual(timing.effect.grants, ['showdown', 'closed-state']);
  assert.equal(timing.effect.location.zone, 'battlefield');
});

test('keywords-ambush-play-to-friendly-occupied-battlefield: the Reaction grant really reaches the rule query for a friendly-occupied Battlefield (CR 822.1.b)', () => {
  const f = fixture({
    programs: [program],
    setup: w => w.player('B')
      .hand('card', { cardId: AMBUSH_CARD, types: ['unit'], keywords: [{ id: 'Ambush' }], might: 2 })
      .unit('ally', { might: 2, location: { type: 'battlefield', id: 'bf1' } })
      .unit('enemy', { owner: 'B', controller: 'B', might: 3, location: { type: 'battlefield', id: 'bf1' } })
  });
  const binder = createEngineStaticBinder(f.engine);
  const statics = f.binding.inspect(f.get('card')).abilities.filter(ability => ability.kind === 'static');
  // The authored timing grant carries `appliesTo: ["card"]`, a shape the production
  // static binder rejects; the grant is therefore bound here in the same shape the
  // merged ops helper builds, so the rule query can be exercised (see the todo).
  const timing = statics.find(ability => ability.effect.kind === 'continuous.timing');
  assert.deepEqual(timing.effect.grants, ['showdown', 'closed-state']);
  assert.throws(() => binder.bindStatic(timing, f.get('card')), /Unsupported static appliesTo/);
  f.engine.layers.addContinuous({
    id: 'test:ambush-timing', layer: 'ability', source: f.ref('card'), filter: { objectId: 'card' },
    effect: { kind: 'continuous.timing', grants: ['showdown', 'closed-state'] }
  }, { type: 'permanent' });

  const timings = actionTimings(f.engine.layers.registry, f.ref('card'), f.get('card'), 'A');
  assert.ok(timings.includes('showdown'), JSON.stringify(timings));
  assert.ok(timings.includes('closed-state'), JSON.stringify(timings));
  void c;
});

test('keywords-ambush-*: the permission binds through the production static binder’s failure path for the merged kernel', () => {
  const f = fixture({
    programs: [program],
    setup: w => w.player('B').hand('card', { cardId: AMBUSH_CARD, types: ['unit'], keywords: [{ id: 'Ambush' }], might: 2 })
  });
  const binder = createEngineStaticBinder(f.engine);
  const permission = f.binding.inspect(f.get('card')).abilities.find(ability => ability.kind === 'static' && ability.effect.kind === 'play-location-permission');
  assert.throws(
    () => binder.bindStatic(permission, f.get('card')),
    error => error.code === 'judge-required' && /has no layer mapping/.test(error.message)
  );
});

test.todo('keywords-ambush-play-to-friendly-occupied-battlefield / keywords-ambush-invalid-when-no-friendly-units (CR 822.1.b, 822.3): the “play to a Battlefield where I already have a unit” permission is only a declaration — src/programs/statics.ts `layerFor()` has no `play-location-permission` branch (it throws ProgramBindingError judge-required), and its `staticTarget()` rejects the Reaction grant’s authored `appliesTo: ["card"]`, so the grant cannot register through the production binder either; src/chain/engine.ts `playDestinationIsLegal()` only consumes the string `permission`/`restriction` names that src/layers/rules/query.ts `playLocations()` reads, so neither the permission nor its Finalize-time revalidation (822.3) can be executed; the authored shapes and the rule query are asserted above');

test.todo('keywords-ambush-invalid-when-no-friendly-units (CR 822.3): the Finalize-time revalidation (“the Battlefield no longer has a friendly unit, so the Ambush permission does not apply”) needs the same missing play-location consumer plus a Finalize check that re-reads the chosen Battlefield’s occupants');
