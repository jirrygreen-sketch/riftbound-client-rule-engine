// docs/rules/scenarios/keywords.yaml — Show Off (CR v1.5 832.1.c, 832.1.c.3, 832.1.c.4,
// 832.1.d.1, 832.2.a).
//
// Show Off expands to a declarative `cost.reveal` static ability. Neither the primitive
// (`src/effects/instructions/registry.generated.ts` has no `cost.reveal`) nor a consumer
// exists, so every scenario’s execution is a todo; the authored declaration is asserted
// below to pin the intended shape.
import assert from 'node:assert/strict';
import test from 'node:test';
import showOff from '../../../dist/effects/keywords/ShowOff.js';
import { instructionDefinitionsById } from '../../../dist/effects/instructions/registry.generated.js';
import { createEngineStaticBinder } from '../../../dist/programs/statics.js';
import { fixture } from './support.mjs';

const SHOW_OFF_CARD = 'test:show-off-card';

const program = {
  canonicalCardId: SHOW_OFF_CARD,
  rulesetVersion: 'core-1.5',
  status: 'executable',
  sourceText: '[Show Off] a unit. If you showed off, …',
  abilities: [{ kind: 'play', cost: { kind: 'printed' }, body: [] }]
};

test('keywords-showoff-reveal-from-hand-locks-value: Show Off expands to a Finalize-time optional reveal/pick declaration (CR 832.1.c, 832.1.d.1)', () => {
  assert.equal(showOff.keyword, 'Show Off');
  assert.equal(showOff.valued, false);
  // 832.2: each instance keeps its own linked result and snapshot.
  assert.equal(showOff.stacking, 'separate');
  for (const ref of ['832.1.c', '832.1.c.3', '832.1.c.4', '832.1.d.1', '832.2.a']) {
    assert.ok(showOff.ruleRefs.includes(ref), `cites ${ref}`);
  }

  const [ability] = showOff.expand({ host: { canonicalCardId: SHOW_OFF_CARD } });
  assert.equal(ability.kind, 'static');
  const effect = ability.effect;
  assert.equal(effect.kind, 'cost.reveal');
  assert.equal(effect.appliesTo, 'self');
  assert.equal(effect.chooser, 'controller');
  assert.equal(effect.timing, 'chain-item-finalize');
  assert.equal(effect.optional, true, '832.1.c.2: the controller may decline');
  assert.deepEqual(effect.sources, ['hand', 'board'], '832.1.c.3: hand reveal and board pick can mix');
  assert.equal(effect.handAction, 'reveal');
  assert.equal(effect.boardAction, 'pick');
  assert.equal(effect.result.lockAt, 'objects-shown-off');
  assert.equal(effect.result.snapshot, true, '832.1.d.1: characteristics are locked at Finalize');
  assert.equal(effect.result.kind, 'show-off');
});

test('keywords-showoff-reveal-from-hand-locks-value: an instance without a compiler-supplied id stays explicitly pending rather than merging (CR 832.2.a)', () => {
  const first = showOff.expand({ host: { canonicalCardId: SHOW_OFF_CARD } })[0];
  const second = showOff.expand({ host: { canonicalCardId: SHOW_OFF_CARD } })[0];
  assert.equal(first.effect.instanceId, `show-off:${SHOW_OFF_CARD}:pending`);
  assert.equal(second.effect.instanceId, first.effect.instanceId);

  // With an explicit per-instance id the two stay distinct.
  const a = showOff.expand({ host: { canonicalCardId: SHOW_OFF_CARD }, params: { instanceId: 'a' } })[0];
  const b = showOff.expand({ host: { canonicalCardId: SHOW_OFF_CARD }, params: { instanceId: 'b' } })[0];
  assert.equal(a.effect.instanceId, 'a');
  assert.equal(b.effect.instanceId, 'b');
  assert.notEqual(a.effect.result.link, b.effect.result.link);

  // 832.1.c: the printed Object clause is supplied by the compiler, not invented.
  assert.equal(first.effect.object, null);
});

test('keywords-showoff-pick-from-board / keywords-showoff-set-can-mix-hand-and-board: the production static binder refuses the declaration', () => {
  const f = fixture({
    programs: [program],
    setup: w => w.hand('card', { cardId: SHOW_OFF_CARD, types: ['unit'], keywords: [{ id: 'Show Off' }], might: 2 })
  });
  const [ability] = f.binding.inspect(f.get('card')).abilities.filter(candidate => candidate.kind === 'static');
  assert.equal(ability.effect.kind, 'cost.reveal');
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(ability, f.get('card')),
    error => error.code === 'judge-required' && /has no layer mapping/.test(error.message)
  );
});

test('keywords-showoff-no-valid-choice-play-normally: the declinable shape is authored, and the optional flag is not a boolean keyword value (CR 832.1.c.2)', () => {
  const withValue = showOff.expand({ value: 0, host: { canonicalCardId: SHOW_OFF_CARD } })[0];
  const withLargeValue = showOff.expand({ value: 9, host: { canonicalCardId: SHOW_OFF_CARD } })[0];
  assert.deepEqual(withLargeValue, withValue, 'an accidental numeric value is ignored');
  assert.equal(withValue.effect.optional, true);
});

test.todo('keywords-showoff-reveal-from-hand-locks-value / keywords-showoff-pick-from-board / keywords-showoff-set-can-mix-hand-and-board / keywords-showoff-no-valid-choice-play-normally / keywords-showoff-multiple-instances-linked-separately (CR 832.1.c, 832.1.c.2, 832.1.c.3, 832.2.a): no merged consumer exists — the generated instruction registry has no `cost.reveal` op (the expansion’s effect kind), src/programs/statics.ts `layerFor()` throws ProgramBindingError judge-required for it, and no Finalize choice plan reads `effect.sources`/`effect.result`, so neither the reveal/pick set nor its locked snapshot can be produced; the authored declaration is asserted above');

test.todo('keywords-showoff-leaving-zone-after-shown-still-finalizes (CR 832.1.c.4): the scenario needs both the Show Off consumer and an additional discard cost on the same card; the merged cost layer supports `discard` payments (src/cost/kinds/discard.ts), but nothing connects the Show Off set to the Finalize plan yet');

test.todo('keywords-showoff-set-can-mix-hand-and-board (CR 832.1.c.3): the expansion already records `sources: ["hand", "board"]` and the separate `handAction`/`boardAction` (asserted above), but building a set that mixes both parts needs the missing `cost.reveal` Finalize choice plan');

test.todo('keywords-showoff-multiple-instances-linked-separately (CR 832.2, 832.2.a): the per-instance `link` and `instanceId` are authored and asserted above (two instances never merge), but consuming them — one Show Off satisfying only the granted clause while the card’s own clause stays unmet — needs the missing `cost.reveal` consumer and a `condition.result` reader for the locked snapshot');

test.todo('keywords-hidden-facedown-no-referenceable-characteristics (CR 811.5.a, cross-chapter): the negative scenario asserts that a facedown card cannot be picked by Show Off — blocked by the same missing `cost.reveal` consumer plus the missing facedown zone; recorded in 811-hidden.test.mjs as well');

assert.equal(instructionDefinitionsById.has('cost.reveal'), false, 'documents the missing op named above');
