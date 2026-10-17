// docs/rules/scenarios/keywords.yaml — Legion (CR v1.5 812.1.b.1, 812.1.c, 812.2) and
// Level (824.1.b.1, 824.1.c, 824.1.d).
//
// Both keywords expand to `condition.predicate` static abilities. The merged static
// binder (`src/programs/statics.ts`) maps effect kinds onto layers and has no
// predicate branch, so neither can register: the tests below assert the authored
// predicates and register the dependent abilities with the exact gap.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEngineStaticBinder } from '../../../dist/programs/statics.js';
import legion from '../../../dist/effects/keywords/Legion.js';
import level, { LEVEL_PREDICATE } from '../../../dist/effects/keywords/Level.js';
import { fixture, pendingItems, settle, timingsOnly } from './support.mjs';

const LEGION_CARD = 'test:legion-unit';
const LEVEL_CARD = 'test:level-unit';

const program = canonicalCardId => ({
  canonicalCardId,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: canonicalCardId,
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
});

test('keywords-legion-not-satisfied-first-card-of-turn: Legion expands to one predicate over the turn’s play history (CR 812.1.b.1)', () => {
  assert.equal(legion.keyword, 'Legion');
  assert.equal(legion.valued, false);
  // 812.3 / 807.2 contrast: Legion is not a valued keyword, so duplicates collapse.
  assert.equal(legion.stacking, 'single');

  const [ability] = legion.expand({ host: { canonicalCardId: LEGION_CARD } });
  assert.equal(ability.kind, 'static');
  assert.equal(ability.effect.kind, 'condition.predicate');
  assert.deepEqual(ability.effect.history, {
    scope: 'turn', action: 'play', player: 'controller', excluding: LEGION_CARD
  });
  assert.equal(ability.effect.operator, 'gte');
  assert.equal(ability.effect.right, 1);
  assert.equal(ability.effect.link, 'active');
  assert.equal(ability.effect.id, `legion:${LEGION_CARD}:predicate`);
});

test('keywords-level-active-when-xp-threshold-met: Level expands to one controller-XP predicate per printed threshold (CR 824.1.b.1)', () => {
  assert.equal(level.keyword, 'Level');
  assert.equal(level.valued, true);
  // 824.1.a: every [Level N] clause carries its own dependent text.
  assert.equal(level.stacking, 'separate');

  const [ability] = level.expand({ value: 3, host: { canonicalCardId: LEVEL_CARD } });
  assert.equal(ability.kind, 'static');
  assert.equal(ability.effect.kind, 'condition.predicate');
  assert.equal(ability.effect.predicate, LEVEL_PREDICATE);
  assert.equal(ability.effect.characteristic, 'xp');
  assert.equal(ability.effect.query, 'controller-xp');
  assert.equal(ability.effect.operator, 'gte');
  assert.equal(ability.effect.threshold.value, 3);
  assert.equal(ability.effect.link, 'active');

  // 824.1.a requires N; a missing value stays missing rather than becoming zero.
  const [missing] = level.expand({ host: { canonicalCardId: LEVEL_CARD } });
  assert.equal(missing.effect.threshold.value, null);
});

test('keywords-legion-* and keywords-level-*: the production static binder refuses both predicate abilities with a named reason', () => {
  const f = fixture({
    programs: [program(LEGION_CARD), program(LEVEL_CARD)],
    setup: w => w.player('B')
      .base('legion', { cardId: LEGION_CARD, might: 2, keywords: [{ id: 'Legion' }] })
      .base('level', { cardId: LEVEL_CARD, might: 2, keywords: [{ id: 'Level', value: 3 }] })
  });
  const binder = createEngineStaticBinder(f.engine);

  for (const [id, expected] of [['legion', 'condition.predicate'], ['level', 'condition.predicate']]) {
    const ability = f.binding.inspect(f.get(id)).abilities.find(candidate => candidate.kind === 'static' && candidate.effect?.kind === expected);
    assert.ok(ability, `${id} exposes a ${expected} ability`);
    assert.throws(
      () => binder.bindStatic(ability, f.get(id)),
      error => error.code === 'judge-required' && /has no layer mapping/.test(error.message),
      `${id} fails closed instead of silently granting a condition`
    );
  }
  assert.equal(f.engine.layers.registry.list().length, 0, 'nothing was registered');
});

test('keywords-legion-satisfied-after-another-card-finalized: a real card Play commits the history both predicates need (CR 812.1.c, 824.1.c)', () => {
  const PLAIN = 'test:plain-spell';
  const f = fixture({
    programs: [program(LEGION_CARD), program(LEVEL_CARD), {
      canonicalCardId: PLAIN, rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'Draw 1.',
      abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [{ id: 'draw', op: 'effect.draw', args: { amount: { kind: 'constant', value: 1 }, player: { kind: 'constant', value: 'A' } } }] }]
    }],
    energy: { A: 4 },
    player: { A: { xp: 3 } },
    setup: w => w.hand('spell', { cardId: PLAIN, types: ['spell'], energy: 1, power: null })
  });
  f.play('spell');
  settle(f.engine);

  // The committed Play is in the pipeline history the predicates read, so a later
  // Legion / Level evaluation would have its evidence; the predicates themselves
  // remain unregisterable (see the todo).
  assert.ok(timingsOnly(f.engine).includes('card-played'));
  assert.deepEqual(pendingItems(f.engine), ['play:spell:1:A:1']);
});

test.todo('keywords-legion-satisfied-after-another-card-finalized / keywords-legion-not-satisfied-first-card-of-turn / keywords-legion-one-card-satisfies-all-legion / keywords-level-active-when-xp-threshold-met / keywords-level-inactive-below-threshold (CR 812.1.c, 812.2, 824.1.b.1, 824.1.d): the dependent abilities gated on these predicates cannot run — src/programs/statics.ts `layerFor()` maps only might/buff/copy/type/tag/timing/keyword/movement/restrict/combat effect kinds and throws ProgramBindingError(\'judge-required\', “Static ability kind condition.predicate has no layer mapping”), so the merged kernel has no consumer that turns a satisfied predicate into the +Might / Ganking grant the card text declares; the authored predicate shape is asserted above');

test.todo('keywords-legion-one-card-satisfies-all-legion (CR 812.2): “a single played card satisfies every Legion on the Board” is a consequence of the same controller-scoped history predicate — it cannot run for the reason above, and the merged kernel has no consumer that reads a satisfied predicate to grant the dependent text');

test.todo('keywords-level-inactive-below-threshold (CR 824.1.d): the deactivation half of the Level predicate cannot run — the expansion authors a `gte` threshold over controller XP (asserted in the first test) but no merged consumer reads `condition.predicate` to remove the dependent ability, so the “XP below the threshold turns the clause off” behaviour cannot be observed');
