// docs/rules/scenarios/keywords.yaml — Hidden (CR v1.5 811.1.b, 811.1.c, 811.1.d.1, 811.1.d.2, 811.1.d.3.a, 811.3, 811.5.a, 811.6).
//
// The merged Hidden expansion is a static `cost.hidden` declaration. The merged cost
// layer already exposes a real Hide plan (`buildHiddenCostPlan` / `payHiddenCostPlan`
// in src/cost/kinds/hidden.ts), so the tests below execute that plan against a real
// position and register the facedown-play half as todos with the exact missing
// consumers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHiddenCostPlan, payHiddenCostPlan } from '../../../dist/cost/kinds/index.js';
import hidden from '../../../dist/effects/keywords/Hidden.js';
import { bindResolveContext } from '../../../dist/events/action-adapter.js';
import { c, world } from './support.mjs';

const HIDDEN = 'test:hidden-card';

const program = {
  canonicalCardId: HIDDEN,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Hidden]',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

test('keywords-hidden-hide-from-hand: Hidden expands to the static hidden-cost declaration (CR 811.1.b, 811.1.c)', () => {
  assert.equal(hidden.keyword, 'Hidden');
  assert.equal(hidden.valued, false);
  assert.equal(hidden.stacking, 'single');
  const abilities = hidden.expand({ host: { canonicalCardId: HIDDEN } });
  assert.equal(abilities.length, 1);
  assert.equal(abilities[0].kind, 'static');
  assert.deepEqual(abilities[0].effect, { kind: 'cost.hidden' });
  assert.ok(hidden.ruleRefs.includes('811.1.b'));
  assert.ok(hidden.ruleRefs.includes('811.5.a'));
});

test('keywords-hidden-hide-from-hand: the merged Hide plan charges one [A] Power of any Domain from a real position (CR 811.1.b, 811.1.c)', () => {
  // 811.1.b: the Hide cost is a single [A] — one Power of any Domain.
  const kernel = world().player('A', { power: ['Fury'] }).player('B')
    .hand('card', { cardId: HIDDEN, types: ['unit'], energy: 3, power: [], keywords: [{ id: 'Hidden' }] })
    .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }).build();
  const context = bindResolveContext(kernel.clone({ sourceSnapshot: kernel.getObject('card'), controller: 'A' }), { controller: 'A' });

  const plan = buildHiddenCostPlan(context, { id: 'cost:hide', mode: 'hide' });
  assert.equal(plan.total.energy, 0, 'hiding costs no Energy');
  assert.equal(plan.total.power.length, 1);
  const receipt = payHiddenCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: 'Fury', amount: 1 }]);
});

test('keywords-hidden-play-facedown-next-turn / keywords-hidden-normal-play-still-allowed: 811.3 keeps the normal Hand Play available (CR 811.3)', () => {
  // 811.3 is an explicit permission, not a restriction: Hidden never removes the
  // ordinary printed-cost Play.
  assert.ok(hidden.ruleRefs.includes('811.3'));
  const kernel = world().player('A', { energy: 3 }).player('B')
    .hand('card', { cardId: HIDDEN, types: ['unit'], energy: 3, power: [], keywords: [{ id: 'Hidden' }] })
    .deck(['A:deck:1'], { owner: 'A' }).deck(['B:deck:1'], { owner: 'B' }).build();
  const context = bindResolveContext(kernel.clone({ sourceSnapshot: kernel.getObject('card'), controller: 'A' }), { controller: 'A' });
  const plan = buildHiddenCostPlan(context, { id: 'cost:play', mode: 'play' });
  assert.equal(plan.total.energy, 0, '811.6: the facedown Play ignores the base cost');
  assert.deepEqual(plan.base, { energy: 3, power: [], xp: 0, actions: [] });
});

test.todo('keywords-hidden-play-facedown-next-turn (811.1.b/811.6): playing a hidden card face-up from the facedown Battlefield zone needs the facedown zone as a real location plus a Reaction timing grant that begins next turn — blocked: the reference kernel has no facedown Battlefield storage and no turn-scoped timing grant; `cost.hidden` is authored but no consumer wires the facedown zone, so only the Hide plan above is executable');

test.todo('keywords-hidden-normal-play-still-allowed (CR 811.3): the normal Hand Play is asserted at the plan level above; the scenario’s “enter the Base ready and pay the printed cost” end-to-end Play is not reachable as a *Hidden* card because the reference kernel cannot move a Hand card to a Battlefield facedown in the first place');

test.todo('keywords-hidden-facedown-no-referenceable-characteristics (811.5.a): forbidding Show Off from picking a facedown card needs the facedown zone’s information model (CR 129.4) plus a `cost.reveal` Finalize consumer — both missing; src/effects/keywords/ShowOff.ts records the same dependency');

test.todo('keywords-hidden-spell-targets-must-be-at-battlefield (811.1.d.2) and keywords-hidden-gear-played-to-battlefield-overrides-base-restriction (811.1.d.1): playing a facedown card needs the facedown zone, the 811.1.d target-scope restriction, and a 811.1.d.1.a location override — the merged target pipeline has no “targets must be at the hiding Battlefield” scope, and src/chain/engine.ts playDestinationIsLegal only consumes explicit continuous.location permissions');

test.todo('keywords-hidden-gear-played-to-battlefield-overrides-base-restriction (CR 811.1.d.1.a): the Hidden Gear must enter the Battlefield it was hidden at even though Gear normally enters the Base — the scale of the gap is the same as the facedown-Play todo above plus a destination override in the Finalize legality check');

test.todo('keywords-hidden-play-effect-mistargets-when-source-leaves (811.1.d.3.a): the effect mistarget is already modelled by the merged target rules (CR 359.3.e), but reaching it needs a facedown Play first; registered together with the facedown-zone gap above');
